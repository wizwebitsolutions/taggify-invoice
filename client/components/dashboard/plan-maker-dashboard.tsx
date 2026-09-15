"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { DashboardHero } from "@/components/dashboard/dashboard-hero";
import { Panel, PanelAction } from "@/components/ui/panel";
import { TableSkeleton, EmptyState, ErrorNotice } from "@/components/ui/table-parts";
import { StatusPill } from "@/components/ui/status-pill";
import { InventoryIcon, PlusIcon, ArrowRightIcon, HeartIcon, EyeIcon } from "@/components/icons";
import { useAuth } from "@/lib/auth-context";
import { plans as plansApi, ApiError, type Plan } from "@/lib/api-client";
import { money, count, initialsOf, roleLabel } from "@/lib/format";

/**
 * Plan Maker's own landing page (newTask.md, 8 Sep — "Planner (POC)...
 * dashboard = Dashboard + Inventory + Plan-create; ... separate dashboard
 * for plan maker, which plan worked their analysis, etc"). plansApi.list()
 * is already scoped to "own plans only" server-side for this role (see
 * plans/service.js's listPlans) — every number here is this one person's
 * pitches, not the agency's. Editing/PDF export still happen from the
 * Plans tab (this page links there rather than duplicating that UI, and
 * routes there — not /inventory — since Plans moved to its own nav
 * destination: newTask.md, 9 Sep); this page's own job is the
 * approve/reject actions and the at-a-glance status breakdown.
 *
 * Approve/reject act directly on a DRAFT plan now — no submit-for-someone-
 * else step (user request, 11 Sep — "remove option of submit for approval,
 * plan maker or admin can approve plan by themselves only").
 *
 * Visual pass (user request, 11 Sep — "enhance ui/ux add minimal colors
 * improve buttons, cards look should more attractive and bit smaller, and
 * organized"): the plan list below used to be plain full-width rows — it's
 * now a tighter card grid matching the Plans tab's own card language (icon
 * tile, status pill, stat cells) but scaled down, since this is a glanceable
 * summary, not the place to work a plan in detail. Color stays restricted
 * to what already carries meaning elsewhere (status pills, the rose/accent
 * split on Reject/Approve) rather than adding new hues.
 */
