import { prisma } from "../../lib/prisma.js";
import { ApifyInstagramProvider, PostNotFoundError } from "../../lib/apifyClient.js";
import { bulkTrackQueue } from "./queue.js";

/**
 * Bulk Tracker worker (12 Oct) — ported from affiliate-creator-tool's
 * jobs/bulkTrackWorker.js. Low, fixed concurrency: these are one-off scrapes
 * of arbitrary external accounts/posts (not our managed pages), so 2 at a
 * time keeps a 50-link batch from hammering Apify all at once.
 */
const CONCURRENCY = 2;

/**
 * Real Apify when a token is configured; otherwise (local dev without a
 * token, or BULK_TRACK_MOCK=true for e2e runs) synthetic results, so the UI
 * can be exercised without spending Apify credits. Production never mocks.
 */
export function useMock() {
  if (process.env.BULK_TRACK_MOCK === "true") return true;
  return !process.env.APIFY_TOKEN && process.env.NODE_ENV !== "production";
}

// Simulates all three real-world outcomes (reel / plain post / broken link)
// with a realistic-ish distribution, same as the source's mockPostMetrics.
function mockPostMetrics() {
  const roll = Math.random();
  if (roll < 0.08) throw new PostNotFoundError("Mock: simulated broken/deleted link");
  const isReel = roll > 0.28;
  const views = Math.floor(15000 + Math.random() * 205000);
  const likes = Math.floor(views * (0.04 + Math.random() * 0.06));
  return {
    videoPlayCount: isReel ? Math.floor(views * (1.5 + Math.random())) : 0,
    likeCount: likes,
    commentsCount: Math.floor(likes * (0.02 + Math.random() * 0.03)),
    shares: Math.floor(likes * 0.05),
    saves: Math.floor(likes * 0.1),
    reposts: Math.floor(likes * 0.02),
    postType: isReel ? "reel" : "post",
    pageName: "Mock Page " + Math.floor(Math.random() * 900 + 100),
    followers: null,
  };
}

function mockAccountMetrics() {
  return { followers: Math.floor(45000 + (Math.random() - 0.5) * 4000), fullName: null };
}

/**
 * apifyClient maps a hidden/absent count to -1 ("unknown") so the campaign
 * flow never reads it as a drop to zero. Bulk snapshots are plain Int
 * columns with no unknown marker (the source stored the -1 as-is, which then
 * showed as "-1" in the UI and export) — store 0 instead.
 */
export function count(v) {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
}

// weight = how many of the batch's rows this job settles (see enqueueProfile
// in service.js) — 0 or no batch means a refresh/backfill, or a profile whose
// rows are settled by their post jobs instead.
export async function bumpBatchCounters(batchId, ok, weight) {
  if (!batchId || !weight) return;
  await prisma.bulkImportBatch.update({
    where: { id: batchId },
    data: ok ? { successCount: { increment: weight } } : { failedCount: { increment: weight } },
  });
  const batch = await prisma.bulkImportBatch.findUnique({ where: { id: batchId } });
  if (batch && batch.successCount + batch.failedCount >= batch.totalCount) {
    await prisma.bulkImportBatch.update({ where: { id: batchId }, data: { status: "done" } });
  }
}

const RETRY_DELAY_MS = Number(process.env.BULK_TRACK_RETRY_DELAY_MS ?? 3000);

/**
 * One retry for a transient scrape failure (rate limit, actor timeout,
 * network) — the source's queue-level `attempts: 2` never fired because its
 * handlers swallowed every error. A broken link (PostNotFoundError) is
 * permanent and isn't retried.
 */
async function scrapeWithRetry(fn) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof PostNotFoundError) throw err;
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    return fn();
  }
}

/**
 * Settles the row's counter claim exactly once: the claim is read off the
 * row (so a restart can't lose or invent it) and cleared before counting,
 * outside the scrape's try/catch so a counter write can't be double-counted
 * as a failure.
 */
async function settleClaim(model, row, ok) {
  const { pendingBatchId, pendingWeight } = row;
  if (!pendingBatchId) return;
  await prisma[model].update({ where: { id: row.id }, data: { pendingBatchId: null, pendingWeight: 0 } });
  await bumpBatchCounters(pendingBatchId, ok, pendingWeight);
}

