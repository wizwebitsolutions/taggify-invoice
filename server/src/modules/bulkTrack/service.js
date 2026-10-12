import ExcelJS from "exceljs";

import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../middleware/errorHandler.js";
import { enqueuePost, enqueueProfile } from "./worker.js";
import { fetchSheetRows, parseSheetUrl } from "./googleSheet.js";

/**
 * Bulk Tracker (12 Oct) — market-research Instagram scraping, ported from
 * wizwebitsolutions/affiliate-creator-tool's controllers/bulkTrack.controller.js
 * (same logic, same response shapes). Nothing here touches Asset, Link,
 * Campaign or payouts.
 *
 * Who sees what: a full (unrestricted) admin sees every batch / sheet / post
 * (the source's `isAdmin`); anyone else granted `bulkTrack.view` — a
 * restricted sub-admin included — sees only rows they created. `user` is
 * routes.js's req.bulkUser: { id, seesAll }.
 */

// Caps how many rows a single Google Sheet import (initial connect or a
// "Check now") pulls in at once. Manual paste has its own 50/50 cap in schemas.js.
export const MAX_LINKS_PER_BATCH = 100;

export function extractUsername(profileUrl) {
  const m = profileUrl.match(/instagram\.com\/([a-zA-Z0-9_.]+)/i);
  if (!m) return null;
  const candidate = m[1].toLowerCase();
  if (["p", "reel", "reels", "tv", "stories", "explore"].includes(candidate)) return null;
  return m[1];
}

export function isPostUrl(url) {
  return /instagram\.com\/(reels?|p)\//i.test(url);
}

// Sheet "Followers" cells vary in format — plain digits or comma-grouped
// ("2300000" vs "1,400,000") — strip everything but digits before parsing.
export function parseFollowerCount(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/[^0-9]/g, "");
  if (!digits) return null;
  const n = parseInt(digits, 10);
  return Number.isFinite(n) ? n : null;
}

const isAdmin = (user) => user?.seesAll === true;
const ownWhere = (user, field) => (isAdmin(user) ? {} : { [field]: user.id });

// Older sources (and test fixtures) predate the flags — both on, as before.
function fetchFlags(source) {
  return { followers: source.fetchFollowers !== false, engagement: source.fetchEngagement !== false };
}

const latest = { orderBy: { capturedAt: "desc" }, take: 1 };

function postRow(p) {
  const s = p.snapshots[0];
  return {
    id: p.id,
    permalink: p.permalink,
    status: p.status,
    postType: p.postType,
    failureReason: p.failureReason,
    views: s?.views ?? null,
    likes: s?.likes ?? null,
    comments: s?.comments ?? null,
    shares: s?.shares ?? null,
    reposts: s?.reposts ?? null,
    saves: s?.saves ?? null,
  };
}

/** Manual paste — up to 50 profile links + 50 post links in one submission. */
export async function createManualBatch(user, { profileLinks = [], postLinks = [] }) {
  if (profileLinks.length === 0 && postLinks.length === 0) {
    throw new ApiError(400, "EMPTY_BATCH", "Add at least one profile or post link");
  }

  const validProfiles = profileLinks.map((url) => ({ url, username: extractUsername(url) })).filter((p) => p.username);
  const validPosts = postLinks.filter(isPostUrl);

  // A batch with 0 valid rows would never get a job to flip it off "running".
  if (validProfiles.length === 0 && validPosts.length === 0) {
    throw new ApiError(400, "NO_VALID_LINKS", "None of the links you pasted look like valid Instagram profile or post URLs");
  }

  const batch = await prisma.bulkImportBatch.create({
    data: { createdByUserId: user.id, sourceType: "manual", totalCount: validProfiles.length + validPosts.length },
  });
  const profiles = await Promise.all(
    validProfiles.map((p) => prisma.bulkTrackedProfile.create({ data: { username: p.username, profileUrl: p.url, addedByUserId: user.id, batchId: batch.id } }))
  );
  const posts = await Promise.all(validPosts.map((permalink) => prisma.bulkTrackedPost.create({ data: { permalink, addedByUserId: user.id, batchId: batch.id } })));

  await Promise.all([
    ...profiles.map((p) => enqueueProfile(p.id, { countBatchId: batch.id, weight: 1 })),
    ...posts.map((p) => enqueuePost(p.id, { countBatchId: batch.id, weight: 1 })),
  ]);

  return {
    batchId: batch.id,
    queued: { profiles: profiles.length, posts: posts.length },
    skipped: { profiles: profileLinks.length - validProfiles.length, posts: postLinks.length - validPosts.length },
  };
}

