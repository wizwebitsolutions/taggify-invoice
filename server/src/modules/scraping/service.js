import { prisma } from "../../lib/prisma.js";
import { ApifyInstagramProvider, PostNotFoundError } from "../../lib/apifyClient.js";

/**
 * Scrapes metrics for a single Link's URL and persists a PostSnapshot.
 * On a dead link (PostNotFoundError) the link is flagged via a status
 * event but left in its current status for an admin to look at, rather
 * than silently failing.
 */
export async function refreshLinkMetrics(linkId) {
  const link = await prisma.link.findUnique({ where: { id: linkId } });
  if (!link) throw new Error(`Link ${linkId} not found`);

  try {
    const metrics = await ApifyInstagramProvider.getPostMetrics(link.url);
    await prisma.postSnapshot.create({
      data: {
        linkId,
        likeCount: metrics.likeCount,
        commentsCount: metrics.commentsCount,
        videoViews: metrics.videoViews,
        videoPlayCount: metrics.videoPlayCount,
        saves: metrics.saves,
        shares: metrics.shares,
        reposts: metrics.reposts,
        source: "apify",
      },
    });
    if (metrics.postedAt && !link.postedAt) {
      await prisma.link.update({ where: { id: linkId }, data: { postedAt: metrics.postedAt } });
    }
    return { ok: true };
  } catch (err) {
    if (err instanceof PostNotFoundError) {
      await prisma.linkStatusEvent.create({
        data: { linkId, status: link.status, note: `Scrape failed: dead link (${err.message})` },
      });
      return { ok: false, reason: "not_found" };
    }
    throw err; // transient/auth/quota — let caller decide on retry
  }
}

/** Refreshes an Asset's follower/media-count snapshot. */
export async function refreshAssetMetrics(assetId) {
  const asset = await prisma.asset.findUnique({ where: { id: assetId } });
  if (!asset) throw new Error(`Asset ${assetId} not found`);

  const metrics = await ApifyInstagramProvider.getAccountMetrics(asset.handle);
  await prisma.accountSnapshot.create({
    data: { assetId, followers: metrics.followers, mediaCount: metrics.mediaCount, source: "apify" },
  });
  await prisma.asset.update({ where: { id: assetId }, data: { followers: metrics.followers } });
}
