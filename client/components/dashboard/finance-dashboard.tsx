"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { DashboardHero } from "@/components/dashboard/dashboard-hero";
import { StackedBar } from "@/components/charts/stacked-bar";
import { TONE_COLOR } from "@/components/charts/tone-color";
import { STATUS_CONFIG } from "@/components/ui/status-pill";
import { Panel, PanelAction } from "@/components/ui/panel";
import { RankedBarList } from "@/components/charts/ranked-bar-list";
import { TableSkeleton, EmptyState } from "@/components/ui/table-parts";
import { InvoiceIcon, AlertIcon, CheckCircleIcon, ClockIcon, ArrowRightIcon } from "@/components/icons";
import { useAuth } from "@/lib/auth-context";
import { links as linksApi, invoices as invoicesApi, assets as assetsApi, campaigns as campaignsApi, billing as billingApi, type Invoice } from "@/lib/api-client";
import { money, count, initialsOf, roleLabel } from "@/lib/format";
import { lastNMonths } from "@/lib/dates";

const INVOICE_STATUS_ORDER: Invoice["status"][] = ["DRAFT", "RAISED", "APPROVED", "REJECTED", "PAID"];

/**
 * Finance's own landing page (newTask.md, 8 Sep — "Finance role: only sees
 * the finance slice — pending-post-for-cost, money given/taken, approvals;
 * campaigns + inventory, page-wise total dues/paid. separate dashboard for
 * finance"). Split out of AdminDashboard rather than reusing it: Finance
 * has no `links.review` permission (screenshot/insight review, cost
 * revision, refresh-metrics are all Admin-only server-side — see
 * links/routes.js), so the interactive review queue and inventory/asset
 * approval actions that used to live on the shared dashboard don't belong
 * here. What Finance *can* act on — invoices and billing-profile approvals
 * — stays fully interactive; campaigns/inventory are read-only context.
 */