export function PlanMakerDashboard() {
  const { user, accessToken } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const token = accessToken!;

  const plansQuery = useQuery({ queryKey: ["plans"], queryFn: () => plansApi.list(token) });
  const plans = plansQuery.data ?? [];

  const stats = useMemo(() => {
    const byStatus = { DRAFT: 0, PENDING_APPROVAL: 0, APPROVED: 0, REJECTED: 0 };
    let pitchedValue = 0;
    for (const p of plans) {
      byStatus[p.status] = (byStatus[p.status] ?? 0) + 1;
      pitchedValue += p.overview.total;
    }
    return { byStatus, pitchedValue, total: plans.length };
  }, [plans]);

  const approveMutation = useMutation({
    mutationFn: (id: string) => plansApi.approve(token, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["plans"] }),
  });
  const rejectMutation = useMutation({
    mutationFn: (id: string) => plansApi.reject(token, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["plans"] }),
  });
  const actionError = approveMutation.error ?? rejectMutation.error;

  return (
    <AppShell
      active="dashboard"
      user={{ initials: initialsOf(user?.name), name: user?.name ?? "—", role: roleLabel(user?.role), tone: "emerald" }}
      searchPlaceholder="Search plans…"
      topbarActions={
        <Button size="default" onClick={() => router.push("/plans")}>
          <PlusIcon className="h-[15px] w-[15px] text-accent-ink" />
          New plan
        </Button>
      }
    >
      <div className="flex flex-col gap-8">
        <DashboardHero
          eyebrow="Plan Maker"
          title={<>Your <span className="serif text-[1.15em]">plans.</span></>}
          subtitle="Every pitch you've built, its approval status, and what it's worth."
          stat={{ value: String(stats.total), label: "Plans total" }}
        />

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
          <KpiCard icon={InventoryIcon} label="Draft" value={String(stats.byStatus.DRAFT)} foot="Still being decided" />
          <KpiCard icon={InventoryIcon} label="Approved" value={String(stats.byStatus.APPROVED)} foot="Ready to send" />
          <KpiCard icon={InventoryIcon} label="Rejected" value={String(stats.byStatus.REJECTED)} tone={stats.byStatus.REJECTED > 0 ? "rose" : undefined} foot="Didn't move forward" />
          <KpiCard icon={InventoryIcon} label="Pitched value" value={money(stats.pitchedValue)} foot="Client-facing total, all plans" />
        </div>

        {actionError && <ErrorNotice message={actionError instanceof ApiError ? actionError.message : "Couldn't update that plan."} />}

        <Panel
          title="Your plans"
          subtitle="Build and edit these from the Plans tab — approve or reject a draft right here."
          action={
            <PanelAction onClick={() => router.push("/plans")}>
              Open Plans <ArrowRightIcon className="h-3 w-3" />
            </PanelAction>
          }
        >
          {plansQuery.isLoading ? (
            <TableSkeleton rows={3} />
          ) : plans.length === 0 ? (
            <EmptyState label="No plans yet — create one from the Plans tab." />
          ) : (
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
              {plans.map((plan) => (
                <PlanCard
                  key={plan.id}
                  plan={plan}
                  onApprove={() => approveMutation.mutate(plan.id)}
                  onReject={() => rejectMutation.mutate(plan.id)}
                  busy={approveMutation.isPending || rejectMutation.isPending}
                />
              ))}
            </div>
          )}
        </Panel>
      </div>
    </AppShell>
  );
}

function PlanCard({
  plan,
  onApprove,
  onReject,
  busy,
}: {
  plan: Plan;
  onApprove: () => void;
  onReject: () => void;
  busy: boolean;
}) {
  return (
    <div className="group flex flex-col gap-2.5 rounded-md border border-border bg-surface px-3.5 py-3 transition-colors hover:border-border-strong">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[0.68rem] font-medium uppercase tracking-[0.06em] text-text-faint">{plan.clientName}</p>
          <p className="truncate text-[0.8438rem] font-semibold leading-snug">{plan.name}</p>
        </div>
        {/* DRAFT/APPROVED/REJECTED are already valid pill statuses;
            PENDING_APPROVAL borrows SCHEDULED's "awaiting, pulsing" look —
            only reachable now on a plan from before the submit step was
            retired (user request, 11 Sep). */}
        <StatusPill className="shrink-0" status={plan.status === "PENDING_APPROVAL" ? "SCHEDULED" : plan.status} />
      </div>

      <div className="flex items-center justify-between text-[0.75rem] text-text-faint">
        <span>
          {count(plan.items.length)} page{plan.items.length === 1 ? "" : "s"}
        </span>
        <span className="inline-flex items-center gap-2.5">
          <span className="inline-flex items-center gap-1">
            <HeartIcon className="h-3 w-3" /> {count(plan.expectedEngagement.likes)}
          </span>
          <span className="inline-flex items-center gap-1">
            <EyeIcon className="h-3 w-3" /> {count(plan.expectedEngagement.views)}
          </span>
        </span>
      </div>

      <p className="text-[0.9375rem] font-semibold tracking-tight tabular-nums">{money(plan.overview.total)}</p>

      {plan.status === "DRAFT" && (
        <div className="flex gap-1.5 border-t border-border pt-2.5">
          <Button size="sm" className="flex-1" onClick={onApprove} disabled={busy}>
            Approve
          </Button>
          <Button size="sm" variant="danger" className="flex-1" onClick={onReject} disabled={busy}>
            Reject
          </Button>
        </div>
      )}
    </div>
  );
}
