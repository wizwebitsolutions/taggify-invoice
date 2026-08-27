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
import { invoices as invoicesApi, links as linksApi, ApiError, type Invoice, type Link } from "@/lib/api-client";
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
        <div className="flex items-center justify-between border-t border-border pt-3.5">
          <span className="text-[0.8125rem] text-text-faint">Total</span>
          <span className="text-[1.125rem] font-extrabold tabular-nums">{money(inv.amount)}</span>
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
      <div className="flex flex-col gap-7">
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
          <div className="hidden flex-1 overflow-hidden rounded-lg border border-border bg-surface shadow-card md:block">
            <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1.2fr)_minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1.1fr)] gap-3 border-b border-border px-5 py-3.5">
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
              <div>
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

          {/* Desktop: persistent side panel. */}
          <div className="hidden w-[340px] shrink-0 flex-col gap-5 rounded-lg border border-border bg-surface p-6 shadow-card md:flex">
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
        <p className="text-[0.8125rem] text-text-faint">Its links go back to Insights approved, eligible to be re-invoiced once the issue is fixed.</p>
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

/**
 * "New invoice" flow (raised from a dedicated Invoices-page entry point,
 * distinct from the multi-select "Bulk invoice" on My Works). Fetches every
 * link eligible for invoicing — INSIGHTS_APPROVED and not yet on an
 * invoice, which is the backend's structural way of enforcing that a
 * screenshot + insights approval is mandatory before a link can be billed
 * — and groups them by campaign for selection. Raising calls the same
 * POST /invoices/bulk the dashboard uses, so the created invoice starts
 * RAISED: visible to Admin/Finance to approve, reject, or mark paid.
 */
function NewInvoiceModal({ token, onClose, onRaised }: { token: string; onClose: () => void; onRaised: () => void }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [raisedInvoice, setRaisedInvoice] = useState<Invoice | null>(null);

  const eligibleQuery = useQuery({
    queryKey: ["links", "INSIGHTS_APPROVED", "invoiceable"],
    // 100 is the server's hard cap (listLinksQuerySchema) — a pageSize
    // above it 400s the whole request. That 400 was getting silently
    // swallowed below (eligible ??= []) and shown as "no links ready",
    // masking the real error for every creator regardless of how many
    // links were actually eligible. See admin-dashboard.tsx for the same
    // cap on its own queries.
    queryFn: () => linksApi.list(token, { status: "INSIGHTS_APPROVED", pageSize: 100 }),
  });

  const eligible = eligibleQuery.data?.items ?? [];
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
  const selectedTotal = eligible.filter((l) => selected.has(l.id)).reduce((sum, l) => sum + Number(l.cost), 0);

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
    mutationFn: () => invoicesApi.bulkCreate(token, [...selected]),
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
            <span className="font-mono">{raisedInvoice.invoiceNumber}</span> for {money(raisedInvoice.amount)} has been sent to your admin for
            approval.
          </p>
          <Button className="w-full" onClick={onClose}>
            Done
          </Button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet onClose={onClose} panelClassName="md:max-w-[640px]">
      <div className="flex flex-1 min-h-0 flex-col gap-5 p-6 pt-1">
        <div>
          <h2 className="text-lg font-bold">New invoice</h2>
          <p className="text-[0.8125rem] text-text-faint">Select the links to bill, grouped by campaign.</p>
        </div>

        <div className="flex items-start gap-2.5 rounded-md border border-blue/25 bg-blue-soft px-3.5 py-2.5 text-[0.8125rem] text-blue">
          <AlertIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>Only links with an approved screenshot and approved insights are shown — both are mandatory before a link can be invoiced.</span>
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
          <EmptyState label="No links are ready to invoice yet — get screenshots and insights approved on My Works first." />
        ) : (
          <>
            <label className="flex items-center gap-2.5 border-b border-border pb-3.5 text-[0.8125rem] font-semibold">
              <input type="checkbox" checked={allSelected} onChange={toggleAll} className="h-4 w-4 rounded accent-[var(--accent)]" />
              Select all · {eligible.length} link{eligible.length === 1 ? "" : "s"}
            </label>

            <div className="flex-1 overflow-y-auto">
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
          {selected.size > 0 && <span className="text-[0.8125rem] font-semibold tabular-nums">{money(selectedTotal)}</span>}
          <Button onClick={() => raiseMutation.mutate()} disabled={selected.size === 0 || raiseMutation.isPending}>
            {raiseMutation.isPending ? "Raising…" : `Raise invoice · ${selected.size} selected`}
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
