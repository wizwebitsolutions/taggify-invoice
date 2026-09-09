import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../middleware/errorHandler.js";
import { refreshAssetMetrics } from "../scraping/service.js";

/**
 * Creators see only their own assets; Admin/Finance/Plan Maker see
 * everything — Plan Maker needs the full catalogue to build a Plan from
 * (newTask.md, 8 Sep: their dashboard is "Dashboard + Inventory +
 * Plan-create"), and doesn't own pages the way a Creator does.
 */
export async function listAssets(user) {
  const where = ["ADMIN", "FINANCE", "PLAN_MAKER"].includes(user.role) ? {} : { ownerId: user.id };
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
export async function getAvgEngagement(assetId) {
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

export async function createAsset(user, { platform, handle, category, ownerId }) {
  // Only an admin may register a page on someone else's behalf (the "create
  // a user with their first page(s)" flow on the Users page); a CREATOR
  // creating their own page never sends ownerId, so this never fires for them.
  if (ownerId && ownerId !== user.id && user.role !== "ADMIN") {
    throw new ApiError(403, "FORBIDDEN", "Only an admin can register a page for another user");
  }
  const asset = await prisma.asset.create({
    data: { ownerId: ownerId ?? user.id, platform, handle, category, approvalStatus: "pending" },
  });

  // Fire-and-forget — pulls followers/full name/bio/avatar in the background
  // so a newly-added page isn't left blank indefinitely: the only other
  // place that populates these fields is assetProfileRescrapeJob, a 24h
  // cron that (deliberately) only rescrapes already-approved assets, so a
  // brand-new "pending" asset would otherwise never get scraped at all.
  // Not awaited: the Apify actor call can take up to ~2 minutes and
  // shouldn't block the "Add page" request; a bad handle or transient
  // failure here just means the page shows blank until it's approved
  // (see setApprovalStatus) or the next cron tick.
  refreshAssetMetrics(asset.id).catch((err) =>
    console.error(`createAsset: initial Apify scrape failed for handle "${handle}"`, err)
  );

  return asset;
}

export async function setApprovalStatus(assetId, approvalStatus) {
  const asset = await prisma.asset.update({ where: { id: assetId }, data: { approvalStatus } });

  // Second chance at a scrape right when a page goes live, rather than
  // waiting for the next 24h assetProfileRescrapeJob tick — also covers the
  // case where the create-time scrape above failed or ran before the actor
  // had indexed the profile.
  if (approvalStatus === "approved") {
    refreshAssetMetrics(assetId).catch((err) =>
      console.error(`setApprovalStatus: Apify scrape failed for asset ${assetId}`, err)
    );
  }

  return asset;
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
