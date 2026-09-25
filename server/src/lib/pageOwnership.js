import { prisma } from "./prisma.js";
import { ApiError } from "../middleware/errorHandler.js";

/**
 * Self-service writes on a page (submitting links, uploading screenshots)
 * are for the page's own creator — or a team member working for that
 * creator (TeamMembership). Before 24 Sep these routes only checked the
 * role, so a creator could submit links against anyone's page ("access to
 * their own content, not every").
 */
export async function assertCanActOnPage(user, asset) {
  if (!asset) throw new ApiError(404, "ASSET_NOT_FOUND", "Asset not found");
  if (asset.ownerId === user.id) return;
  if (user.role === "TEAM_MEMBER") {
    const membership = await prisma.teamMembership.findUnique({ where: { userId_creatorId: { userId: user.id, creatorId: asset.ownerId } } });
    if (membership) return;
  }
  throw new ApiError(403, "NOT_YOUR_PAGE", "You can only do this for your own pages");
}

/**
 * A creator / team member may submit a link only on a campaign row their
 * page is booked on (user decision, 24 Sep — "booked campaigns only"): the
 * admin books the page first, then the creator posts.
 */
export async function assertPageBooked(campaignId, assetId) {
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId }, select: { id: true } });
  if (!campaign) throw new ApiError(404, "CAMPAIGN_NOT_FOUND", "Campaign not found");
  const booking = await prisma.campaignAssignment.findFirst({ where: { campaignId, assetId }, select: { id: true } });
  if (!booking) throw new ApiError(403, "PAGE_NOT_BOOKED", "This page isn't booked on that campaign — ask your admin to add it first");
}
