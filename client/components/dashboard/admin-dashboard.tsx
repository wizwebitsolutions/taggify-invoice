"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { LinkDetailPanel, STATUS_LABEL } from "@/components/dashboard/link-detail-panel";
import { TrendAreaChart } from "@/components/charts/trend-area-chart";
import { RankedBarList } from "@/components/charts/ranked-bar-list";
import { StackedBar } from "@/components/charts/stacked-bar";
import { TONE_COLOR } from "@/components/charts/tone-color";
import { STATUS_CONFIG, StatusPill } from "@/components/ui/status-pill";
import { Th, TableSkeleton, EmptyState } from "@/components/ui/table-parts";
import { InvoiceIcon, AlertIcon, CheckCircleIcon, AssetIcon, CampaignIcon, ClockIcon, TeamIcon, ChevronRightIcon, ArrowRightIcon } from "@/components/icons";
import { useAuth } from "@/lib/auth-context";
import {
  links as linksApi,
  invoices as invoicesApi,
  assets as assetsApi,
  campaigns as campaignsApi,
  billing as billingApi,
  admin as adminApi,
  type Link,
  type Invoice,
} from "@/lib/api-client";
import { money, initialsOf, roleLabel } from "@/lib/format";

const LINK_PIPELINE_ORDER: Link["status"][] = [
  "SUBMITTED",
  "PENDING_SCREENSHOT_REVIEW",
  "SCREENSHOT_REJECTED",
  "SCREENSHOT_APPROVED",
  "INSIGHTS_PENDING",
  "INSIGHTS_APPROVED",
  "INVOICED",
];
const INVOICE_STATUS_ORDER: Invoice["status"][] = ["DRAFT", "RAISED", "APPROVED", "REJECTED", "PAID"];

// Links awaiting an admin action, as opposed to just sitting in the pipeline
// waiting on the creator or the scrape cron — this is the default slice the
// review queue below shows.
const ACTIONABLE_STATUSES = "PENDING_SCREENSHOT_REVIEW,INSIGHTS_PENDING";
// Everything the "Links in pipeline" KPI counts (not yet invoiced) — so
// clicking that tile shows exactly what it counted, not just the narrower
// actionable-only default.
const IN_PIPELINE_STATUSES = LINK_PIPELINE_ORDER.filter((s) => s !== "INVOICED").join(",");

