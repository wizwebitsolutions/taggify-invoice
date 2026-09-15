"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader, Thumb } from "@/components/ui/data-table";
import { Tag } from "@/components/ui/tag";
import { Panel, PanelAction, ProgressBar } from "@/components/ui/panel";
import { RankedBarList } from "@/components/charts/ranked-bar-list";
import { StackedBar } from "@/components/charts/stacked-bar";
import { TONE_COLOR } from "@/components/charts/tone-color";
import { STATUS_CONFIG, StatusPill } from "@/components/ui/status-pill";
import { TableSkeleton, EmptyState } from "@/components/ui/table-parts";
import { ComparePagesPanel } from "@/components/dashboard/compare-pages-panel";
import { InvoiceIcon, AlertIcon, CampaignIcon, ClockIcon, TeamIcon, ArrowRightIcon, PlusIcon, DownloadIcon, EyeIcon } from "@/components/icons";
import { useAuth } from "@/lib/auth-context";
import {
  links as linksApi,
  invoices as invoicesApi,
  assets as assetsApi,
  campaigns as campaignsApi,
  billing as billingApi,
  plans as plansApi,
  admin as adminApi,
  type Link as LinkRow,
  type Invoice,
  type Campaign,
} from "@/lib/api-client";
import { money, initialsOf, roleLabel } from "@/lib/format";
import { lastNMonths } from "@/lib/dates";

const LINK_PIPELINE_ORDER: LinkRow["status"][] = [
  "SUBMITTED",
  "PENDING_SCREENSHOT_REVIEW",
  "SCREENSHOT_REJECTED",
  "SCREENSHOT_APPROVED",
  "INSIGHTS_PENDING",
  "INSIGHTS_APPROVED",
  "INVOICED",
  "INVALID",
];
const INVOICE_STATUS_ORDER: Invoice["status"][] = ["DRAFT", "RAISED", "APPROVED", "REJECTED", "PAID"];

const DAY = 24 * 60 * 60 * 1000;
const daysSince = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / DAY));
const shortDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "—");

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

/** One row of the "Needs your decision" queue on the admin home. */
type Decision = {
  id: string;
  title: string;
  sub: string;
  href: string;
  waitingDays?: number;
  primary?: { label: string; onClick: () => void; pending?: boolean };
  secondary?: { label: string; href: string };
  thumb?: string | null;
  initials?: string;
};

/**
 * Admin's landing page (premium mockup 02): a decision queue, not a chart
 * wall. Greeting + count, four KPIs, "Needs your decision" on the left,
 * campaign budgets and the six-month expenditure bars on the right. The
 * deeper analytics (pipeline funnel, page comparison, invoice mix, system
 * health) stay further down the page. Reviewing individual proofs happens
 * on /approvals, the list-left/detail-right queue.
 */
