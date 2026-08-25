import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../middleware/errorHandler.js";

/**
 * Creators see only their own assets; Admin/Finance see everything —
 * mirrors the scoping used across links/invoices.
 */
export async function listAssets(user) {
  const where = ["ADMIN", "FINANCE"].includes(user.role) ? {} : { ownerId: user.id };
  const assets = await prisma.asset.findMany({
    where,
    include: { rateCards: true },
    orderBy: { createdAt: "desc" },
  });
  return Promise.all(assets.map(async (asset) => ({ ...asset, engagement: await getAvgEngagement(asset.id) })));
}

/**
 * Avg. Likes / Comments / Views across this asset's posts (creator.wldd.in's
 * "Performance Metrics" on the Assets page) — one figure per link, taken
 * from its most recent scrape, averaged across every link that's been
 * scraped at least once. Links with no snapshot yet don't count toward it.
 */
async function getAvgEngagement(assetId) {
  const links = await prisma.link.findMany({
    where: { assetId },
    select: { postSnapshots: { orderBy: { capturedAt: "desc" }, take: 1 } },
  });
  const latest = links.map((l) => l.postSnapshots[0]).filter(Boolean);
  if (latest.length === 0) return { avgLikes: null, avgComments: null, avgViews: null, sampleSize: 0 };

  const sum = (key) => latest.reduce((total, s) => total + s[key], 0);
  return {
    avgLikes: Math.round(sum("likeCount") / latest.length),
    avgComments: Math.round(sum("commentsCount") / latest.length),
    avgViews: Math.round(sum("videoViews") / latest.length),
    sampleSize: latest.length,
  };
}

export async function createAsset(user, { platform, handle }) {
  return prisma.asset.create({
    data: { ownerId: user.id, platform, handle, approvalStatus: "pending" },
  });
}

export async function setApprovalStatus(assetId, approvalStatus) {
  return prisma.asset.update({ where: { id: assetId }, data: { approvalStatus } });
}

/** Upserts each (assetId, format) rate — admin-only, versioned by effectiveFrom. */
export async function updateRateCard(assetId, rateCards) {
  const asset = await prisma.asset.findUnique({ where: { id: assetId } });
  if (!asset) throw new ApiError(404, "ASSET_NOT_FOUND", "Asset not found");

  return prisma.$transaction(
    rateCards.map((entry) =>
      prisma.rateCard.upsert({
        where: { assetId_format: { assetId, format: entry.format } },
        create: { assetId, format: entry.format, amount: entry.amount },
        update: { amount: entry.amount, effectiveFrom: new Date() },
      })
    )
  );
}
