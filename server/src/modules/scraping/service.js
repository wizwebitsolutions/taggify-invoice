import { prisma } from "../../lib/prisma.js";
import { ApifyInstagramProvider, PostNotFoundError } from "../../lib/apifyClient.js";
import { recomputePostQuota } from "../../lib/postQuota.js";

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
        thumbnailUrl: metrics.thumbnailUrl,
        caption: metrics.caption,
        source: "apify",
      },
    });
    if (metrics.postedAt && !link.postedAt) {
      await prisma.link.update({ where: { id: linkId }, data: { postedAt: metrics.postedAt } });
      // Which posts count is decided by posted date, so learning one can move
      // the over-quota line on this page (lib/postQuota.js).
      await recomputePostQuota(link.campaignId, link.assetId);
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

/**
 * Refreshes an Asset's follower/media-count snapshot, and syncs its profile
 * details (full name, bio, avatar) from the same Apify call. Called from
 * the dedicated 24h asset-profile cron (see jobs/assetProfileRescrape.js) —
 * not the 6h link-rescrape job — since a profile pic/bio doesn't go stale
 * nearly as fast as post engagement does. Also called synchronously from
 * the Inventory "refresh" button (see assets/service.js's refreshProfile),
 * which is why this returns the updated asset rather than void — the cron
 * and the fire-and-forget callers in assets/service.js just ignore it.
 */
export async function refreshAssetMetrics(assetId) {
  const asset = await prisma.asset.findUnique({ where: { id: assetId } });
  if (!asset) throw new Error(`Asset ${assetId} not found`);

  let metrics;
  try {
    metrics = await ApifyInstagramProvider.getAccountMetrics(asset.handle);
  } catch (err) {
    // Remember *why* so the Inventory row can say so ("private account",
    // "no profile for handle") instead of showing 0 followers forever.
    await prisma.asset.update({ where: { id: assetId }, data: { lastScrapeError: String(err?.message ?? err).slice(0, 300), scrapeQueuedAt: null } }).catch(() => {});
    throw err;
  }
  return applyProfileMetrics(assetId, metrics);
}

/**
 * Persists one profile scrape's result onto the asset (+ an AccountSnapshot
 * row). Split out of refreshAssetMetrics so the Inventory import can store
 * the numbers its preview already fetched instead of scraping every page a
 * second time right after creating it.
 */
export async function applyProfileMetrics(assetId, metrics) {
  await prisma.accountSnapshot.create({
    data: { assetId, followers: metrics.followers, mediaCount: metrics.mediaCount, source: "apify" },
  });
  return prisma.asset.update({
    where: { id: assetId },
    data: {
      followers: metrics.followers,
      // Only replaced when Instagram actually returned one — an imported
      // page keeps its sheet "Page Name" / last known picture otherwise.
      ...(metrics.fullName ? { fullName: metrics.fullName } : {}),
      biography: metrics.biography,
      ...(metrics.profilePicUrl ? { profilePicUrl: metrics.profilePicUrl } : {}),
      // Profile-level engagement (Inventory "Create page", 14 Sep) — see
      // apifyClient.js's averageLatestPosts. Only overwritten when the
      // scrape actually saw posts, so a transient empty latestPosts doesn't
      // wipe a previous good sample.
      ...(metrics.sampleSize > 0
        ? { profileAvgViews: metrics.avgViews, profileAvgLikes: metrics.avgLikes, profileAvgComments: metrics.avgComments, profileSampleSize: metrics.sampleSize }
        : {}),
      lastScrapedAt: new Date(),
      lastScrapeError: null,
      scrapeQueuedAt: null,
    },
  });
}
