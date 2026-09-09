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
 * pitches, not the agency's. Editing/PDF export still happen from
 * Inventory → Plans (this page links there rather than duplicating that
 * UI); this page's own job is the submit/approve/reject actions and the
 * at-a-glance status breakdown.
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

  const submitMutation = useMutation({
    mutationFn: (id: string) => plansApi.submit(token, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["plans"] }),
  });
  const approveMutation = useMutation({
    mutationFn: (id: string) => plansApi.approve(token, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["plans"] }),
  });
  const rejectMutation = useMutation({
    mutationFn: (id: string) => plansApi.reject(token, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["plans"] }),
  });
  const actionError = submitMutation.error ?? approveMutation.error ?? rejectMutation.error;

  return (
    <AppShell
      active="dashboard"
      user={{ initials: initialsOf(user?.name), name: user?.name ?? "—", role: roleLabel(user?.role), tone: "emerald" }}
      searchPlaceholder="Search plans…"
      topbarActions={
        <Button size="default" onClick={() => router.push("/inventory")}>
          <PlusIcon className="h-[15px] w-[15px] text-accent-ink" />
          New plan
        </Button>
      }
    >
      <div className="flex flex-col gap-8">
        <DashboardHero
          eyebrow="Plan Maker"
          title={<span className="text-accent">Your plans</span>}
          subtitle="Every pitch you've built, its approval status, and what it's worth."
          stat={{ value: String(stats.total), label: "Plans total" }}
        />

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
          <KpiCard icon={InventoryIcon} label="Draft" value={String(stats.byStatus.DRAFT)} foot="Still being built" />
          <KpiCard icon={InventoryIcon} label="Pending approval" value={String(stats.byStatus.PENDING_APPROVAL)} tone={stats.byStatus.PENDING_APPROVAL > 0 ? "violet" : undefined} foot="Awaiting sign-off" />
          <KpiCard icon={InventoryIcon} label="Approved" value={String(stats.byStatus.APPROVED)} foot="Ready to send" />
          <KpiCard icon={InventoryIcon} label="Pitched value" value={money(stats.pitchedValue)} foot="Client-facing total, all plans" />
        </div>

        {actionError && <ErrorNotice message={actionError instanceof ApiError ? actionError.message : "Couldn't update that plan."} />}

        <Panel
          title="Your plans"
          subtitle="Build and edit these from Inventory → Plans — actions here are just submit/approve/reject."
          action={
            <PanelAction onClick={() => router.push("/inventory")}>
              Open Inventory <ArrowRightIcon className="h-3 w-3" />
            </PanelAction>
          }
        >
          {plansQuery.isLoading ? (
            <TableSkeleton rows={3} />
          ) : plans.length === 0 ? (
            <EmptyState label="No plans yet — create one from Inventory." />
          ) : (
            <div className="flex flex-col gap-2.5">
              {plans.map((plan) => (
                <PlanRow
                  key={plan.id}
                  plan={plan}
                  onSubmit={() => submitMutation.mutate(plan.id)}
                  onApprove={() => approveMutation.mutate(plan.id)}
                  onReject={() => rejectMutation.mutate(plan.id)}
                  busy={submitMutation.isPending || approveMutation.isPending || rejectMutation.isPending}
                />
              ))}
            </div>
          )}
        </Panel>
      </div>
    </AppShell>
  );
}

function PlanRow({
  plan,
  onSubmit,
  onApprove,
  onReject,
  busy,
}: {
  plan: Plan;
  onSubmit: () => void;
  onApprove: () => void;
  onReject: () => void;
  busy: boolean;
}) {
  return (
    <div className="flex flex-col gap-2.5 rounded-md border border-border px-3.5 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="truncate text-[0.8438rem] font-semibold">{plan.name}</p>
          {/* DRAFT/APPROVED/REJECTED are already valid pill statuses;
              PENDING_APPROVAL borrows SCHEDULED's "awaiting, pulsing" look
              since Plan doesn't have its own pill status set. */}
          <StatusPill status={plan.status === "PENDING_APPROVAL" ? "SCHEDULED" : plan.status} />
        </div>
        <p className="mt-0.5 truncate text-xs text-text-faint">
          {plan.clientName} · {count(plan.items.length)} page{plan.items.length === 1 ? "" : "s"} ·{" "}
          <span className="inline-flex items-center gap-1">
            <HeartIcon className="h-3 w-3" /> {count(plan.expectedEngagement.likes)}
          </span>{" "}
          <span className="inline-flex items-center gap-1">
            <EyeIcon className="h-3 w-3" /> {count(plan.expectedEngagement.views)}
          </span>{" "}
          · {money(plan.overview.total)}
        </p>
      </div>
      <div className="flex shrink-0 gap-1.5">
        {plan.status === "DRAFT" && (
          <Button size="sm" variant="secondary" onClick={onSubmit} disabled={busy}>
            Submit for approval
          </Button>
        )}
        {plan.status === "PENDING_APPROVAL" && (
          <>
            <Button size="sm" onClick={onApprove} disabled={busy}>
              Approve
            </Button>
            <Button size="sm" variant="danger" onClick={onReject} disabled={busy}>
              Reject
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