export function FinanceDashboard() {
  const { user, accessToken } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const token = accessToken!;

  const linksQuery = useQuery({ queryKey: ["links", "finance-overview"], queryFn: () => linksApi.list(token, { pageSize: 100 }) });
  const invoicesQuery = useQuery({ queryKey: ["invoices", "finance-overview"], queryFn: () => invoicesApi.list(token, { pageSize: 100 }) });
  const assetsQuery = useQuery({ queryKey: ["assets"], queryFn: () => assetsApi.list(token) });
  const campaignsQuery = useQuery({ queryKey: ["campaigns"], queryFn: () => campaignsApi.list(token) });
  const billingQuery = useQuery({ queryKey: ["billingProfiles"], queryFn: () => billingApi.list(token) });

  const links = linksQuery.data?.items ?? [];
  const invoices = invoicesQuery.data?.items ?? [];
  const assets = assetsQuery.data ?? [];
  const billingProfiles = billingQuery.data ?? [];

  // Same definitions as the Invoices page's own tiles and AdminDashboard's,
  // so the same number never disagrees with itself across pages.
  const financeKpis = useMemo(() => {
    const totalRaised = invoices.reduce((sum, i) => sum + Number(i.amount), 0);
    const pending = invoices.filter((i) => i.status === "RAISED" || i.status === "APPROVED");
    const overdue = pending.filter((i) => i.overdueDays > 0);
    const paid = invoices.filter((i) => i.status === "PAID");
    return {
      totalRaised,
      pendingAmount: pending.reduce((sum, i) => sum + Number(i.amount), 0),
      pendingCount: pending.length,
      overdueAmount: overdue.reduce((sum, i) => sum + Number(i.amount), 0),
      overdueCount: overdue.length,
      collectedAmount: paid.reduce((sum, i) => sum + Number(i.amount), 0),
      collectedCount: paid.length,
    };
  }, [invoices]);

  // Same per-month bucketing as AdminDashboard's expenditure chart (money
  // paid out, by month raised) — just feeding a KPI-card sparkline here
  // instead of a full chart, off data this dashboard already fetches.
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
    () =>
      INVOICE_STATUS_ORDER.map((status) => ({
        key: status,
        label: STATUS_CONFIG[status].label,
        value: invoices.filter((i) => i.status === status).length,
        color: TONE_COLOR[STATUS_CONFIG[status].tone ?? "slate"],
      })),
    [invoices]
  );

  // "pending-post-for-cost" (newTask.md, 8 Sep) — links still working
  // through the pipeline, not yet invoiced; read-only here (no
  // links.review permission), unlike the same figure's drill-down on the
  // Admin dashboard.
  const pendingForInvoicing = links.filter((l) => l.status !== "INVOICED" && l.status !== "INVALID").length;

  // Page-wise total dues (newTask.md, 8 Sep) — sum of every INVOICED link's
  // cost, grouped by page. An approximation of "money given/taken" per
  // page from data this dashboard already has (link.cost × invoiced
  // status), not a true paid-vs-pending split — that would need per-invoice
  // line items joined back to their link's page, which no endpoint returns
  // today. Labeled accordingly rather than implying more precision than this has.
  const pageWiseDues = useMemo(() => {
    const byAsset = new Map<string, { handle: string; followers: number; total: number; count: number }>();
    for (const link of links) {
      if (link.status !== "INVOICED" || !link.asset) continue;
      const existing = byAsset.get(link.asset.id) ?? { handle: link.asset.handle, followers: link.asset.followers, total: 0, count: 0 };
      existing.total += Number(link.cost);
      existing.count += 1;
      byAsset.set(link.asset.id, existing);
    }
    return [...byAsset.values()].sort((a, b) => b.total - a.total).slice(0, 8);
  }, [links]);

  const approveBillingMutation = useMutation({
    mutationFn: ({ id, approvalStatus }: { id: string; approvalStatus: "approved" | "rejected" }) => billingApi.setApproval(token, id, approvalStatus),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["billingProfiles"] }),
  });
  const pendingBillingProfiles = billingProfiles.filter((b) => b.approvalStatus === "pending");

  return (
    <AppShell active="dashboard" user={{ initials: initialsOf(user?.name), name: user?.name ?? "—", role: roleLabel(user?.role), tone: "blue" }} searchPlaceholder="Search invoices, campaigns, pages…">
      <div className="flex flex-col gap-8">
        <DashboardHero
          eyebrow="Finance"
          title={<span className="text-accent">Overview</span>}
          subtitle="Money given, money taken, and what's still waiting on an approval."
          stat={{ value: String(financeKpis.pendingCount), label: "Invoices pending" }}
        />

        <div className="flex gap-3 overflow-x-auto pb-1 -mx-4 px-4 md:mx-0 md:grid md:grid-cols-4 md:gap-4 md:overflow-visible md:px-0 md:pb-0">
          <KpiCard
            className="w-[160px] shrink-0 md:w-auto"
            icon={InvoiceIcon}
            label="Total raised"
            value={money(financeKpis.totalRaised)}
            foot={`${invoices.length} invoices`}
            sparkline={raisedTrend}
            onClick={() => router.push("/invoices")}
          />
          <KpiCard
            className="w-[160px] shrink-0 md:w-auto"
            icon={ClockIcon}
            label="Pending payment"
            value={money(financeKpis.pendingAmount)}
            foot={`${financeKpis.pendingCount} awaiting settlement`}
            onClick={() => router.push("/invoices?status=RAISED")}
          />
          <KpiCard
            className="w-[160px] shrink-0 md:w-auto"
            icon={AlertIcon}
            label="Overdue"
            value={money(financeKpis.overdueAmount)}
            foot={`${financeKpis.overdueCount} past due date`}
            tone={financeKpis.overdueCount > 0 ? "rose" : undefined}
            onClick={() => router.push("/invoices?status=RAISED")}
          />
          <KpiCard className="w-[160px] shrink-0 md:w-auto" icon={CheckCircleIcon} label="Collected" value={money(financeKpis.collectedAmount)} foot={`${financeKpis.collectedCount} paid invoices`} onClick={() => router.push("/invoices?status=PAID")} />
        </div>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <Panel title="Invoice status" subtitle="Every invoice ever raised, by current status.">
            {invoicesQuery.isLoading ? (
              <TableSkeleton rows={1} />
            ) : invoices.length === 0 ? (
              <EmptyState label="No invoices raised yet." />
            ) : (
              <StackedBar segments={invoiceComposition} onSelect={(status) => router.push(`/invoices?status=${status}`)} />
            )}
          </Panel>

          <Panel title="Pending post-for-cost" subtitle="Links still in the pipeline, not yet invoiced.">
            <div className="flex items-center gap-4 py-2">
              <ClockIcon className="h-8 w-8 text-text-faint" />
              <div>
                <p className="text-2xl font-extrabold tabular-nums">{linksQuery.isLoading ? "—" : pendingForInvoicing}</p>
                <p className="text-[0.8125rem] text-text-faint">links awaiting invoicing</p>
              </div>
              <Button variant="ghost" size="sm" className="ml-auto" onClick={() => router.push("/invoices")}>
                View invoices <ArrowRightIcon className="h-3 w-3" />
              </Button>
            </div>
          </Panel>
        </div>

        {/* Read-only campaign/inventory context — Finance sees these (newTask.md, 8 Sep) but doesn't manage them. */}
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <Panel
            title="Campaigns"
            subtitle="Read-only — campaign management is Admin's."
            action={
              <PanelAction onClick={() => router.push("/campaigns")}>
                View all <ArrowRightIcon className="h-3 w-3" />
              </PanelAction>
            }
          >
            {campaignsQuery.isLoading ? (
              <TableSkeleton rows={3} />
            ) : (campaignsQuery.data ?? []).length === 0 ? (
              <EmptyState label="No campaigns yet." />
            ) : (
              <div className="flex flex-col gap-2.5">
                {(campaignsQuery.data ?? []).slice(0, 5).map((c) => (
                  <div key={c.id} className="flex items-center justify-between gap-3 rounded-md border border-border px-3.5 py-2.5">
                    <span className="truncate text-[0.8438rem] font-semibold">{c.title}</span>
                    <span className="shrink-0 text-xs text-text-faint">{money(c.costCap ?? 0)} cap</span>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel
            title="Page-wise dues"
            subtitle="Total invoiced amount per page, highest first."
            action={
              <PanelAction onClick={() => router.push("/inventory")}>
                View inventory <ArrowRightIcon className="h-3 w-3" />
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
        </div>

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
            <div className="flex flex-col gap-2.5">
              {pendingBillingProfiles.map((bp) => (
                <div key={bp.id} className="flex items-center justify-between gap-3 rounded-md border border-border px-3.5 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-[0.8438rem] font-semibold">{bp.name}</p>
                    <p className="truncate text-xs text-text-faint">{bp.user?.name ?? bp.user?.phoneNumber ?? "—"} · PAN {bp.pan}</p>
                  </div>
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

        <p className="text-center text-xs text-text-faint">
          {count(assets.length)} pages in inventory · {count((campaignsQuery.data ?? []).length)} campaigns
        </p>
      </div>
    </AppShell>
  );
}
