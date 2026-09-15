import { prisma } from "./prisma.js";

/**
 * Plan Maker's campaign scope (user decision, 12 Sep — "only campaigns
 * created from their own approved plans", not every campaign). A campaign
 * is "theirs" if it was spawned by one of their plans (Plan.campaignId →
 * Campaign, see plans/service.js's createCampaignFromPlan), or is a later
 * phase of such a campaign (phases hang off the root via parentCampaignId
 * and never carry their own Plan row).
 *
 * Kept in its own module (not campaigns/service.js) because invoices/
 * links/campaigns all need it and campaigns/service.js already imports
 * links/service.js — putting it there would create a cycle.
 *
 * Only PLAN_MAKER reads this. ADMIN/FINANCE see every campaign; CREATOR/
 * TEAM_MEMBER are scoped by asset ownership elsewhere, not by campaign.
 */
export function planMakerCampaignWhere(userId) {
  return {
    OR: [{ Plan: { createdById: userId } }, { parentCampaign: { Plan: { createdById: userId } } }],
  };
}

/** Prisma `where` fragment to AND into any Campaign query for this requester — `{}` when unscoped. */
export function campaignVisibilityWhere(user) {
  return user?.role === "PLAN_MAKER" ? planMakerCampaignWhere(user.id) : {};
}

export async function canPlanMakerAccessCampaign(userId, campaignId) {
  const found = await prisma.campaign.findFirst({
    where: { id: campaignId, ...planMakerCampaignWhere(userId) },
    select: { id: true },
  });
  return Boolean(found);
}
