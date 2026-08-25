"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { RequireAuth } from "@/components/auth/require-auth";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { StatusPill } from "@/components/ui/status-pill";
import { Field, TextField } from "@/components/ui/form-field";
import { DownloadIcon, SearchIcon } from "@/components/icons";
import { Th, TableSkeleton, EmptyState, ErrorNotice } from "@/components/ui/table-parts";
import { useAuth } from "@/lib/auth-context";
import { invoices as invoicesApi, ApiError, type Invoice } from "@/lib/api-client";
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<Invoice["status"] | "">("");
  const [paymentFilter, setPaymentFilter] = useState<Invoice["paymentStatus"] | "">("");
  const [rejectingId, setRejectingId] = useState<string | null>(null);
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

  return (
    <AppShell
      active="invoices"
      user={{ initials: initialsOf(user?.name), name: user?.name ?? "—", role: roleLabel(user?.role), tone: user?.role === "FINANCE" ? "blue" : "emerald" }}
      searchPlaceholder="Search invoice number, creator…"
    >
      <div className="flex flex-col gap-7">
        <div>
          <p className="mb-1.5 text-[0.6875rem] font-bold uppercase tracking-[0.08em] text-text-faint">Finance</p>
          <h1 className="mb-1.5 text-[1.625rem] font-bold">Invoices</h1>
          <p className="text-[0.9375rem] text-text-muted">Raised, paid, and GST status — tracked independently, settled manually.</p>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <KpiCard label="Total raised" value={money(kpis.totalRaised)} foot={`${items.length} invoices total`} />
          <KpiCard label="Pending payment" value={money(kpis.pendingAmount)} foot={`${kpis.pendingCount} invoice${kpis.pendingCount === 1 ? "" : "s"} awaiting settlement`} />
          <KpiCard label="Overdue" value={money(kpis.overdueAmount)} foot={`${kpis.overdueCount} invoice${kpis.overdueCount === 1 ? "" : "s"} past due date`} tone={kpis.overdueCount > 0 ? "rose" : undefined} />
        </div>

        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-64 items-center gap-2 rounded-full border border-border bg-surface px-3.5 text-[0.8125rem] text-text-faint">
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

          <div className="flex-1" />
          <Button variant="secondary" size="sm" className="rounded-full">
            <DownloadIcon className="h-3.5 w-3.5" />
            Export CSV
          </Button>
        </div>

        <div className="flex min-h-0 flex-1 gap-5">
          <div className="flex-1 overflow-hidden rounded-lg border border-border bg-surface shadow-card">
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
                      <div className="truncate text-[0.8438rem] text-text-muted">Creator</div>
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

          {selected && (
            <div className="flex w-[340px] shrink-0 flex-col gap-5 rounded-lg border border-border bg-surface p-6 shadow-card">
              <div>
                <div className="font-mono text-xs text-text-faint">{selected.invoiceNumber}</div>
                <div className="text-[1.875rem] font-extrabold tracking-tight tabular-nums">{money(selected.amount)}</div>
              </div>
              <div className="flex flex-wrap gap-2">
                <StatusPill status={selected.status} />
                <StatusPill status={selected.paymentStatus} />
                <StatusPill status={selected.gstStatus} />
              </div>
              {selected.status === "REJECTED" && selected.remarks && (
                <p className="rounded-md border border-rose/30 bg-rose-soft px-3.5 py-2.5 text-[0.8125rem] text-rose">{selected.remarks}</p>
              )}
              <div className="h-px bg-border" />
              <div className="flex flex-col gap-3">
                {(selected.items ?? []).slice(0, 4).map((item) => (
                  <LineItem key={item.id} title={item.link?.campaign?.title ?? item.link?.url ?? "Link"} amount={money(item.amount)} />
                ))}
                {(selected.items?.length ?? 0) > 4 && (
                  <LineItem title={`+ ${selected.items!.length - 4} more approved links`} amount="" />
                )}
              </div>
              <div className="flex items-center justify-between border-t border-border pt-3.5">
                <span className="text-[0.8125rem] text-text-faint">Total</span>
                <span className="text-[1.125rem] font-extrabold tabular-nums">{money(selected.amount)}</span>
              </div>

              <Button
                variant="secondary"
                size="lg"
                className="w-full"
                onClick={() => downloadMutation.mutate(selected)}
                disabled={downloadMutation.isPending}
              >
                <DownloadIcon className="h-3.5 w-3.5" />
                {downloadMutation.isPending ? "Preparing PDF…" : "Download PDF"}
              </Button>
              <Button
                variant="secondary"
                size="lg"
                className="w-full"
                onClick={() => downloadLinksMutation.mutate(selected)}
                disabled={downloadLinksMutation.isPending}
              >
                <SearchIcon className="h-3.5 w-3.5" />
                {downloadLinksMutation.isPending ? "Preparing…" : "Download links"}
              </Button>

              {canManage && selected.status !== "PAID" && selected.status !== "REJECTED" && (
                <Button size="lg" className="w-full" onClick={() => markPaidMutation.mutate(selected.id)} disabled={markPaidMutation.isPending}>
                  {markPaidMutation.isPending ? "Marking paid…" : "Mark as paid"}
                </Button>
              )}
              {canManage && selected.status !== "PAID" && selected.status !== "REJECTED" && (
                <Button variant="danger" size="lg" className="w-full" onClick={() => setRejectingId(selected.id)}>
                  Reject invoice
                </Button>
              )}
              {canManage && selected.gstStatus !== "COMPLETED" && (
                <Button
                  variant="secondary"
                  size="lg"
                  className="w-full"
                  onClick={() => gstMutation.mutate({ id: selected.id, gstStatus: NEXT_GST[selected.gstStatus] })}
                  disabled={gstMutation.isPending}
                >
                  {gstMutation.isPending ? "Updating…" : `Advance GST to ${NEXT_GST[selected.gstStatus].toLowerCase()}`}
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
            </div>
          )}
        </div>
      </div>

      {rejectingId && (
        <RejectInvoiceModal
          onClose={() => setRejectingId(null)}
          onConfirm={(remarks) => rejectMutation.mutate({ id: rejectingId, remarks })}
          isPending={rejectMutation.isPending}
          error={rejectMutation.error instanceof ApiError ? rejectMutation.error.message : rejectMutation.isError ? "Couldn't reject this invoice." : undefined}
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onConfirm(remarks);
        }}
        className="flex w-full max-w-[420px] flex-col gap-5 rounded-lg border border-border bg-surface p-6 shadow-card"
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
    </div>
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
