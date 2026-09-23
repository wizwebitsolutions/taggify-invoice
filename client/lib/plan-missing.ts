import type { Plan, SheetPendingEntry } from "@/lib/api-client";

/**
 * What a plan is still missing — one list, read by both the plan card's
 * "Details filled" block and the step-by-step "Complete details" popup
 * (user request, 22 Sep — "anything missing in excel sheet according to our
 * plan (database) will be shown as missing ... take input of missing fields
 * from users in steps"). Purely client-side, nothing here is enforced
 * server-side except what createPlanSchema already requires.
 */
export type MissingStepKey = "notes" | "clientContact" | "budget" | "pages";

export interface PlanMissing {
  /** Every gap, in card order — "Brief", "Client contact", "Page @x not in Inventory", … */
  labels: string[];
  /** The gaps the steps popup can collect, in step order. */
  steps: { key: MissingStepKey; label: string }[];
  percent: number;
  pendingPages: Extract<SheetPendingEntry, { kind: "page" }>[];
  pendingBudget: Extract<SheetPendingEntry, { kind: "budget" }> | null;
}

export function planMissing(plan: Plan): PlanMissing {
  const pending = plan.sourceSheetPending ?? [];
  const pendingPages = pending.filter((p): p is Extract<SheetPendingEntry, { kind: "page" }> => p.kind === "page");
  const pendingBudget = pending.find((p): p is Extract<SheetPendingEntry, { kind: "budget" }> => p.kind === "budget") ?? null;

  const checks: { key: MissingStepKey | null; label: string; done: boolean }[] = [
    { key: "notes", label: "Brief", done: Boolean(plan.notes?.trim()) },
    { key: "clientContact", label: "Client contact", done: Boolean(plan.clientContact) },
    { key: "budget", label: pendingBudget ? "Budget (sheet's is below the pages' total)" : "Budget", done: plan.budget != null },
    { key: "pages", label: "Pages", done: plan.items.length > 0 || pendingPages.length > 0 },
    { key: null, label: "Rates on every page", done: plan.items.length === 0 || plan.items.every((i) => Number(i.cost) > 0) },
    ...pendingPages.map((p) => ({ key: "pages" as const, label: p.cost == null ? `@${p.handle} has no cost` : `@${p.handle} not in Inventory`, done: false })),
  ];
  const missing = checks.filter((c) => !c.done);
  const stepKeys = [...new Set(missing.map((c) => c.key).filter((k): k is MissingStepKey => k !== null))];
  const stepLabel: Record<MissingStepKey, string> = { notes: "Brief", clientContact: "Client contact", budget: "Budget", pages: "Pages" };
  return {
    labels: missing.map((c) => c.label),
    steps: stepKeys.map((key) => ({ key, label: stepLabel[key] })),
    percent: Math.round(((checks.length - missing.length) / checks.length) * 100),
    pendingPages,
    pendingBudget,
  };
}
