"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { RequireAuth } from "@/components/auth/require-auth";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { StatusPill } from "@/components/ui/status-pill";
import { Field, TextField } from "@/components/ui/form-field";
import { DownloadIcon, SearchIcon, PlusIcon, AlertIcon, CheckCircleIcon } from "@/components/icons";
import { Th, TableSkeleton, EmptyState, ErrorNotice } from "@/components/ui/table-parts";
import { useAuth } from "@/lib/auth-context";
import {
  invoices as invoicesApi,
  links as linksApi,
  campaigns as campaignsApi,
  INVOICEABLE_LINK_STATUSES_CSV,
  ApiError,
  type Invoice,
  type Link,
  type Campaign,
} from "@/lib/api-client";
import { money, initialsOf, roleLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

export default function InvoicesPage() {
  return (
    <RequireAuth>
      <InvoicesContent />
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
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<Invoice["status"] | "">(
    (searchParams.get("status") as Invoice["status"] | null) ?? ""
  );
  const [paymentFilter, setPaymentFilter] = useState<Invoice["paymentStatus"] | "">(
    (searchParams.get("paymentStatus") as Invoice["paymentStatus"] | null) ?? ""
  );
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [showNewInvoice, setShowNewInvoice] = useState(false);
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

  const canManage = user?.role === "ADMIN" || user?.role === "FINANCE";
  const canRaiseInvoice = user?.role === "CREATOR" || user?.role === "ADMIN";

  const markPaidMutation = useMutation({
    mutationFn: (id: string) => invoicesApi.markPaid(token, id),
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
          <div className="text-[1.875rem] font-extrabold tracking-tight tabular-nums">{money(inv.amount)}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusPill status={inv.status} />
          <StatusPill status={inv.paymentStatus} />
          <StatusPill status={inv.gstStatus} />
          {inv.isGstInvoice && (
            <span className="rounded-full border border-accent/25 bg-accent-soft px-2.5 py-1 text-[0.6875rem] font-bold text-accent">
              GST invoice
            </span>
          )}
        </div>
        {inv.status === "REJECTED" && inv.remarks && (
          <p className="rounded-md border border-rose/30 bg-rose-soft px-3.5 py-2.5 text-[0.8125rem] text-rose">{inv.remarks}</p>
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
            <span className="text-[1.125rem] font-extrabold tabular-nums">{money(inv.amount)}</span>
          </div>
        </div>

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

        {canManage && inv.status !== "PAID" && inv.status !== "REJECTED" && (
          <Button size="lg" className="w-full" onClick={() => markPaidMutation.mutate(inv.id)} disabled={markPaidMutation.isPending}>
            {markPaidMutation.isPending ? "Marking paid…" : "Mark as paid"}
          </Button>
        )}
        {canManage && inv.status !== "PAID" && inv.status !== "REJECTED" && (
          <Button variant="danger" size="lg" className="w-full" onClick={() => setRejectingId(inv.id)}>
            Reject invoice
          </Button>
        )}
        {canManage && inv.gstStatus !== "COMPLETED" && (
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

        {(markPaidMutation.isError || gstMutation.isError || downloadMutation.isError || downloadLinksMutation.isError) && (
          <ErrorNotice
            message={
              markPaidMutation.error instanceof ApiError
                ? markPaidMutation.error.message
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
      <div className="flex h-full min-h-0 flex-col gap-7">
        <div>
          <p className="mb-1.5 text-[0.6875rem] font-bold uppercase tracking-[0.08em] text-text-faint">Finance</p>
          <h1 className="mb-1.5 text-[1.625rem] font-bold">Invoices</h1>
          <p className="text-[0.9375rem] text-text-muted">Raised, paid, and GST status — tracked independently, settled manually.</p>
        </div>

        {/* Horizontal-scroll strip on mobile, a 3-up grid at md+. */}
        <div className="flex gap-3 overflow-x-auto pb-1 -mx-4 px-4 md:mx-0 md:grid md:grid-cols-3 md:gap-4 md:overflow-visible md:px-0 md:pb-0">
          <KpiCard className="w-[170px] shrink-0 md:w-auto" label="Total raised" value={money(kpis.totalRaised)} foot={`${items.length} invoices total`} />
          <KpiCard className="w-[170px] shrink-0 md:w-auto" label="Pending payment" value={money(kpis.pendingAmount)} foot={`${kpis.pendingCount} invoice${kpis.pendingCount === 1 ? "" : "s"} awaiting settlement`} />
          <KpiCard className="w-[170px] shrink-0 md:w-auto" label="Overdue" value={money(kpis.overdueAmount)} foot={`${kpis.overdueCount} invoice${kpis.overdueCount === 1 ? "" : "s"} past due date`} tone={kpis.overdueCount > 0 ? "rose" : undefined} />
        </div>

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
            className="h-9 rounded-full border border-border bg-surface px-3.5 text-[0.8125rem] text-text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
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
            className="h-9 rounded-full border border-border bg-surface px-3.5 text-[0.8125rem] text-text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
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

        <div className="flex min-h-0 flex-1 flex-col gap-4 md:flex-row md:gap-5">
          <div className="hidden flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-card md:flex">
            {/* Sticky so the column labels stay put while the row list
                below scrolls in its own region — this whole area used to
                just grow to full content height with nothing to actually
                scroll it (the outer page scrolled instead, taking the
                header and the persistent detail panel along with it).
                Reported as "scroll invoice not working" (newTask.md, 8 Sep). */}
            <div
              data-testid="invoice-table-header"
              className="sticky top-0 z-10 grid grid-cols-[minmax(0,1.1fr)_minmax(0,1.2fr)_minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1.1fr)] gap-3 border-b border-border bg-surface px-5 py-3.5"
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
              <EmptyState label="No invoices raised yet — bulk-invoice approved links from My Works." />
            ) : (
              <div className="flex-1 overflow-y-auto" data-testid="invoice-row-list">
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
                      <div className="truncate text-[0.8438rem] text-text-muted">{inv.creator?.name ?? inv.creator?.phoneNumber ?? "—"}</div>
                      <div className="text-[0.9375rem] font-bold tabular-nums">{money(inv.amount)}</div>
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
                      <div className={cn("text-xs", isOverdue ? "font-bold text-rose" : "text-text-faint")}>
                        {isPaid ? (inv.paidAt ? `Settled ${new Date(inv.paidAt).toLocaleDateString()}` : "Settled") : isOverdue ? `Overdue · ${inv.overdueDays}d` : inv.dueDate ? `Due ${new Date(inv.dueDate).toLocaleDateString()}` : "—"}
                      </div>
                      <div onClick={(e) => e.stopPropagation()} className="flex items-center gap-1.5">
                        {canManage && inv.status !== "PAID" && inv.status !== "REJECTED" && (
                          <Button
                            size="sm"
                            className="h-8 bg-accent-soft text-accent shadow-none hover:brightness-100"
                            onClick={() => markPaidMutation.mutate(inv.id)}
                            disabled={markPaidMutation.isPending}
                          >
                            Mark paid
                          </Button>
                        )}
                        {canManage && inv.status !== "PAID" && inv.status !== "REJECTED" && (
                          <button
                            title="Reject invoice"
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-faint hover:bg-rose-soft hover:text-rose"
                            onClick={() => setRejectingId(inv.id)}
                          >
                            ✕
                          </button>
                        )}
                        <button
                          title="Download links"
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-faint hover:bg-surface-2 hover:text-text-muted disabled:opacity-50"
                          onClick={() => downloadLinksMutation.mutate(inv)}
                          disabled={downloadLinksMutation.isPending}
                        >
                          <SearchIcon className="h-3.5 w-3.5" />
                        </button>
                        <button
                          title="Download PDF"
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-faint hover:bg-surface-2 hover:text-text-muted disabled:opacity-50"
                          onClick={() => downloadMutation.mutate(inv)}
                          disabled={downloadMutation.isPending}
                        >
                          <DownloadIcon className="h-3.5 w-3.5" />
                        </button>
                      </div>
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
              <EmptyState label="No invoices raised yet — bulk-invoice approved links from My Works." />
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
                      <span className="truncate text-[0.8125rem] text-text-muted">{inv.creator?.name ?? inv.creator?.phoneNumber ?? "—"}</span>
                      <span className="shrink-0 text-[1.0625rem] font-bold tabular-nums">{money(inv.amount)}</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <StatusPill status={inv.paymentStatus} />
                      <StatusPill status={inv.gstStatus} />
                    </div>
                    <div className="flex items-center justify-between border-t border-border pt-2.5">
                      <span className={cn("text-xs", isOverdue ? "font-bold text-rose" : "text-text-faint")}>
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
                        {canManage && inv.status !== "PAID" && inv.status !== "REJECTED" && (
                          <Button
                            size="sm"
                            className="h-9 bg-accent-soft px-2.5 text-accent shadow-none hover:brightness-100"
                            onClick={() => markPaidMutation.mutate(inv.id)}
                            disabled={markPaidMutation.isPending}
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

          {/* Desktop: persistent side panel — its own scroll so a
              long-lined-item invoice can't force the whole row to grow
              past its bounded height (same fix as the table above). */}
          <div
            data-testid="invoice-detail-panel"
            className="hidden w-[340px] shrink-0 flex-col gap-5 overflow-y-auto rounded-lg border border-border bg-surface p-6 shadow-card md:flex"
          >
            {selected && renderInvoiceDetail(selected)}
          </div>
        </div>
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
    </AppShell>
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
        <h2 className="text-lg font-bold">Reject invoice</h2>
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
 * Fetches every link eligible for invoicing (screenshot approved, not yet
 * on an invoice — see INVOICEABLE_LINK_STATUSES_CSV) matching the chosen
 * filters. Raising calls the same POST /invoices/bulk the dashboard's quick
 * "Bulk invoice" uses, so the created invoice starts RAISED: visible to
 * Admin/Finance to approve, reject, or mark paid.
 */
function NewInvoiceModal({ token, onClose, onRaised }: { token: string; onClose: () => void; onRaised: () => void }) {
  const [step, setStep] = useState<"filters" | "preview">("filters");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [campaignSearch, setCampaignSearch] = useState("");
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isGstInvoice, setIsGstInvoice] = useState(false);
  const [raisedInvoice, setRaisedInvoice] = useState<Invoice | null>(null);

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
    // 100 is the server's hard cap (listLinksQuerySchema) — a pageSize
    // above it 400s the whole request. That 400 was getting silently
    // swallowed below (eligible ??= []) and shown as "no links ready",
    // masking the real error for every creator regardless of how many
    // links were actually eligible. See admin-dashboard.tsx for the same
    // cap on its own queries.
    queryFn: () =>
      linksApi.list(token, {
        status: INVOICEABLE_LINK_STATUSES_CSV,
        from: fromDate || undefined,
        to: toDate || undefined,
        campaignId: campaignId ?? undefined,
        pageSize: 100,
      }),
    enabled: step === "preview",
  });

  const eligible = eligibleQuery.data?.items ?? [];

  // Land on preview with everything the filters matched already selected —
  // the point of filtering first is to narrow down to what you meant to
  // bill, so re-ticking every box by hand afterward would just be busywork.
  // Still individually deselectable below. Keyed on the filters themselves
  // (not e.g. dataUpdatedAt) so a background refetch of the *same* filters
  // can't silently wipe a selection the user already hand-adjusted — this
  // only resets when fromDate/toDate/campaignId actually change.
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
      if (!byCampaign.has(key)) {
        byCampaign.set(key, { title: link.campaign?.title ?? "Untitled campaign", brandName: link.campaign?.brandName ?? "", links: [] });
      }
      byCampaign.get(key)!.links.push(link);
    }
    return [...byCampaign.values()];
  }, [eligible]);

  const allIds = eligible.map((l) => l.id);
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));
  const subtotal = eligible.filter((l) => selected.has(l.id)).reduce((sum, l) => sum + Number(l.cost), 0);
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

  const raiseMutation = useMutation({
    mutationFn: () => invoicesApi.bulkCreate(token, [...selected], 15, isGstInvoice),
    onSuccess: (invoice) => {
      setRaisedInvoice(invoice);
      onRaised();
    },
  });

  // Success screen — closes the loop on "goes to admin for approval"
  // rather than just silently dismissing the modal.
  if (raisedInvoice) {
    return (
      <Sheet onClose={onClose} panelClassName="md:max-w-[420px]">
        <div className="flex flex-col items-center gap-4 p-8 pt-2 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-accent">
            <CheckCircleIcon className="h-6 w-6" />
          </div>
          <h2 className="text-lg font-bold">Invoice raised</h2>
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

  // ── Step 1: date range + campaign search ─────────────────────────
  if (step === "filters") {
    return (
      <Sheet onClose={onClose} panelClassName="md:max-w-[480px]">
        <div className="flex flex-1 min-h-0 flex-col gap-5 p-6 pt-1">
          <div>
            <h2 className="text-lg font-bold">New invoice</h2>
            <p className="text-[0.8125rem] text-text-faint">Narrow down to what you're billing, then preview it.</p>
          </div>

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
              <div className="flex items-center justify-between rounded-md border border-border-strong bg-surface-2 px-3.5 py-2.5 text-[0.9375rem]">
                <span className="truncate">
                  {selectedCampaign.title} <span className="text-text-faint">· {selectedCampaign.brandName}</span>
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
                  ✕
                </button>
              </div>
            ) : (
              <>
                <TextField value={campaignSearch} onChange={setCampaignSearch} placeholder="Search campaigns…" />
                {campaignSearch.trim() && (
                  <div className="mt-1.5 max-h-40 overflow-y-auto rounded-md border border-border">
                    {campaignMatches.length === 0 ? (
                      <p className="px-3.5 py-2.5 text-[0.8125rem] text-text-faint">No campaigns match "{campaignSearch}".</p>
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
                          <span className="text-text-faint">{c.brandName}</span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </>
            )}
          </Field>

          <div className="flex items-center gap-2.5 border-t border-border pt-4">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <div className="flex-1" />
            <Button onClick={() => setStep("preview")}>Continue</Button>
          </div>
        </div>
      </Sheet>
    );
  }

  // ── Step 2: preview + GST choice + total ──────────────────────────
  return (
    <Sheet onClose={onClose} panelClassName="md:max-w-[640px]">
      <div className="flex flex-1 min-h-0 flex-col gap-5 p-6 pt-1">
        <div>
          <button
            type="button"
            onClick={() => setStep("filters")}
            className="mb-1 text-[0.8125rem] font-semibold text-text-faint hover:text-text"
          >
            ‹ Back to filters
          </button>
          <h2 className="text-lg font-bold">Preview invoice</h2>
          <p className="text-[0.8125rem] text-text-faint">Select the links to bill, grouped by campaign.</p>
        </div>

        <div className="flex items-start gap-2.5 rounded-md border border-blue/25 bg-blue-soft px-3.5 py-2.5 text-[0.8125rem] text-blue">
          <AlertIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>Only links with an approved screenshot are shown — insights aren't required to invoice.</span>
        </div>

        {eligibleQuery.isLoading ? (
          <TableSkeleton />
        ) : eligibleQuery.isError ? (
          // Was falling through to the empty state below on any fetch
          // error (eligible ??= []) — indistinguishable from "genuinely
          // nothing to invoice" and exactly how the pageSize-400 bug above
          // went unnoticed. A real error now reads as one.
          <ErrorNotice message={eligibleQuery.error instanceof ApiError ? eligibleQuery.error.message : "Couldn't load links ready to invoice."} />
        ) : eligible.length === 0 ? (
          <EmptyState label="No links matched these filters — try widening the date range or clearing the campaign." />
        ) : (
          <>
            <label className="flex items-center gap-2.5 border-b border-border pb-3.5 text-[0.8125rem] font-semibold">
              <input type="checkbox" checked={allSelected} onChange={toggleAll} className="h-4 w-4 rounded accent-[var(--accent)]" />
              Select all · {eligible.length} link{eligible.length === 1 ? "" : "s"}
            </label>

            {/* min-h so the link list can't get squeezed to near-nothing on a
                short viewport — step 2 now also carries the GST toggle +
                totals card below it, competing for the same fixed modal
                height the original single-purpose list didn't have to
                share (found by actually driving this in a real, short
                browser window, not just reading the JSX). */}
            <div className="min-h-[160px] flex-1 overflow-y-auto">
              <div className="flex flex-col gap-5">
                {groups.map((group) => {
                  const groupIds = group.links.map((l) => l.id);
                  const groupAllIn = groupIds.every((id) => selected.has(id));
                  const groupTotal = group.links.reduce((sum, l) => sum + Number(l.cost), 0);
                  return (
                    <div key={group.title + group.brandName} className="flex flex-col gap-2">
                      <label className="flex items-center gap-2.5 text-[0.8125rem] font-bold">
                        <input
                          type="checkbox"
                          checked={groupAllIn}
                          onChange={() => toggleGroup(group.links)}
                          className="h-4 w-4 rounded accent-[var(--accent)]"
                        />
                        {group.title}
                        {group.brandName && <span className="font-normal text-text-faint">· {group.brandName}</span>}
                        <span className="ml-auto font-normal text-text-faint">{money(groupTotal)}</span>
                      </label>
                      <div className="flex flex-col gap-1 pl-6">
                        {group.links.map((link) => (
                          <label key={link.id} className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[0.8125rem] hover:bg-surface-2">
                            <input
                              type="checkbox"
                              checked={selected.has(link.id)}
                              onChange={() => toggleOne(link.id)}
                              className="h-4 w-4 rounded accent-[var(--accent)]"
                            />
                            <span className="truncate text-text-muted">
                              @{link.asset?.handle ?? "—"} · {link.format}
                            </span>
                            <span className="ml-auto shrink-0 font-semibold tabular-nums">{money(link.cost)}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* GST choice — newTask.md #4: pick GST (auto +18%) or non-GST before raising. */}
            <div className="flex items-center gap-2 rounded-md border border-border bg-surface-2 p-1">
              <button
                type="button"
                onClick={() => setIsGstInvoice(false)}
                className={cn(
                  "flex-1 rounded-[6px] py-2 text-center text-[0.8125rem] font-semibold transition-colors",
                  !isGstInvoice ? "bg-surface shadow-card" : "text-text-faint"
                )}
              >
                Non-GST invoice
              </button>
              <button
                type="button"
                onClick={() => setIsGstInvoice(true)}
                className={cn(
                  "flex-1 rounded-[6px] py-2 text-center text-[0.8125rem] font-semibold transition-colors",
                  isGstInvoice ? "bg-surface shadow-card" : "text-text-faint"
                )}
              >
                GST invoice · +18%
              </button>
            </div>

            <div className="flex flex-col gap-1.5 rounded-md border border-border p-3.5 text-[0.8125rem]">
              <div className="flex items-center justify-between text-text-muted">
                <span>Subtotal</span>
                <span className="tabular-nums">{money(subtotal)}</span>
              </div>
              {isGstInvoice && (
                <div className="flex items-center justify-between text-text-muted">
                  <span>GST (18%)</span>
                  <span className="tabular-nums">{money(gstAmount)}</span>
                </div>
              )}
              <div className="mt-1 flex items-center justify-between border-t border-border pt-1.5 text-[0.9375rem] font-bold">
                <span>Total</span>
                <span className="tabular-nums">{money(total)}</span>
              </div>
            </div>
          </>
        )}

        {raiseMutation.isError && (
          <ErrorNotice message={raiseMutation.error instanceof ApiError ? raiseMutation.error.message : "Couldn't raise this invoice."} />
        )}

        <div className="flex items-center gap-2.5 border-t border-border pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <div className="flex-1" />
          <Button onClick={() => raiseMutation.mutate()} disabled={selected.size === 0 || raiseMutation.isPending}>
            {raiseMutation.isPending ? "Raising…" : `Raise invoice · ${money(total)}`}
          </Button>
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
      {amount && <div className="text-[0.8125rem] font-bold tabular-nums">{amount}</div>}
    </div>
  );
}