export async function processProfile(profileId) {
  const profile = await prisma.bulkTrackedProfile.findUnique({ where: { id: profileId } });
  if (!profile) return;
  let ok = true;
  try {
    const metrics = await scrapeWithRetry(() => (useMock() ? mockAccountMetrics() : ApifyInstagramProvider.getAccountMetrics(profile.username)));
    await prisma.bulkTrackedProfileSnapshot.create({ data: { profileId: profile.id, followers: count(metrics.followers) } });
    await prisma.bulkTrackedProfile.update({
      where: { id: profile.id },
      data: { status: "done", failureReason: null, pageName: metrics.fullName ?? profile.pageName },
    });
  } catch (err) {
    ok = false;
    await prisma.bulkTrackedProfile.update({ where: { id: profile.id }, data: { status: "failed", failureReason: err.message } });
  }
  await settleClaim("bulkTrackedProfile", profile, ok);
}

export async function processPost(postId) {
  const post = await prisma.bulkTrackedPost.findUnique({ where: { id: postId } });
  if (!post) return;
  let ok = true;
  try {
    // Our getPostMetrics never rejects a zero-play scrape (the source's
    // allowZeroPlays: true) — a photo/carousel post legitimately has none.
    const metrics = await scrapeWithRetry(() => (useMock() ? mockPostMetrics() : ApifyInstagramProvider.getPostMetrics(post.permalink)));
    await prisma.bulkTrackedPostSnapshot.create({
      data: {
        postId: post.id,
        views: count(metrics.videoPlayCount),
        likes: count(metrics.likeCount),
        comments: count(metrics.commentsCount),
        shares: count(metrics.shares),
        reposts: count(metrics.reposts),
        saves: count(metrics.saves),
        pageName: metrics.pageName ?? null,
        followers: metrics.followers ?? null,
      },
    });
    await prisma.bulkTrackedPost.update({ where: { id: post.id }, data: { status: "done", postType: metrics.postType ?? null, failureReason: null } });
  } catch (err) {
    ok = false;
    // A broken/deleted/private link is a distinct, permanent outcome — not a
    // transient failure like a rate limit or auth issue — so its own status.
    const isBroken = err instanceof PostNotFoundError;
    await prisma.bulkTrackedPost.update({
      where: { id: post.id },
      data: { status: isBroken ? "broken" : "failed", failureReason: err.message },
    });
  }
  await settleClaim("bulkTrackedPost", post, ok);
}

export async function processJob(job) {
  const { kind, profileId, postId } = job.data;
  if (kind === "profile") return processProfile(profileId);
  if (kind === "post") return processPost(postId);
}

/**
 * Queue a scrape. `countBatchId` + `weight` (how many of that batch's rows
 * this job settles — see service.js importRowsAsBatch) are stored on the
 * row; none = a refresh/backfill that must not touch any batch's counters,
 * which also clears a stale claim.
 */
export async function enqueueProfile(profileId, { countBatchId = null, weight = 0 } = {}) {
  await prisma.bulkTrackedProfile.update({ where: { id: profileId }, data: { pendingBatchId: weight ? countBatchId : null, pendingWeight: countBatchId ? weight : 0 } });
  await bulkTrackQueue.add("track", { kind: "profile", profileId });
}
export async function enqueuePost(postId, { countBatchId = null, weight = 0 } = {}) {
  await prisma.bulkTrackedPost.update({ where: { id: postId }, data: { pendingBatchId: weight ? countBatchId : null, pendingWeight: countBatchId ? weight : 0 } });
  await bulkTrackQueue.add("track", { kind: "post", postId });
}

/**
 * The queue is in-memory, so a restart (deploy, Render sleep) drops every
 * job in flight — the source left those rows "queued" and their batch
 * "running" forever. On boot, re-queue every still-queued row; its counter
 * claim is already on the row, so batch progress comes out exactly right.
 */
export async function recoverQueuedRows() {
  const [profiles, posts] = await Promise.all([
    prisma.bulkTrackedProfile.findMany({ where: { status: "queued" }, select: { id: true } }),
    prisma.bulkTrackedPost.findMany({ where: { status: "queued" }, select: { id: true } }),
  ]);
  for (const p of profiles) await bulkTrackQueue.add("track", { kind: "profile", profileId: p.id });
  for (const p of posts) await bulkTrackQueue.add("track", { kind: "post", postId: p.id });
  if (profiles.length + posts.length > 0) console.log(`[BulkTrackWorker] re-queued ${profiles.length} profile(s), ${posts.length} post(s) after restart`);
}

export function startBulkTrackWorker() {
  bulkTrackQueue.process(processJob, { concurrency: CONCURRENCY });
  console.log(`[BulkTrackWorker] Started (concurrency=${CONCURRENCY}${useMock() ? ", mock scrapes" : ""})`);
  recoverQueuedRows().catch((err) => console.error("[BulkTrackWorker] recoverQueuedRows failed", err));
}
