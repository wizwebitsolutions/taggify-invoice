"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CircleCheck, Download, FileText, Wallet } from "lucide-react";

import { useAuth } from "@/lib/auth-context";
import { ApiError, canUse, invoices as invoicesApi, type Invoice } from "@/lib/api-client";
import { captionTitle, computePayoutTotals, formatLabel, latestSnapshot, monthKeyOf, monthLabel, monthRange, sumMoney } from "@/lib/finance";
import { plural } from "@/lib/format";
import { invalidateCreator, useMyInvoices, useMyPaid, useMyPending, useMySummary } from "@/lib/queries/creator";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/taggify/illustration";
import { MetricTile } from "@/components/taggify/metric-tile";
import { Money } from "@/components/taggify/money";
import { StatusPill } from "@/components/taggify/status-pill";
import { SegmentedFilter } from "@/components/taggify/segmented-filter";
import { ContentThumb, displayHandle } from "@/components/finance/identity";
import { LoadError, NoAccess } from "@/components/finance/states";
import { InvoiceAttachmentField } from "@/components/finance/invoice-attachment";
import { MyInvoiceSheet, useInvoiceDownloads } from "@/components/creator/invoice-sheet";

/** Creator-facing invoice stages: no Finance jargon. */
const INVOICE_STAGE: Record<Invoice["status"], { label: string; tone: "warning" | "info" | "success" | "danger" | "neutral" }> = {
  DRAFT: { label: "Draft", tone: "neutral" },
  RAISED: { label: "Sent · waiting for approval", tone: "warning" },
  APPROVED: { label: "Approved · payment due", tone: "info" },
  REJECTED: { label: "Rejected", tone: "danger" },
  PAID: { label: "Paid", tone: "success" },
};

export default function MoneyPage() {
  return (
    <AppShell active="money">
      <CreatorMoney />
    </AppShell>
  );
}

