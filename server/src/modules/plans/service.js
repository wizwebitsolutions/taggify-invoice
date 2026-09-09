import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../middleware/errorHandler.js";
import { getAvgEngagement } from "../assets/service.js";

/**
 * "Inventory" (newTask.md #13) — pitch documents built from a set of pages,
 * exportable as a PDF for a brand client. See schema.prisma's Plan/PlanItem
 * comment for how this differs from Campaign.
 */

// Flat rate, matching invoices/service.js's own GST_RATE exactly (kept as
// a separate constant here rather than imported — plans and invoices are
// independent documents that happen to share a number, not one config
// that should couple the two modules together).
const GST_RATE = 0.18;

async function resolveItemCosts(items) {
  if (!items || items.length === 0) return [];
  const assetIds = [...new Set(items.map((i) => i.assetId))];
  const assets = await prisma.asset.findMany({ where: { id: { in: assetIds } }, include: { rateCards: true } });
  const assetById = new Map(assets.map((a) => [a.id, a]));

  return items.map((item) => {
    const asset = assetById.get(item.assetId);
    if (!asset) throw new ApiError(404, "ASSET_NOT_FOUND", `Page ${item.assetId} not found`);
    let cost = item.cost;
    if (cost == null) {
      const rateCard = asset.rateCards.find((rc) => rc.format === item.format);
      if (!rateCard) throw new ApiError(400, "NO_RATE_CARD", `No rate card set for format "${item.format}" on @${asset.handle}`);
      cost = Number(rateCard.amount);
    }
    return {
      assetId: item.assetId,
      format: item.format,
      cost,
      clientCost: item.clientCost ?? null,
      postsPerProfile: item.postsPerProfile ?? 1,
    };
  });
}

export async function createPlan(requester, { name, clientName, clientContact, budget, isGstPlan, items }) {
  const resolvedItems = await resolveItemCosts(items);
  const plan = await prisma.plan.create({
    data: {
      name,
      clientName,
      clientContact,
      budget,
      isGstPlan,
      createdById: requester.id,
      items: { create: resolvedItems },
    },
    include: { items: { include: { asset: true } }, createdBy: { select: { id: true, name: true } }, approvedBy: { select: { id: true, name: true } } },
  });
  return annotatePlan(plan);
}

// Plan Maker can only ever touch their own plans (newTask.md, 8 Sep — "Plan
// Maker... approves plans he created as well"); Admin can touch any. Not
// scoped as a WHERE clause because 404 (not 403) is what a not-found *or*
// not-yours plan should look like — same not-leaking-existence shape the
// rest of this file's ApiError(404, "PLAN_NOT_FOUND", ...) already uses.
function assertCanAccessPlan(requester, plan) {
  if (requester.role === "ADMIN") return;
  if (plan.createdById !== requester.id) {
    throw new ApiError(404, "PLAN_NOT_FOUND", "Plan not found");
  }
}

export async function updatePlan(planId, requester, { items, ...fields }) {
  const existing = await prisma.plan.findUnique({ where: { id: planId } });
  if (!existing) throw new ApiError(404, "PLAN_NOT_FOUND", "Plan not found");
  assertCanAccessPlan(requester, existing);

  const data = { ...fields };
  if (items) {
    const resolvedItems = await resolveItemCosts(items);
    await prisma.planItem.deleteMany({ where: { planId } });
    data.items = { create: resolvedItems };
  }

  const plan = await prisma.plan.update({
    where: { id: planId },
    data,
    include: { items: { include: { asset: true } }, createdBy: { select: { id: true, name: true } }, approvedBy: { select: { id: true, name: true } } },
  });
  return annotatePlan(plan);
}

