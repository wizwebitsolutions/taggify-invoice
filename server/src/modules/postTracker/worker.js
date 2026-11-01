import { prisma } from "../../lib/prisma.js";
import { uploadTrackedPostImage } from "../../lib/cloudinaryClient.js";
import { downloadImage } from "../../lib/downloadImage.js";
import { InProcessQueue } from "../bulkTrack/queue.js";
import { captureSnapshot, LoginWallError, PostUnavailableError } from "./capture.js";

/**
 * Post Tracker capture worker (24 Oct). One capture at a time with a pause
 * between them — this is an ordinary visitor's pace, not a crawl. Failures
 * that may pass (a login wall, a timeout) go back in the queue with a
 * growing delay; after MAX_ATTEMPTS the card shows why. A post Instagram
 * says is gone is flagged broken straight away.
 */
const GAP_MS = 4_000;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 2 * 60_000;

export const captureQueue = new InProcessQueue("post-tracker");

export function captureEnabled() {
  return process.env.POST_TRACKER_CAPTURE !== "off";
}

export async function enqueueCapture(postId) {
  if (!captureEnabled()) return;
  await captureQueue.add("capture", { postId });
}

export async function processCapture(postId) {
  const post = await prisma.trackedPost.findUnique({ where: { id: postId } });
  if (!post || post.archivedAt || post.captureStatus !== "queued") return;

  try {
    const snap = await captureSnapshot(post.canonicalUrl);
    const screenshotUrl = await uploadTrackedPostImage(post.id, "screen", snap.screenshot);
    let coverUrl = post.coverUrl;
    if (snap.coverImageUrl) {
      // The cover is a nice-to-have — a failed copy keeps the last one.
      coverUrl = await downloadImage(snap.coverImageUrl, 3, "Instagram")
        .then((img) => uploadTrackedPostImage(post.id, "cover", img.buffer))
        .catch(() => coverUrl);
    }
    await prisma.trackedPost.update({
      where: { id: postId },
      data: {
        captureStatus: "done",
        captureError: null,
        captureCount: 0,
        capturedAt: new Date(),
        screenshotUrl,
        coverUrl,
        ownerHandle: snap.ownerHandle,
        caption: snap.caption,
        postedOn: snap.postedOn,
        likeCount: snap.likeCount,
        commentCount: snap.commentCount,
        viewCount: snap.viewCount ?? null,
        broken: false,
      },
    });
  } catch (err) {
    if (err instanceof PostUnavailableError) {
      await prisma.trackedPost.update({ where: { id: postId }, data: { captureStatus: "unavailable", captureError: err.message, captureCount: 0, broken: true } });
      return;
    }
    const attempts = post.captureCount + 1;
    const message = err instanceof LoginWallError ? err.message : `Couldn't open the post (${err.message})`;
    if (attempts >= MAX_ATTEMPTS) {
      await prisma.trackedPost.update({ where: { id: postId }, data: { captureStatus: "failed", captureError: message, captureCount: attempts } });
      return;
    }
    await prisma.trackedPost.update({ where: { id: postId }, data: { captureError: message, captureCount: attempts } });
    setTimeout(() => enqueueCapture(postId).catch(() => {}), RETRY_BASE_MS * attempts).unref?.();
  }
}

/** Starts the queue and re-queues whatever a restart left waiting. */
export function startPostTrackerWorker() {
  if (!captureEnabled()) return;
  captureQueue.process(
    async ({ data }) => {
      try {
        await processCapture(data.postId);
      } finally {
        await new Promise((resolve) => setTimeout(resolve, GAP_MS));
      }
    },
    { concurrency: 1 }
  );
  prisma.trackedPost
    .findMany({ where: { captureStatus: "queued", archivedAt: null }, select: { id: true }, orderBy: { createdAt: "asc" } })
    .then((rows) => rows.forEach((r) => enqueueCapture(r.id)))
    .catch((err) => console.error("post-tracker: couldn't re-queue captures", err));
}
