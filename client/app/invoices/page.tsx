"use client";

import { OwnSectionGate } from "@/components/auth/own-section-gate";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { RequireAuth } from "@/components/auth/require-auth";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { Tag } from "@/components/ui/tag";
import { Note } from "@/components/ui/note";
import { Steps } from "@/components/ui/steps";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { StatusPill } from "@/components/ui/status-pill";
import { Field, TextField } from "@/components/ui/form-field";
import { DownloadIcon, SearchIcon, PlusIcon, AlertIcon, CheckCircleIcon, CloseIcon, MoreIcon, ArrowRightIcon } from "@/components/icons";
import { Th, TableSkeleton, EmptyState, ErrorNotice } from "@/components/ui/table-parts";
import { InvoiceAttachmentControl } from "@/components/invoices/invoice-attachment";
import { PaySheet, toPaymentInvoice } from "@/components/payments/pay-sheet";
import { useAuth } from "@/lib/auth-context";
import { InvoiceNumberingCard } from "@/components/invoices/invoice-numbering-card";
import { ClientInvoicesPanel } from "@/components/invoices/client-invoices-panel";
import { AttachInvoiceModal } from "@/components/invoices/attach-invoice-modal";
import {
  invoices as invoicesApi,
  links as linksApi,
  campaigns as campaignsApi,
  INVOICEABLE_LINK_STATUSES_CSV,
  ApiError,
  hasAccess,
  type Invoice,
  type Link,
  type Campaign,
  canUse,
} from "@/lib/api-client";
import { money, initialsOf, roleLabel, personLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { formatLabel } from "@/lib/formats";

/** Posts on an invoice beyond their campaign booking (29 Sep) — non-zero blocks Approve and Pay until it's rejected and re-raised. */
const overQuotaOf = (inv: Invoice) => inv.overQuotaCount ?? 0;

export default function InvoicesPage() {
  return (
    <RequireAuth>
      <OwnSectionGate ownKey="finance.view" active="invoices">
        <InvoicesContent />
      </OwnSectionGate>
    </RequireAuth>
  );
}

function InvoicesContent() {
  const { user, accessToken } = useAuth();
  const queryClient = useQueryClient();
  // Seeds the filters from the URL once on mount — lets the admin dashboard
  // deep-link here already filtered (e.g. /invoices?status=RAISED) instead
  // of landing on an unfiltered list the admin then has to re-filter by hand.
  const searchParams = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState(searchParams.get("search") ?? "");
  const [statusFilter, setStatusFilter] = useState<Invoice["status"] | "">(
    (searchParams.get("status") as Invoice["status"] | null) ?? ""
  );
  const [paymentFilter, setPaymentFilter] = useState<Invoice["paymentStatus"] | "">(
    (searchParams.get("paymentStatus") as Invoice["paymentStatus"] | null) ?? ""
  );
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [showNewInvoice, setShowNewInvoice] = useState(false);
  const [showAttachInvoice, setShowAttachInvoice] = useState(false);
  // Paying an invoice off directly (28 Sep) opens the same TDS + mandatory-
  // receipt PaySheet the Payments tab uses, instead of the old bare mark-paid.
  const [payingInvoice, setPayingInvoice] = useState<Invoice | null>(null);
  // Payables (creators bill us) vs Receivables (we bill the plan's client) —
  // user decision, 23 Sep. Deep-linkable as ?view=receivables.
  const [view, setView] = useState<"payables" | "receivables">(searchParams.get("view") === "receivables" ? "receivables" : "payables");
  const token = accessToken!;

  const invoicesQuery = useQuery({
    queryKey: ["invoices", search, statusFilter, paymentFilter],
    queryFn: () =>
      invoicesApi.list(token, {
        pageSize: 100,
        search: search || undefined,
        status: statusFilter || undefined,
        paymentStatus: paymentFilter || undefined,
      }),
  });

  const items = invoicesQuery.data?.items ?? [];
  const selected = items.find((i) => i.id === selectedId) ?? items[0];
  // Mobile's sheet only opens on an explicit tap — no fallback-to-first-row like the desktop panel below.
  const mobileSelected = selectedId ? items.find((i) => i.id === selectedId) : undefined;

  const kpis = useMemo(() => {
    const totalRaised = items.reduce((sum, i) => sum + Number(i.amount), 0);
    const pending = items.filter((i) => i.status === "RAISED" || i.status === "APPROVED");
    const overdue = pending.filter((i) => i.overdueDays > 0);
    return {
      totalRaised,
      pendingCount: pending.length,
      pendingAmount: pending.reduce((sum, i) => sum + Number(i.amount), 0),
      overdueCount: overdue.length,
      overdueAmount: overdue.reduce((sum, i) => sum + Number(i.amount), 0),
    };
  }, [items]);

  // finance.manage (15 Sep — a plain ADMIN/FINANCE by default, or any other
  // role explicitly granted it) mirrors the server's requireAccess() gates
  // below.
  // Per-action keys (23 Sep): pay = mark paid / reject, approve = the sign-off, edit = GST / payment status.
  const canManage = hasAccess(user, "finance.pay");
  const canEditStatus = hasAccess(user, "finance.edit");
  // Creators raise their own invoices (user request, 13 Sep — "invoice will be generated by creator's only").
  const canRaiseInvoice = user?.role === "CREATOR" && canUse(user, "finance.edit");
  // Sign-off (RAISED → APPROVED) and payment share one gate since 23 Sep:
  // Finance approves and pays. Server mirrors this — POST
  // /invoices/:id/approve is finance.manage-gated with FINANCE as a bare
  // role, same as mark-paid.
  const canApprove = hasAccess(user, "finance.approve");
  // Receivables are the agency's own money in: Admin/Finance settle them, a
  // Plan Maker can see the ones on their plans. Server: GET /invoices/client.
  const canSeeReceivables = hasAccess(user, "finance.view") || user?.role === "PLAN_MAKER";

  const approveMutation = useMutation({
    mutationFn: (id: string) => invoicesApi.approve(token, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["invoices"] }),
  });
  const gstMutation = useMutation({
    mutationFn: ({ id, gstStatus }: { id: string; gstStatus: Invoice["gstStatus"] }) => invoicesApi.updateGstStatus(token, id, gstStatus),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["invoices"] }),
  });
  const downloadMutation = useMutation({
    mutationFn: (inv: Invoice) => invoicesApi.downloadPdf(token, inv.id, inv.invoiceNumber),
  });
  const downloadLinksMutation = useMutation({
    mutationFn: (inv: Invoice) => invoicesApi.downloadLinks(token, inv.id, inv.invoiceNumber),
  });
  const rejectMutation = useMutation({
    mutationFn: ({ id, remarks }: { id: string; remarks: string }) => invoicesApi.reject(token, id, remarks),
    onSuccess: () => {
      setRejectingId(null);
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
    },
  });

  const NEXT_GST: Record<Invoice["gstStatus"], Invoice["gstStatus"]> = {
    PENDING: "SCHEDULED",
    SCHEDULED: "COMPLETED",
    COMPLETED: "COMPLETED",
  };

  // Shared between the desktop persistent panel and the mobile bottom
  // sheet — same content, different outer chrome, so this stays one
  // definition instead of two copies drifting apart.
  function renderInvoiceDetail(inv: Invoice) {
    return (
      <>
        <div>
          <div className="font-mono text-xs text-text-faint">{inv.invoiceNumber}</div>
          <div className="text-[1.875rem] font-semibold tracking-tight tabular-nums">{money(inv.amount)}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusPill status={inv.status} />
          <StatusPill status={inv.paymentStatus} />
          <StatusPill status={inv.gstStatus} />
          {inv.isGstInvoice && (
            <span className="rounded-full border border-accent/25 bg-accent-soft px-2.5 py-1 text-[0.6875rem] font-semibold text-accent">
              GST invoice
            </span>
          )}
        </div>
        {inv.status === "REJECTED" && inv.remarks && (
          <p className="rounded-md border border-rose/30 bg-rose-soft px-3.5 py-2.5 text-[0.8125rem] text-rose">{inv.remarks}</p>
        )}
        {overQuotaOf(inv) > 0 && inv.status !== "REJECTED" && inv.status !== "PAID" && (
          <p className="rounded-md border border-rose/30 bg-rose-soft px-3.5 py-2.5 text-[0.8125rem] text-rose" data-testid="invoice-over-quota">
            <b className="font-semibold">
              {overQuotaOf(inv)} post{overQuotaOf(inv) === 1 ? " is" : "s are"} beyond what the campaign booked.
            </b>{" "}
            This invoice can&rsquo;t be approved or paid as it stands — reject it so it can be raised again with only the booked posts.
          </p>
        )}
        <div className="h-px bg-border" />
        <div className="flex flex-col gap-3">
          {(inv.items ?? []).slice(0, 4).map((item) => (
            <LineItem key={item.id} title={item.link?.campaign?.title ?? item.link?.url ?? "Link"} amount={money(item.amount)} />
          ))}
          {(inv.items?.length ?? 0) > 4 && <LineItem title={`+ ${inv.items!.length - 4} more approved links`} amount="" />}
        </div>
        <div className="flex flex-col gap-1.5 border-t border-border pt-3.5 text-[0.8125rem]">
          {inv.isGstInvoice && (
            <>
              <div className="flex items-center justify-between text-text-faint">
                <span>Subtotal</span>
                <span className="tabular-nums">{money(inv.subtotal)}</span>
              </div>
              <div className="flex items-center justify-between text-text-faint">
                <span>GST (18%)</span>
                <span className="tabular-nums">{money(inv.gstAmount)}</span>
              </div>
            </>
          )}
          <div className="flex items-center justify-between">
            <span className="text-text-faint">Total</span>
            <span className="text-[1.125rem] font-semibold tabular-nums">{money(inv.amount)}</span>
          </div>
        </div>

        <InvoiceAttachmentControl token={token} invoice={inv} />

        <Button variant="secondary" size="lg" className="w-full" onClick={() => downloadMutation.mutate(inv)} disabled={downloadMutation.isPending}>
          <DownloadIcon className="h-3.5 w-3.5" />
          {downloadMutation.isPending ? "Preparing PDF…" : "Download PDF"}
        </Button>
        <Button
          variant="secondary"
          size="lg"
          className="w-full"
          onClick={() => downloadLinksMutation.mutate(inv)}
          disabled={downloadLinksMutation.isPending}
        >
          <SearchIcon className="h-3.5 w-3.5" />
          {downloadLinksMutation.isPending ? "Preparing…" : "Download links"}
        </Button>

        {canApprove && inv.status === "RAISED" && overQuotaOf(inv) === 0 && (
          <Button size="lg" className="w-full" onClick={() => approveMutation.mutate(inv.id)} disabled={approveMutation.isPending}>
            <CheckCircleIcon className="h-4 w-4 text-accent-ink" />
            {approveMutation.isPending ? "Approving…" : "Approve invoice"}
          </Button>
        )}
        {/* Payment only once approved (12 Sep) — a RAISED invoice shows
            Approve and nothing payable until that's done. Paying opens the
            same TDS + mandatory-receipt PaySheet the Payments tab uses (28
            Sep) — an invoice is paid off exclusively through a Payout now. */}
        {canManage && inv.status === "APPROVED" && overQuotaOf(inv) === 0 && (
          <Button size="lg" className="w-full" onClick={() => setPayingInvoice(inv)}>
            Mark as paid
          </Button>
        )}
        {canManage && inv.status !== "PAID" && inv.status !== "REJECTED" && (
          <Button variant="danger" size="lg" className="w-full" onClick={() => setRejectingId(inv.id)}>
            Reject invoice
          </Button>
        )}
        {canEditStatus && inv.gstStatus !== "COMPLETED" && (
          <Button
            variant="secondary"
            size="lg"
            className="w-full"
            onClick={() => gstMutation.mutate({ id: inv.id, gstStatus: NEXT_GST[inv.gstStatus] })}
            disabled={gstMutation.isPending}
          >
            {gstMutation.isPending ? "Updating…" : `Advance GST to ${NEXT_GST[inv.gstStatus].toLowerCase()}`}
          </Button>
        )}

        {(approveMutation.isError || gstMutation.isError || downloadMutation.isError || downloadLinksMutation.isError) && (
          <ErrorNotice
            message={
              approveMutation.error instanceof ApiError
                ? approveMutation.error.message
                : gstMutation.error instanceof ApiError
                  ? gstMutation.error.message
                  : downloadMutation.error instanceof ApiError
                    ? downloadMutation.error.message
                    : downloadLinksMutation.error instanceof ApiError
                      ? downloadLinksMutation.error.message
                      : "Something went wrong."
            }
          />
        )}
      </>
    );
  }

  return (
    <AppShell
      active="invoices"
      user={{ initials: initialsOf(user?.name), name: user?.name ?? "—", role: roleLabel(user?.role), tone: user?.role === "FINANCE" ? "blue" : "emerald" }}
      searchPlaceholder="Search invoice number, creator…"
      fab={
        canRaiseInvoice ? (
          <Button size="lg" className="h-14 rounded-full px-5 shadow-glow" onClick={() => setShowNewInvoice(true)}>
            <PlusIcon className="h-4 w-4 text-accent-ink" />
            New invoice
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-7">
        <div>
          <p className="mb-1 text-[0.68rem] font-medium uppercase tracking-[0.06em] text-text-faint">Finance</p>
          <h1 className="mb-1 text-[1.5rem] font-semibold leading-tight tracking-[-0.03em] md:text-[1.625rem]">Invoices</h1>
          <p className="max-w-[56ch] text-[0.875rem] text-text-muted">
            {view === "receivables"
              ? canManage
                ? "What clients owe us, on plans with a real invoice attached — not just the Proforma."
                : "Client invoices issued from your approved plans — what clients owe, settled manually."
              : "Raised, paid, and GST status — tracked independently, settled manually."}
          </p>
        </div>

        {canSeeReceivables && (
          <div role="tablist" aria-label="Invoice direction" className="inline-flex w-fit rounded-full border border-border bg-surface p-1 text-[0.8125rem]">
            {(
              [
                ["payables", "Payables · creators"],
                ["receivables", "Receivables · clients"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                role="tab"
                aria-selected={view === key}
                onClick={() => setView(key)}
                className={cn("rounded-full px-3.5 py-1.5 font-medium transition-colors", view === key ? "bg-ink text-ink-fg" : "text-text-muted hover:text-text")}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {view === "receivables" && canSeeReceivables ? (
          // Attached-only for whoever can actually do something about an
          // unattached row (Admin/Finance — Mark paid/Cancel, plus the new
          // "Attach an invoice" picker below). A Plan Maker has neither on
          // this page, so filtering them the same way would just make their
          // own receivables disappear with no way to bring them back — they
          // keep seeing everything, same as before this change.
          <ClientInvoicesPanel token={token} canManage={canManage} hasAttachment={canManage} onAttachInvoice={canManage ? () => setShowAttachInvoice(true) : undefined} />
        ) : (
          <>

        {/* Horizontal-scroll strip on mobile, a 3-up grid at md+. */}
        <div className="flex gap-3 overflow-x-auto pb-1 -mx-4 px-4 md:mx-0 md:grid md:grid-cols-3 md:gap-4 md:overflow-visible md:px-0 md:pb-0">
          <KpiCard className="w-[170px] shrink-0 md:w-auto" label="Total raised" value={money(kpis.totalRaised)} foot={`${items.length} invoices total`} />
          <KpiCard className="w-[170px] shrink-0 md:w-auto" label="Pending payment" value={money(kpis.pendingAmount)} foot={`${kpis.pendingCount} invoice${kpis.pendingCount === 1 ? "" : "s"} awaiting settlement`} />
          <KpiCard className="w-[170px] shrink-0 md:w-auto" label="Overdue" value={money(kpis.overdueAmount)} foot={`${kpis.overdueCount} invoice${kpis.overdueCount === 1 ? "" : "s"} past due date`} tone={kpis.overdueCount > 0 ? "rose" : undefined} />
        </div>

        {/* finance.edit (23 Sep) — matches the server route; a plain Finance
            account holds it by baseline, so this stays where it was, but a
            restricted Finance/granted other role now sees the real state. */}
        {canEditStatus && accessToken && <InvoiceNumberingCard token={accessToken} />}

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex h-9 min-w-[160px] flex-1 items-center gap-2 rounded-full border border-border bg-surface px-3.5 text-[0.8125rem] text-text-faint sm:flex-none sm:w-64">
            <SearchIcon className="h-3.5 w-3.5 shrink-0" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search invoice number…"
              className="w-full bg-transparent text-text placeholder:text-text-faint focus:outline-none"
            />
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as Invoice["status"] | "")}
            className="h-9 rounded-full border border-border bg-surface px-3.5 text-[0.8125rem] text-text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-30"
          >
            <option value="">Invoice status</option>
            <option value="DRAFT">Draft</option>
            <option value="RAISED">Raised</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
            <option value="PAID">Paid</option>
          </select>

          <select
            value={paymentFilter}
            onChange={(e) => setPaymentFilter(e.target.value as Invoice["paymentStatus"] | "")}
            className="h-9 rounded-full border border-border bg-surface px-3.5 text-[0.8125rem] text-text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-30"
          >
            <option value="">Payment status</option>
            <option value="PENDING">Pending</option>
            <option value="COMPLETED">Completed</option>
            <option value="CANCELLED">Cancelled</option>
          </select>

          <div className="hidden flex-1 md:block" />
          <Button variant="secondary" size="sm" className="rounded-full">
            <DownloadIcon className="h-3.5 w-3.5" />
            Export CSV
          </Button>
          {canRaiseInvoice && (
            <Button size="sm" className="hidden rounded-full md:inline-flex" onClick={() => setShowNewInvoice(true)}>
              <PlusIcon className="h-3.5 w-3.5" />
              New invoice
            </Button>
          )}
        </div>

        <div className="flex flex-col gap-4 md:flex-row md:gap-5 md:items-stretch">
          {/* No internal height cap or scroll region here on purpose — the
              table grows to fit every row and the page itself scrolls
              (newTask.md / user feedback, 9 Sep: "full scrollable, no fixed
              size of height" — a bounded box with its own scrollbar felt
              small regardless of how tall the browser window was). */}
          <div className="hidden flex-1 flex-col rounded-lg border border-border bg-surface shadow-card md:flex">
            <div
              data-testid="invoice-table-header"
              className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1.2fr)_minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1.1fr)] gap-3 border-b border-border px-5 py-3.5"
            >
              <Th>Invoice</Th>
              <Th>Creator</Th>
              <Th>Amount</Th>
              <Th>Status</Th>
              <Th>Payment</Th>
              <Th>GST status</Th>
              <Th>Due</Th>
              <Th>Action</Th>
            </div>

            {invoicesQuery.isLoading ? (
              <TableSkeleton />
            ) : items.length === 0 ? (
              <EmptyState label="No invoices raised yet — bulk-invoice submitted links from My Works." />
            ) : (
              <div data-testid="invoice-row-list">
                {items.map((inv) => {
                  const isOverdue = inv.overdueDays > 0;
                  const isPaid = inv.status === "PAID";
                  return (
                    <div
                      key={inv.id}
                      onClick={() => setSelectedId(inv.id)}
                      className={cn(
                        "grid cursor-pointer grid-cols-[minmax(0,1.1fr)_minmax(0,1.2fr)_minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1.1fr)] items-center gap-3 border-b border-border px-5 py-4 hover:bg-surface-2",
                        (inv.id === selectedId || (!selectedId && inv.id === items[0]?.id)) && "bg-surface-2"
                      )}
                    >
                      <div className="truncate font-mono text-[0.8125rem] text-text-muted">{inv.invoiceNumber}</div>
                      <div className="truncate text-[0.8438rem] text-text-muted">{personLabel(inv.creator, "—")}</div>
                      <div className="text-[0.9375rem] font-semibold tabular-nums">{money(inv.amount)}</div>
                      <div className="flex flex-col gap-1">
                        <StatusPill status={inv.status} />
                        {inv.status === "REJECTED" && inv.remarks && (
                          <span className="truncate text-[0.6875rem] text-rose" title={inv.remarks}>
                            {inv.remarks}
                          </span>
                        )}
                      </div>
                      <div>
                        <StatusPill status={inv.paymentStatus} />
                      </div>
                      <div>
                        <StatusPill status={inv.gstStatus} />
                      </div>
                      <div className={cn("text-xs", isOverdue ? "font-semibold text-rose" : "text-text-faint")}>
                        {isPaid ? (inv.paidAt ? `Settled ${new Date(inv.paidAt).toLocaleDateString()}` : "Settled") : isOverdue ? `Overdue · ${inv.overdueDays}d` : inv.dueDate ? `Due ${new Date(inv.dueDate).toLocaleDateString()}` : "—"}
                      </div>
                      <InvoiceRowActions
                        inv={inv}
                        canManage={canManage}
                        canApprove={canApprove}
                        onApprove={() => approveMutation.mutate(inv.id)}
                        approvePending={approveMutation.isPending}
                        onMarkPaid={() => setPayingInvoice(inv)}
                        onReject={() => setRejectingId(inv.id)}
                        onDownloadPdf={() => downloadMutation.mutate(inv)}
                        onDownloadLinks={() => downloadLinksMutation.mutate(inv)}
                        downloadPdfPending={downloadMutation.isPending}
                        downloadLinksPending={downloadLinksMutation.isPending}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Mobile: cards instead of a table row. */}
          <div className="flex flex-col gap-3 md:hidden">
            {invoicesQuery.isLoading ? (
              <TableSkeleton />
            ) : items.length === 0 ? (
              <EmptyState label="No invoices raised yet — bulk-invoice submitted links from My Works." />
            ) : (
              items.map((inv) => {
                const isOverdue = inv.overdueDays > 0;
                const isPaid = inv.status === "PAID";
                return (
                  <div
                    key={inv.id}
                    onClick={() => setSelectedId(inv.id)}
                    className="flex flex-col gap-2.5 rounded-[14px] border border-border bg-surface p-3.5 shadow-card"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-mono text-xs text-text-faint">{inv.invoiceNumber}</span>
                      <StatusPill status={inv.status} />
                    </div>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[0.8125rem] text-text-muted">{personLabel(inv.creator, "—")}</span>
                      <span className="shrink-0 text-[1.0625rem] font-semibold tabular-nums">{money(inv.amount)}</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <StatusPill status={inv.paymentStatus} />
                      <StatusPill status={inv.gstStatus} />
                    </div>
                    <div className="flex items-center justify-between border-t border-border pt-2.5">
                      <span className={cn("text-xs", isOverdue ? "font-semibold text-rose" : "text-text-faint")}>
                        {isPaid
                          ? inv.paidAt
                            ? `Settled ${new Date(inv.paidAt).toLocaleDateString()}`
                            : "Settled"
                          : isOverdue
                            ? `Overdue · ${inv.overdueDays}d`
                            : inv.dueDate
                              ? `Due ${new Date(inv.dueDate).toLocaleDateString()}`
                              : "—"}
                      </span>
                      <div onClick={(e) => e.stopPropagation()} className="flex items-center gap-1">
                        {canApprove && inv.status === "RAISED" && overQuotaOf(inv) === 0 && (
                          <Button size="sm" className="h-9 px-2.5" onClick={() => approveMutation.mutate(inv.id)} disabled={approveMutation.isPending}>
                            Approve
                          </Button>
                        )}
                        {canManage && inv.status === "APPROVED" && overQuotaOf(inv) === 0 && (
                          <Button
                            size="sm"
                            className="h-9 bg-accent-soft px-2.5 text-accent shadow-none hover:brightness-100"
                            onClick={() => setPayingInvoice(inv)}
                          >
                            Mark paid
                          </Button>
                        )}
                        <button
                          title="Download PDF"
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-text-faint hover:bg-surface-2 hover:text-text-muted disabled:opacity-50"
                          onClick={() => downloadMutation.mutate(inv)}
                          disabled={downloadMutation.isPending}
                        >
                          <DownloadIcon className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Desktop: persistent side panel — grows with its content, same
              as the table, no separate scroll region of its own. */}
          <div
            data-testid="invoice-detail-panel"
            className="hidden w-[340px] shrink-0 flex-col gap-5 rounded-lg border border-border bg-surface p-6 shadow-card md:flex"
          >
            {selected && renderInvoiceDetail(selected)}
          </div>
        </div>
          </>
        )}
      </div>

      {/* Mobile: detail opens as a bottom sheet. */}
      {mobileSelected && (
        <Sheet onClose={() => setSelectedId(null)} overlayClassName="md:hidden" panelClassName="md:hidden">
          <div className="flex flex-col gap-5 overflow-y-auto p-6 pt-1">{renderInvoiceDetail(mobileSelected)}</div>
        </Sheet>
      )}

      {rejectingId && (
        <RejectInvoiceModal
          onClose={() => setRejectingId(null)}
          onConfirm={(remarks) => rejectMutation.mutate({ id: rejectingId, remarks })}
          isPending={rejectMutation.isPending}
          error={rejectMutation.error instanceof ApiError ? rejectMutation.error.message : rejectMutation.isError ? "Couldn't reject this invoice." : undefined}
        />
      )}

      {showNewInvoice && (
        <NewInvoiceModal
          token={token}
          onClose={() => setShowNewInvoice(false)}
          onRaised={() => {
            queryClient.invalidateQueries({ queryKey: ["invoices"] });
            queryClient.invalidateQueries({ queryKey: ["links"] });
          }}
        />
      )}

      {showAttachInvoice && <AttachInvoiceModal token={token} canManage={canManage} onClose={() => setShowAttachInvoice(false)} />}

      {payingInvoice && (
        <PaySheet
          mode="new"
          token={token}
          vendor={payingInvoice.creator!}
          links={[]}
          invoices={[toPaymentInvoice(payingInvoice)]}
          onRemoveLink={() => {}}
          // Only one invoice is ever in this sheet — removing it leaves nothing to pay, so close instead of showing PaySheet's "no links left" state (which assumes links, not invoices).
          onRemoveInvoice={() => setPayingInvoice(null)}
          onClose={() => setPayingInvoice(null)}
          onPaid={() => {
            setPayingInvoice(null);
            queryClient.invalidateQueries({ queryKey: ["invoices"] });
            queryClient.invalidateQueries({ queryKey: ["payments"] });
          }}
        />
      )}
    </AppShell>
  );
}

/**
 * Desktop invoice-row actions — was 4 separate controls fighting for one
 * 32px row (Mark paid, a reject icon-button, a download-links icon-button,
 * a download-PDF icon-button). "Mark paid" is the one action taken
 * constantly, so it stays a visible primary button; the other three move
 * behind a single "more actions" trigger, closed by default.
 */
function InvoiceRowActions({
  inv,
  canManage,
  canApprove,
  onApprove,
  approvePending,
  onMarkPaid,
  onReject,
  onDownloadPdf,
  onDownloadLinks,
  downloadPdfPending,
  downloadLinksPending,
}: {
  inv: Invoice;
  canManage: boolean;
  canApprove: boolean;
  onApprove: () => void;
  approvePending: boolean;
  onMarkPaid: () => void;
  onReject: () => void;
  onDownloadPdf: () => void;
  onDownloadLinks: () => void;
  downloadPdfPending: boolean;
  downloadLinksPending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // Reject stays available on anything still open; paying needs APPROVED
  // (server-enforced too) — so a RAISED row shows Approve for Admin and
  // no payment action for Finance until that's done.
  const canAct = canManage && inv.status !== "PAID" && inv.status !== "REJECTED";
  // Over-quota posts on it (29 Sep): Reject stays (that's how it's resolved), Approve and Pay don't.
  const blocked = overQuotaOf(inv) > 0;
  const canPay = canManage && inv.status === "APPROVED" && !blocked;
  const showApprove = canApprove && inv.status === "RAISED" && !blocked;

  useEffect(() => {
    if (!open) return;
    function onOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onOutside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onOutside);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open]);

  return (
    <div ref={ref} onClick={(e) => e.stopPropagation()} className="relative flex items-center justify-end gap-1.5">
      {showApprove && (
        <Button size="sm" className="h-8" onClick={onApprove} disabled={approvePending}>
          Approve
        </Button>
      )}
      {canPay && (
        <Button size="sm" className="h-8 bg-accent-soft text-accent shadow-none hover:brightness-100" onClick={onMarkPaid}>
          Mark paid
        </Button>
      )}
      <button
        type="button"
        title="More actions"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid={`invoice-actions-trigger-${inv.id}`}
        onClick={() => setOpen((v) => !v)}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-faint hover:bg-surface-2 hover:text-text-muted"
      >
        <MoreIcon className="h-3.5 w-3.5 rotate-90" />
      </button>
      {open && (
        <div
          role="menu"
          data-testid={`invoice-actions-menu-${inv.id}`}
          className="absolute right-0 top-[calc(100%+4px)] z-20 w-48 rounded-md border border-border-strong bg-surface-2 p-1 shadow-card"
        >
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onDownloadPdf();
            }}
            disabled={downloadPdfPending}
            className="flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-left text-[0.8125rem] font-medium text-text-muted hover:bg-surface-hover hover:text-text disabled:opacity-50"
          >
            <DownloadIcon className="h-3.5 w-3.5" /> Download PDF
          </button>
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onDownloadLinks();
            }}
            disabled={downloadLinksPending}
            className="flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-left text-[0.8125rem] font-medium text-text-muted hover:bg-surface-hover hover:text-text disabled:opacity-50"
          >
            <SearchIcon className="h-3.5 w-3.5" /> Download links
          </button>
          {canAct && (
            <>
              <div className="my-1 h-px bg-border" />
              <button
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onReject();
                }}
                className="flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-left text-[0.8125rem] font-semibold text-rose hover:bg-rose-soft"
              >
                <CloseIcon className="h-3.5 w-3.5" /> Reject invoice
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function RejectInvoiceModal({
  onClose,
  onConfirm,
  isPending,
  error,
}: {
  onClose: () => void;
  onConfirm: (remarks: string) => void;
  isPending: boolean;
  error?: string;
}) {
  const [remarks, setRemarks] = useState("");

  return (
    <Sheet onClose={onClose} panelClassName="md:max-w-[420px]">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onConfirm(remarks);
        }}
        className="flex flex-col gap-5 overflow-y-auto p-6 pt-1"
      >
        <h2 className="text-lg font-semibold">Reject invoice</h2>
        <p className="text-[0.8125rem] text-text-faint">Its links go back to whatever status they were in before this invoice, eligible to be re-invoiced once the issue is fixed.</p>
        <Field label="Reason">
          <TextField required value={remarks} onChange={setRemarks} placeholder="e.g. duplicate links, cost difference…" />
        </Field>
        {error && <ErrorNotice message={error} />}
        <div className="flex gap-2.5">
          <Button type="button" variant="ghost" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" className="flex-1" disabled={isPending || !remarks.trim()}>
            {isPending ? "Rejecting…" : "Reject invoice"}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}

// Mirrors server/src/modules/invoices/service.js's GST_RATE — a live
// preview of the total before submitting has to match what the server will
// actually charge, or the preview is worse than useless.
const GST_RATE = 0.18;

/**
 * "New invoice" flow (raised from a dedicated Invoices-page entry point,
 * distinct from the multi-select "Bulk invoice" on My Works). Two steps:
 *   1. Filters — narrow down by date range and/or campaign (newTask.md #4).
 *   2. Preview — the links that matched, grouped by campaign, a live
 *      subtotal/GST/total breakdown, and the GST-vs-non-GST choice, before
 *      actually raising anything.
 * Fetches every link eligible for invoicing (not rejected/broken, not yet
 * on an invoice — see INVOICEABLE_LINK_STATUSES_CSV) matching the chosen
 * filters. Raising calls the same POST /invoices/bulk the dashboard's quick
 * "Bulk invoice" uses, so the created invoice starts RAISED: visible to
 * Admin/Finance to approve, reject, or mark paid.
 */
function NewInvoiceModal({ token, onClose, onRaised }: { token: string; onClose: () => void; onRaised: () => void }) {
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [campaignSearch, setCampaignSearch] = useState("");
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isGstInvoice, setIsGstInvoice] = useState(false);
  const [raisedInvoice, setRaisedInvoice] = useState<Invoice | null>(null);
  const { user } = useAuth();

  const campaignsQuery = useQuery({ queryKey: ["campaigns"], queryFn: () => campaignsApi.list(token) });
  const selectedCampaign = (campaignsQuery.data ?? []).find((c: Campaign) => c.id === campaignId) ?? null;
  const campaignMatches = useMemo(() => {
    const all = campaignsQuery.data ?? [];
    const q = campaignSearch.trim().toLowerCase();
    if (!q) return all;
    return all.filter((c: Campaign) => c.title.toLowerCase().includes(q) || c.brandName.toLowerCase().includes(q));
  }, [campaignsQuery.data, campaignSearch]);

  const eligibleQuery = useQuery({
    queryKey: ["links", "invoiceable", fromDate, toDate, campaignId],
    // unbilled: not on any invoice, whatever the status says (22 Sep).
    queryFn: () => linksApi.list(token, { status: INVOICEABLE_LINK_STATUSES_CSV, unbilled: true, from: fromDate || undefined, to: toDate || undefined, campaignId: campaignId ?? undefined, pageSize: 100 }),
    enabled: step >= 1,
  });
  const eligible = eligibleQuery.data?.items ?? [];

  const filterKey = `${fromDate}|${toDate}|${campaignId ?? ""}`;
  const [autoSelectedFor, setAutoSelectedFor] = useState<string | null>(null);
  if (eligibleQuery.data && autoSelectedFor !== filterKey) {
    setAutoSelectedFor(filterKey);
    setSelected(new Set(eligible.map((l) => l.id)));
  }

  const groups = useMemo(() => {
    const byCampaign = new Map<string, { title: string; brandName: string; links: Link[] }>();
    for (const link of eligible) {
      const key = link.campaignId;
      if (!byCampaign.has(key)) byCampaign.set(key, { title: link.campaign?.title ?? "Untitled campaign", brandName: link.campaign?.brandName ?? "", links: [] });
      byCampaign.get(key)!.links.push(link);
    }
    return [...byCampaign.values()];
  }, [eligible]);

  const allIds = eligible.map((l) => l.id);
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));
  const chosen = eligible.filter((l) => selected.has(l.id));
  const subtotal = chosen.reduce((sum, l) => sum + Number(l.cost), 0);
  const gstAmount = isGstInvoice ? Math.round(subtotal * GST_RATE * 100) / 100 : 0;
  const total = subtotal + gstAmount;

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(allIds));
  }
  function toggleGroup(groupLinks: Link[]) {
    const groupIds = groupLinks.map((l) => l.id);
    const allIn = groupIds.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      groupIds.forEach((id) => (allIn ? next.delete(id) : next.add(id)));
      return next;
    });
  }
  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  // 22 Sep — "Not eligible for invoicing: <url> (already on invoice INV-…)":
  // a link the list offered that another invoice has since taken (a race,
  // or a status that drifted from its invoice row). Refetching the list
  // drops those links out of `eligible` — and so out of `chosen`, which is
  // eligible ∩ selected — so the creator just clicks Generate again.
  const queryClientForLinks = useQueryClient();
  const raiseMutation = useMutation({
    // `chosen`, not `selected`: only ids still in the (possibly refetched) list.
    mutationFn: () => invoicesApi.bulkCreate(token, chosen.map((l) => l.id), 15, isGstInvoice),
    onSuccess: (invoice) => {
      setRaisedInvoice(invoice);
      onRaised();
    },
    // Awaited so the Raise button (disabled while fetching) can't re-post
    // the refused ids before the refetched list has dropped them.
    onError: async (err) => {
      if (err instanceof ApiError && err.code === "INELIGIBLE_LINKS") await queryClientForLinks.refetchQueries({ queryKey: ["links", "invoiceable"] });
    },
  });
  const ineligible =
    raiseMutation.isError && raiseMutation.error instanceof ApiError && raiseMutation.error.code === "INELIGIBLE_LINKS"
      ? [...raiseMutation.error.message.matchAll(/(https?:\/\/\S+) \(([^)]*)\)/g)].map((m) => ({ url: m[1], reason: m[2] }))
      : null;

  if (raisedInvoice) {
    return (
      <Sheet onClose={onClose} panelClassName="md:max-w-[420px]">
        <div className="flex flex-col items-center gap-4 p-8 pt-2 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full border border-accent-line bg-accent-soft text-accent">
            <CheckCircleIcon className="h-6 w-6" />
          </div>
          <h2 className="text-[1.125rem] font-semibold tracking-[-0.02em]">Invoice raised</h2>
          <p className="text-[0.8125rem] text-text-muted">
            <span className="font-mono">{raisedInvoice.invoiceNumber}</span> for {money(raisedInvoice.amount)}
            {raisedInvoice.isGstInvoice ? " (incl. 18% GST)" : ""} has been sent to your admin for approval.
          </p>
          <Button className="w-full" onClick={onClose}>
            Done
          </Button>
        </div>
      </Sheet>
    );
  }

  const today = new Date().toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  const pickedLinks = step === 0 ? [] : chosen;

  const filters = (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="From (optional)">
          <TextField type="date" value={fromDate} onChange={setFromDate} />
        </Field>
        <Field label="To (optional)">
          <TextField type="date" value={toDate} onChange={setToDate} />
        </Field>
      </div>
      <Field label="Campaign (optional — leave blank for all)">
        {selectedCampaign ? (
          <div className="flex items-center justify-between rounded-md border border-border-strong bg-surface px-3 py-2 text-[0.875rem] shadow-card">
            <span className="truncate">
              {selectedCampaign.title} <span className="text-text-muted">· {selectedCampaign.brandName}</span>
            </span>
            <button
              type="button"
              onClick={() => {
                setCampaignId(null);
                setCampaignSearch("");
              }}
              className="shrink-0 text-text-faint hover:text-text"
              aria-label="Clear campaign"
            >
              <CloseIcon className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <>
            <TextField value={campaignSearch} onChange={setCampaignSearch} placeholder="Search campaigns…" />
            {campaignSearch.trim() && (
              <div className="mt-1.5 max-h-40 overflow-y-auto rounded-md border border-border">
                {campaignMatches.length === 0 ? (
                  <p className="px-3.5 py-2.5 text-[0.8125rem] text-text-muted">No campaigns match &quot;{campaignSearch}&quot;.</p>
                ) : (
                  campaignMatches.map((c: Campaign) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setCampaignId(c.id);
                        setCampaignSearch("");
                      }}
                      className="flex w-full flex-col px-3.5 py-2.5 text-left text-[0.8125rem] hover:bg-surface-2"
                    >
                      <span className="font-semibold">{c.title}</span>
                      <span className="text-text-muted">{c.brandName}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </>
        )}
      </Field>
    </div>
  );

  const typePicker = (
    <div className="flex flex-col gap-2" role="radiogroup" aria-label="Invoice type">
      <p className="text-[0.8125rem] font-semibold">Invoice type</p>
      {[
        { gst: true, title: "GST invoice", sub: "Adds 18% GST · needs GSTIN on file" },
        { gst: false, title: "Non-GST invoice", sub: "Plain amount, no tax line" },
      ].map((o) => (
        <button
          key={String(o.gst)}
          type="button"
          role="radio"
          aria-checked={isGstInvoice === o.gst}
          onClick={() => setIsGstInvoice(o.gst)}
          className={cn("flex items-center gap-3 rounded-[10px] border px-3.5 py-3 text-left transition-colors", isGstInvoice === o.gst ? "border-ink bg-surface-2" : "border-border hover:border-border-strong")}
        >
          <span className={cn("flex h-4 w-4 shrink-0 items-center justify-center rounded-full border", isGstInvoice === o.gst ? "border-ink bg-ink" : "border-border-strong")}>{isGstInvoice === o.gst && <span className="h-1.5 w-1.5 rounded-full bg-ink-fg" />}</span>
          <span className="flex flex-col">
            <span className="text-[0.8375rem] font-semibold">{o.title}</span>
            <span className="text-[0.75rem] text-text-muted">{o.sub}</span>
          </span>
        </button>
      ))}
      <Note tone="info" className="mt-1">
        Insights aren&apos;t required to invoice. Posts with pending insights are included and marked.
      </Note>
    </div>
  );

  const preview = (
    <div className="flex flex-col rounded-lg border border-border bg-surface-2 p-4 md:p-6" data-testid="invoice-preview">
      <div className="mx-auto flex w-full max-w-[520px] flex-col gap-4 rounded-[6px] border border-border bg-surface p-5 shadow-lg md:p-7">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[1rem] font-semibold tracking-[-0.01em]">INVOICE</p>
            <p className="text-[0.75rem] text-text-muted">{today}</p>
          </div>
          <div className="text-right">
            <p className="text-[0.8375rem] font-semibold">{user?.name ?? "—"}</p>
            <p className="text-[0.75rem] text-text-muted">{user?.phoneNumber ?? ""}</p>
          </div>
        </div>
        <div>
          <p className="text-[0.7rem] text-text-muted">Bill to</p>
          <p className="text-[0.8375rem] font-semibold">Taggify</p>
          {selectedCampaign && <p className="text-[0.75rem] text-text-muted">{selectedCampaign.title}</p>}
        </div>
        {eligibleQuery.isLoading ? (
          <TableSkeleton rows={3} />
        ) : pickedLinks.length === 0 ? (
          <p className="py-4 text-center text-[0.8125rem] text-text-muted">{step === 0 ? "Pick posts to see the preview." : "No posts selected."}</p>
        ) : (
          <table className="w-full text-[0.78rem]">
            <thead>
              <tr className="border-b border-border text-left text-[0.68rem] text-text-muted">
                <th className="py-1.5 font-medium">Post</th>
                <th className="py-1.5 font-medium">Date</th>
                <th className="py-1.5 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {pickedLinks.slice(0, 6).map((l) => (
                <tr key={l.id} className="border-b border-border last:border-b-0">
                  <td className="py-1.5">
                    <span>{formatLabel(l.format)}</span> · <span className="text-text-muted">@{l.asset?.handle ?? "—"}</span>
                    {(l.status === "INSIGHTS_PENDING" || l.status === "SCREENSHOT_APPROVED") && (
                      <Tag tone="wait" dot={false} className="ml-1.5 h-[18px] text-[0.62rem]">
                        insights pending
                      </Tag>
                    )}
                  </td>
                  <td className="py-1.5 text-text-muted">{new Date(l.postedAt ?? l.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</td>
                  <td className="py-1.5 text-right tabular-nums">{money(l.cost)}</td>
                </tr>
              ))}
              {pickedLinks.length > 6 && (
                <tr>
                  <td colSpan={3} className="py-1.5 text-text-muted">
                    +{pickedLinks.length - 6} more posts
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
        <div className="ml-auto flex w-[200px] flex-col gap-1 text-[0.8125rem]">
          <div className="flex justify-between text-text-muted">
            <span>Subtotal</span>
            <span className="tabular-nums">{money(subtotal)}</span>
          </div>
          {isGstInvoice && (
            <div className="flex justify-between text-text-muted">
              <span>GST 18%</span>
              <span className="tabular-nums">{money(gstAmount)}</span>
            </div>
          )}
          <div className="mt-1 flex justify-between border-t border-border pt-1.5 font-semibold">
            <span>Total</span>
            <span className="text-[0.95rem] tabular-nums">{money(total)}</span>
          </div>
        </div>
      </div>
    </div>
  );

  const pickList = eligibleQuery.isLoading ? (
    <TableSkeleton />
  ) : eligibleQuery.isError ? (
    <ErrorNotice message={eligibleQuery.error instanceof ApiError ? eligibleQuery.error.message : "Couldn't load links ready to invoice."} />
  ) : eligible.length === 0 ? (
    <EmptyState label="No links matched these filters — try widening the date range or clearing the campaign." />
  ) : (
    <div className="flex flex-col gap-4">
      <label className="flex items-center gap-2.5 border-b border-border pb-3 text-[0.8125rem] font-semibold">
        <input type="checkbox" checked={allSelected} onChange={toggleAll} className="h-4 w-4 rounded accent-[var(--ink)]" />
        Select all · {eligible.length} link{eligible.length === 1 ? "" : "s"}
      </label>
      {groups.map((group) => {
        const groupIds = group.links.map((l) => l.id);
        const groupAllIn = groupIds.every((id) => selected.has(id));
        const groupTotal = group.links.reduce((sum, l) => sum + Number(l.cost), 0);
        return (
          <div key={group.title + group.brandName} className="flex flex-col gap-1.5">
            <label className="flex items-center gap-2.5 text-[0.8125rem] font-semibold">
              <input type="checkbox" checked={groupAllIn} onChange={() => toggleGroup(group.links)} className="h-4 w-4 rounded accent-[var(--ink)]" />
              {group.title}
              {group.brandName && <span className="font-normal text-text-muted">· {group.brandName}</span>}
              <span className="ml-auto font-normal text-text-muted">{money(groupTotal)}</span>
            </label>
            <div className="flex flex-col gap-0.5 pl-6">
              {group.links.map((link) => (
                <label key={link.id} className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[0.8125rem] hover:bg-surface-2">
                  <input type="checkbox" checked={selected.has(link.id)} onChange={() => toggleOne(link.id)} className="h-4 w-4 rounded accent-[var(--ink)]" />
                  <span className="truncate text-text-2">
                    @{link.asset?.handle ?? "—"} · {formatLabel(link.format)}
                  </span>
                  <span className="ml-auto shrink-0 font-semibold tabular-nums">{money(link.cost)}</span>
                </label>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <Sheet onClose={onClose} panelClassName="md:max-w-[960px]">
      <div className="flex min-h-0 flex-1 flex-col gap-5 p-6 pt-1">
        <div className="shrink-0">
          <h2 className="text-[1.125rem] font-semibold tracking-[-0.02em]">{step === 1 ? "Preview invoice" : "New invoice"}</h2>
          <p className="text-[0.8125rem] text-text-muted">Step {step + 1} of 3 · {["Narrow down to what you're billing.", "Check the preview, then choose GST or non-GST.", "Everything is set — generate it."][step]}</p>
        </div>
        <Steps steps={["Pick posts", "Preview", "Generate"]} current={step} />

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 overflow-y-auto md:grid-cols-[380px_1fr]">
          <div className="flex flex-col gap-5">
            {step === 0 && filters}
            {step === 1 && (
              <>
                <Note tone="info">Every submitted link not yet invoiced is shown — a screenshot or insights aren&apos;t required to invoice, only rejected/broken links are left out.</Note>
                {pickList}
              </>
            )}
            {step === 2 && typePicker}
          </div>
          <div className="min-h-0">{preview}</div>
        </div>

        {ineligible ? (
          <div className="flex flex-col gap-1.5 rounded-md border border-rose/30 bg-rose-soft px-3 py-2.5 text-[0.8125rem]" data-testid="ineligible-links-notice">
            <p className="font-semibold text-rose">
              {ineligible.length === 1 ? "One link" : `${ineligible.length} links`} can't go on this invoice and {ineligible.length === 1 ? "has" : "have"} been removed from the list — click Generate again for the rest.
            </p>
            <ul className="flex flex-col gap-0.5 text-text-muted">
              {ineligible.map((l) => (
                <li key={l.url} className="truncate">
                  <a href={l.url} target="_blank" rel="noopener noreferrer" className="text-blue hover:underline">
                    {l.url}
                  </a>{" "}
                  — {l.reason}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          raiseMutation.isError && <ErrorNotice message={raiseMutation.error instanceof ApiError ? raiseMutation.error.message : "Couldn't raise this invoice."} />
        )}

        <div className="flex shrink-0 items-center gap-2.5 border-t border-border pt-4">
          {step === 0 ? (
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          ) : (
            <Button type="button" variant="secondary" onClick={() => setStep((step - 1) as 0 | 1 | 2)}>
              Back
            </Button>
          )}
          <span className="ml-auto hidden text-[0.8125rem] text-text-muted sm:inline">
            {chosen.length > 0 && (
              <>
                {chosen.length} post{chosen.length === 1 ? "" : "s"} · <b className="text-text">{money(total)}</b>
                {isGstInvoice ? " incl. GST" : ""}
              </>
            )}
          </span>
          {step < 2 ? (
            <Button onClick={() => setStep((step + 1) as 0 | 1 | 2)} disabled={step === 1 && chosen.length === 0}>
              Continue <ArrowRightIcon className="h-4 w-4" />
            </Button>
          ) : (
            <Button onClick={() => raiseMutation.mutate()} disabled={chosen.length === 0 || raiseMutation.isPending || eligibleQuery.isFetching}>
              {raiseMutation.isPending ? "Raising…" : `Raise invoice · ${money(total)}`}
            </Button>
          )}
        </div>
      </div>
    </Sheet>
  );
}

function LineItem({ title, amount }: { title: string; amount: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="h-8 w-8 shrink-0 rounded-lg bg-gradient-to-br from-accent-soft to-accent-2-soft" />
      <div className="min-w-0 flex-1 truncate text-[0.8125rem] font-semibold">{title}</div>
      {amount && <div className="text-[0.8125rem] font-semibold tabular-nums">{amount}</div>}
    </div>
  );
}
