"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CircleCheck, Clock, Download, FileText, MoreHorizontal, Paperclip } from "lucide-react";

import { useAuth } from "@/lib/auth-context";
import { ApiError, canUse, clientInvoices as clientInvoicesApi, hasAccess, type ClientInvoice } from "@/lib/api-client";
import { monthKeyOf, monthLabel, monthRange } from "@/lib/finance";
import { canEditPlan } from "@/lib/plans";
import { personLabel, plural } from "@/lib/format";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/taggify/illustration";
import { MetricTile } from "@/components/taggify/metric-tile";
import { Money } from "@/components/taggify/money";
import { SearchField } from "@/components/taggify/search-field";
import { StatusPill } from "@/components/taggify/status-pill";
import { PlanInvoiceAttachmentField } from "@/components/finance/invoice-attachment";
import { Pager, PER_PAGE } from "@/components/finance/pager";
import { LoadError, NoAccess } from "@/components/finance/states";

const TABS = { ISSUED: "Issued", PAID: "Paid", CANCELLED: "Cancelled" } as const;
type Tab = keyof typeof TABS;
const errText = (e: unknown, fallback: string) => (e instanceof ApiError || e instanceof Error ? e.message : fallback);
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
const daysSince = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
/** Money is summed in whole paise and converted once. */
const sumRupees = (xs: (string | null | undefined)[]) => xs.reduce<number>((p, x) => p + Math.round(Number(x ?? 0) * 100), 0) / 100;
const clientOf = (r: ClientInvoice) => r.plan?.clientCompany || r.plan?.clientName || "Client";

export default function ReceivablesPage() {
  return (
    <AppShell active="receivables">
      <Receivables />
    </AppShell>
  );
}

/**
 * Receivables: Taggify → client invoices minted when a plan is invoiced (prototype
 * S.receivables). GET /invoices/client returns every row (no paging), so tabs,
 * counts and search run here over the full list. Reading is finance.view (a
 * planner sees their own plans'); marking paid and cancelling are finance.pay.
 */
