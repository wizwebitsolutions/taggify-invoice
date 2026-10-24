import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../middleware/errorHandler.js";
import { uploadPostThumbnail, isCloudinaryConfigured } from "../../lib/cloudinaryClient.js";
import { downloadImage } from "../../lib/downloadImage.js";

/**
 * Post thumbnails (22 Oct — "instagram reel thumbnail is not showing").
 *
 * The scrape stores Instagram's own CDN link on the snapshot
 * (PostSnapshot.thumbnailUrl). The browser used to hotlink that directly,
 * which breaks two ways: the link is signed with an `oe=` expiry of about a
 * week, after which it 403s for good, and cdninstagram.com is blocked by some
 * networks and privacy extensions. Same problem the profile pictures had
 * (assets/service.js, 11 + 22 Sep), fixed the same way: copy the image into
 * Cloudinary right after the scrape, and serve it through our own
 * GET /links/:id/thumbnail, which falls back to proxying Instagram
 * server-to-server for a snapshot whose copy hasn't landed yet.
 */

// Proxy cache for the fallback path — keyed by linkId. Short TTL: a stored
// copy normally replaces it within seconds of the scrape anyway.
const thumbnailCache = new Map(); // linkId -> { buffer, contentType, cachedAt }
const THUMBNAIL_CACHE_TTL_MS = 60 * 60 * 1000;

/**
 * Copies a freshly scraped thumbnail into Cloudinary and saves the stored
 * link on that snapshot. Never throws — a failure leaves the snapshot with
 * only the Instagram link, and the proxy fallback covers it until the next
 * scrape (the 6h cron re-scrapes pending links).
 */
export async function storePostThumbnail(snapshotId, linkId, thumbnailUrl) {
  if (!thumbnailUrl || !isCloudinaryConfigured()) return;
  try {
    const image = await downloadImage(thumbnailUrl, 3, "Instagram");
    thumbnailCache.set(linkId, { ...image, cachedAt: Date.now() });
    const storedUrl = await uploadPostThumbnail(linkId, image.buffer);
    await prisma.postSnapshot.update({ where: { id: snapshotId }, data: { thumbnailStoredUrl: storedUrl } });
  } catch (err) {
    console.error(`storePostThumbnail: couldn't store link ${linkId}'s thumbnail`, err);
  }
}

/**
 * What GET /links/:id/thumbnail serves: a redirect to the stored Cloudinary
 * copy when the latest snapshot has one, otherwise the proxied Instagram
 * bytes. 404 when no scrape has produced a thumbnail for this link yet.
 */
export async function getPostThumbnailSource(linkId) {
  const snapshot = await prisma.postSnapshot.findFirst({
    where: { linkId, thumbnailUrl: { not: null } },
    orderBy: { capturedAt: "desc" },
    select: { thumbnailUrl: true, thumbnailStoredUrl: true },
  });
  if (!snapshot) throw new ApiError(404, "NO_THUMBNAIL", "This post has no thumbnail yet");
  if (snapshot.thumbnailStoredUrl) return { redirect: snapshot.thumbnailStoredUrl };

  const cached = thumbnailCache.get(linkId);
  if (cached && Date.now() - cached.cachedAt < THUMBNAIL_CACHE_TTL_MS) {
    return { buffer: cached.buffer, contentType: cached.contentType };
  }
  try {
    const result = await downloadImage(snapshot.thumbnailUrl, 3, "Instagram");
    thumbnailCache.set(linkId, { ...result, cachedAt: Date.now() });
    return result;
  } catch (err) {
    throw new ApiError(502, "THUMBNAIL_FETCH_FAILED", `Couldn't fetch this post's thumbnail from Instagram after 3 attempts: ${err.message}`);
  }
}
