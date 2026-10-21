"use client";

import { useParams } from "next/navigation";

import { useAuth } from "@/lib/auth-context";
import { canEditPlan, isEditablePlan } from "@/lib/plans";
import { usePlan } from "@/lib/queries/plans";
import { AppShell } from "@/components/layout/app-shell";
import { Skeleton } from "@/components/ui/skeleton";
import { LoadError, NoAccess } from "@/components/finance/states";
import { PlanForm } from "@/components/plans/plan-form/plan-form";

export default function EditPlanPage() {
  return (
    <AppShell active="plans">
      <EditPlan />
    </AppShell>
  );
}

/** Reopens the plan form prefilled. Only drafts and rejected plans; an approved plan already has its campaign. */
function EditPlan() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const plan = usePlan(id);

  if (!canEditPlan(user)) return <NoAccess what="editing plans" />;
  if (plan.isError) return <LoadError onRetry={() => plan.refetch()} what="this plan" />;
  if (!plan.data) return <Skeleton className="mt-6 h-96 w-full rounded-card" />;
  if (!canEditPlan(user, plan.data)) return <NoAccess what="editing this plan" />;
  if (!isEditablePlan(plan.data)) return <NoAccess what="editing this plan" hint="An approved plan already made its campaign, so it can't be edited. Make a new variant instead." />;
  return <PlanForm key={id} mode={{ kind: "edit", plan: plan.data }} />;
}
