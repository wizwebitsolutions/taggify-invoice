import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../middleware/errorHandler.js";

/**
 * Campaigns list, each annotated with:
 *  - a card preview: one representative post's thumbnail + caption, and the
 *    total likes across every post submitted for that campaign
 *  - budget: `spent` (sum of every non-rejected link's cost) and
 *    `remainingBudget` (costCap - spent, null if no cap was set) — newTask.md #9
 *  - `pendingAssignmentCount`: how many rows from an attached sheet still
 *    need a page/creator created for them — newTask.md #8/#11
 * None of this is stored — computed here from Link/CampaignAssignment so
 * there's nothing to keep in sync.
 */
export async function listCampaigns({ search } = {}) {
  const campaigns = await prisma.campaign.findMany({
    where: search
      ? { OR: [{ title: { contains: search, mode: "insensitive" } }, { brandName: { contains: search, mode: "insensitive" } }] }
      : undefined,
    orderBy: { createdAt: "desc" },
  });
  if (campaigns.length === 0) return campaigns;

  const campaignIds = campaigns.map((c) => c.id);

  const [links, assignments] = await Promise.all([
    prisma.link.findMany({
      where: { campaignId: { in: campaignIds } },
      select: {
        campaignId: true,
        cost: true,
        status: true,
        postedAt: true,
        createdAt: true,
        postSnapshots: {
          orderBy: { capturedAt: "desc" },
          take: 1,
          select: { thumbnailUrl: true, caption: true, likeCount: true },
        },
      },
    }),
    prisma.campaignAssignment.findMany({
      where: { campaignId: { in: campaignIds }, status: "pending" },
      select: { campaignId: true },
    }),
  ]);

  const linksByCampaign = new Map();
  for (const link of links) {
    if (!linksByCampaign.has(link.campaignId)) linksByCampaign.set(link.campaignId, []);
    linksByCampaign.get(link.campaignId).push(link);
  }
  const pendingByCampaign = new Map();
  for (const a of assignments) {
    pendingByCampaign.set(a.campaignId, (pendingByCampaign.get(a.campaignId) ?? 0) + 1);
  }

  return campaigns.map((campaign) => {
    const campaignLinks = linksByCampaign.get(campaign.id) ?? [];

    // One post represents the whole campaign on its card — prefer the most
    // recently posted link that actually has a scraped thumbnail yet (a
    // just-submitted link hasn't been scraped by the cron/on-approval scrape
    // yet), falling back to just the most recent link so a brand-new
    // campaign still shows *something* instead of an empty card.
    const withThumbnail = campaignLinks
      .filter((l) => l.postSnapshots[0]?.thumbnailUrl)
      .sort((a, b) => (b.postedAt ?? b.createdAt) - (a.postedAt ?? a.createdAt));
    const representative = withThumbnail[0] ?? campaignLinks[0] ?? null;
    const representativeSnapshot = representative?.postSnapshots[0] ?? null;

    // -1 is Apify's "unknown/hidden count" sentinel (see scraping/service.js)
    // — never counted as a real like, and never a link with no snapshot yet.
    const totalLikes = campaignLinks.reduce((sum, l) => {
      const likes = l.postSnapshots[0]?.likeCount;
      return likes && likes > 0 ? sum + likes : sum;
    }, 0);

    // A rejected screenshot means the submission never counted as valid
    // work, so it shouldn't count against the budget either.
    const spent = campaignLinks
      .filter((l) => l.status !== "SCREENSHOT_REJECTED")
      .reduce((sum, l) => sum + Number(l.cost), 0);

    return {
      ...campaign,
      postCount: campaignLinks.length,
      representativePost: representativeSnapshot
        ? { thumbnailUrl: representativeSnapshot.thumbnailUrl, caption: representativeSnapshot.caption }
        : null,
      totalLikes,
      spent,
      remainingBudget: campaign.costCap != null ? Number(campaign.costCap) - spent : null,
      pendingAssignmentCount: pendingByCampaign.get(campaign.id) ?? 0,
    };
  });
}

/**
 * Creates a campaign and, if a page/creator sheet was attached (newTask.md
 * #8), one CampaignAssignment row per entry — matched immediately to an
 * existing Asset by handle where one exists, left "pending" otherwise for
 * an admin to resolve (see resolveAssignment).
 */
export async function createCampaign({ brandName, title, deadline, costCap, sheetLink, assignments }) {
  const campaign = await prisma.campaign.create({ data: { brandName, title, deadline, costCap, sheetLink } });
  if (!assignments || assignments.length === 0) return { campaign, matchedCount: 0, pendingCount: 0 };

  // One query for every handle in the sheet, rather than one lookup per row.
  const handles = [...new Set(assignments.map((a) => a.handle.trim().replace(/^@+/, "").toLowerCase()))];
  const existingAssets = await prisma.asset.findMany({
    where: { handle: { in: handles, mode: "insensitive" } },
    select: { id: true, handle: true },
  });
  const assetByHandle = new Map(existingAssets.map((a) => [a.handle.toLowerCase(), a.id]));

  const rows = assignments.map((a) => {
    const cleanHandle = a.handle.trim().replace(/^@+/, "");
    const assetId = assetByHandle.get(cleanHandle.toLowerCase()) ?? null;
    return {
      campaignId: campaign.id,
      pageHandle: cleanHandle,
      creatorPhone: a.phone,
      assetId,
      status: assetId ? "matched" : "pending",
    };
  });
  await prisma.campaignAssignment.createMany({ data: rows });

  const matchedCount = rows.filter((r) => r.status === "matched").length;
  return { campaign, matchedCount, pendingCount: rows.length - matchedCount };
}

export async function updateCampaign(id, data) {
  return prisma.campaign.update({ where: { id }, data });
}

export async function listAssignments(campaignId) {
  return prisma.campaignAssignment.findMany({
    where: { campaignId },
    include: { asset: { select: { id: true, handle: true, category: true, approvalStatus: true } } },
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
  });
}

/**
 * Resolves a pending assignment once an admin has created (or identified)
 * the page it should point to — newTask.md #11's approval gate is whatever
 * that page's own Asset.approvalStatus already is (a page created for this
 * still starts "pending" there, same as any other new page).
 */
export async function resolveAssignment(campaignId, assignmentId, assetId) {
  const assignment = await prisma.campaignAssignment.findUnique({ where: { id: assignmentId } });
  if (!assignment || assignment.campaignId !== campaignId) {
    throw new ApiError(404, "ASSIGNMENT_NOT_FOUND", "Assignment not found on this campaign");
  }
  const asset = await prisma.asset.findUnique({ where: { id: assetId } });
  if (!asset) throw new ApiError(404, "ASSET_NOT_FOUND", "Asset not found");

  return prisma.campaignAssignment.update({
    where: { id: assignmentId },
    data: { assetId, status: "matched" },
  });
}
