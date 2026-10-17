"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader, Table, THead, TH, TR, TD, Cell2 } from "@/components/ui/data-table";
import { Tag } from "@/components/ui/tag";
import { Note } from "@/components/ui/note";
import { Segmented } from "@/components/ui/chips";
import { Panel, PanelAction } from "@/components/ui/panel";
import { RankedBarList } from "@/components/charts/ranked-bar-list";
import { StackedBar } from "@/components/charts/stacked-bar";
import { TONE_COLOR } from "@/components/charts/tone-color";
import { STATUS_CONFIG } from "@/components/ui/status-pill";
import { TableSkeleton, EmptyState, ErrorNotice } from "@/components/ui/table-parts";
import { ArrowRightIcon, CheckIcon, DownloadIcon } from "@/components/icons";
import { PaySheet, toPaymentInvoice } from "@/components/payments/pay-sheet";
import { useAuth } from "@/lib/auth-context";
import { links as linksApi, invoices as invoicesApi, assets as assetsApi, campaigns as campaignsApi, billing as billingApi, admin as adminApi, type Invoice } from "@/lib/api-client";
import { money, count, initialsOf, roleLabel, personLabel } from "@/lib/format";
import { lastNMonths } from "@/lib/dates";
import { useState } from "react";
import { formatLabel } from "@/lib/formats";

const INVOICE_STATUS_ORDER: Invoice["status"][] = ["DRAFT", "RAISED", "APPROVED", "REJECTED", "PAID"];
const DAY = 24 * 60 * 60 * 1000;

function dueLabel(inv: Invoice): { text: string; tone: "bad" | "wait" | "neutral" } {
  if (inv.overdueDays > 0) return { text: `${inv.overdueDays}d overdue`, tone: "bad" };
  if (!inv.dueDate) return { text: "No due date", tone: "neutral" };
  const days = Math.ceil((new Date(inv.dueDate).getTime() - Date.now()) / DAY);
  if (days <= 0) return { text: "Today", tone: "wait" };
  return { text: `In ${days}d`, tone: days <= 3 ? "wait" : "neutral" };
}

/**
 * Finance home (premium mockup 10): what's owed, what's paid, and what
 * needs a cost before it can be billed. Payout queue with inline "Mark
 * paid", dues by page, links waiting on a cost, and the daily export.
 */