function Receivables() {
  const { user, accessToken } = useAuth();
  const qc = useQueryClient();
  const allowed = !!user && user.role !== "CREATOR" && user.role !== "TEAM_MEMBER" && canUse(user, "finance.view");
  const [tab, setTab] = useState<Tab>("ISSUED");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [paying, setPaying] = useState<ClientInvoice | null>(null);
  const [cancelling, setCancelling] = useState<ClientInvoice | null>(null);

  const list = useQuery({ queryKey: ["clientInvoices", "all"], queryFn: () => clientInvoicesApi.list(accessToken!), enabled: !!accessToken && allowed });
  const all = useMemo(() => list.data?.items ?? [], [list.data]);
  const needle = q.trim().toLowerCase();
  const matches = (r: ClientInvoice) => !needle || `${r.invoiceNumber} ${r.plan?.clientName ?? ""} ${r.plan?.clientCompany ?? ""} ${r.plan?.createdBy?.name ?? ""} ${r.plan?.name ?? ""}`.toLowerCase().includes(needle);
  const counts = { ISSUED: 0, PAID: 0, CANCELLED: 0 } as Record<Tab, number>;
  all.filter(matches).forEach((r) => counts[r.status]++);
  const rows = all.filter((r) => r.status === tab && matches(r));
  const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  useEffect(() => {
    if (page > pages) setPage(pages);
  }, [page, pages]);
  const current = Math.min(page, pages);
  const shown = rows.slice((current - 1) * PER_PAGE, current * PER_PAGE);

  const month = monthKeyOf(new Date());
  const range = monthRange(month);
  const unpaid = all.filter((r) => r.status === "ISSUED");
  const oldest = unpaid.reduce<ClientInvoice | null>((o, r) => (!o || r.issuedAt < o.issuedAt ? r : o), null);
  const paidThisMonth = all.filter((r) => r.status === "PAID" && r.paidAt && r.paidAt >= range.from && r.paidAt <= range.to);

  const pdf = useMutation({
    mutationFn: (r: ClientInvoice) => clientInvoicesApi.downloadPdf(accessToken!, r.id, r.invoiceNumber),
    onError: (e) => toast.error(errText(e, "Couldn't download the PDF.")),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["clientInvoices"] });

  if (!allowed) return <NoAccess what="receivables" hint="Ask an admin to give you the Finance “view” permission if you need it." />;
  const canSettle = hasAccess(user, "finance.pay");
  const canOpenPlan = canUse(user, "plans.view");

  return (
    <div className="flex flex-col gap-5 pt-2">
      <div>
        <p className="text-body font-medium text-fg-strong">Finance</p>
        <h1 className="text-display">Receivables</h1>
        <p className="mt-1 text-body text-muted-foreground">What clients owe Taggify for approved plans.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <MetricTile tone="coral" icon={FileText} label="Unpaid" loading={list.isLoading} value={<Money value={sumRupees(unpaid.map((r) => r.total))} />} meta={plural(unpaid.length, "invoice")} />
        <MetricTile tone="mint" icon={CircleCheck} label="Paid This Month" loading={list.isLoading} value={<Money value={sumRupees(paidThisMonth.map((r) => r.paidAmount ?? r.total))} />} meta={`${plural(paidThisMonth.length, "invoice")} in ${monthLabel(month, "long")}`} />
        <MetricTile tone="amber" icon={Clock} label="Oldest unpaid" loading={list.isLoading} value={oldest ? plural(daysSince(oldest.issuedAt), "day") : "—"} meta={oldest ? `${clientOf(oldest)} · issued ${day(oldest.issuedAt)}` : "Nothing unpaid"} />
      </div>

      <Card className="overflow-hidden">
        <Tabs
          value={tab}
          onValueChange={(v) => {
            setTab(v as Tab);
            setPage(1);
          }}
        >
          <div className="flex items-end gap-4 px-5 pt-2">
            <TabsList className="flex-1 border-b-0">
              {(Object.keys(TABS) as Tab[]).map((k) => (
                <TabsTrigger key={k} value={k}>
                  {TABS[k]} ({counts[k]})
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
        </Tabs>
        <div className="flex flex-wrap items-center gap-2 border-t px-5 py-4">
          <SearchField
            label="Search receivables"
            placeholder="Search client, planner or invoice no..."
            className="w-full sm:w-80"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
        </div>

        {list.isError ? (
          <LoadError onRetry={() => list.refetch()} what="receivables" />
        ) : list.isLoading ? (
          <div className="flex flex-col gap-2 border-t p-5">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : shown.length === 0 ? (
          <div className="border-t">
            <EmptyState name={needle ? "empty-search" : "empty-dues"} title={needle ? "Nothing matches" : `No ${TABS[tab].toLowerCase()} client invoices`}>
              {needle ? "Try another client, planner or number." : tab === "ISSUED" ? "Client invoices appear here when a plan is invoiced." : null}
            </EmptyState>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>{tab === "PAID" ? "Paid" : "Issued"}</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((r) => {
                const age = daysSince(r.issuedAt);
                const short = r.status === "PAID" && r.paidAmount != null && Math.round(Number(r.paidAmount) * 100) < Math.round(Number(r.total) * 100);
                return (
                  <TableRow key={r.id}>
                    <TableCell>
                      <span className="text-body-strong">{r.invoiceNumber}</span>
                      {r.plan?.createdBy?.name && <span className="block text-small text-fg-muted">Planner: {r.plan.createdBy.name}</span>}
                    </TableCell>
                    <TableCell>
                      <span className="block font-medium">{clientOf(r)}</span>
                      {r.plan?.clientGstNumber && <span className="block text-small text-fg-muted">GSTIN {r.plan.clientGstNumber}</span>}
                    </TableCell>
                    <TableCell>
                      {r.plan ? (
                        canOpenPlan ? (
                          <Link href={`/plans/${r.plan.id}`} className="font-medium text-foreground hover:text-brand-ink">
                            {r.plan.name}
                          </Link>
                        ) : (
                          <span className="font-medium">{r.plan.name}</span>
                        )
                      ) : (
                        "—"
                      )}
                      {r.plan?.campaign && <span className="block text-small text-fg-muted">{r.plan.campaign.title}</span>}
                      {/* The plan's final client invoice PDF (v1 Receivables "Attach an invoice"): same plans.edit / owning-planner rule as on the plan page. */}
                      {r.plan && r.status !== "CANCELLED" && canEditPlan(user, { createdBy: { id: r.plan.createdById, name: r.plan.createdBy?.name ?? null } }) && (
                        <div className="mt-1">
                          <PlanInvoiceAttachmentField plan={r.plan} editable compact />
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-semibold">
                      <Money value={r.status === "PAID" && r.paidAmount ? r.paidAmount : r.total} />
                      {short && (
                        <span className="block text-small font-normal text-fg-muted">
                          of <Money value={r.total} />
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{day(r.status === "PAID" && r.paidAt ? r.paidAt : r.issuedAt)}</TableCell>
                    <TableCell>
                      <span className="flex flex-col items-start gap-1">
                        {r.status === "ISSUED" ? <StatusPill tone="info">{age === 0 ? "Issued today" : `Issued ${plural(age, "day")} ago`}</StatusPill> : r.status === "PAID" ? <StatusPill tone={short ? "warning" : "success"}>{short ? "Paid · short" : "Paid"}</StatusPill> : <StatusPill tone="neutral">Cancelled</StatusPill>}
                        {r.remarks && r.status !== "ISSUED" && <span className="max-w-48 truncate text-small text-fg-muted">{r.remarks}</span>}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="inline-flex items-center gap-2">
                        {canSettle && r.status === "ISSUED" && (
                          <Button size="sm" onClick={() => setPaying(r)}>
                            Mark paid…
                          </Button>
                        )}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" aria-label={`More for ${r.invoiceNumber}`}>
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => pdf.mutate(r)}>
                              <Download className="h-4 w-4" aria-hidden />
                              Download PDF
                            </DropdownMenuItem>
                            {r.plan?.invoiceAttachment?.url && (
                              <DropdownMenuItem asChild>
                                <a href={r.plan.invoiceAttachment.url} target="_blank" rel="noreferrer">
                                  <Paperclip className="h-4 w-4" aria-hidden />
                                  Final invoice ({r.plan.invoiceAttachment.name})
                                </a>
                              </DropdownMenuItem>
                            )}
                            {canSettle && r.status === "ISSUED" && <DropdownMenuItem onSelect={() => setCancelling(r)}>Cancel invoice…</DropdownMenuItem>}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        {rows.length > 0 && <Pager total={rows.length} page={current} pages={pages} noun="invoices" onPage={setPage} />}
      </Card>

      <Dialog open={!!paying} onOpenChange={(o) => !o && setPaying(null)}>
        <DialogContent>{paying && <MarkPaidForm key={paying.id} invoice={paying} onClose={() => setPaying(null)} onDone={refresh} />}</DialogContent>
      </Dialog>
      <CancelDialog invoice={cancelling} onClose={() => setCancelling(null)} onDone={refresh} />
    </div>
  );
}

/**
 * Records the client's payment. Marking paid always closes the invoice (server sets PAID
 * whatever the amount), so an amount below the total is a write-off of the rest, never a
 * part payment that can be topped up later. The note is required then.
 */
function MarkPaidForm({ invoice, onClose, onDone }: { invoice: ClientInvoice; onClose: () => void; onDone: () => Promise<unknown> }) {
  const { accessToken } = useAuth();
  const [amount, setAmount] = useState(String(Number(invoice.total)));
  const [remarks, setRemarks] = useState("");
  const clean = amount.replace(/,/g, "").trim();
  const value = Number(clean);
  const amountOk = /^\d+(\.\d{1,2})?$/.test(clean) && value > 0;
  const totalPaise = Math.round(Number(invoice.total) * 100);
  const over = Math.round(value * 100) > totalPaise;
  const shortBy = amountOk && !over ? (totalPaise - Math.round(value * 100)) / 100 : 0;
  const noteMissing = shortBy > 0 && !remarks.trim();
  const mark = useMutation({
    mutationFn: () => clientInvoicesApi.markPaid(accessToken!, invoice.id, { paidAmount: value, ...(remarks.trim() ? { remarks: remarks.trim() } : {}) }),
    onSuccess: async () => {
      await onDone();
      toast.success(`${invoice.invoiceNumber} marked paid.`);
      onClose();
    },
  });
  return (
    <>
        <DialogHeader>
          <DialogTitle>Mark {invoice.invoiceNumber} paid?</DialogTitle>
          <DialogDescription>
            {clientOf(invoice)} · total <Money value={invoice.total} />. This closes the invoice and can&apos;t be undone here.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="rcv-amount">Amount received (₹)</Label>
            <Input id="rcv-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={!amountOk || over} />
            {!amountOk ? (
              <p className="text-small text-danger-helper">Enter the amount received, in rupees.</p>
            ) : over ? (
              <p className="text-small text-danger-helper">That&apos;s more than the invoice total.</p>
            ) : shortBy > 0 ? (
              <p className="text-small text-warning-fg">
                That&apos;s <Money value={shortBy} /> less than the total. The invoice still closes as paid and the rest can&apos;t be collected through Taggify later. Say why in the note.
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="rcv-remarks">
              Note {shortBy > 0 ? null : <span className="font-normal text-muted-foreground">(optional)</span>}
            </Label>
            <Input id="rcv-remarks" maxLength={500} placeholder={shortBy > 0 ? "e.g. TDS deducted by the client, agreed discount" : "e.g. NEFT ref, cheque no."} aria-invalid={noteMissing} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </div>
        </div>
        {mark.isError && (
          <p className="text-small text-danger-helper" role="alert">
            {errText(mark.error, "Couldn't mark it paid. Try again.")}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="success" disabled={!amountOk || over || noteMissing || mark.isPending} onClick={() => mark.mutate()}>
            Mark paid
          </Button>
        </DialogFooter>
    </>
  );
}

function CancelDialog({ invoice, onClose, onDone }: { invoice: ClientInvoice | null; onClose: () => void; onDone: () => Promise<unknown> }) {
  const { accessToken } = useAuth();
  const [reason, setReason] = useState("");
  const cancel = useMutation({
    mutationFn: () => clientInvoicesApi.cancel(accessToken!, invoice!.id, reason.trim()),
    onSuccess: async () => {
      await onDone();
      toast.success(`${invoice!.invoiceNumber} cancelled.`);
      close();
    },
  });
  function close() {
    setReason("");
    cancel.reset();
    onClose();
  }
  return (
    <Dialog open={!!invoice} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel {invoice?.invoiceNumber}?</DialogTitle>
          <DialogDescription>Use this when the client won&apos;t pay this invoice (deal fell through, re-issued elsewhere). It stays on record as cancelled.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="rcv-cancel">Reason</Label>
          <Input id="rcv-cancel" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        {cancel.isError && (
          <p className="text-small text-danger-helper" role="alert">
            {errText(cancel.error, "Couldn't cancel it. Try again.")}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            Keep it
          </Button>
          <Button variant="destructive" disabled={!reason.trim() || cancel.isPending} onClick={() => cancel.mutate()}>
            Cancel invoice
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
