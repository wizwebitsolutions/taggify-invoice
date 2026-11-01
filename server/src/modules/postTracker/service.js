import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../middleware/errorHandler.js";
import { parseInstagramPostUrl, urlsFor } from "./url.js";
import { enqueueCapture } from "./worker.js";

/**
 * Post Tracker (24 Oct). A card is a cleaned-up link plus a snapshot of its
 * public page (worker.js / capture.js: phone-size screenshot, cover image,
 * likes and comments), captured in the background after the link is added.
 * The browser also shows Instagram's own embed of it.
 *
 * `user` is routes.js's req.trackerUser: { id, seesAll }. Everyone works on
 * their own cards; a full admin can also see (and tidy) everyone's.
 */

const withCreator = { createdBy: { select: { id: true, name: true, email: true } } };

function toDto(post) {
  const { embedUrl } = urlsFor(post.shortcode, post.kind);
  return {
    id: post.id,
    shortcode: post.shortcode,
    kind: post.kind,
    canonicalUrl: post.canonicalUrl,
    embedUrl,
    note: post.note,
    broken: post.broken,
    archivedAt: post.archivedAt,
    createdAt: post.createdAt,
    createdBy: post.createdBy ? { id: post.createdBy.id, name: post.createdBy.name ?? post.createdBy.email ?? null } : null,
    snapshot: {
      status: post.captureStatus,
      error: post.captureError,
      capturedAt: post.capturedAt,
      screenshotUrl: post.screenshotUrl,
      coverUrl: post.coverUrl,
      ownerHandle: post.ownerHandle,
      caption: post.caption,
      postedOn: post.postedOn,
      likeCount: post.likeCount,
      commentCount: post.commentCount,
      viewCount: post.viewCount,
    },
  };
}

/**
 * Adds every valid line as a card. Per line the result is "created",
 * "existing" (already tracked — re-pasting an archived one brings it back)
 * or "rejected" with a reason, so the page can say exactly what happened.
 */
export async function addPosts(user, { urls, note }) {
  const lines = urls.map((input) => ({ input, parsed: parseInstagramPostUrl(input) }));
  const valid = new Map(); // shortcode -> first parsed line with it
  for (const { parsed } of lines) if (parsed.ok && !valid.has(parsed.shortcode)) valid.set(parsed.shortcode, parsed);

  const shortcodes = [...valid.keys()];
  const before = shortcodes.length
    ? await prisma.trackedPost.findMany({ where: { createdById: user.id, shortcode: { in: shortcodes } }, select: { shortcode: true } })
    : [];
  const existed = new Set(before.map((p) => p.shortcode));

  const toCreate = shortcodes.filter((code) => !existed.has(code));
  if (toCreate.length) {
    await prisma.trackedPost.createMany({
      data: toCreate.map((code) => {
        const p = valid.get(code);
        const input = lines.find((l) => l.parsed.ok && l.parsed.shortcode === code).input;
        return { createdById: user.id, inputUrl: input.trim().slice(0, 2000), canonicalUrl: p.canonicalUrl, shortcode: code, kind: p.kind, note: note || null };
      }),
      // Two tabs pasting the same link at once: the unique key settles it.
      skipDuplicates: true,
    });
    const fresh = await prisma.trackedPost.findMany({ where: { createdById: user.id, shortcode: { in: toCreate } }, select: { id: true } });
    for (const { id } of fresh) await enqueueCapture(id);
  }
  if (existed.size) {
    await prisma.trackedPost.updateMany({ where: { createdById: user.id, shortcode: { in: [...existed] }, archivedAt: { not: null } }, data: { archivedAt: null } });
  }

  const created = new Set(toCreate);
  const seen = new Set();
  const results = lines.map(({ input, parsed }) => {
    if (!parsed.ok) return { input, result: "rejected", reason: parsed.reason };
    const repeat = seen.has(parsed.shortcode);
    seen.add(parsed.shortcode);
    return { input, shortcode: parsed.shortcode, result: created.has(parsed.shortcode) && !repeat ? "created" : "existing" };
  });
  return {
    results,
    created: results.filter((r) => r.result === "created").length,
    existing: results.filter((r) => r.result === "existing").length,
    rejected: results.filter((r) => r.result === "rejected").length,
  };
}

const STATUS_WHERE = {
  all: { archivedAt: null },
  ok: { archivedAt: null, broken: false },
  broken: { archivedAt: null, broken: true },
  archived: { archivedAt: { not: null } },
};

export async function listPosts(user, { status, q, addedBy, page, pageSize }) {
  const owner = user.seesAll ? (addedBy ? { createdById: addedBy } : {}) : { createdById: user.id };
  const search = q ? { OR: [{ note: { contains: q, mode: "insensitive" } }, { shortcode: { contains: q } }] } : {};
  const where = { ...owner, ...search, ...STATUS_WHERE[status] };

  const [items, ...counts] = await Promise.all([
    prisma.trackedPost.findMany({ where, include: withCreator, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    ...Object.values(STATUS_WHERE).map((s) => prisma.trackedPost.count({ where: { ...owner, ...search, ...s } })),
  ]);
  const byStatus = Object.fromEntries(Object.keys(STATUS_WHERE).map((key, i) => [key, counts[i]]));
  return { items: items.map(toDto), total: byStatus[status], page, pageSize, counts: byStatus };
}

async function findOwn(user, id) {
  const post = await prisma.trackedPost.findUnique({ where: { id } });
  // Someone else's card reads as missing, not forbidden — no probing for ids.
  if (!post || (!user.seesAll && post.createdById !== user.id)) throw new ApiError(404, "TRACKED_POST_NOT_FOUND", "Post not found");
  return post;
}

export async function updatePost(user, id, { note, broken, archived }) {
  await findOwn(user, id);
  const data = {};
  if (note !== undefined) data.note = note || null;
  if (broken !== undefined) data.broken = broken;
  if (archived !== undefined) data.archivedAt = archived ? new Date() : null;
  return toDto(await prisma.trackedPost.update({ where: { id }, data, include: withCreator }));
}

/** A re-capture can't be asked for more often than this per card — each one opens Instagram. */
export const RECAPTURE_COOLDOWN_MS = 10 * 60_000;

export async function recapture(user, id) {
  const post = await findOwn(user, id);
  if (post.captureStatus === "queued") throw new ApiError(409, "CAPTURE_PENDING", "This snapshot is already being taken");
  if (post.capturedAt && Date.now() - new Date(post.capturedAt).getTime() < RECAPTURE_COOLDOWN_MS) {
    throw new ApiError(429, "CAPTURE_TOO_SOON", "This snapshot was taken less than 10 minutes ago — try again later");
  }
  const updated = await prisma.trackedPost.update({ where: { id }, data: { captureStatus: "queued", captureError: null, captureCount: 0 }, include: withCreator });
  await enqueueCapture(id);
  return toDto(updated);
}

export async function deletePost(user, id) {
  const post = await findOwn(user, id);
  // Same rule as the card menu: archive first, so one click can't lose a live card.
  if (!post.archivedAt) throw new ApiError(409, "ARCHIVE_FIRST", "Archive this post before deleting it");
  await prisma.trackedPost.delete({ where: { id } });
  return { ok: true };
}