function CreatorMoney() {
  const { user, accessToken } = useAuth();
  const qc = useQueryClient();
  const month = monthKeyOf(new Date());
  const pending = useMyPending();
  const invoices = useMyInvoices();
  const paid = useMyPaid();
  const monthSummary = useMySummary(monthRange(month));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState(false);
  const [gst, setGst] = useState<"no" | "yes">("no");
  const [viewing, setViewing] = useState<Invoice | null>(null);
  const { pdf } = useInvoiceDownloads();

  const ready = useMemo(() => pending.data?.items ?? [], [pending.data]);
  const chosen = ready.filter((l) => selected.has(l.id));
  // Drop selections that left the list (invoiced elsewhere, picked up by a payout).
  useEffect(() => {
    setSelected((s) => {
      const ids = new Set(ready.map((l) => l.id));
      const kept = [...s].filter((id) => ids.has(id));
      return kept.length === s.size ? s : new Set(kept);
    });
  }, [ready]);
  const totals = computePayoutTotals(
    chosen.map((l) => Number(l.cost)),
    gst === "yes",
    null
  );
  const open = (invoices.data?.items ?? []).filter((i) => i.status === "RAISED" || i.status === "APPROVED");

  const raise = useMutation({
    mutationFn: () => invoicesApi.bulkCreate(accessToken!, chosen.map((l) => l.id), 15, gst === "yes"),
    onSuccess: async (inv) => {
      setConfirm(false);
      setSelected(new Set());
      await invalidateCreator(qc);
      toast.success(`Invoice ${inv.invoiceNumber} sent.`);
    },
  });

  if (user?.role !== "CREATOR" || !canUse(user, "finance.view")) return <NoAccess what="Money" />;
  const canRaise = canUse(user, "finance.edit");

  return (
    <div className="flex flex-col gap-6 pt-2">
      <div>
        <h1 className="text-display">Money</h1>
        <p className="mt-1 text-body text-muted-foreground">What you can invoice, what&apos;s on its way, and what&apos;s been paid.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <MetricTile tone="mint" icon={Wallet} label="Ready to invoice" loading={pending.isLoading} value={<Money value={sumMoney(ready, (l) => l.cost)} />} meta={`${plural(ready.length, "post")} · or Taggify pays you directly`} />
        <MetricTile tone="amber" icon={FileText} label="Invoiced, not paid yet" loading={invoices.isLoading} value={<Money value={sumMoney(open, (i) => i.amount)} />} meta={plural(open.length, "invoice")} />
        <MetricTile tone="coral" icon={CircleCheck} label={`Paid in ${monthLabel(month)}`} loading={monthSummary.isLoading} value={<Money value={monthSummary.data?.paid.amount ?? 0} />} meta={`${plural(monthSummary.data?.paid.payments ?? 0, "payment")} · after TDS`} />
      </div>

      <Tabs defaultValue="ready">
        <TabsList>
          <TabsTrigger value="ready">Ready to invoice ({ready.length})</TabsTrigger>
          <TabsTrigger value="invoices">Invoices ({invoices.data?.total ?? 0})</TabsTrigger>
          <TabsTrigger value="paid">Paid ({paid.data?.total ?? 0})</TabsTrigger>
        </TabsList>

        <TabsContent value="ready" className="flex flex-col gap-3">
          {pending.isError ? (
            <LoadError onRetry={() => pending.refetch()} what="your posts" />
          ) : pending.isLoading ? (
            <Skeleton className="h-40 rounded-card" />
          ) : ready.length === 0 ? (
            <Card>
              <EmptyState name="empty-dues" title="Nothing to invoice yet">
                Posts appear here once they&apos;re live and not on an invoice or payout.
              </EmptyState>
            </Card>
          ) : (
            <>
              <Card className="divide-y overflow-hidden">
                <label className="flex items-center gap-3 bg-muted px-4 py-3 text-small font-semibold">
                  <Checkbox
                    checked={chosen.length === 0 ? false : chosen.length === ready.length ? true : "indeterminate"}
                    onCheckedChange={(v) => setSelected(v === true ? new Set(ready.map((l) => l.id)) : new Set())}
                    aria-label="Select all posts"
                  />
                  Select all
                </label>
                {ready.map((l) => (
                  <label key={l.id} className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-accent">
                    <Checkbox
                      checked={selected.has(l.id)}
                      onCheckedChange={(v) =>
                        setSelected((s) => {
                          const n = new Set(s);
                          if (v === true) n.add(l.id);
                          else n.delete(l.id);
                          return n;
                        })
                      }
                      aria-label={`Select ${captionTitle(latestSnapshot(l)?.caption) ?? formatLabel(l.format)}`}
                    />
                    <ContentThumb src={latestSnapshot(l)?.thumbnailUrl} format={l.format} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body-strong">{captionTitle(latestSnapshot(l)?.caption) ?? formatLabel(l.format)}</span>
                      <span className="block truncate text-small text-fg-muted">
                        {displayHandle(l.asset.handle)} · {l.campaign?.title ?? "—"}
                      </span>
                    </span>
                    <Money value={l.cost} className="font-semibold" />
                  </label>
                ))}
              </Card>
              {canRaise && (
                <div className="sticky bottom-[calc(theme(spacing.24)+env(safe-area-inset-bottom))] z-10 flex items-center gap-3 rounded-card border bg-card p-4 shadow-3 md:bottom-4">
                  <span className="min-w-0 flex-1 text-body">
                    <span className="font-semibold">{plural(chosen.length, "post")}</span> selected · <Money value={totals.subtotal} className="font-semibold" />
                  </span>
                  <Button disabled={chosen.length === 0} onClick={() => setConfirm(true)}>
                    Raise invoice
                  </Button>
                </div>
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="invoices">
          {invoices.isError ? (
            <LoadError onRetry={() => invoices.refetch()} what="your invoices" />
          ) : invoices.isLoading ? (
            <Skeleton className="h-32 rounded-card" />
          ) : (invoices.data?.items.length ?? 0) === 0 ? (
            <Card>
              <EmptyState name="empty-content" title="No invoices yet">
                Raise one from Ready to invoice.
              </EmptyState>
            </Card>
          ) : (
            <Card className="divide-y overflow-hidden">
              {invoices.data!.items.map((i) => (
                <div key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block text-body-strong">{i.invoiceNumber}</span>
                    <span className="block text-small text-fg-muted">
                      Sent {new Date(i.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
                      {i.campaign ? ` · ${i.campaign.title}` : ""}
                      {i.remarks && i.status === "REJECTED" ? ` · ${i.remarks}` : ""}
                    </span>
                  </span>
                  <StatusPill tone={INVOICE_STAGE[i.status].tone}>{INVOICE_STAGE[i.status].label}</StatusPill>
                  <Money value={i.amount} className="font-semibold" />
                  {/* Your own (GST) invoice document, kept with Taggify's copy. Locked once paid. */}
                  {(i.attachment || i.status !== "PAID") && <InvoiceAttachmentField invoice={i} compact attachLabel="Attach your invoice" />}
                  <Button variant="outline" size="sm" aria-label={`View ${i.invoiceNumber}`} onClick={() => setViewing(i)}>
                    View
                  </Button>
                  <Button variant="ghost" size="icon" aria-label={`Download ${i.invoiceNumber} PDF`} disabled={pdf.isPending} onClick={() => pdf.mutate(i)}>
                    <Download />
                  </Button>
                </div>
              ))}
            </Card>
          )}
        </TabsContent>

        <TabsContent value="paid">
          {paid.isError ? (
            <LoadError onRetry={() => paid.refetch()} what="your payments" />
          ) : paid.isLoading ? (
            <Skeleton className="h-32 rounded-card" />
          ) : (paid.data?.items.length ?? 0) === 0 ? (
            <Card>
              <EmptyState name="empty-dues" title="No payments yet">
                Payments show here with their receipts.
              </EmptyState>
            </Card>
          ) : (
            <Card className="divide-y overflow-hidden">
              {paid.data!.items.map((r) => {
                const amount = r.kind === "payout" ? r.payout.netAmount : r.invoice.amount;
                const receipt = r.kind === "payout" ? r.payout.receipt : r.invoice.receipt;
                const utr = r.kind === "payout" ? r.payout.utr : null;
                return (
                  <div key={r.kind === "payout" ? r.payout.id : r.invoice.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <span className="min-w-0 flex-1">
                      <span className="block text-body-strong">
                        <Money value={amount} />
                      </span>
                      <span className="block text-small text-fg-muted">
                        {r.paidAt ? new Date(r.paidAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—"}
                        {r.kind === "payout" && r.payout.tdsPercent ? ` · TDS ${Number(r.payout.tdsPercent)}% deducted` : ""}
                        {utr ? ` · UTR ${utr}` : ""}
                      </span>
                    </span>
                    <StatusPill tone="success">Paid</StatusPill>
                    {receipt?.url ? (
                      <Button asChild variant="outline" size="sm">
                        <a href={receipt.url} target="_blank" rel="noreferrer">
                          View receipt
                        </a>
                      </Button>
                    ) : (
                      <span className="text-small text-fg-muted">No receipt on file</span>
                    )}
                  </div>
                );
              })}
            </Card>
          )}
        </TabsContent>
      </Tabs>

      <MyInvoiceSheet invoice={viewing} onClose={() => setViewing(null)} />

      <Dialog
        open={confirm}
        onOpenChange={(o) => {
          setConfirm(o);
          if (!o) raise.reset();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Raise an invoice for {plural(chosen.length, "post")}?</DialogTitle>
            <DialogDescription>Finance checks it against what was booked, then pays it.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <p className="text-body-strong">Are you GST registered?</p>
            <SegmentedFilter
              label="GST"
              value={gst}
              onChange={setGst}
              options={[
                { value: "no", label: "No GST" },
                { value: "yes", label: "Add 18% GST" },
              ]}
              className="self-start"
            />
          </div>
          <dl className="grid grid-cols-2 gap-y-1 rounded-lg border p-3 text-body">
            <dt className="text-muted-foreground">Posts</dt>
            <dd className="text-right">
              <Money value={totals.subtotal} />
            </dd>
            <dt className="text-muted-foreground">GST</dt>
            <dd className="text-right">{gst === "yes" ? <Money value={totals.gstAmount} signed /> : "—"}</dd>
            <dt className="font-semibold">Invoice total</dt>
            <dd className="text-right font-semibold">
              <Money value={totals.netAmount} />
            </dd>
          </dl>
          {raise.isError && (
            <p className="text-small text-danger-helper" role="alert">
              {raise.error instanceof ApiError || raise.error instanceof Error ? raise.error.message : "Couldn't raise the invoice. Try again."}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setConfirm(false);
                raise.reset();
              }}
            >
              Cancel
            </Button>
            <Button disabled={raise.isPending} onClick={() => raise.mutate()}>
              {raise.isPending ? "Sending…" : "Send invoice"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