// ADMIN sees every plan; Plan Maker sees only the ones they created — their
// dashboard's "which plan worked, their analysis" (newTask.md, 8 Sep) is
// scoped to their own pitches, not the whole agency's.
export async function listPlans(requester) {
  const where = requester?.role === "ADMIN" ? {} : { createdById: requester.id };
  const plans = await prisma.plan.findMany({
    where,
    include: { items: { include: { asset: true } }, createdBy: { select: { id: true, name: true } }, approvedBy: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
  });
  return Promise.all(plans.map(annotatePlan));
}

export async function getPlan(planId, requester) {
  const plan = await prisma.plan.findUnique({
    where: { id: planId },
    include: { items: { include: { asset: true } }, createdBy: { select: { id: true, name: true } }, approvedBy: { select: { id: true, name: true } } },
  });
  if (!plan) throw new ApiError(404, "PLAN_NOT_FOUND", "Plan not found");
  if (requester) assertCanAccessPlan(requester, plan);
  return annotatePlan(plan);
}

export async function deletePlan(planId, requester) {
  const plan = await prisma.plan.findUnique({ where: { id: planId } });
  if (!plan) throw new ApiError(404, "PLAN_NOT_FOUND", "Plan not found");
  assertCanAccessPlan(requester, plan);
  await prisma.plan.delete({ where: { id: planId } });
}

/**
 * DRAFT → PENDING_APPROVAL. The owner (or Admin) submits a plan once it's
 * ready for someone to sign off on — see approvePlan/rejectPlan for who
 * that "someone" can be.
 */
export async function submitPlan(planId, requester) {
  const plan = await prisma.plan.findUnique({ where: { id: planId } });
  if (!plan) throw new ApiError(404, "PLAN_NOT_FOUND", "Plan not found");
  assertCanAccessPlan(requester, plan);
  if (plan.status !== "DRAFT") {
    throw new ApiError(400, "INVALID_PLAN_STATUS", `Only a draft plan can be submitted for approval (this one is ${plan.status})`);
  }
  const updated = await prisma.plan.update({
    where: { id: planId },
    data: { status: "PENDING_APPROVAL" },
    include: { items: { include: { asset: true } }, createdBy: { select: { id: true, name: true } }, approvedBy: { select: { id: true, name: true } } },
  });
  return annotatePlan(updated);
}

/**
 * PENDING_APPROVAL → APPROVED/REJECTED. Admin can decide on any plan
 * (newTask.md, 8 Sep — "Admin... even approving plans"); a Plan Maker can
 * only decide on their own ("approves plans he created as well") — they
 * can't approve a colleague's pitch.
 */
async function decidePlan(planId, requester, decision) {
  const plan = await prisma.plan.findUnique({ where: { id: planId } });
  if (!plan) throw new ApiError(404, "PLAN_NOT_FOUND", "Plan not found");
  assertCanAccessPlan(requester, plan);
  if (plan.status !== "PENDING_APPROVAL") {
    throw new ApiError(400, "INVALID_PLAN_STATUS", `Only a plan pending approval can be ${decision === "APPROVED" ? "approved" : "rejected"} (this one is ${plan.status})`);
  }
  const updated = await prisma.plan.update({
    where: { id: planId },
    data:
      decision === "APPROVED"
        ? { status: "APPROVED", approvedById: requester.id, approvedAt: new Date() }
        : { status: "REJECTED", approvedById: requester.id, approvedAt: new Date() },
    include: { items: { include: { asset: true } }, createdBy: { select: { id: true, name: true } }, approvedBy: { select: { id: true, name: true } } },
  });
  return annotatePlan(updated);
}

export const approvePlan = (planId, requester) => decidePlan(planId, requester, "APPROVED");
export const rejectPlan = (planId, requester) => decidePlan(planId, requester, "REJECTED");

/**
 * Adds the computed numbers newTask.md #13 (and its 8 Sep follow-up) ask
 * for. Two cost totals, kept deliberately distinct:
 *  - totalCost/budgetVariance: internal — every item's real cost × how many
 *    posts it covers, compared against the admin's own budget target.
 *  - overview.{subtotal,gstAmount,total}: client-facing — each item's
 *    clientCost when set (falling back to its real cost otherwise), the
 *    number that actually belongs in anything sent to the brand. See
 *    forClientPdf() below for why the PDF never touches totalCost directly.
 * expectedEngagement/overview.expectedImpressions come from the *distinct*
 * selected pages' own scrape history (getAvgEngagement) — an asset picked
 * for two formats only counts once. There's no impressions metric anywhere
 * in the data model (PostSnapshot tracks likes/comments/views/saves/
 * shares/reposts, not impressions), so it's approximated from avg. views
 * per post × posts per profile — an estimate, same spirit as the source
 * sheet's own rounded "5M+" rather than an exact figure.
 */
async function annotatePlan(plan) {
  const budget = plan.budget != null ? Number(plan.budget) : null;

  const distinctAssetIds = [...new Set(plan.items.map((i) => i.assetId))];
  const engagements = await Promise.all(distinctAssetIds.map((assetId) => getAvgEngagement(assetId)));
  const engagementByAsset = new Map(distinctAssetIds.map((id, i) => [id, engagements[i]]));
  const expectedLikes = engagements.reduce((sum, e) => sum + (e.avgLikes ?? 0), 0);
  const expectedViews = engagements.reduce((sum, e) => sum + (e.avgViews ?? 0), 0);

  const totalCost = plan.items.reduce((sum, item) => sum + Number(item.cost) * item.postsPerProfile, 0);
  const clientSubtotal = plan.items.reduce((sum, item) => sum + Number(item.clientCost ?? item.cost) * item.postsPerProfile, 0);
  // Rounded to paise so float drift can't leave total !== subtotal + gstAmount by a fraction — same rounding invoices/service.js uses.
  const gstAmount = plan.isGstPlan ? Math.round(clientSubtotal * GST_RATE * 100) / 100 : 0;

  const totalPosts = plan.items.reduce((sum, item) => sum + item.postsPerProfile, 0);
  const expectedImpressions = plan.items.reduce(
    (sum, item) => sum + (engagementByAsset.get(item.assetId)?.avgViews ?? 0) * item.postsPerProfile,
    0
  );
  const totalFollowers = distinctAssetIds.reduce((sum, id) => {
    const item = plan.items.find((i) => i.assetId === id);
    return sum + (item?.asset?.followers ?? 0);
  }, 0);

  return {
    ...plan,
    totalCost,
    // Positive = under budget ("less cost" than budgeted), negative = over ("extra cost").
    budgetVariance: budget != null ? budget - totalCost : null,
    expectedEngagement: { likes: expectedLikes, views: expectedViews },
    overview: {
      totalFollowers,
      totalPosts,
      expectedImpressions,
      subtotal: clientSubtotal,
      gstAmount,
      total: clientSubtotal + gstAmount,
    },
  };
}

/**
 * Reshapes a plan for the client-facing PDF (newTask.md, 8 Sep) — the
 * whole point of a separate clientCost is that the real internal number
 * must never reach anything sent to a brand. Rather than trust every call
 * site to remember `clientCost ?? cost` themselves, this resolves it once
 * here and doesn't even carry `cost`/`clientCost` through to the output —
 * planPdf.js physically has no field to reach for but the resolved
 * `displayCost`, so there's no way to wire it up wrong later.
 */
export function forClientPdf(plan) {
  return {
    name: plan.name,
    clientName: plan.clientName,
    clientContact: plan.clientContact,
    createdAt: plan.createdAt,
    isGstPlan: plan.isGstPlan,
    overview: plan.overview,
    items: plan.items.map((item) => ({
      format: item.format,
      postsPerProfile: item.postsPerProfile,
      displayCost: Number(item.clientCost ?? item.cost),
      asset: item.asset ? { handle: item.asset.handle, category: item.asset.category, followers: item.asset.followers } : null,
    })),
  };
}