function lastNMonths(n: number) {
  const now = new Date();
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (n - 1 - i), 1);
    return { key: `${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleDateString(undefined, { month: "short" }) };
  });
}

function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/**
 * Admin/Finance's landing page — a bird's-eye view (finance, pipeline
 * health, pages) instead of the creator's per-link "My Works" table, since
 * neither role submits or owns links themselves. Full review capability
 * (approve screenshot/insights, refresh metrics) still lives here via the
 * "Needs your review" queue, reusing the same LinkDetailPanel the creator
 * dashboard uses — nothing an admin could do before is gone, it's just no
 * longer the whole page.
 */
export function AdminDashboard() {
  const { user, accessToken } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const token = accessToken!;
  const isAdmin = user?.role === "ADMIN"; // true admin only — Finance can't reach /admin/* routes

  // 100 is the server's hard cap (listLinksQuerySchema/listInvoicesQuerySchema)
  // — matches every other page's own list call (Invoices, the creator
  // dashboard). A pageSize above it 400s the whole query, which silently
  // renders as "0" everywhere below rather than an error, so don't raise this
  // without raising the server cap first.
  const linksQuery = useQuery({ queryKey: ["links", "admin-overview"], queryFn: () => linksApi.list(token, { pageSize: 100 }) });
  const invoicesQuery = useQuery({ queryKey: ["invoices", "admin-overview"], queryFn: () => invoicesApi.list(token, { pageSize: 100 }) });
  const assetsQuery = useQuery({ queryKey: ["assets"], queryFn: () => assetsApi.list(token) });
  const campaignsQuery = useQuery({ queryKey: ["campaigns"], queryFn: () => campaignsApi.list(token) });
  const billingQuery = useQuery({ queryKey: ["billingProfiles"], queryFn: () => billingApi.list(token) });
  const usersQuery = useQuery({ queryKey: ["adminUsers"], queryFn: () => adminApi.users(token), enabled: isAdmin });
  const jobRunsQuery = useQuery({ queryKey: ["job-runs"], queryFn: () => adminApi.jobRuns(token), enabled: isAdmin });

  const links = linksQuery.data?.items ?? [];
  const invoices = invoicesQuery.data?.items ?? [];
  const assets = assetsQuery.data ?? [];
  const billingProfiles = billingQuery.data ?? [];

  // ── Finance KPIs — same definitions as the Invoices page's own tiles, so the two never disagree.
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

  const opsKpis = useMemo(() => {
    const pendingPages = assets.filter((a) => a.approvalStatus === "pending").length;
    const pendingBilling = billingProfiles.filter((b) => b.approvalStatus === "pending").length;
    return {
      activePages: assets.filter((a) => a.approvalStatus === "approved").length,
      pendingApprovals: pendingPages + pendingBilling,
      campaigns: campaignsQuery.data?.length ?? 0,
      inPipeline: links.filter((l) => l.status !== "INVOICED").length,
    };
  }, [assets, billingProfiles, campaignsQuery.data, links]);

  const revenueTrend = useMemo(() => {
    const months = lastNMonths(6);
    const byKey = new Map(months.map((m) => [m.key, 0]));
    for (const inv of invoices) {
      const d = new Date(inv.createdAt);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      if (byKey.has(key)) byKey.set(key, (byKey.get(key) ?? 0) + Number(inv.amount));
    }
    return months.map((m) => ({ label: m.label, value: byKey.get(m.key) ?? 0 }));
  }, [invoices]);

  const linkFunnel = useMemo(
    () =>
      LINK_PIPELINE_ORDER.map((status) => ({
        key: status,
        label: STATUS_CONFIG[status].label,
        value: links.filter((l) => l.status === status).length,
        color: TONE_COLOR[STATUS_CONFIG[status].tone ?? "slate"],
      })),
    [links]
  );

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

  const topPages = useMemo(
    () =>
      [...assets]
        .sort((a, b) => b.followers - a.followers)
        .slice(0, 6)
        .map((a) => ({ key: a.id, label: `@${a.handle}`, value: a.followers })),
    [assets]
  );

  // ── "Needs your review" queue — defaults to both actionable statuses; a funnel-bar click narrows it to one.
  const [queueStatus, setQueueStatus] = useState<string>(ACTIONABLE_STATUSES);
  const [detailId, setDetailId] = useState<string | null>(null);
  const queueQuery = useQuery({
    queryKey: ["links", "admin-queue", queueStatus],
    queryFn: () => linksApi.list(token, { status: queueStatus, pageSize: 50 }),
  });
  const queueRows = queueQuery.data?.items ?? [];
  const queueDetail = queueRows.find((l) => l.id === detailId) ?? queueRows[0];
  const isDefaultQueue = queueStatus === ACTIONABLE_STATUSES;

  function selectFunnelStatus(status: string) {
    setQueueStatus(status);
    setDetailId(null);
    scrollToId("link-queue");
  }

  const approveAssetMutation = useMutation({
    mutationFn: ({ id, approvalStatus }: { id: string; approvalStatus: "approved" | "rejected" }) => assetsApi.setApproval(token, id, approvalStatus),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["assets"] }),
  });
  const approveBillingMutation = useMutation({
    mutationFn: ({ id, approvalStatus }: { id: string; approvalStatus: "approved" | "rejected" }) => billingApi.setApproval(token, id, approvalStatus),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["billingProfiles"] }),
  });

  const pendingPages = assets.filter((a) => a.approvalStatus === "pending");
  const pendingBillingProfiles = billingProfiles.filter((b) => b.approvalStatus === "pending");

  const recentJobRuns = (jobRunsQuery.data ?? []).slice(0, 5);
  const usersByRole = useMemo(() => {
    const items = usersQuery.data ?? [];
    const roles: Record<string, number> = { CREATOR: 0, TEAM_MEMBER: 0, ADMIN: 0, FINANCE: 0 };
    for (const u of items) roles[u.role] = (roles[u.role] ?? 0) + 1;
    return { total: items.length, roles };
  }, [usersQuery.data]);

  return (
    <AppShell
      active="dashboard"
      user={{ initials: initialsOf(user?.name), name: user?.name ?? "—", role: roleLabel(user?.role), tone: user?.role === "FINANCE" ? "blue" : "emerald" }}
      searchPlaceholder="Search links, invoices, pages…"
    >
      <div className="flex flex-col gap-8">
        <div>
          <p className="mb-1.5 text-[0.6875rem] font-bold uppercase tracking-[0.08em] text-text-faint">Admin</p>
          <h1 className="mb-1.5 text-[1.625rem] font-bold">Overview</h1>
          <p className="text-[0.9375rem] text-text-muted">Finance, pipeline health, and pages — across every creator.</p>
        </div>

        {/* Finance KPIs */}
        <div className="grid grid-cols-4 gap-4">
          <KpiCard icon={InvoiceIcon} label="Total raised" value={money(financeKpis.totalRaised)} foot={`${invoices.length} invoices`} onClick={() => router.push("/invoices")} />
          <KpiCard
            icon={ClockIcon}
            label="Pending payment"
            value={money(financeKpis.pendingAmount)}
            foot={`${financeKpis.pendingCount} awaiting settlement`}
            onClick={() => router.push("/invoices?status=RAISED")}
          />
          <KpiCard
            icon={AlertIcon}
            label="Overdue"
            value={money(financeKpis.overdueAmount)}
            foot={`${financeKpis.overdueCount} past due date`}
            tone={financeKpis.overdueCount > 0 ? "rose" : undefined}
            // Overdue really spans RAISED + APPROVED, but the invoices
            // page's status dropdown is single-select (no comma-list
            // support there, unlike links) — RAISED is the common case;
            // the destination table still marks overdue rows in rose either way.
            onClick={() => router.push("/invoices?status=RAISED")}
          />
          <KpiCard
            icon={CheckCircleIcon}
            label="Collected"
            value={money(financeKpis.collectedAmount)}
            foot={`${financeKpis.collectedCount} paid invoices`}
            onClick={() => router.push("/invoices?status=PAID")}
          />
        </div>

        {/* Ops KPIs */}
        <div className="grid grid-cols-4 gap-4">
          <KpiCard icon={AssetIcon} label="Active pages" value={String(opsKpis.activePages)} foot={`${assets.length} registered total`} onClick={() => router.push("/assets")} />
          <KpiCard
            icon={AlertIcon}
            label="Pending approvals"
            value={String(opsKpis.pendingApprovals)}
            foot="Pages + billing profiles"
            tone={opsKpis.pendingApprovals > 0 ? "indigo" : undefined}
            onClick={() => scrollToId("pending-approvals")}
          />
          <KpiCard icon={CampaignIcon} label="Campaigns" value={String(opsKpis.campaigns)} onClick={() => router.push("/campaigns")} />
          <KpiCard
            icon={ClockIcon}
            label="Links in pipeline"
            value={String(opsKpis.inPipeline)}
            foot="Not yet invoiced"
            onClick={() => selectFunnelStatus(IN_PIPELINE_STATUSES)}
          />
        </div>

        {/* Revenue trend */}
        <section className="rounded-lg border border-border bg-surface p-6 shadow-card">
          {invoicesQuery.isLoading ? (
            <TableSkeleton rows={1} />
          ) : (
            <TrendAreaChart data={revenueTrend} label="Revenue trend" subtitle="Last 6 months" formatValue={money} />
          )}
        </section>

        {/* Link funnel + top pages */}
        <div className="grid grid-cols-2 gap-5">
          <section className="rounded-lg border border-border bg-surface p-6 shadow-card">
            <div className="mb-5">
              <h2 className="text-[0.9375rem] font-bold">Link pipeline</h2>
              <p className="mt-0.5 text-[0.8125rem] text-text-faint">Where every submitted link sits right now — click a stage to inspect it.</p>
            </div>
            {linksQuery.isLoading ? (
              <TableSkeleton />
            ) : (
              <RankedBarList
                items={linkFunnel.map((f) => ({ ...f, active: queueStatus === f.key }))}
                onSelect={(key) => selectFunnelStatus(key)}
              />
            )}
          </section>

          <section className="rounded-lg border border-border bg-surface p-6 shadow-card">
            <div className="mb-5">
              <h2 className="text-[0.9375rem] font-bold">Top pages</h2>
              <p className="mt-0.5 text-[0.8125rem] text-text-faint">Ranked by follower count.</p>
            </div>
            {assetsQuery.isLoading ? (
              <TableSkeleton />
            ) : topPages.length === 0 ? (
              <EmptyState label="No pages registered yet." />
            ) : (
              <RankedBarList items={topPages} formatValue={(v) => v.toLocaleString()} onSelect={() => router.push("/assets")} />
            )}
          </section>
        </div>

        {/* Invoice composition */}
        <section className="rounded-lg border border-border bg-surface p-6 shadow-card">
          <div className="mb-5">
            <h2 className="text-[0.9375rem] font-bold">Invoice status</h2>
            <p className="mt-0.5 text-[0.8125rem] text-text-faint">Every invoice ever raised, by current status — click one to open it filtered.</p>
          </div>
          {invoicesQuery.isLoading ? (
            <TableSkeleton rows={1} />
          ) : invoices.length === 0 ? (
            <EmptyState label="No invoices raised yet." />
          ) : (
            <StackedBar segments={invoiceComposition} onSelect={(status) => router.push(`/invoices?status=${status}`)} />
          )}
        </section>

        {/* Needs your review */}
        <section id="link-queue" className="scroll-mt-6">
          <div className="mb-4 flex items-end justify-between">
            <div>
              <h2 className="text-[1.0625rem] font-bold">{isDefaultQueue ? "Needs your review" : `Links · ${STATUS_LABEL[queueStatus] ?? queueStatus}`}</h2>
              <p className="mt-0.5 text-[0.8125rem] text-text-faint">
                {isDefaultQueue ? "Screenshot approvals and insight approvals waiting on you." : "Filtered from the link pipeline chart above."}
              </p>
            </div>
            {!isDefaultQueue && (
              <Button variant="ghost" size="sm" onClick={() => selectFunnelStatus(ACTIONABLE_STATUSES)}>
                ← Back to needs review
              </Button>
            )}
          </div>

          <div className="flex min-h-0 gap-5">
            <div className="flex-1 overflow-hidden rounded-lg border border-border bg-surface shadow-card">
              <div className="grid grid-cols-[minmax(0,2.4fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.3fr)_24px] gap-3 border-b border-border px-5 py-3.5">
                <Th>Post</Th>
                <Th>Page</Th>
                <Th>Cost</Th>
                <Th>Status</Th>
                <div />
              </div>
              {queueQuery.isLoading ? (
                <TableSkeleton />
              ) : queueRows.length === 0 ? (
                <EmptyState label={isDefaultQueue ? "Nothing waiting on you — all caught up." : "No links in this stage."} />
              ) : (
                <div>
                  {queueRows.map((link) => (
                    <div
                      key={link.id}
                      onClick={() => setDetailId(link.id)}
                      className={
                        "grid cursor-pointer grid-cols-[minmax(0,2.4fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.3fr)_24px] items-center gap-3 border-b border-l-[3px] border-border border-l-transparent px-5 py-3.5 transition-colors hover:bg-surface-2 " +
                        ((link.id === detailId || (!detailId && link.id === queueRows[0]?.id)) ? "border-l-accent bg-accent-soft hover:bg-accent-soft" : "")
                      }
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">{link.campaign?.title ?? "—"}</div>
                        <div className="mt-0.5 truncate text-xs text-text-faint">{link.url}</div>
                      </div>
                      <div className="text-[0.8438rem] text-text-muted">@{link.asset?.handle ?? "—"}</div>
                      <div className="text-sm font-bold tabular-nums">{money(link.cost)}</div>
                      <div>
                        <StatusPill status={link.status} />
                      </div>
                      <ChevronRightIcon className="h-3.5 w-3.5 text-text-faint" />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {queueDetail && (
              <LinkDetailPanel
                link={queueDetail}
                token={token}
                isAdmin={isAdmin}
                canUploadScreenshot={false}
                onChanged={() => {
                  queryClient.invalidateQueries({ queryKey: ["links"] });
                  queryClient.invalidateQueries({ queryKey: ["linkTimeline", queueDetail.id] });
                }}
              />
            )}
          </div>
        </section>

        {/* Pending approvals */}
        <section id="pending-approvals" className="scroll-mt-6 grid grid-cols-2 gap-5">
          <div className="rounded-lg border border-border bg-surface p-6 shadow-card">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-[0.9375rem] font-bold">Pages awaiting approval</h2>
              <button onClick={() => router.push("/assets")} className="flex items-center gap-1 text-[0.8125rem] font-semibold text-accent hover:text-accent-2">
                View all <ArrowRightIcon className="h-3 w-3" />
              </button>
            </div>
            {assetsQuery.isLoading ? (
              <TableSkeleton rows={3} />
            ) : pendingPages.length === 0 ? (
              <EmptyState label="No pages waiting on approval." />
            ) : (
              <div className="flex flex-col gap-2.5">
                {pendingPages.map((a) => (
                  <div key={a.id} className="flex items-center justify-between gap-3 rounded-md border border-border px-3.5 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-[0.8438rem] font-semibold">@{a.handle}</p>
                      <p className="text-xs text-text-faint">{a.followers.toLocaleString()} followers</p>
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      <Button size="sm" onClick={() => approveAssetMutation.mutate({ id: a.id, approvalStatus: "approved" })} disabled={approveAssetMutation.isPending}>
                        Approve
                      </Button>
                      <Button variant="danger" size="sm" onClick={() => approveAssetMutation.mutate({ id: a.id, approvalStatus: "rejected" })} disabled={approveAssetMutation.isPending}>
                        Reject
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-border bg-surface p-6 shadow-card">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-[0.9375rem] font-bold">Billing profiles awaiting approval</h2>
              <button onClick={() => router.push("/profile?tab=billing")} className="flex items-center gap-1 text-[0.8125rem] font-semibold text-accent hover:text-accent-2">
                View all <ArrowRightIcon className="h-3 w-3" />
              </button>
            </div>
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
          </div>
        </section>

        {/* System health — ADMIN only, Finance can't reach /admin/* */}
        {isAdmin && (
          <section className="grid grid-cols-2 gap-5">
            <div className="rounded-lg border border-border bg-surface p-6 shadow-card">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-[0.9375rem] font-bold">Recent job runs</h2>
                <button onClick={() => router.push("/job-runs")} className="flex items-center gap-1 text-[0.8125rem] font-semibold text-accent hover:text-accent-2">
                  View all <ArrowRightIcon className="h-3 w-3" />
                </button>
              </div>
              {jobRunsQuery.isLoading ? (
                <TableSkeleton rows={3} />
              ) : recentJobRuns.length === 0 ? (
                <EmptyState label="No cron runs recorded yet." />
              ) : (
                <div className="flex flex-col gap-2.5">
                  {recentJobRuns.map((run) => (
                    <div key={run.id} className="flex items-center justify-between gap-3 rounded-md border border-border px-3.5 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-[0.8438rem] font-semibold">{run.jobName}</p>
                        <p className="text-xs text-text-faint">{new Date(run.startedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</p>
                      </div>
                      <StatusPill status={run.status === "success" ? "PAID" : run.status === "failed" ? "REJECTED" : "SCHEDULED"} detail={run.status} />
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-lg border border-border bg-surface p-6 shadow-card">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-[0.9375rem] font-bold">Team</h2>
                <button onClick={() => router.push("/users")} className="flex items-center gap-1 text-[0.8125rem] font-semibold text-accent hover:text-accent-2">
                  View all <ArrowRightIcon className="h-3 w-3" />
                </button>
              </div>
              {usersQuery.isLoading ? (
                <TableSkeleton rows={3} />
              ) : (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-2.5">
                    <TeamIcon className="h-4 w-4 text-text-faint" />
                    <span className="text-[0.9375rem] font-extrabold tabular-nums">{usersByRole.total}</span>
                    <span className="text-[0.8125rem] text-text-faint">users total</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2.5">
                    {(["CREATOR", "TEAM_MEMBER", "ADMIN", "FINANCE"] as const).map((role) => (
                      <button
                        key={role}
                        onClick={() => router.push("/users")}
                        className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-left hover:bg-surface-2"
                      >
                        <span className="text-xs text-text-faint">{roleLabel(role)}</span>
                        <span className="text-[0.8125rem] font-bold tabular-nums">{usersByRole.roles[role] ?? 0}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>
        )}
      </div>
    </AppShell>
  );
}
