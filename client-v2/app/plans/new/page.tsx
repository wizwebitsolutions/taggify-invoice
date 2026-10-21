"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";

import { useAuth } from "@/lib/auth-context";
import { canEditPlan } from "@/lib/plans";
import { usePlan } from "@/lib/queries/plans";
import { AppShell } from "@/components/layout/app-shell";
import { Skeleton } from "@/components/ui/skeleton";
import { LoadError, NoAccess } from "@/components/finance/states";
import { PlanForm } from "@/components/plans/plan-form/plan-form";

export default function NewPlanPage() {
  return (
    <AppShell active="plans">
      <Suspense>
        <NewPlan />
      </Suspense>
    </AppShell>
  );
}

/** Create a plan (optionally starting from ?assetIds=<page ids>), or a variant of one with ?variantOf=<plan id> (its client and brief carry over). */
function NewPlan() {
  const { user } = useAuth();
  const params = useSearchParams();
  const variantOf = params.get("variantOf") ?? "";
  // Pages ticked in Inventory → "Create plan" (?assetIds=a,b,c) start the new plan's selection.
  const assetIds = (params.get("assetIds") ?? "").split(",").filter(Boolean);
  const source = usePlan(variantOf);

  if (!canEditPlan(user)) return <NoAccess what="creating plans" />;
  if (!variantOf) return <PlanForm key="create" mode={{ kind: "create", assetIds }} />;
  if (source.isError) return <LoadError onRetry={() => source.refetch()} what="the plan this variant is based on" />;
  if (!source.data) return <Skeleton className="mt-6 h-96 w-full rounded-card" />;
  return <PlanForm key={variantOf} mode={{ kind: "variant", source: source.data }} />;
}