export function FinanceDashboard() {
  const { user, accessToken } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const token = accessToken!;
  const [groupBy, setGroupBy] = useState<"invoice" | "page" | "campaign">("invoice");

  const linksQuery = useQuery({ queryKey: ["links", "finance-overview"], queryFn: () => linksApi.list(token, { pageSize: 100 }) });
  const invoicesQuery = useQuery({ queryKey: ["invoices", "finance-overview"], queryFn: () => invoicesApi.list(token, { pageSize: 100 }) });
  const assetsQuery = useQuery({ queryKey: ["assets"], queryFn: () => assetsApi.list(token) });
  const campaignsQuery = useQuery({ queryKey: ["campaigns"], queryFn: () => campaignsApi.list(token) });
  const billingQuery = useQuery({ queryKey: ["billingProfiles"], queryFn: () => billingApi.list(token) });

  const links = linksQuery.data?.items ?? [];
  const invoices = invoicesQuery.data?.items ?? [];
  const assets = assetsQuery.data ?? [];
  const billingProfiles = billingQuery.data ?? [];

  const kpis = useMemo(() => {
    const pending = invoices.filter((i) => i.status === "RAISED" || i.status === "APPROVED");
    const overdue = pending.filter((i) => i.overdueDays > 0);
    const paid = invoices.filter((i) => i.status === "PAID");
    const now = new Date();
    const paidThisMonth = paid.filter((i) => {
      const d = new Date(i.paidAt ?? i.createdAt);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    });
    return {
      dueAmount: pending.reduce((s, i) => s + Number(i.amount), 0),
      dueCount: pending.length,
      overdueAmount: overdue.reduce((s, i) => s + Number(i.amount), 0),
      overdueCount: overdue.length,
      paidMonthAmount: paidThisMonth.reduce((s, i) => s + Number(i.amount), 0),
      paidMonthCount: paidThisMonth.length,
      collectedAmount: paid.reduce((s, i) => s + Number(i.amount), 0),
      gstPending: invoices.filter((i) => i.isGstInvoice && i.gstStatus === "PENDING").length,
      gstScheduled: invoices.filter((i) => i.isGstInvoice && i.gstStatus === "SCHEDULED").length,
    };
  }, [invoices]);

  const raisedTrend = useMemo(() => {
    const months = lastNMonths(6);
    const byKey = new Map(months.map((m) => [m.key, 0]));
    for (const inv of invoices) {
      const d = new Date(inv.createdAt);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      if (byKey.has(key)) byKey.set(key, (byKey.get(key) ?? 0) + Number(inv.amount));
    }
    return months.map((m) => byKey.get(m.key) ?? 0);
  }, [invoices]);

  const invoiceComposition = useMemo(
    () => INVOICE_STATUS_ORDER.map((status) => ({ key: status, label: STATUS_CONFIG[status].label, value: invoices.filter((i) => i.status === status).length, color: TONE_COLOR[STATUS_CONFIG[status].tone ?? "slate"] })),
    [invoices]
  );

  const queue = useMemo(() => invoices.filter((i) => i.status === "RAISED" || i.status === "APPROVED").sort((a, b) => b.overdueDays - a.overdueDays || new Date(a.dueDate ?? 0).getTime() - new Date(b.dueDate ?? 0).getTime()), [invoices]);
  const groupedQueue = useMemo(() => {
    if (groupBy === "invoice") return null;
    const map = new Map<string, { label: string; sub: string; amount: number; count: number; overdue: number }>();
    for (const inv of queue) {
      const key = groupBy === "page" ? inv.creator?.id ?? inv.creatorId : inv.campaign?.id ?? "none";
      const label = groupBy === "page" ? personLabel(inv.creator, "—") : inv.campaign?.title ?? "No campaign";
      const sub = groupBy === "page" ? "creator" : inv.campaign?.brandName ?? "";
      const e = map.get(key) ?? { label, sub, amount: 0, count: 0, overdue: 0 };
      e.amount += Number(inv.amount);
      e.count += 1;
      if (inv.overdueDays > 0) e.overdue += 1;
      map.set(key, e);
    }
    return [...map.values()].sort((a, b) => b.amount - a.amount);
  }, [queue, groupBy]);

  const needsCost = useMemo(() => links.filter((l) => Number(l.cost) === 0 && l.status !== "INVALID"), [links]);
  // A post beyond its campaign booking (29 Sep) will never be invoiced, so it isn't "awaiting invoicing".
  const pendingForInvoicing = links.filter((l) => l.status !== "INVOICED" && l.status !== "INVALID" && !l.overQuota).length;

  const pageWiseDues = useMemo(() => {
    const byAsset = new Map<string, { handle: string; total: number; count: number; paid: number }>();
    for (const link of links) {
      if (link.status !== "INVOICED" || !link.asset) continue;
      const existing = byAsset.get(link.asset.id) ?? { handle: link.asset.handle, total: 0, count: 0, paid: 0 };
      const isPaid = link.invoiceItem?.invoice?.status === "PAID";
      if (isPaid) existing.paid += Number(link.cost);
      else existing.total += Number(link.cost);
      existing.count += 1;
      byAsset.set(link.asset.id, existing);
    }
    return [...byAsset.values()].sort((a, b) => b.total - a.total).slice(0, 8);
  }, [links]);

  // Paying opens the same TDS + mandatory-receipt PaySheet the Payments tab
  // uses (28 Sep) — an invoice is paid off exclusively through a Payout now.
  const [payingInvoice, setPayingInvoice] = useState<Invoice | null>(null);
  const approveBillingMutation = useMutation({
    mutationFn: ({ id, approvalStatus }: { id: string; approvalStatus: "approved" | "rejected" }) => billingApi.setApproval(token, id, approvalStatus),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["billingProfiles"] }),
  });
  const exportMutation = useMutation({ mutationFn: () => adminApi.runFinanceGoogleSheetExportNow(token) });
  const pendingBillingProfiles = billingProfiles.filter((b) => b.approvalStatus === "pending");
  const firstName = (user?.name ?? "there").split(" ")[0];
  const monthLabel = new Date().toLocaleDateString(undefined, { month: "short" });

  return (
    <AppShell active="dashboard" user={{ initials: initialsOf(user?.name), name: user?.name ?? "—", role: roleLabel(user?.role), tone: "blue" }} searchPlaceholder="Search invoices, campaigns, pages…">
      <div className="flex flex-col gap-5">
        <PageHeader
          title={
            <>
              Finance, <span className="serif text-[1.15em]">{firstName}.</span>
            </>
          }
          subtitle="What's owed, what's paid, and what needs a cost before it can be billed."
          actions={
            <>
              <Button variant="secondary" onClick={() => exportMutation.mutate()} disabled={exportMutation.isPending}>
                <DownloadIcon className="h-4 w-4" />
                {exportMutation.isPending ? "Exporting…" : "Export to sheet"}
              </Button>
              <Button onClick={() => router.push("/invoices?status=APPROVED")}>
                <CheckIcon className="h-4 w-4" />
                Record payment
              </Button>
            </>
          }
        />

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
          <KpiCard label="Due now" value={money(kpis.dueAmount)} foot={kpis.overdueCount > 0 ? `${kpis.overdueCount} overdue · ${money(kpis.overdueAmount)}` : `${kpis.dueCount} invoices awaiting settlement`} tone={kpis.overdueCount > 0 ? "rose" : undefined} onClick={() => router.push("/invoices?status=APPROVED")} sparkline={raisedTrend} />
          <KpiCard label={`Paid · ${monthLabel}`} value={money(kpis.paidMonthAmount)} foot={`${kpis.paidMonthCount} invoices · ${money(kpis.collectedAmount)} all time`} onClick={() => router.push("/invoices?status=PAID")} />
          <KpiCard label="Posts without a cost" value={String(needsCost.length)} foot={needsCost.length > 0 ? "Can't be invoiced yet" : "Everything is priced"} tone={needsCost.length > 0 ? "violet" : undefined} />
          <KpiCard label="GST filings pending" value={String(kpis.gstPending)} foot={`${kpis.gstScheduled} scheduled`} onClick={() => router.push("/invoices")} />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.5fr_1fr]">
          <Card data-testid="payout-queue">
            <CardHeader
              title="Payout queue"
              meta={<span className="text-[0.78rem] text-text-muted">{queue.length} open</span>}
              action={
                <>
                  <Segmented
                    ariaLabel="Group payouts"
                    value={groupBy}
                    onChange={setGroupBy}
                    options={[
                      { value: "invoice", label: "By invoice" },
                      { value: "page", label: "By creator" },
                      { value: "campaign", label: "By campaign" },
                    ]}
                  />
                  <Link href="/invoices" className="hidden text-[0.8125rem] font-medium text-blue hover:text-text sm:inline">
                    All invoices
                  </Link>
                </>
              }
            />
            {invoicesQuery.isLoading ? (
              <TableSkeleton />
            ) : queue.length === 0 ? (
              <EmptyState label="Nothing waiting for payout." />
            ) : groupedQueue ? (
              <Table>
                <THead>
                  <tr>
                    <TH>{groupBy === "page" ? "Creator" : "Campaign"}</TH>
                    <TH>Invoices</TH>
                    <TH right>Amount</TH>
                  </tr>
                </THead>
                <tbody>
                  {groupedQueue.map((g) => (
                    <TR key={g.label}>
                      <TD>
                        <Cell2 primary={g.label} secondary={g.sub} />
                      </TD>
                      <TD>
                        {g.count} {g.overdue > 0 && <Tag tone="bad">{g.overdue} overdue</Tag>}
                      </TD>
                      <TD right className="font-semibold">
                        {money(g.amount)}
                      </TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            ) : (
              <Table>
                <THead>
                  <tr>
                    <TH>Invoice</TH>
                    <TH className="hidden md:table-cell">Creator</TH>
                    <TH className="hidden lg:table-cell">Campaign</TH>
                    <TH right>Amount</TH>
                    <TH>Due</TH>
                    <TH className="hidden md:table-cell">GST</TH>
                    <TH />
                  </tr>
                </THead>
                <tbody>
                  {queue.slice(0, 8).map((inv, i) => {
                    const due = dueLabel(inv);
                    return (
                      <TR key={inv.id} interactive onClick={() => router.push(`/invoices?search=${encodeURIComponent(inv.invoiceNumber)}&status=${inv.status}`)} style={{ animationDelay: `${0.2 + i * 0.04}s` }}>
                        <TD className="font-semibold">{inv.invoiceNumber}</TD>
                        <TD className="hidden md:table-cell">{personLabel(inv.creator, "—")}</TD>
                        <TD className="hidden text-text-muted lg:table-cell">{inv.campaign?.title ?? "—"}</TD>
                        <TD right className="font-semibold">
                          {money(inv.amount)}
                        </TD>
                        <TD>
                          <Tag tone={due.tone}>{due.text}</Tag>
                        </TD>
                        <TD className="hidden text-text-muted md:table-cell">{inv.isGstInvoice ? STATUS_CONFIG[inv.gstStatus].label : "Non-GST"}</TD>
                        <TD right>
                          {/* Paying opens PaySheet, which only accepts an APPROVED invoice; a RAISED one still needs admin approval first. */}
                          {(inv.overQuotaCount ?? 0) > 0 ? (
                            // Posts beyond their booking on it (29 Sep) — not payable until rejected and re-raised.
                            <Tag tone="bad">Over booking · re-raise</Tag>
                          ) : inv.status === "APPROVED" ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={(e) => {
                                e.stopPropagation();
                                setPayingInvoice(inv);
                              }}
                            >
                              Mark paid
                            </Button>
                          ) : (
                            <Tag tone="wait">Awaiting approval</Tag>
                          )}
                        </TD>
                      </TR>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </Card>

          <div className="flex flex-col gap-4">
            <Panel
              title="Page-wise dues"
              subtitle="Invoiced and still unpaid, per page."
              action={
                <PanelAction onClick={() => router.push("/inventory")}>
                  All pages <ArrowRightIcon className="h-3 w-3" />
                </PanelAction>
              }
            >
              {linksQuery.isLoading ? (
                <TableSkeleton rows={3} />
              ) : pageWiseDues.length === 0 ? (
                <EmptyState label="No invoiced links yet." />
              ) : (
                <RankedBarList items={pageWiseDues.map((p) => ({ key: p.handle, label: `@${p.handle}`, value: p.total }))} formatValue={(v) => money(v)} onSelect={() => router.push("/inventory")} />
              )}
            </Panel>

            <Panel title="Pending post-for-cost" subtitle={needsCost.length > 0 ? "Posts with no cost yet — set one before invoicing." : "Links still in the pipeline, not yet invoiced."}>
              {linksQuery.isLoading ? (
                <TableSkeleton rows={2} />
              ) : needsCost.length > 0 ? (
                <div className="flex flex-col gap-2">
                  {needsCost.slice(0, 5).map((l) => (
                    <div key={l.id} className="flex items-center gap-3">
                      <Cell2 primary={`@${l.asset?.handle ?? "—"} · ${formatLabel(l.format)}`} secondary={l.campaign?.title ?? "—"} />
                      {/* Cost revision itself is an Admin action; Finance opens the campaign to flag it. */}
                      <Button size="sm" variant="secondary" className="ml-auto" onClick={() => router.push(`/campaigns/view?id=${l.campaignId}`)}>
                        Open campaign
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <p className="text-[1.5rem] font-semibold tabular-nums">{pendingForInvoicing}</p>
                  <p className="text-[0.8125rem] text-text-muted">links awaiting invoicing</p>
                  <Button variant="ghost" size="sm" className="ml-auto" onClick={() => router.push("/invoices")}>
                    View invoices <ArrowRightIcon className="h-3 w-3" />
                  </Button>
                </div>
              )}
            </Panel>

            <Note tone={exportMutation.isSuccess ? "ok" : "info"}>
              {exportMutation.isSuccess ? "Finance export pushed to the sheet just now." : "Daily finance export runs every morning and pushes every invoice row to the Google Sheet."}{" "}
              <button type="button" className="font-medium text-blue hover:text-text" onClick={() => exportMutation.mutate()} disabled={exportMutation.isPending}>
                Run now
              </button>
            </Note>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Panel title="Invoice status" subtitle="Every invoice ever raised, by current status.">
            {invoicesQuery.isLoading ? <TableSkeleton rows={1} /> : invoices.length === 0 ? <EmptyState label="No invoices raised yet." /> : <StackedBar segments={invoiceComposition} onSelect={(status) => router.push(`/invoices?status=${status}`)} />}
          </Panel>

          <Panel
            title="Billing profiles awaiting approval"
            action={
              <PanelAction onClick={() => router.push("/profile?tab=billing")}>
                View all <ArrowRightIcon className="h-3 w-3" />
              </PanelAction>
            }
          >
            {billingQuery.isLoading ? (
              <TableSkeleton rows={3} />
            ) : pendingBillingProfiles.length === 0 ? (
              <EmptyState label="No billing profiles waiting on approval." />
            ) : (
              <div className="flex flex-col gap-2">
                {pendingBillingProfiles.map((bp) => (
                  <div key={bp.id} className="flex items-center justify-between gap-3 rounded-md border border-border px-3.5 py-2.5">
                    <Cell2 primary={bp.name} secondary={`${personLabel(bp.user, "—")} · PAN ${bp.pan}`} />
                    <div className="flex shrink-0 gap-1.5">
                      <Button size="sm" onClick={() => approveBillingMutation.mutate({ id: bp.id, approvalStatus: "approved" })} disabled={approveBillingMutation.isPending}>
                        Approve
                      </Button>
                      <Button variant="danger" size="sm" onClick={() => approveBillingMutation.mutate({ id: bp.id, approvalStatus: "rejected" })} disabled={approveBillingMutation.isPending}>
                        Reject
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>

        <p className="text-center text-xs text-text-muted">
          {count(assets.length)} pages in inventory · {count((campaignsQuery.data ?? []).length)} campaigns
        </p>
      </div>

      {payingInvoice && (
        <PaySheet
          mode="new"
          token={token}
          vendor={payingInvoice.creator!}
          links={[]}
          invoices={[toPaymentInvoice(payingInvoice)]}
          onRemoveLink={() => {}}
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