export async function listBatches(user) {
  return prisma.bulkImportBatch.findMany({
    where: ownWhere(user, "createdByUserId"),
    include: { sheetSource: { select: { sheetUrl: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

export async function loadBatch(user, id) {
  const batch = await prisma.bulkImportBatch.findUnique({ where: { id } });
  if (!batch) throw new ApiError(404, "BATCH_NOT_FOUND", "Batch not found");
  if (!isAdmin(user) && batch.createdByUserId !== user.id) throw new ApiError(403, "FORBIDDEN", "Forbidden");
  return batch;
}

export async function getBatch(user, id) {
  const batch = await loadBatch(user, id);
  const [profiles, posts] = await Promise.all([
    prisma.bulkTrackedProfile.findMany({ where: { batchId: batch.id }, include: { snapshots: latest }, orderBy: { createdAt: "asc" } }),
    prisma.bulkTrackedPost.findMany({ where: { batchId: batch.id }, include: { snapshots: latest }, orderBy: { createdAt: "asc" } }),
  ]);
  return {
    batch,
    profiles: profiles.map((p) => ({
      id: p.id,
      username: p.username,
      profileUrl: p.profileUrl,
      category: p.category,
      status: p.status,
      failureReason: p.failureReason,
      followers: p.snapshots[0]?.followers ?? null,
    })),
    posts: posts.map(postRow),
  };
}

/**
 * Re-scrapes every "done" post in this batch — broken/failed posts are
 * skipped (retrying just spends an Apify call on something that will fail
 * again). Doesn't touch the batch's counters — no countBatchId on the jobs.
 */
export async function refreshBatchPosts(user, id) {
  const batch = await loadBatch(user, id);
  return requeueDonePosts({ batchId: batch.id, status: "done" });
}

async function requeueDonePosts(where) {
  const posts = await prisma.bulkTrackedPost.findMany({ where, select: { id: true } });
  if (posts.length === 0) return { queued: 0 };
  await prisma.bulkTrackedPost.updateMany({ where: { id: { in: posts.map((p) => p.id) } }, data: { status: "queued" } });
  await Promise.all(posts.map((p) => enqueuePost(p.id)));
  return { queued: posts.length };
}

function postsFilter(user, { source, sheetSourceId }) {
  if (source === "sheet" && !sheetSourceId) throw new ApiError(400, "SHEET_SOURCE_REQUIRED", "sheetSourceId is required when source=sheet");
  return { ...ownWhere(user, "addedByUserId"), sheetSourceId: source === "sheet" ? sheetSourceId : null };
}

/**
 * Every tracked post matching the filter, across all batches — a sheet
 * that's been re-checked repeatedly shows as one list.
 */
export async function listAllPosts(user, query) {
  const posts = await prisma.bulkTrackedPost.findMany({
    where: postsFilter(user, query),
    include: { snapshots: latest },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  return posts.map((p) => ({ ...postRow(p), createdAt: p.createdAt }));
}

/** The Posts tab's floating refresh button — same rules as refreshBatchPosts, scoped by filter. */
export async function refreshAllPosts(user, query) {
  return requeueDonePosts({ ...postsFilter(user, query), status: "done" });
}

// Live count from the linked profile's latest scrape wins; the sheet's own
// Followers cell is the fallback. A 0 snapshot is a scrape that returned no
// count, not a real page with zero followers — fall through to the sheet value.
export function resolveFollowers(post) {
  const scraped = post.profile?.snapshots?.[0]?.followers;
  return scraped ? scraped : (post.followers ?? null);
}

export const STATUS_LABEL = { queued: "Queued", done: "Done", failed: "Failed", broken: "Broken Link", not_fetched: "Not fetched" };

const HEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2568C4" } };
const HEADER_FONT = { bold: true, color: { argb: "FFFFFFFF" } };

/**
 * .xlsx export of one batch — one row per tracked post, then one row per
 * profile that has no post in this batch (page columns only). Page Name
 * prefers the sheet's own column; Apify's scraped name is the fallback.
 * Returns { filename, workbook } — the route streams it.
 */
export async function buildBatchExport(user, id) {
  const batch = await loadBatch(user, id);
  const posts = await prisma.bulkTrackedPost.findMany({
    where: { batchId: batch.id },
    include: { snapshots: latest, profile: { include: { snapshots: latest } } },
    orderBy: { createdAt: "asc" },
  });
  const profileOnly = await prisma.bulkTrackedProfile.findMany({
    where: { batchId: batch.id, posts: { none: { batchId: batch.id } } },
    include: { snapshots: latest },
    orderBy: { createdAt: "asc" },
  });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Taggify";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("Bulk Track Export");
  sheet.columns = [
    { header: "Page Name", key: "pageName", width: 24 },
    { header: "Page Link", key: "pageLink", width: 34 },
    { header: "Followers", key: "followers", width: 12 },
    { header: "Date", key: "date", width: 16 },
    { header: "Posted Links", key: "postedLinks", width: 42 },
    { header: "Views", key: "views", width: 12 },
    { header: "Likes", key: "likes", width: 12 },
    { header: "Comments", key: "comments", width: 12 },
    { header: "Shares", key: "shares", width: 12 },
    { header: "Reposts", key: "reposts", width: 12 },
    { header: "Saves", key: "saves", width: 12 },
    { header: "Status", key: "status", width: 14 },
    { header: "Failure Reason", key: "failureReason", width: 32 },
    { header: "Captured At", key: "capturedAt", width: 22 },
  ];
  const headerRow = sheet.getRow(1);
  headerRow.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: "middle" };
  });
  headerRow.height = 20;
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: "A1", to: "N1" };

  for (const p of posts) {
    const s = p.snapshots[0];
    sheet.addRow({
      pageName: p.pageName ?? s?.pageName ?? p.profile?.pageName ?? "",
      pageLink: p.pageLink ?? "",
      followers: resolveFollowers(p) ?? "",
      date: p.postedDate ?? "",
      postedLinks: p.permalink,
      views: s?.views ?? "",
      likes: s?.likes ?? "",
      comments: s?.comments ?? "",
      shares: s?.shares ?? "",
      reposts: s?.reposts ?? "",
      saves: s?.saves ?? "",
      status: STATUS_LABEL[p.status] ?? p.status,
      failureReason: p.failureReason ?? "",
      capturedAt: s?.capturedAt?.toISOString() ?? "",
    });
  }
  for (const p of profileOnly) {
    const s = p.snapshots[0];
    sheet.addRow({
      pageName: p.pageName ?? p.username,
      pageLink: p.profileUrl,
      followers: s?.followers || "",
      status: STATUS_LABEL[p.status] ?? p.status,
      failureReason: p.failureReason ?? "",
      capturedAt: s?.capturedAt?.toISOString() ?? "",
    });
  }

  return { filename: `bulk-track-${batch.id}.xlsx`, workbook };
}

/**
 * Removes one batch and every profile/post (snapshots cascade) imported
 * through it. A sheet batch's rows will be re-imported by the next "Check
 * now" — the correct behaviour for a deliberate re-track.
 */
export async function deleteBatch(user, id) {
  const batch = await loadBatch(user, id);
  const deleted = await prisma.$transaction(async (tx) => {
    const posts = await tx.bulkTrackedPost.deleteMany({ where: { batchId: batch.id } });
    const profiles = await tx.bulkTrackedProfile.deleteMany({ where: { batchId: batch.id } });
    await tx.bulkImportBatch.delete({ where: { id: batch.id } });
    return { posts: posts.count, profiles: profiles.count };
  });
  return { success: true, deleted };
}

/**
 * The service account that reads these sheets also writes Taggify's own
 * finance export, and may be able to read internal plan sheets — so those
 * are refused outright: Bulk Tracker is for outside research sheets only.
 */
async function assertNotInternalSheet(sheetUrl) {
  let sheetId;
  try {
    sheetId = parseSheetUrl(sheetUrl).sheetId;
  } catch (err) {
    throw new ApiError(400, "SHEET_READ_FAILED", err.message);
  }
  const internal =
    (Boolean(process.env.GOOGLE_FINANCE_SPREADSHEET_ID) && sheetId === process.env.GOOGLE_FINANCE_SPREADSHEET_ID) ||
    (await prisma.plan.findFirst({ where: { internalSheetUrl: { contains: `/d/${sheetId}` } }, select: { id: true } }));
  if (internal) throw new ApiError(403, "INTERNAL_SHEET", "That's one of Taggify's own internal sheets — Bulk Tracker only imports outside research sheets.");
}

/** A sheet read failure is the user's to fix (sharing, URL, tab) — 400 with Google's reason, as in the source. */
async function readSheet(sheetUrl, gid) {
  await assertNotInternalSheet(sheetUrl);
  try {
    return await fetchSheetRows(sheetUrl, gid);
  } catch (err) {
    throw new ApiError(400, "SHEET_READ_FAILED", err.message);
  }
}

export async function previewSheet({ sheetUrl, gid }) {
  const { headers, rows } = await readSheet(sheetUrl, gid);
  // rows (capped at one import) let the connect form count importable rows
  // and estimate Apify calls live as columns/fetch options change.
  return { headers, sampleRow: rows[0] ?? null, rowCount: rows.length, rows: rows.slice(0, MAX_LINKS_PER_BATCH) };
}

// The profile-link cell of a sheet row, as a username — null when no profile
// column is mapped, the cell is empty, or it isn't a profile URL.
function rowProfile(source, row) {
  if (!source.profileLinkCol) return null;
  const url = row[source.profileLinkCol];
  if (!url) return null;
  const username = extractUsername(url);
  return username ? { url, username } : null;
}

/**
 * One BulkTrackedProfile per (sheet source, username) — a sheet with 100 rows
 * from 20 pages costs 20 profile scrapes, not 100. `cache` (lowercased
 * username -> profile) is shared across a whole import.
 */
async function ensureSheetProfile({ source, userId, batchId, cache, url, username, category }) {
  const key = username.toLowerCase();
  const existing = cache.get(key);
  if (existing) return { profile: existing, isNew: false };
  const profile = await prisma.bulkTrackedProfile.create({
    data: { username, profileUrl: url, category: category || null, addedByUserId: userId, sheetSourceId: source.id, batchId },
  });
  cache.set(key, profile);
  return { profile, isNew: true };
}

async function loadSheetProfileCache(sourceId) {
  const existing = await prisma.bulkTrackedProfile.findMany({ where: { sheetSourceId: sourceId } });
  return new Map(existing.map((p) => [p.username.toLowerCase(), p]));
}

// What a sheet row gives Apify to do under this source's fetch flags. A row
// is only imported when there's something to fetch for it: a post link with
// engagement on, or a profile link with followers on.
function rowTargets(source, row) {
  const { followers, engagement } = fetchFlags(source);
  const postUrl = source.postLinkCol ? row[source.postLinkCol] : null;
  const hasPost = Boolean(postUrl) && isPostUrl(postUrl);
  const prof = followers ? rowProfile(source, row) : null;
  return { postUrl, hasPost, prof, engagement, importable: (engagement && hasPost) || Boolean(prof) };
}

/**
 * Imports sheet rows as one batch. A batch's progress counts sheet rows, not
 * jobs — so each job says which batch it reports to (countBatchId) and how
 * many of that batch's rows it settles (weight): a post job settles its own
 * row; a profile job settles only the rows that have no post job.
 */
export async function importRowsAsBatch({ source, rows, userId, sourceType }) {
  const toImport = rows.slice(0, MAX_LINKS_PER_BATCH);
  const batch = await prisma.bulkImportBatch.create({ data: { createdByUserId: userId, sourceType, sheetSourceId: source.id, totalCount: 0 } });

  const cache = await loadSheetProfileCache(source.id);
  const profileWork = new Map(); // profileId -> { profile, isNew, weight }
  const createdPosts = [];
  const scrapedPosts = [];
  let rowCount = 0;

  for (const row of toImport) {
    const { postUrl, hasPost, prof, engagement, importable } = rowTargets(source, row);
    if (!importable) continue;
    rowCount++;

    let profile = null;
    if (prof) {
      const res = await ensureSheetProfile({
        source,
        userId,
        batchId: batch.id,
        cache,
        url: prof.url,
        username: prof.username,
        category: source.categoryCol ? row[source.categoryCol] : null,
      });
      profile = res.profile;
      const work = profileWork.get(profile.id) ?? { profile, isNew: res.isNew, weight: 0 };
      if (!(engagement && hasPost)) work.weight++;
      profileWork.set(profile.id, work);
    }

    if (!hasPost) continue;
    const post = await prisma.bulkTrackedPost.create({
      data: {
        permalink: postUrl,
        profileId: profile?.id ?? null,
        pageLink: source.profileLinkCol ? row[source.profileLinkCol] || null : null,
        pageName: source.pageNameCol ? row[source.pageNameCol] || null : null,
        followers: source.followersCol ? parseFollowerCount(row[source.followersCol]) : null,
        postedDate: source.dateCol ? row[source.dateCol] || null : null,
        ...(engagement ? {} : { status: "not_fetched" }),
        addedByUserId: userId,
        sheetSourceId: source.id,
        batchId: batch.id,
      },
    });
    createdPosts.push(post);
    if (engagement) scrapedPosts.push(post);
  }

  // New profiles are always scraped; one that failed earlier is retried. A
  // reused profile that's done (or in flight from its own batch) isn't
  // re-scraped — the rows it would settle here count as done straight away.
  const profileJobs = [];
  let settledNow = 0;
  for (const { profile, isNew, weight } of profileWork.values()) {
    if (isNew || profile.status === "failed") profileJobs.push({ id: profile.id, weight });
    else settledNow += weight;
  }

  await prisma.bulkImportBatch.update({
    where: { id: batch.id },
    data: {
      totalCount: rowCount,
      ...(settledNow ? { successCount: settledNow } : {}),
      ...(settledNow >= rowCount ? { status: "done" } : {}),
    },
  });

  await Promise.all([
    ...profileJobs.map((p) => enqueueProfile(p.id, p.weight ? { countBatchId: batch.id, weight: p.weight } : {})),
    ...scrapedPosts.map((p) => enqueuePost(p.id, { countBatchId: batch.id, weight: 1 })),
  ]);
  const profileCount = [...profileWork.values()].filter((w) => w.isNew).length;
  return { batch, rowCount, profileCount, postCount: createdPosts.length };
}

/**
 * Sheet posts with a stored pageLink but no linked profile get linked
 * (creating/reusing profiles), so "Check now" repairs an existing source.
 * Profiles created here belong to no batch, so their jobs touch no counters.
 */
async function backfillSheetProfiles(source, rows) {
  const unlinked = await prisma.bulkTrackedPost.findMany({
    where: { sheetSourceId: source.id, profileId: null, pageLink: { not: null } },
    select: { id: true, permalink: true, pageLink: true },
  });
  if (unlinked.length === 0) return 0;

  const rowByPost = new Map();
  if (source.postLinkCol) for (const r of rows) rowByPost.set(r[source.postLinkCol], r);

  const cache = await loadSheetProfileCache(source.id);
  const created = [];
  let linked = 0;
  for (const post of unlinked) {
    const username = extractUsername(post.pageLink);
    if (!username) continue;
    const row = rowByPost.get(post.permalink);
    const { profile, isNew } = await ensureSheetProfile({
      source,
      userId: source.addedByUserId,
      batchId: null,
      cache,
      url: post.pageLink,
      username,
      category: row && source.categoryCol ? row[source.categoryCol] : null,
    });
    if (isNew) created.push(profile);
    await prisma.bulkTrackedPost.update({ where: { id: post.id }, data: { profileId: profile.id } });
    linked++;
  }
  await Promise.all(created.map((p) => enqueueProfile(p.id)));
  return linked;
}

export async function createSheetSource(user, body) {
  const { sheetUrl, gid, name, profileLinkCol, postLinkCol, categoryCol, followersCol, dateCol, pageNameCol, fetchFollowers, fetchEngagement } = body;
  if (!profileLinkCol && !postLinkCol) throw new ApiError(400, "NO_LINK_COLUMN", "Map at least one of profileLinkCol or postLinkCol");
  // Each ticked fetch needs the column it scrapes from, or it'd silently fetch nothing.
  if (fetchFollowers && !profileLinkCol && !fetchEngagement) throw new ApiError(400, "NO_PROFILE_COLUMN", "Fetching followers needs a profile link column mapped");
  if (fetchEngagement && !postLinkCol && !fetchFollowers) throw new ApiError(400, "NO_POST_COLUMN", "Fetching post engagement needs a post link column mapped");

  // A URL like ".../edit?gid=123456" already carries the tab. When neither is
  // given, fetchSheetRows resolves the real first-tab gid — storing that keeps
  // every later "Check now" pointed at the same tab this import read.
  let parsedGid;
  try {
    parsedGid = parseSheetUrl(sheetUrl).gid;
  } catch (err) {
    throw new ApiError(400, "SHEET_READ_FAILED", err.message);
  }
  const { rows, gid: resolvedGid } = await readSheet(sheetUrl, gid ?? parsedGid);

  const source = await prisma.bulkImportSheetSource.create({
    data: {
      addedByUserId: user.id,
      name: name?.trim() || null,
      sheetUrl,
      gid: resolvedGid,
      profileLinkCol,
      postLinkCol,
      categoryCol,
      followersCol,
      dateCol,
      pageNameCol,
      fetchFollowers,
      fetchEngagement,
      lastCheckedAt: new Date(),
    },
  });

  const result = await importRowsAsBatch({ source, rows, userId: user.id, sourceType: "sheet" });
  return { sheetSourceId: source.id, batchId: result.batch.id, imported: { rows: result.rowCount, profiles: result.profileCount, posts: result.postCount } };
}

/** Newest first; the Connected Sheets panel shows 5, or 20 a page after "See more". */
export async function listSheetSources(user, { page, pageSize }) {
  const where = ownWhere(user, "addedByUserId");
  const [sources, total] = await Promise.all([
    prisma.bulkImportSheetSource.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.bulkImportSheetSource.count({ where }),
  ]);
  return { sources, total };
}

async function loadSheetSource(user, id) {
  const source = await prisma.bulkImportSheetSource.findUnique({ where: { id } });
  if (!source) throw new ApiError(404, "SHEET_SOURCE_NOT_FOUND", "Sheet source not found");
  if (!isAdmin(user) && source.addedByUserId !== user.id) throw new ApiError(403, "FORBIDDEN", "Forbidden");
  return source;
}

/**
 * Removes the source and every profile/post/batch imported through it — in
 * dependency order, since only snapshots cascade at the DB level.
 */
export async function deleteSheetSource(user, id) {
  const source = await loadSheetSource(user, id);
  const deleted = await prisma.$transaction(async (tx) => {
    const posts = await tx.bulkTrackedPost.deleteMany({ where: { sheetSourceId: source.id } });
    const profiles = await tx.bulkTrackedProfile.deleteMany({ where: { sheetSourceId: source.id } });
    const batches = await tx.bulkImportBatch.deleteMany({ where: { sheetSourceId: source.id } });
    await tx.bulkImportSheetSource.delete({ where: { id: source.id } });
    return { posts: posts.count, profiles: profiles.count, batches: batches.count };
  });
  return { success: true, deleted };
}

/**
 * Diffs a sheet's current rows against every link already imported under it
 * (new rows only — edits to existing rows are ignored), imports new rows as
 * a fresh batch, and stamps lastCheckedAt.
 */
export async function checkSheetSourceForNewRows(source) {
  const { rows } = await readSheet(source.sheetUrl, source.gid);

  const existingPosts = await prisma.bulkTrackedPost.findMany({ where: { sheetSourceId: source.id }, select: { permalink: true } });
  const seenPosts = new Set(existingPosts.map((p) => p.permalink));
  const existingProfiles = await prisma.bulkTrackedProfile.findMany({ where: { sheetSourceId: source.id }, select: { username: true } });
  const seenProfiles = new Set(existingProfiles.map((p) => p.username.toLowerCase()));

  // New = its post link isn't imported yet, or (no usable post link) its
  // profile isn't tracked yet. Rows the fetch flags give nothing to do are
  // never new, or every recheck would re-find them.
  const newRows = rows.filter((row) => {
    const { postUrl, hasPost, prof, importable } = rowTargets(source, row);
    if (!importable) return false;
    if (hasPost) return !seenPosts.has(postUrl);
    return !seenProfiles.has(prof.username.toLowerCase());
  });

  // Before importing, so posts created below (already linked) aren't rescanned.
  if (fetchFlags(source).followers) await backfillSheetProfiles(source, rows);

  await prisma.bulkImportSheetSource.update({ where: { id: source.id }, data: { lastCheckedAt: new Date() } });

  if (newRows.length === 0) return { newRowsFound: 0, batch: null, rowCount: 0, profileCount: 0, postCount: 0 };
  const result = await importRowsAsBatch({ source, rows: newRows, userId: source.addedByUserId, sourceType: "sheet" });
  return { newRowsFound: newRows.length, ...result };
}

/** Manual "Check now". */
export async function checkSheetSourceNow(user, id) {
  const source = await loadSheetSource(user, id);
  const result = await checkSheetSourceForNewRows(source);
  return {
    newRowsFound: result.newRowsFound,
    batchId: result.batch?.id ?? null,
    imported: { rows: result.rowCount, profiles: result.profileCount, posts: result.postCount },
  };
}
