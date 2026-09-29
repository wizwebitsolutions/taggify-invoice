"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { StatusPill } from "@/components/ui/status-pill";
import { Field, TextField } from "@/components/ui/form-field";
import { DownloadIcon, SearchIcon, CloseIcon, UploadIcon } from "@/components/icons";
import { Th, TableSkeleton, EmptyState, ErrorNotice } from "@/components/ui/table-parts";
import { clientInvoices as clientInvoicesApi, ApiError, type ClientInvoice } from "@/lib/api-client";
import { PlanInvoiceAttachmentControl } from "@/components/plans/plan-invoice-attachment";
import { money } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Receivables (user decision, 23 Sep — "track + list in /invoices"): the
 * Taggify → client invoices minted on approved plans, as Finance sees and
 * settles them. Sits behind the Payables / Receivables toggle on
 * app/invoices/page.tsx for ADMIN / FINANCE (and a Plan Maker, read-only,
 * for their own plans). The document itself is still generated from the
 * plan card (components/plans/client-invoice-modal.tsx); this is the ledger.
 *
 * `hasAttachment`/`showAttachmentControl` (tasks.md #5, 23 Sep — the
 * Payments tab): the Payments tab defaults `hasAttachment` on ("actual
 * amount to be collected" only counts a plan whose real, non-Proforma
 * invoice is attached) and shows the attach control inline so that can be
 * done from here too; /invoices' own Receivables tab leaves both off,
 * unchanged.
 */
