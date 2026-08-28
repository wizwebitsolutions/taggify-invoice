import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../middleware/errorHandler.js";
import { getAvgEngagement } from "../assets/service.js";

/**
 * "Inventory" (newTask.md #13) — pitch documents built from a set of pages,
 * exportable as a PDF for a brand client. See schema.prisma's Plan/PlanItem
 * comment for how this differs from Campaign.
 */

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
    return { assetId: item.assetId, format: item.format, cost };
  });
}

export async function createPlan(admin, { name, clientName, clientContact, budget, items }) {
  const resolvedItems = await resolveItemCosts(items);
  const plan = await prisma.plan.create({
    data: {
      name,
      clientName,
      clientContact,
      budget,
      createdById: admin.id,
      items: { create: resolvedItems },
    },
    include: { items: { include: { asset: true } } },
  });
  return annotatePlan(plan);
}

export async function updatePlan(planId, { items, ...fields }) {
  const existing = await prisma.plan.findUnique({ where: { id: planId } });
  if (!existing) throw new ApiError(404, "PLAN_NOT_FOUND", "Plan not found");

  const data = { ...fields };
  if (items) {
    const resolvedItems = await resolveItemCosts(items);
    await prisma.planItem.deleteMany({ where: { planId } });
    data.items = { create: resolvedItems };
  }

  const plan = await prisma.plan.update({
    where: { id: planId },
    data,
    include: { items: { include: { asset: true } } },
  });
  return annotatePlan(plan);
}

export async function listPlans() {
  const plans = await prisma.plan.findMany({
    include: { items: { include: { asset: true } } },
    orderBy: { createdAt: "desc" },
  });
  return Promise.all(plans.map(annotatePlan));
}

export async function getPlan(planId) {
  const plan = await prisma.plan.findUnique({
    where: { id: planId },
    include: { items: { include: { asset: true } }, createdBy: { select: { id: true, name: true } } },
  });
  if (!plan) throw new ApiError(404, "PLAN_NOT_FOUND", "Plan not found");
  return annotatePlan(plan);
}

export async function deletePlan(planId) {
  const plan = await prisma.plan.findUnique({ where: { id: planId } });
  if (!plan) throw new ApiError(404, "PLAN_NOT_FOUND", "Plan not found");
  await prisma.plan.delete({ where: { id: planId } });
}

/**
 * Adds the computed numbers newTask.md #13 asks for: total cost across
 * every selected page/format, expected engagement (summed avg. likes/views
 * across the *distinct* selected pages' own history — an asset picked for
 * two formats only counts once), and how the cost compares to budget.
 */
async function annotatePlan(plan) {
  const totalCost = plan.items.reduce((sum, item) => sum + Number(item.cost), 0);
  const budget = plan.budget != null ? Number(plan.budget) : null;

  const distinctAssetIds = [...new Set(plan.items.map((i) => i.assetId))];
  const engagements = await Promise.all(distinctAssetIds.map((assetId) => getAvgEngagement(assetId)));
  const expectedLikes = engagements.reduce((sum, e) => sum + (e.avgLikes ?? 0), 0);
  const expectedViews = engagements.reduce((sum, e) => sum + (e.avgViews ?? 0), 0);

  return {
    ...plan,
    totalCost,
    // Positive = under budget ("less cost" than budgeted), negative = over ("extra cost").
    budgetVariance: budget != null ? budget - totalCost : null,
    expectedEngagement: { likes: expectedLikes, views: expectedViews },
  };
}
