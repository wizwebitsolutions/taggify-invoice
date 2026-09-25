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
 * ADMIN/FINANCE see every campaign. Since 24 Sep ("access to their own
 * content, not every") CREATOR/TEAM_MEMBER are scoped too — see
 * creatorCampaignWhere.
 */
export function planMakerCampaignWhere(userId) {
  return {
    OR: [{ Plan: { createdById: userId } }, { parentCampaign: { Plan: { createdById: userId } } }],
  };
}

/**
 * The page owners whose content a creator-side account works on: a CREATOR
 * is their own; a TEAM_MEMBER works for the creator(s) they're a member of.
 */
export async function ownerIdsFor(user) {
  if (user?.role === "TEAM_MEMBER") {
    const memberships = await prisma.teamMembership.findMany({ where: { userId: user.id }, select: { creatorId: true } });
    return [user.id, ...memberships.map((m) => m.creatorId)];
  }
  return [user.id];
}

/**
 * A creator's campaigns (24 Sep): a campaign group one of their pages is
 * booked on (CampaignAssignment) — the root row or any of its phases/extra
 * posts. Booked only, not "posted to": a link can only be submitted on a
 * booked row (lib/pageOwnership.js assertPageBooked), so a posted link
 * can't be used to open someone else's campaign.
 */
export function creatorCampaignWhere(ownerIds) {
  const onMyPages = { assignments: { some: { asset: { ownerId: { in: ownerIds } } } } };
  return { OR: [onMyPages, { phases: { some: onMyPages } }, { parentCampaign: onMyPages }] };
}

/** Prisma `where` fragment to AND into any Campaign query for this requester — `{}` when unscoped. */
export async function campaignVisibilityWhere(user) {
  if (user?.role === "PLAN_MAKER") return planMakerCampaignWhere(user.id);
  if (user?.role === "CREATOR" || user?.role === "TEAM_MEMBER") return creatorCampaignWhere(await ownerIdsFor(user));
  return {};
}

/** Creator/team member may open a campaign only if it (or its group) touches their pages. */
export async function canCreatorAccessCampaign(user, campaignId) {
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId }, select: { id: true, parentCampaignId: true } });
  if (!campaign) return false;
  const rootId = campaign.parentCampaignId ?? campaign.id;
  const found = await prisma.campaign.findFirst({ where: { id: rootId, ...creatorCampaignWhere(await ownerIdsFor(user)) }, select: { id: true } });
  return Boolean(found);
}

export async function canPlanMakerAccessCampaign(userId, campaignId) {
  const found = await prisma.campaign.findFirst({
    where: { id: campaignId, ...planMakerCampaignWhere(userId) },
    select: { id: true },
  });
  return Boolean(found);
}
