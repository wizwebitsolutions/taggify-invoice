/**
 * Plans helpers (pure). Mirrors the server's rules: a plan is DRAFT until an
 * approver approves or rejects it (no submit step — PENDING_APPROVAL is a
 * legacy value); approving creates the campaign. Admin can act on any plan;
 * a Planner only on their own, with their own-content switches.
 */
import { hasAccess, hasOwnAccess, type Plan, type PlanItem, type PermissionKey, type User } from "@/lib/api-client";
import { formatLabel } from "@/lib/formats";

export const PLAN_STATUS: Record<Plan["status"], { label: string; tone: "warning" | "success" | "danger" }> = {
  DRAFT: { label: "Draft · awaiting approval", tone: "warning" },
  PENDING_APPROVAL: { label: "Draft · awaiting approval", tone: "warning" },
  APPROVED: { label: "Approved", tone: "success" },
  REJECTED: { label: "Rejected", tone: "danger" },
};

export const isDraft = (p: Pick<Plan, "status">) => p.status === "DRAFT" || p.status === "PENDING_APPROVAL";
/** Only a DRAFT can be approved/rejected (server decidePlan); legacy PENDING_APPROVAL rows can't. */
export const isDecidable = (p: Pick<Plan, "status">) => p.status === "DRAFT";
/** A rejected plan can still be approved later (8 Oct); only a draft can be rejected. */
export const canBeApproved = (p: Pick<Plan, "status">) => p.status === "DRAFT" || p.status === "REJECTED";

/** The plan sheet's two layouts (8 Oct), modelled on the two sample plans. */
export const SHEET_FORMAT_INFO = {
  breakdown: { label: "Category breakdown", description: "A row per page category with followers, items, cost and expected views, then GST and the total." },
  summary: { label: "Campaign summary", description: "One overview block: total followers, deliverables, expected views, cost and cost per view." },
} as const;
export const sheetFormatOf = (p: { sheetFormat?: string | null }) => (p.sheetFormat === "summary" ? "summary" : "breakdown");

/** Drafts and rejected plans reopen in the plan form; an approved plan already made its campaign. */
export const isEditablePlan = (p: Pick<Plan, "status">) => isDraft(p) || p.status === "REJECTED";

/** What the client pays before GST, after any Step-3 override — the plan's headline value. */
export const planValue = (p: Plan) => p.overview.subtotal;

/** The plan's distinct pages, in line order, for a PageAvatarStack (several lines can share a page). */
export function planPages(p: Pick<Plan, "items">) {
  const seen = new Map<string, { id: string; handle: string; platform?: string | null }>();
  for (const i of p.items) if (!seen.has(i.assetId)) seen.set(i.assetId, { id: i.assetId, handle: i.asset?.handle ?? "", platform: i.asset?.platform });
  return [...seen.values()];
}

export const perPostClient =(i: PlanItem) => Number(i.clientCost ?? i.cost);
export const lineClientTotal = (i: PlanItem) => perPostClient(i) * i.postsPerProfile;
export const lineCost = (i: PlanItem) => Number(i.cost) * i.postsPerProfile;

/** What the client pays (before GST, after any override) minus what the pages earn — never shown to the client. */
/** What the client pays before GST (subtotal less any flat discount, 16 Oct) minus our cost to pages. */
export const margin = (p: Plan) => Math.round(((p.overview.taxable ?? p.overview.subtotal) - p.totalCost) * 100) / 100;

/** The internal budget caps what the pages cost us, not the client quote (as in v1). */
export const budgetLeft = (p: Plan) => (p.budget ? Math.round((Number(p.budget) - p.totalCost) * 100) / 100 : null);

type PlanUser = Pick<User, "id" | "role" | "permissions"> & { ownAccess?: Partial<Record<string, boolean>> };

function can(user: PlanUser | null | undefined, key: PermissionKey, plan?: Pick<Plan, "createdBy">) {
  if (!user) return false;
  if (hasAccess(user, key)) return true;
  if (user.role === "PLAN_MAKER") return hasOwnAccess(user, key) && (!plan || plan.createdBy?.id === user.id);
  return false;
}

export const canViewPlans = (u: PlanUser | null | undefined) => can(u, "plans.view");
export const canEditPlan = (u: PlanUser | null | undefined, p?: Pick<Plan, "createdBy">) => can(u, "plans.edit", p);
export const canApprovePlan = (u: PlanUser | null | undefined, p?: Pick<Plan, "createdBy">) => can(u, "plans.approve", p);

/** The formats the server accepts for new plan lines (lib/formats.ts mirrors server/src/lib/formats.js). */
export { FORMATS } from "@/lib/formats";

export function formatName(f: string | null | undefined) {
  return formatLabel(f) || "Post";
}