export function ClientInvoicesPanel({
  token,
  canManage,
  hasAttachment = false,
  showAttachmentControl = false,
  searchPlaceholder = "Search invoice, client, plan maker…",
  initialSearch = "",
  onAttachInvoice,
}: {
  token: string;
  canManage: boolean;
  hasAttachment?: boolean;
  showAttachmentControl?: boolean;
  searchPlaceholder?: string;
  /** Seeds the search box (25 Sep — the "Attach an invoice" client picker opens this list pre-searched for the client it picked). Only read on first render; the search box is still freely editable after. */
  initialSearch?: string;
  /** Renders an "Attach an invoice" action next to the search bar when set (25 Sep — Receivables' client-picker entry point). Omit to leave it out, e.g. on the Payments tab. */
  onAttachInvoice?: () => void;
}) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState(initialSearch);
  const [statusFilter, setStatusFilter] = useState<ClientInvoice["status"] | "">("");
  const [settling, setSettling] = useState<ClientInvoice | null>(null);
  const [cancelling, setCancelling] = useState<ClientInvoice | null>(null);

  const query = useQuery({
    queryKey: ["client-invoices", search, statusFilter, hasAttachment],
    queryFn: () => clientInvoicesApi.list(token, { search: search || undefined, status: statusFilter || undefined, hasAttachment }),
  });
  const items = query.data?.items ?? [];

  const kpis = useMemo(() => {
    const open = items.filter((c) => c.status !== "CANCELLED");
    const billed = open.reduce((sum, c) => sum + Number(c.total), 0);
    const collected = items.filter((c) => c.status === "PAID").reduce((sum, c) => sum + Number(c.paidAmount ?? c.total), 0);
    const outstanding = items.filter((c) => c.status === "ISSUED");
    return { billed, collected, outstanding: billed - collected, outstandingCount: outstanding.length, count: open.length };
  }, [items]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["client-invoices"] });
  const markPaidMutation = useMutation({
    mutationFn: ({ id, paidAmount, remarks }: { id: string; paidAmount?: number; remarks?: string }) => clientInvoicesApi.markPaid(token, id, { paidAmount, remarks }),
    onSuccess: () => {
      setSettling(null);
      invalidate();
    },
  });
  const cancelMutation = useMutation({
    mutationFn: ({ id, remarks }: { id: string; remarks: string }) => clientInvoicesApi.cancel(token, id, remarks),
    onSuccess: () => {
      setCancelling(null);
      invalidate();
    },
  });
  const downloadMutation = useMutation({
    mutationFn: (ci: ClientInvoice) => clientInvoicesApi.downloadPdf(token, ci.id, ci.invoiceNumber),
  });

  const clientLabel = (ci: ClientInvoice) => ci.plan?.clientCompany ?? ci.plan?.clientName ?? "—";
  const dateLabel = (ci: ClientInvoice) =>
    ci.status === "PAID"
      ? ci.paidAt
        ? `Collected ${new Date(ci.paidAt).toLocaleDateString()}`
        : "Collected"
      : ci.status === "CANCELLED"
        ? "Cancelled"
        : `Issued ${new Date(ci.issuedAt).toLocaleDateString()}`;

  const actions = (ci: ClientInvoice, size: "sm" | "default" = "sm") => (
    <div onClick={(e) => e.stopPropagation()} className="flex items-center justify-end gap-1">
      {canManage && ci.status === "ISSUED" && (
        <Button size={size} className={cn(size === "sm" && "h-8")} onClick={() => setSettling(ci)}>
          Mark paid
        </Button>
      )}
      {canManage && ci.status === "ISSUED" && (
        <Button variant="ghost" size={size} className={cn("text-rose", size === "sm" && "h-8")} onClick={() => setCancelling(ci)}>
          Cancel
        </Button>
      )}
      <button
        title="Download PDF"
        aria-label={`Download ${ci.invoiceNumber}`}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-faint hover:bg-surface-2 hover:text-text-muted disabled:opacity-50"
        onClick={() => downloadMutation.mutate(ci)}
        disabled={downloadMutation.isPending}
      >
        <DownloadIcon className="h-3.5 w-3.5" />
      </button>
    </div>
  );

  const COLS = "grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)_minmax(0,1.2fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(0,1.2fr)_minmax(0,1.3fr)]";

  return (
    <div className="flex flex-col gap-7" data-testid="receivables-view">
      <div className="flex gap-3 overflow-x-auto pb-1 -mx-4 px-4 md:mx-0 md:grid md:grid-cols-3 md:gap-4 md:overflow-visible md:px-0 md:pb-0">
        <KpiCard className="w-[170px] shrink-0 md:w-auto" label="Billed to clients" value={money(kpis.billed)} foot={`${kpis.count} client invoice${kpis.count === 1 ? "" : "s"}`} />
        <KpiCard className="w-[170px] shrink-0 md:w-auto" label="Collected" value={money(kpis.collected)} foot="Marked paid by Finance" />
        <KpiCard
          className="w-[170px] shrink-0 md:w-auto"
          label="Outstanding"
          value={money(kpis.outstanding)}
          foot={`${kpis.outstandingCount} awaiting payment`}
          tone={kpis.outstandingCount > 0 ? "rose" : undefined}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <div className="flex h-9 min-w-[160px] flex-1 items-center gap-2 rounded-full border border-border bg-surface px-3.5 text-[0.8125rem] text-text-faint sm:flex-none sm:w-64">
          <SearchIcon className="h-3.5 w-3.5 shrink-0" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full bg-transparent text-text placeholder:text-text-faint focus:outline-none"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as ClientInvoice["status"] | "")}
          className="h-9 rounded-full border border-border bg-surface px-3.5 text-[0.8125rem] text-text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-30"
        >
          <option value="">Status</option>
          <option value="ISSUED">Issued</option>
          <option value="PAID">Paid</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
        {onAttachInvoice && (
          <Button variant="secondary" size="sm" className="rounded-full" onClick={onAttachInvoice} data-testid="attach-invoice-button">
            <UploadIcon className="h-3.5 w-3.5" />
            Attach an invoice
          </Button>
        )}
      </div>

      {(markPaidMutation.isError || cancelMutation.isError || downloadMutation.isError) && (
        <ErrorNotice
          message={
            [markPaidMutation.error, cancelMutation.error, downloadMutation.error].find((e) => e instanceof ApiError)?.message ?? "Something went wrong — try again."
          }
        />
      )}

      {/* Desktop table — grows with content, page scrolls (same as payables). */}
      <div className="hidden flex-col rounded-lg border border-border bg-surface shadow-card md:flex">
        <div className={cn("grid gap-3 border-b border-border px-5 py-3.5", COLS)}>
          <Th>Invoice</Th>
          <Th>Client</Th>
          <Th>Plan / campaign</Th>
          <Th>Total</Th>
          <Th>Status</Th>
          <Th>Date</Th>
          <Th>Action</Th>
        </div>
        {query.isLoading ? (
          <TableSkeleton />
        ) : items.length === 0 ? (
          <EmptyState label="No client invoices yet — generate one from an approved plan on the Plans page." />
        ) : (
          <div data-testid="client-invoice-row-list">
            {items.map((ci) => (
              <div key={ci.id} className={cn("grid items-center gap-3 border-b border-border px-5 py-4 hover:bg-surface-2", COLS)}>
                <div className="truncate font-mono text-[0.8125rem] text-text-muted">{ci.invoiceNumber}</div>
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-[0.8438rem] text-text">{clientLabel(ci)}</span>
                  {ci.plan?.clientGstNumber && <span className="truncate font-mono text-[0.6875rem] text-text-faint">{ci.plan.clientGstNumber}</span>}
                </div>
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="truncate text-[0.8125rem] text-text-muted">{ci.plan?.name ?? "—"}</span>
                  {ci.plan?.campaign && <span className="truncate text-[0.6875rem] text-text-faint">{ci.plan.campaign.title}</span>}
                  {ci.plan?.createdBy?.name && <span className="truncate text-[0.6875rem] text-text-faint">POC · {ci.plan.createdBy.name}</span>}
                  {showAttachmentControl && ci.plan && <PlanInvoiceAttachmentControl token={token} plan={ci.plan} />}
                </div>
                <div className="flex flex-col">
                  <span className="text-[0.9375rem] font-semibold tabular-nums">{money(ci.total)}</span>
                  {ci.status === "PAID" && ci.paidAmount != null && Number(ci.paidAmount) !== Number(ci.total) && (
                    <span className="text-[0.6875rem] text-rose">Received {money(ci.paidAmount)}</span>
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  <StatusPill status={ci.status} />
                  {ci.remarks && (
                    <span className="truncate text-[0.6875rem] text-text-faint" title={ci.remarks}>
                      {ci.remarks}
                    </span>
                  )}
                </div>
                <div className="text-xs text-text-faint">{dateLabel(ci)}</div>
                {actions(ci)}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Mobile cards. */}
      <div className="flex flex-col gap-3 md:hidden">
        {query.isLoading ? (
          <TableSkeleton />
        ) : items.length === 0 ? (
          <EmptyState label="No client invoices yet — generate one from an approved plan on the Plans page." />
        ) : (
          items.map((ci) => (
            <div key={ci.id} className="flex flex-col gap-2.5 rounded-[14px] border border-border bg-surface p-3.5 shadow-card">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-mono text-xs text-text-faint">{ci.invoiceNumber}</span>
                <StatusPill status={ci.status} />
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-[0.8125rem] text-text-muted">{clientLabel(ci)}</span>
                <span className="shrink-0 text-[1.0625rem] font-semibold tabular-nums">{money(ci.total)}</span>
              </div>
              {showAttachmentControl && ci.plan && <PlanInvoiceAttachmentControl token={token} plan={ci.plan} />}
              <div className="flex items-center justify-between border-t border-border pt-2.5">
                <span className="text-xs text-text-faint">{dateLabel(ci)}</span>
                {actions(ci, "default")}
              </div>
            </div>
          ))
        )}
      </div>

      {settling && (
        <SettleModal
          invoice={settling}
          onClose={() => setSettling(null)}
          isPending={markPaidMutation.isPending}
          onConfirm={(paidAmount, remarks) => markPaidMutation.mutate({ id: settling.id, paidAmount, remarks })}
        />
      )}
      {cancelling && (
        <CancelModal
          invoice={cancelling}
          onClose={() => setCancelling(null)}
          isPending={cancelMutation.isPending}
          onConfirm={(remarks) => cancelMutation.mutate({ id: cancelling.id, remarks })}
        />
      )}
    </div>
  );
}

/** Thin wrapper over the app's one overlay primitive (components/ui/sheet.tsx — bottom sheet on mobile, centered dialog at md+). */
function ModalFrame({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <Sheet onClose={onClose}>
      <div role="dialog" aria-label={title} className="flex flex-col gap-4 overflow-y-auto p-6 pt-1 md:pt-6">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-[-0.02em]">{title}</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="-mr-2 -mt-1 flex h-8 w-8 items-center justify-center rounded-md text-text-faint hover:bg-surface-2">
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </Sheet>
  );
}

function SettleModal({
  invoice,
  onClose,
  onConfirm,
  isPending,
}: {
  invoice: ClientInvoice;
  onClose: () => void;
  onConfirm: (paidAmount: number | undefined, remarks: string | undefined) => void;
  isPending: boolean;
}) {
  const [amount, setAmount] = useState(String(Number(invoice.total)));
  const [remarks, setRemarks] = useState("");
  const parsed = Number(amount);
  const valid = Number.isFinite(parsed) && parsed > 0;
  return (
    <ModalFrame title={`Mark ${invoice.invoiceNumber} as paid`} onClose={onClose}>
      <p className="mb-4 text-[0.8125rem] text-text-muted">Record the amount the client actually transferred. A short payment is kept as-is so the gap stays visible.</p>
      <div className="flex flex-col gap-3">
        <Field label="Amount received (₹)">
          <TextField value={amount} onChange={setAmount} inputMode="decimal" aria-label="Amount received (₹)" />
        </Field>
        <Field label="Remarks (optional)">
          <TextField value={remarks} onChange={setRemarks} placeholder="e.g. TDS deducted" aria-label="Remarks (optional)" />
        </Field>
      </div>
      <div className="mt-1 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Back
        </Button>
        <Button disabled={!valid || isPending} onClick={() => onConfirm(valid && parsed !== Number(invoice.total) ? parsed : undefined, remarks.trim() || undefined)}>
          {isPending ? "Saving…" : "Confirm payment"}
        </Button>
      </div>
    </ModalFrame>
  );
}

function CancelModal({ invoice, onClose, onConfirm, isPending }: { invoice: ClientInvoice; onClose: () => void; onConfirm: (remarks: string) => void; isPending: boolean }) {
  const [remarks, setRemarks] = useState("");
  return (
    <ModalFrame title={`Cancel ${invoice.invoiceNumber}`} onClose={onClose}>
      <p className="mb-4 text-[0.8125rem] text-text-muted">Closes this receivable as never to be collected. The plan keeps its number; nothing is deleted.</p>
      <Field label="Reason">
        <TextField value={remarks} onChange={setRemarks} placeholder="e.g. Deal fell through" aria-label="Reason" />
      </Field>
      <div className="mt-1 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Back
        </Button>
        <Button variant="danger" disabled={!remarks.trim() || isPending} onClick={() => onConfirm(remarks.trim())}>
          {isPending ? "Cancelling…" : "Cancel invoice"}
        </Button>
      </div>
    </ModalFrame>
  );
}