export function AdminDashboard() {
  const { user, accessToken } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const token = accessToken!;
  const isAdmin = user?.role === "ADMIN";

  // 100 is the server's hard cap for every list endpoint.
  const linksQuery = useQuery({ queryKey: ["links", "admin-overview"], queryFn: () => linksApi.list(token, { pageSize: 100 }) });
  const invoicesQuery = useQuery({ queryKey: ["invoices", "admin-overview"], queryFn: () => invoicesApi.list(token, { pageSize: 100 }) });
  const assetsQuery = useQuery({ queryKey: ["assets"], queryFn: () => assetsApi.list(token) });
  const campaignsQuery = useQuery({ queryKey: ["campaigns"], queryFn: () => campaignsApi.list(token) });
  const billingQuery = useQuery({ queryKey: ["billingProfiles"], queryFn: () => billingApi.list(token) });
  const plansQuery = useQuery({ queryKey: ["plans"], queryFn: () => plansApi.list(token), enabled: isAdmin });
  const usersQuery = useQuery({ queryKey: ["adminUsers"], queryFn: () => adminApi.users(token), enabled: isAdmin });
  const jobRunsQuery = useQuery({ queryKey: ["job-runs"], queryFn: () => adminApi.jobRuns(token), enabled: isAdmin });

  const links = linksQuery.data?.items ?? [];
  const invoices = invoicesQuery.data?.items ?? [];
  const assets = assetsQuery.data ?? [];
  const campaigns = campaignsQuery.data ?? [];
  const billingProfiles = billingQuery.data ?? [];
  const plans = plansQuery.data ?? [];

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["links"] });
    queryClient.invalidateQueries({ queryKey: ["assets"] });
    queryClient.invalidateQueries({ queryKey: ["billingProfiles"] });
    queryClient.invalidateQueries({ queryKey: ["plans"] });
  };
  const approveScreenshot = useMutation({ mutationFn: (id: string) => linksApi.reviewScreenshot(token, id, true), onSuccess: invalidateAll });
  const approveInsights = useMutation({ mutationFn: (id: string) => linksApi.approveInsights(token, id), onSuccess: invalidateAll });
  const approveAsset = useMutation({ mutationFn: (id: string) => assetsApi.setApproval(token, id, "approved"), onSuccess: invalidateAll });
  const approveBilling = useMutation({ mutationFn: (id: string) => billingApi.setApproval(token, id, "approved"), onSuccess: invalidateAll });

  // ── KPIs ──────────────────────────────────────────────────────────────
  const expenditureTrend = useMemo(() => {
    const months = lastNMonths(6);
    const byKey = new Map(months.map((m) => [m.key, 0]));
    for (const inv of invoices) {
      const d = new Date(inv.createdAt);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      if (byKey.has(key)) byKey.set(key, (byKey.get(key) ?? 0) + Number(inv.amount));
    }
    return months.map((m) => ({ label: m.label, value: byKey.get(m.key) ?? 0 }));
  }, [invoices]);
  const thisMonth = expenditureTrend[expenditureTrend.length - 1]?.value ?? 0;
  const lastMonth = expenditureTrend[expenditureTrend.length - 2]?.value ?? 0;
  const monthDelta = lastMonth > 0 ? Math.round(((thisMonth - lastMonth) / lastMonth) * 100) : null;

  const payouts = useMemo(() => {
    const pending = invoices.filter((i) => i.status === "RAISED" || i.status === "APPROVED");
    const overdue = pending.filter((i) => i.overdueDays > 0);
    return { amount: pending.reduce((s, i) => s + Number(i.amount), 0), count: pending.length, overdue: overdue.length };
  }, [invoices]);

  const liveCampaigns = useMemo(() => {
    const now = Date.now();
    const live = campaigns.filter((c) => !c.parentCampaignId && (!c.deadline || new Date(c.deadline).getTime() >= now - DAY));
    const endingSoon = live.filter((c) => c.deadline && new Date(c.deadline).getTime() - now < 7 * DAY).length;
    return { count: live.length, endingSoon };
  }, [campaigns]);

  const awaitingReview = useMemo(() => {
    const rows = links.filter((l) => l.status === "PENDING_SCREENSHOT_REVIEW" || l.status === "INSIGHTS_PENDING");
    const oldest = rows.reduce((max, l) => Math.max(max, daysSince(l.createdAt)), 0);
    return { count: rows.length, oldest };
  }, [links]);

  // ── Needs your decision ───────────────────────────────────────────────
  const decisions = useMemo<Decision[]>(() => {
    const out: Decision[] = [];
    for (const l of links.filter((l) => l.status === "PENDING_SCREENSHOT_REVIEW")) {
      out.push({
        id: `shot-${l.id}`,
        title: `Screenshot proof · @${l.asset?.handle ?? "—"}`,
        sub: `${l.campaign?.title ?? "—"} · ${l.format} · submitted ${daysSince(l.createdAt)}d ago`,
        href: `/approvals?item=${l.id}`,
        waitingDays: daysSince(l.createdAt),
        secondary: { label: "View", href: `/approvals?item=${l.id}` },
        primary: { label: "Approve", onClick: () => approveScreenshot.mutate(l.id), pending: approveScreenshot.isPending },
      });
    }
    for (const l of links.filter((l) => l.status === "INSIGHTS_PENDING")) {
      out.push({
        id: `ins-${l.id}`,
        title: `Insights · @${l.asset?.handle ?? "—"}`,
        sub: `${l.campaign?.title ?? "—"} · ${l.format} · ${daysSince(l.createdAt)}d ago`,
        href: `/approvals?item=${l.id}`,
        waitingDays: daysSince(l.createdAt),
        primary: { label: "Approve", onClick: () => approveInsights.mutate(l.id), pending: approveInsights.isPending },
      });
    }
    for (const p of plans.filter((p) => p.status === "PENDING_APPROVAL")) {
      out.push({
        id: `plan-${p.id}`,
        title: `Plan approval · ${p.name}`,
        sub: `${p.createdBy?.name ?? "Planner"} · ${p.items?.length ?? 0} pages · ${money(p.overview?.total ?? 0)} quoted`,
        href: `/plans?id=${p.id}`,
        waitingDays: daysSince(p.updatedAt),
        secondary: { label: "Review", href: `/plans?id=${p.id}` },
      });
    }
    for (const c of campaigns.filter((c) => (c.pendingAssignmentCount ?? 0) > 0)) {
      out.push({
        id: `pend-${c.id}`,
        title: `${c.pendingAssignmentCount} new creator${c.pendingAssignmentCount === 1 ? "" : "s"} from imported sheet`,
        sub: `${c.title} · not in database yet`,
        href: `/campaigns/view?id=${c.id}`,
        initials: "+",
        secondary: { label: "Create all", href: `/campaigns/view?id=${c.id}` },
      });
    }
    for (const a of assets.filter((a) => a.approvalStatus === "pending")) {
      out.push({
        id: `asset-${a.id}`,
        title: `New page · @${a.handle}`,
        sub: `${a.owner?.name ?? "—"} · ${a.category ?? "uncategorised"}`,
        href: `/inventory`,
        waitingDays: daysSince(a.createdAt),
        primary: { label: "Approve", onClick: () => approveAsset.mutate(a.id), pending: approveAsset.isPending },
      });
    }
    for (const b of billingProfiles.filter((b) => b.approvalStatus === "pending")) {
      out.push({
        id: `bill-${b.id}`,
        title: `Billing profile · ${b.name}`,
        sub: `${b.user?.name ?? b.user?.phoneNumber ?? "—"} · PAN ${b.pan}`,
        href: `/approvals`,
        primary: { label: "Approve", onClick: () => approveBilling.mutate(b.id), pending: approveBilling.isPending },
      });
    }
    for (const l of links.filter((l) => l.status === "INVALID")) {
      out.push({
        id: `bad-${l.id}`,
        title: `Link not working · @${l.asset?.handle ?? "—"}`,
        sub: `${l.campaign?.title ?? "—"} · ${money(l.cost)} tied to it`,
        href: `/campaigns/view?id=${l.campaignId}`,
        secondary: { label: "Review", href: `/campaigns/view?id=${l.campaignId}` },
      });
    }
    return out.sort((a, b) => (b.waitingDays ?? 0) - (a.waitingDays ?? 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [links, plans, campaigns, assets, billingProfiles, approveScreenshot.isPending, approveInsights.isPending, approveAsset.isPending, approveBilling.isPending]);

  // ── Budgets ───────────────────────────────────────────────────────────
  const budgets = useMemo(() => {
    return campaigns
      .filter((c) => !c.parentCampaignId && c.costCap && Number(c.costCap) > 0)
      .map((c) => ({ c, pct: Math.round(((c.spent ?? 0) / Number(c.costCap)) * 100) }))
      .sort((a, b) => b.pct - a.pct)
      .slice(0, 4);
  }, [campaigns]);

  // ── Deeper analytics (kept below the fold) ────────────────────────────
  const linkFunnel = useMemo(
    () => LINK_PIPELINE_ORDER.map((status) => ({ key: status, label: STATUS_CONFIG[status].label, value: links.filter((l) => l.status === status).length, color: TONE_COLOR[STATUS_CONFIG[status].tone ?? "slate"] })),
    [links]
  );
  const invoiceComposition = useMemo(
    () => INVOICE_STATUS_ORDER.map((status) => ({ key: status, label: STATUS_CONFIG[status].label, value: invoices.filter((i) => i.status === status).length, color: TONE_COLOR[STATUS_CONFIG[status].tone ?? "slate"] })),
    [invoices]
  );
  const pageMetrics = useMemo(() => {
    const byAsset = new Map<string, { linksCount: number; totalInvoiced: number }>();
    for (const l of links) {
      const entry = byAsset.get(l.assetId) ?? { linksCount: 0, totalInvoiced: 0 };
      entry.linksCount += 1;
      if (l.status === "INVOICED") entry.totalInvoiced += Number(l.cost);
      byAsset.set(l.assetId, entry);
    }
    return [...assets]
      .sort((a, b) => b.followers - a.followers)
      .map((a) => ({ id: a.id, handle: a.handle, followers: a.followers, linksCount: byAsset.get(a.id)?.linksCount ?? 0, totalInvoiced: byAsset.get(a.id)?.totalInvoiced ?? 0 }));
  }, [assets, links]);
  const recentJobRuns = (jobRunsQuery.data ?? []).slice(0, 5);
  const usersByRole = useMemo(() => {
    const items = usersQuery.data ?? [];
    const roles: Record<string, number> = { CREATOR: 0, TEAM_MEMBER: 0, ADMIN: 0, FINANCE: 0 };
    for (const u of items) roles[u.role] = (roles[u.role] ?? 0) + 1;
    return { total: items.length, roles };
  }, [usersQuery.data]);

  const firstName = (user?.name ?? "there").split(" ")[0];
  const monthLabel = new Date().toLocaleDateString(undefined, { month: "short" });
  const maxBar = Math.max(1, ...expenditureTrend.map((m) => m.value));
  const loading = linksQuery.isLoading || invoicesQuery.isLoading || campaignsQuery.isLoading;

  return (
    <AppShell
      active="dashboard"
      user={{ initials: initialsOf(user?.name), name: user?.name ?? "—", role: roleLabel(user?.role), tone: user?.role === "FINANCE" ? "blue" : "emerald" }}
      searchPlaceholder="Search campaigns, pages, invoices…"
    >
      <div className="flex flex-col gap-5">
        <PageHeader
          title={
            <>
              {greeting()}, <span className="serif text-[1.15em]">{firstName}.</span>
            </>
          }
          subtitle={
            decisions.length > 0
              ? `${decisions.length} thing${decisions.length === 1 ? "" : "s"} need${decisions.length === 1 ? "s" : ""} a decision from you. ${payouts.overdue > 0 ? `${payouts.overdue} payout${payouts.overdue === 1 ? " is" : "s are"} overdue.` : "Budget and spend are on track."}`
              : "Nothing is waiting on you. Budget and spend are on track."
          }
          actions={
            isAdmin ? (
              <>
                <Button variant="secondary" onClick={() => router.push("/campaigns?import=1")}>
                  <DownloadIcon className="h-4 w-4" />
                  Import sheet
                </Button>
                <Button onClick={() => router.push("/campaigns?new=1")}>
                  <PlusIcon className="h-4 w-4" />
                  New campaign
                </Button>
              </>
            ) : undefined
          }
        />

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
          <KpiCard
            icon={InvoiceIcon}
            label={`Expenditure · ${monthLabel}`}
            value={money(thisMonth)}
            foot={monthDelta === null ? `${invoices.length} invoices total` : `${monthDelta >= 0 ? "+" : ""}${monthDelta}% vs last month`}
            sparkline={expenditureTrend.map((m) => m.value)}
            onClick={() => router.push("/invoices")}
          />
          <KpiCard
            icon={ClockIcon}
            label="Pending payouts"
            value={money(payouts.amount)}
            foot={`${payouts.count} invoices · ${payouts.overdue} overdue`}
            tone={payouts.overdue > 0 ? "rose" : undefined}
            onClick={() => router.push("/invoices?status=RAISED")}
          />
          <KpiCard icon={CampaignIcon} label="Live campaigns" value={String(liveCampaigns.count)} foot={liveCampaigns.endingSoon > 0 ? `${liveCampaigns.endingSoon} ending this week` : "None ending this week"} onClick={() => router.push("/campaigns")} />
          <KpiCard
            icon={AlertIcon}
            label="Posts awaiting review"
            value={String(awaitingReview.count)}
            foot={awaitingReview.count > 0 ? `Oldest waiting ${awaitingReview.oldest} day${awaitingReview.oldest === 1 ? "" : "s"}` : "All caught up"}
            tone={awaitingReview.oldest >= 3 ? "violet" : undefined}
            onClick={() => router.push("/approvals")}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.4fr_1fr]">
          {/* Needs your decision */}
          <Card className="flex flex-col" data-testid="decision-queue">
            <CardHeader
              title="Needs your decision"
              meta={decisions.length > 0 ? <Tag tone="wait">{decisions.length}</Tag> : <Tag tone="ok">Clear</Tag>}
              action={
                <Link href="/approvals" className="flex items-center gap-1 text-[0.8125rem] font-medium text-blue hover:text-text">
                  Open approvals <ArrowRightIcon className="h-3.5 w-3.5" />
                </Link>
              }
            />
            {loading ? (
              <TableSkeleton rows={4} />
            ) : decisions.length === 0 ? (
              <EmptyState label="Nothing waiting on you — all caught up." />
            ) : (
              <ul className="flex flex-col">
                {decisions.slice(0, 6).map((d, i) => (
                  <li key={d.id} className="flex items-center gap-3.5 border-b border-border px-[18px] py-3 last:border-b-0 motion-safe:animate-reveal-up" style={{ animationDelay: `${0.3 + i * 0.06}s` }}>
                    {d.initials ? (
                      <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full bg-surface-2 text-[0.8rem] font-semibold text-text-2 ring-1 ring-inset ring-border">{d.initials}</span>
                    ) : (
                      <Thumb src={d.thumb} />
                    )}
                    <Link href={d.href} className="flex min-w-0 flex-1 flex-col gap-[2px]">
                      <span className="truncate text-[0.8375rem] font-semibold">{d.title}</span>
                      <span className="truncate text-[0.78rem] text-text-muted">{d.sub}</span>
                    </Link>
                    {d.waitingDays !== undefined && d.waitingDays >= 3 && <Tag tone="bad" className="hidden sm:inline-flex">Waiting {d.waitingDays}d</Tag>}
                    <div className="flex shrink-0 items-center gap-1.5">
                      {d.secondary && (
                        <Button variant="secondary" size="sm" asChild>
                          <Link href={d.secondary.href}>
                            {d.secondary.label === "View" && <EyeIcon className="h-3.5 w-3.5" />}
                            {d.secondary.label}
                          </Link>
                        </Button>
                      )}
                      {d.primary && (
                        <Button size="sm" onClick={d.primary.onClick} disabled={d.primary.pending}>
                          {d.primary.label}
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {decisions.length > 6 && (
              <Link href="/approvals" className="border-t border-border px-[18px] py-2.5 text-center text-[0.78rem] font-medium text-text-muted hover:text-text">
                {decisions.length - 6} more in approvals
              </Link>
            )}
          </Card>

          <div className="flex flex-col gap-4">
            <Card>
              <CardHeader
                title="Campaign budgets"
                action={
                  <Link href="/campaigns" className="text-[0.8125rem] font-medium text-blue hover:text-text">
                    All campaigns
                  </Link>
                }
              />
              <div className="flex flex-col gap-3.5 px-[18px] pb-4 pt-2">
                {campaignsQuery.isLoading ? (
                  <TableSkeleton rows={3} />
                ) : budgets.length === 0 ? (
                  <EmptyState label="No campaign has a budget cap yet." />
                ) : (
                  budgets.map(({ c, pct }) => <BudgetRow key={c.id} campaign={c} pct={pct} />)
                )}
              </div>
            </Card>

            <Card>
              <CardHeader title="Expenditure · last 6 months" meta={monthDelta !== null ? <Tag tone={monthDelta >= 0 ? "ok" : "bad"}>{monthDelta >= 0 ? "+" : ""}{monthDelta}%</Tag> : undefined} />
              <div className="flex h-[132px] items-end gap-2.5 px-[18px] pb-4 pt-3" data-testid="expenditure-bars">
                {expenditureTrend.map((m, i) => (
                  <div key={m.label} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5" title={`${m.label}: ${money(m.value)}`}>
                    <div
                      className={`w-full origin-bottom rounded-[5px] motion-safe:animate-grow-y ${i === expenditureTrend.length - 1 ? "bg-ink" : "bg-border"}`}
                      style={{ height: `${Math.max(4, Math.round((m.value / maxBar) * 100))}%`, animationDelay: `${0.5 + i * 0.08}s` }}
                    />
                    <span className="text-[0.68rem] text-text-muted">{m.label}</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>

        {/* ── Deeper analytics ── */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Panel title="Link pipeline" subtitle="Where every submitted link sits right now.">
            {linksQuery.isLoading ? <TableSkeleton /> : <RankedBarList items={linkFunnel} onSelect={(key) => router.push(`/approvals?status=${key}`)} />}
          </Panel>
          <ComparePagesPanel pages={pageMetrics} loading={assetsQuery.isLoading} onSelectPage={() => router.push("/inventory")} />
        </div>

        <Panel title="Invoice status" subtitle="Every invoice ever raised, by current status — click one to open it filtered.">
          {invoicesQuery.isLoading ? <TableSkeleton rows={1} /> : invoices.length === 0 ? <EmptyState label="No invoices raised yet." /> : <StackedBar segments={invoiceComposition} onSelect={(status) => router.push(`/invoices?status=${status}`)} />}
        </Panel>

        {isAdmin && (
          <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Panel
              title="Recent job runs"
              action={
                <PanelAction onClick={() => router.push("/job-runs")}>
                  View all <ArrowRightIcon className="h-3 w-3" />
                </PanelAction>
              }
            >
              {jobRunsQuery.isLoading ? (
                <TableSkeleton rows={3} />
              ) : recentJobRuns.length === 0 ? (
                <EmptyState label="No cron runs recorded yet." />
              ) : (
                <div className="flex flex-col gap-2">
                  {recentJobRuns.map((run) => (
                    <div key={run.id} className="flex items-center justify-between gap-3 rounded-md border border-border px-3.5 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-[0.8375rem] font-semibold">{run.jobName}</p>
                        <p className="text-xs text-text-muted">{new Date(run.startedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</p>
                      </div>
                      <StatusPill status={run.status === "success" ? "PAID" : run.status === "failed" ? "REJECTED" : "SCHEDULED"} detail={run.status} />
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            <Panel
              title="Team"
              action={
                <PanelAction onClick={() => router.push("/users")}>
                  View all <ArrowRightIcon className="h-3 w-3" />
                </PanelAction>
              }
            >
              {usersQuery.isLoading ? (
                <TableSkeleton rows={3} />
              ) : (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-2.5">
                    <TeamIcon className="h-4 w-4 text-text-muted" />
                    <span className="text-[0.9375rem] font-semibold tabular-nums">{usersByRole.total}</span>
                    <span className="text-[0.8125rem] text-text-muted">users total</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {(["CREATOR", "TEAM_MEMBER", "ADMIN", "FINANCE"] as const).map((role) => (
                      <button key={role} onClick={() => router.push("/users")} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-left hover:bg-surface-2">
                        <span className="text-xs text-text-muted">{roleLabel(role)}</span>
                        <span className="text-[0.8125rem] font-semibold tabular-nums">{usersByRole.roles[role] ?? 0}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </Panel>
          </section>
        )}
      </div>
    </AppShell>
  );
}

function BudgetRow({ campaign, pct }: { campaign: Campaign; pct: number }) {
  const cap = Number(campaign.costCap);
  const tone = pct >= 100 ? "rose" : pct >= 85 ? "warn" : "accent";
  return (
    <Link href={`/campaigns/view?id=${campaign.id}`} className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span className="truncate text-[0.8375rem] font-semibold">{campaign.title}</span>
        <span className="ml-auto whitespace-nowrap text-[0.78rem] tabular-nums text-text-muted">
          {money(campaign.spent ?? 0)} of {money(cap)}
        </span>
      </div>
      <ProgressBar pct={pct} tone={tone} />
      <span className="text-[0.75rem] text-text-muted">
        {campaign.phaseCount && campaign.phaseCount > 1 ? `${campaign.phaseCount} phases` : "Phase 1"} · {campaign.deadline ? `ends ${shortDate(campaign.deadline)}` : "no deadline"}
      </span>
    </Link>
  );
}
