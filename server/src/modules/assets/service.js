import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../middleware/errorHandler.js";
import { refreshAssetMetrics, applyProfileMetrics } from "../scraping/service.js";
import { ApifyInstagramProvider } from "../../lib/apifyClient.js";
import { normalizeHandle, isValidHandle, parseImportSheet, ImportParseError } from "./importParser.js";
import { fetchSheetCsv } from "../campaigns/service.js";
import { uploadProfilePic, isCloudinaryConfigured } from "../../lib/cloudinaryClient.js";
import { loadEffectivePermissions } from "../../lib/effectivePermissions.js";

/**
 * Creators see only their own assets; Plan Maker sees everything — it
 * needs the full catalogue to build a Plan from (newTask.md, 8 Sep: their
 * dashboard is "Dashboard + Inventory + Plan-create"), and doesn't own
 * pages the way a Creator does. Anyone else's visibility is inventory.view
 * (23 Sep, Step 3) — read fresh from the DB, not the JWT, so restricting or
 * granting it takes effect immediately.
 */
export async function listAssets(user) {
  const effective = await loadEffectivePermissions(user.id);
  const where = effective["inventory.view"] || user.role === "PLAN_MAKER" ? {} : { ownerId: user.id };
  const assets = await prisma.asset.findMany({
    where,
    // owner name/phone — Inventory's "filter by page owner" (newTask.md, 9
    // Sep) needs something human-readable to filter/group by; a Creator
    // only ever sees their own assets anyway, so this is a no-op for them.
    // assignments -> campaign — Inventory card's "campaigns they've made"
    // (user request, 11 Sep): every campaign this page has been assigned to,
    // via CampaignAssignment, deduped below (one page can have more than one
    // assignment row against the same campaign, e.g. re-attached sheets).
    include: {
      rateCards: true,
      owner: { select: { id: true, name: true, phoneNumber: true, email: true } },
      assignments: { select: { campaign: { select: { id: true, title: true, brandName: true } } } },
    },
    orderBy: { createdAt: "desc" },
  });
  return Promise.all(
    assets.map(async (asset) => {
      const { assignments, ...rest } = asset;
      const campaignsById = new Map((assignments ?? []).map((a) => [a.campaign.id, a.campaign]));
      return { ...rest, campaigns: [...campaignsById.values()], engagement: await getAvgEngagement(asset.id, asset) };
    })
  );
}

/** Everything getAvgEngagement needs off the Asset row when the caller didn't already load it. */
const ENGAGEMENT_ASSET_SELECT = {
  profileAvgViews: true,
  profileAvgLikes: true,
  profileAvgComments: true,
  profileSampleSize: true,
  manualAvgViews: true,
  manualAvgLikes: true,
  manualAvgComments: true,
};

/**
 * Avg. Likes / Comments / Views across this asset's posts (creator.wldd.in's
 * "Performance Metrics" on the Assets page) — one figure per link, taken
 * from its most recent scrape, averaged across every link that's been
 * scraped at least once. Links with no snapshot yet don't count toward it.
 *
 * A manually entered figure (Inventory's Edit panel, 28 Sep) replaces that
 * one number whichever automatic source produced it, and `manual` says which
 * ones those are so the UI can mark them. `sampleSize`/`source` keep
 * describing the automatic data underneath — a typed number isn't an average
 * of anything, so it never claims a sample of its own.
 */
export async function getAvgEngagement(assetId, asset = null) {
  // Both reads up front and in parallel: the row is needed either way now
  // (manual overrides apply whether or not there are scraped links), where it
  // used to be fetched only on the no-links path.
  const [links, row] = await Promise.all([
    prisma.link.findMany({ where: { assetId }, select: { postSnapshots: { orderBy: { capturedAt: "desc" }, take: 1 } } }),
    asset ?? prisma.asset.findUnique({ where: { id: assetId }, select: ENGAGEMENT_ASSET_SELECT }),
  ]);

  return withManualOverrides(automaticEngagement(links, row), row);
}

function automaticEngagement(links, row) {
  const latest = links.map((l) => l.postSnapshots[0]).filter(Boolean);
  if (latest.length === 0) {
    // No links through the app yet — fall back to the profile-level
    // averages the Apify profile scrape stored (Inventory "Create page",
    // 14 Sep), so a freshly added page isn't stuck on "N/A".
    if (row?.profileSampleSize > 0) {
      return { avgLikes: row.profileAvgLikes, avgComments: row.profileAvgComments, avgViews: row.profileAvgViews, sampleSize: row.profileSampleSize, source: "profile" };
    }
    return { avgLikes: null, avgComments: null, avgViews: null, sampleSize: 0 };
  }

  const sum = (key) => latest.reduce((total, s) => total + s[key], 0);
  return {
    avgLikes: Math.round(sum("likeCount") / latest.length),
    avgComments: Math.round(sum("commentsCount") / latest.length),
    avgViews: Math.round(sum("videoViews") / latest.length),
    sampleSize: latest.length,
  };
}

function withManualOverrides(engagement, row) {
  const overrides = { avgViews: row?.manualAvgViews ?? null, avgLikes: row?.manualAvgLikes ?? null, avgComments: row?.manualAvgComments ?? null };
  const manual = Object.fromEntries(Object.entries(overrides).filter(([, value]) => value !== null).map(([key]) => [key, true]));
  if (Object.keys(manual).length === 0) return engagement;
  return {
    ...engagement,
    ...Object.fromEntries(Object.entries(overrides).filter(([, value]) => value !== null)),
    manual,
  };
}

// `followers` is only ever passed by the plan-sheet "Add to inventory" path
// (plans/service.js addPendingPage) — a starting count from the sheet until
// the background scrape below replaces it.
export async function createAsset(user, { platform, handle, category, ownerId, rateCards, followers }) {
  // Only an admin or plan maker may register a page on someone else's behalf
  // (the "create a user with their first page(s)" flow, and — 25 Sep — a
  // plan maker onboarding a vendor while building a plan); a CREATOR
  // creating their own page never sends ownerId, so this never fires for them.
  if (ownerId && ownerId !== user.id && user.role !== "ADMIN" && user.role !== "PLAN_MAKER") {
    throw new ApiError(403, "FORBIDDEN", "Only an admin or plan maker can register a page for another user");
  }
  // A plan maker isn't a page owner themselves — unlike a creator/admin,
  // there's no "their own id" to fall back to below, so a missing ownerId
  // (or one sent as their own id, e.g. a copy-pasted request) must fail
  // loudly here instead of silently creating a plan-maker-owned asset
  // (which nothing downstream — links, invoices — expects to exist).
  if (user.role === "PLAN_MAKER" && (!ownerId || ownerId === user.id)) {
    throw new ApiError(400, "OWNER_REQUIRED", "Pick or create the creator account this page belongs to.");
  }
  // Only a CREATOR account owns pages — an admin/plan maker picking (or a
  // client sending) any other account's id is a mistake, not a page to create.
  if (ownerId && ownerId !== user.id) {
    const target = await prisma.user.findUnique({ where: { id: ownerId }, select: { role: true } });
    if (!target) throw new ApiError(404, "USER_NOT_FOUND", "That account doesn't exist.");
    if (target.role !== "CREATOR") throw new ApiError(400, "OWNER_NOT_CREATOR", "Pages can only be registered under a creator account.");
  }
  // Readable 409 instead of the raw unique-constraint 500 (found driving the
  // Inventory "Create page" form, 14 Sep). Same rule as the sheet import:
  // a handle already under this account is "already in Inventory"; one
  // under a *different* account can't be registered twice.
  const clash = await prisma.asset.findFirst({
    where: { platform, handle: { equals: handle, mode: "insensitive" } },
    select: { ownerId: true, owner: { select: { name: true, phoneNumber: true } } },
  });
  if (clash) {
    const targetOwnerId = ownerId ?? user.id;
    throw new ApiError(
      409,
      "ASSET_ALREADY_EXISTS",
      clash.ownerId === targetOwnerId ? `@${handle} is already in Inventory${user.role === "ADMIN" ? ` under ${ownerLabel(clash.owner)}` : ""}.` : `@${handle} is already registered under ${user.role === "ADMIN" ? ownerLabel(clash.owner) : "another account"}.`
    );
  }
  // A page an admin registers is approved on the spot — the approval queue
  // exists to vet pages creators add themselves (user request, 14 Sep).
  // Optional reel/story rates from the Create page form land in the same
  // insert, so a page never exists half-configured.
  // Rate cards are money (links and plans price from them) and were only
  // ever admin-writable (PUT /:id/rate-card) — a creator's own submission
  // can't smuggle one in through this route.
  const rates = user.role === "ADMIN" ? dedupeRateCards(rateCards) : [];
  if (user.role !== "ADMIN" && rateCards?.length) {
    throw new ApiError(403, "FORBIDDEN", "Only an admin can set a page's rate card.");
  }
  let asset;
  try {
    asset = await prisma.asset.create({
      data: {
        ownerId: ownerId ?? user.id,
        platform,
        handle,
        category,
        ...(followers != null ? { followers } : {}),
        approvalStatus: user.role === "ADMIN" ? "approved" : "pending",
        ...(rates.length > 0 ? { rateCards: { create: rates } } : {}),
      },
      include: { rateCards: true },
    });
  } catch (err) {
    // Double-submit / concurrent create racing past the check above.
    if (err?.code === "P2002") throw new ApiError(409, "ASSET_ALREADY_EXISTS", `@${handle} is already in Inventory.`);
    throw err;
  }

  // Fire-and-forget — pulls followers/full name/bio/avatar/avg views in the
  // background so a newly-added page isn't left blank indefinitely: the only
  // other place that populates these fields is assetProfileRescrapeJob, a
  // 24h cron that (deliberately) only rescrapes already-approved assets, so
  // a creator-added "pending" asset would otherwise never get scraped at all.
  // Not awaited: the Apify actor call can take up to ~2 minutes and
  // shouldn't block the "Add page" request; a bad handle or transient
  // failure here just means the page shows blank until it's approved
  // (see setApprovalStatus) or the next cron tick.
  const queuedAt = await markScrapeQueued([asset.id]);
  void scrapeSequentially([asset.id]);

  return { ...asset, scrapeQueuedAt: queuedAt };
}

/**
 * Bulk "Refresh from Instagram" (user request, 14 Sep) — re-pulls
 * followers, avg views and profile details for the selected pages, one at
 * a time in the background. Returns immediately with how many were queued;
 * each row shows "Fetching…" (scrapeQueuedAt) until its turn completes.
 */
export async function queueProfileRefresh(assetIds) {
  const ids = [...new Set(assetIds)];
  // Rows already queued (a chain in flight) aren't queued twice — that
  // would just run the same Apify scrape back to back.
  const found = await prisma.asset.findMany({ where: { id: { in: ids }, scrapeQueuedAt: null }, select: { id: true } });
  const queued = found.map((a) => a.id);
  await markScrapeQueued(queued);
  void scrapeSequentially(queued);
  return { queued: queued.length };
}

export async function setApprovalStatus(assetId, approvalStatus) {
  const asset = await prisma.asset.update({ where: { id: assetId }, data: { approvalStatus } });

  // Second chance at a scrape right when a page goes live, rather than
  // waiting for the next 24h assetProfileRescrapeJob tick — also covers the
  // case where the create-time scrape above failed or ran before the actor
  // had indexed the profile.
  if (approvalStatus === "approved") {
    refreshAssetMetrics(assetId)
      .then(() => storeProfilePic(assetId))
      .catch((err) => console.error(`setApprovalStatus: Apify scrape failed for asset ${assetId}`, err));
  }

  return asset;
}

/**
 * Manual "refresh" button on an Inventory page card — synchronously pulls
 * fresh followers/full name/bio/avatar from Apify instead of waiting for
 * the next 24h assetProfileRescrapeJob tick. Admin-only (see routes.js),
 * same as links' refresh-metrics; awaited (unlike the fire-and-forget calls
 * above) since this is a user-initiated action expecting the fresh numbers
 * back, not a background touch-up.
 */
export async function refreshProfile(assetId) {
  const asset = await prisma.asset.findUnique({ where: { id: assetId } });
  if (!asset) throw new ApiError(404, "ASSET_NOT_FOUND", "Asset not found");
  const updated = await refreshAssetMetrics(assetId);
  await storeProfilePic(assetId);
  return updated;
}

// In-memory cache for fetchProfilePic — keyed by assetId, holding the last
// successfully-fetched bytes. Confirmed by hand (11 Sep) that Instagram's
// edge network 403/503s the *identical* URL on a genuinely random fraction
// of requests (three retries back-to-back from this same box: 503, 200,
// 200) — independent of Referer/UA, and not fixed by the retry loop alone
// forever, since a page could theoretically hit 3 failures in a row. Once
// one request gets through, cache it so every subsequent viewer is served
// instantly from memory instead of re-rolling the dice against Instagram
// on every single page load. Cleared (by TTL) well before the upstream
// signed URL itself would expire.
const profilePicCache = new Map(); // assetId -> { buffer, contentType, cachedAt }
// 24h, matching assetProfileRescrapeJob's own cadence — storeProfilePic
// below re-populates this right after every scrape (initial, on-approval,
// manual refresh, and the 24h cron itself), so in practice a real viewer's
// <img> is almost always served straight from cache rather than racing
// Instagram live at all.
const PROFILE_PIC_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// De-dupes concurrent callers: the Inventory card renders TWO <img> tags
// against the exact same URL (the blurred cover + the sharp circular
// avatar), which both fire the instant the card mounts. Confirmed by hand
// (11 Sep) that reproduces the broken-image bug even with retries/caching
// in place — two simultaneous requests for an asset with nothing cached yet
// each independently hit Instagram's CDN with the identical URL, and Meta's
// edge treats that duplicate-concurrent-request pattern as suspicious more
// often than a single request alone. Keyed by assetId, holding the in-flight
// promise so the second caller awaits the first's result instead of firing
// its own separate fetch.
const profilePicInFlight = new Map(); // assetId -> Promise<{ buffer, contentType }>

/**
 * Proxies an asset's Instagram profile picture through our own server
 * instead of the client hotlinking cdninstagram.com directly (user report,
 * 11 Sep: the direct <img src="cdninstagram.com/..."> intermittently came
 * back broken). Retries a few times with a short backoff — confirmed by
 * hand that back-to-back requests for the exact same URL flip between 503
 * and 200, so a single failed attempt does NOT mean the link is dead — then
 * caches a success so later requests skip Instagram entirely, and de-dupes
 * concurrent callers (see profilePicInFlight above) rather than each firing
 * its own separate request.
 */
export async function fetchProfilePic(assetId) {
  const cached = profilePicCache.get(assetId);
  if (cached && Date.now() - cached.cachedAt < PROFILE_PIC_CACHE_TTL_MS) {
    return { buffer: cached.buffer, contentType: cached.contentType };
  }

  const inFlight = profilePicInFlight.get(assetId);
  if (inFlight) return inFlight;

  const promise = fetchProfilePicUncached(assetId).finally(() => profilePicInFlight.delete(assetId));
  profilePicInFlight.set(assetId, promise);
  return promise;
}

async function fetchProfilePicUncached(assetId) {
  const asset = await prisma.asset.findUnique({ where: { id: assetId }, select: { profilePicUrl: true, profilePicStoredUrl: true } });
  if (!asset?.profilePicUrl && !asset?.profilePicStoredUrl) throw new ApiError(404, "NO_PROFILE_PIC", "This page has no profile picture yet");

  // Our own stored copy first (22 Sep) — it doesn't expire or flake the way
  // Instagram's CDN does. Instagram is only the fallback for a page whose
  // picture hasn't been stored yet (or a Cloudinary blip).
  if (asset.profilePicStoredUrl) {
    try {
      const result = await downloadImage(asset.profilePicStoredUrl, 1, "Cloudinary");
      profilePicCache.set(assetId, { ...result, cachedAt: Date.now() });
      return result;
    } catch (err) {
      if (!asset.profilePicUrl) throw new ApiError(502, "PROFILE_PIC_FETCH_FAILED", `Couldn't load this page's stored profile picture: ${err.message}`);
    }
  }

  try {
    const result = await downloadImage(asset.profilePicUrl, 3, "Instagram");
    profilePicCache.set(assetId, { ...result, cachedAt: Date.now() });
    return result;
  } catch (err) {
    throw new ApiError(502, "PROFILE_PIC_FETCH_FAILED", `Couldn't fetch this page's profile picture from Instagram after 3 attempts: ${err.message}`);
  }
}

/** GETs an image with a short backoff between attempts (see fetchProfilePic's note on Instagram's flaky CDN). */
async function downloadImage(url, attempts, sourceLabel) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const upstream = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
      if (upstream.ok) return { buffer: Buffer.from(await upstream.arrayBuffer()), contentType: upstream.headers.get("content-type") ?? "image/jpeg" };
      lastError = new Error(`${sourceLabel} returned ${upstream.status}`);
    } catch (err) {
      lastError = err;
    }
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 300));
  }
  throw lastError;
}

/**
 * Stores a page's profile picture in Cloudinary (user request, 22 Sep —
 * "pages profile pic should be stored in database") right after a scrape
 * refreshed its Instagram URL, and saves the stored link on the page.
 * Called from every place that calls refreshAssetMetrics / applyProfileMetrics
 * (createAsset's scrape chain, setApprovalStatus, refreshProfile, import,
 * and the 24h assetProfileRescrapeJob cron), so the stored copy follows
 * the page's current picture. Also primes fetchProfilePic's in-memory cache.
 * Never throws — a failure just leaves the previous stored copy (or the
 * Instagram fallback) in place until the next scrape.
 */
export async function storeProfilePic(assetId) {
  // No Cloudinary account on this environment: nothing to store into, so
  // don't download the picture or log a failure on every single scrape.
  if (!isCloudinaryConfigured()) return;
  try {
    const asset = await prisma.asset.findUnique({ where: { id: assetId }, select: { profilePicUrl: true } });
    if (!asset?.profilePicUrl) return;
    const image = await downloadImage(asset.profilePicUrl, 3, "Instagram");
    profilePicCache.set(assetId, { ...image, cachedAt: Date.now() });
    const storedUrl = await uploadProfilePic(assetId, image.buffer);
    await prisma.asset.update({ where: { id: assetId }, data: { profilePicStoredUrl: storedUrl } });
  } catch (err) {
    console.error(`storeProfilePic: couldn't store asset ${assetId}'s profile picture`, err);
  }
}

async function storeProfilePicsSequentially(assetIds) {
  for (const id of assetIds) await storeProfilePic(id);
}

/** Upserts each (assetId, format) rate — admin-only, versioned by effectiveFrom. */
/**
 * Inventory's Edit panel (28 Sep) — the page's own details, as opposed to its
 * rate card. Only the keys actually sent are touched, so saving a category
 * can't silently wipe an engagement override and vice versa; an explicit null
 * clears one (category back to none, a figure back to the automatic scrape).
 * Returns the asset with its engagement recomputed, so the caller sees the
 * effective numbers rather than having to re-derive them.
 */
export async function updateAssetDetails(assetId, fields) {
  const asset = await prisma.asset.findUnique({ where: { id: assetId } });
  if (!asset) throw new ApiError(404, "ASSET_NOT_FOUND", "Asset not found");

  const data = {};
  if ("category" in fields) data.category = fields.category;
  if ("avgViews" in fields) data.manualAvgViews = fields.avgViews;
  if ("avgLikes" in fields) data.manualAvgLikes = fields.avgLikes;
  if ("avgComments" in fields) data.manualAvgComments = fields.avgComments;

  const updated = await prisma.asset.update({ where: { id: assetId }, data });
  return { ...updated, engagement: await getAvgEngagement(assetId, updated) };
}

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

/* ── Inventory "Create page" / "Import pages" (user request, 14 Sep) ─────
 * Admin registers pages under a chosen creator account, one at a time
 * (createAsset above with ownerId) or in bulk from an .xlsx/.csv. The
 * bulk path is two steps — previewImport resolves every row against real
 * accounts/pages and reports what *would* happen; importAssets then
 * creates exactly the rows the admin confirmed. Nothing is written during
 * preview, so a sheet full of typos costs nothing to look at.
 */

/** Creator accounts a page can be registered under — the only role that owns pages (see system design.md). */
export async function listPageOwners() {
  return prisma.user.findMany({
    where: { role: "CREATOR" },
    select: { id: true, name: true, phoneNumber: true, email: true },
    orderBy: [{ name: "asc" }, { createdAt: "asc" }],
  });
}

/** Digits only, so "+91 98765-43210", "9876543210" and "919876543210" all compare equal on their last 10 digits. */
function phoneKey(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

/**
 * Matches a sheet's owner cell to a creator account: by phone number
 * first (the unique login key), then by exact name or email (both
 * case-insensitive). A name shared by two creators is ambiguous rather
 * than silently picking one.
 */
export function resolveOwnerRef(ownerRef, owners) {
  const ref = String(ownerRef ?? "").trim();
  if (!ref) return { owner: null, reason: null };
  // Phone matching only for a cell that *is* a phone number (digits plus
  // the usual +, spaces, dashes, brackets) — not for an email or a name
  // that happens to contain ten digits.
  const looksLikePhone = /^[\s()+\-.\d]+$/.test(ref);
  const key = phoneKey(ref);
  if (looksLikePhone && key.length >= 10) {
    const byPhone = owners.find((o) => phoneKey(o.phoneNumber) === key);
    if (byPhone) return { owner: byPhone, reason: null };
  }
  const lower = ref.toLowerCase();
  const byEmail = owners.filter((o) => o.email && o.email.toLowerCase() === lower);
  if (byEmail.length === 1) return { owner: byEmail[0], reason: null };
  const byName = owners.filter((o) => o.name && o.name.trim().toLowerCase() === lower);
  if (byName.length === 1) return { owner: byName[0], reason: null };
  if (byName.length > 1) return { owner: null, reason: `"${ref}" matches ${byName.length} creator accounts — use their phone number instead.` };
  return { owner: null, reason: `No creator account matches "${ref}".` };
}

/**
 * Row statuses:
 *   ready          — will be created under `owner`
 *   invalid        — bad/missing handle; never importable
 *   duplicate      — same handle appeared on an earlier row of this sheet
 *   exists         — already registered under that same account; skipped
 *   conflict       — already registered under a *different* account; skipped
 *                    (a page can't sensibly live under two creators)
 *   owner-missing  — no owner cell; the admin picks a default account
 *   owner-unknown  — owner cell didn't match any creator; admin picks one
 *
 * A CREATOR's own import (25 Sep) never reaches owner-missing/owner-unknown —
 * every row is forced onto their own account regardless of the sheet's owner
 * column, and the full creator list is never fetched or returned to them
 * (an ordinary Creator has no business seeing every other creator's name,
 * phone and email — this was a real leak before this role could reach here).
 */
export async function previewImport(parsed, user) {
  const isCreator = user?.role === "CREATOR";
  const owners = isCreator ? [] : await listPageOwners();
  const selfAsOwner = await selfAsOwnerFor(user);
  const handles = [...new Set(parsed.rows.map((r) => r.handle).filter(Boolean))];
  const existing = handles.length
    ? await prisma.asset.findMany({
        where: { platform: "instagram", handle: { in: handles, mode: "insensitive" } },
        select: { id: true, handle: true, ownerId: true, owner: { select: { id: true, name: true, phoneNumber: true, email: true } } },
      })
    : [];
  const existingByHandle = new Map();
  for (const a of existing) {
    const k = a.handle.toLowerCase();
    existingByHandle.set(k, [...(existingByHandle.get(k) ?? []), a]);
  }

  const seen = new Set();
  const rows = parsed.rows.map((row) => {
    const base = { rowNumber: row.rowNumber, rawHandle: row.rawHandle, handle: row.handle, pageName: row.pageName ?? null, category: row.category, followers: row.followers, rateCards: row.rateCards, ownerRef: row.ownerRef, owner: null, ownerId: null, status: "ready", reason: null };
    if (row.problem) return { ...base, status: "invalid", reason: row.problem };
    const key = row.handle.toLowerCase();
    if (seen.has(key)) return { ...base, status: "duplicate", reason: "Same handle appears earlier in this sheet." };
    seen.add(key);

    const matches = existingByHandle.get(key) ?? [];

    // A creator's own sheet ignores whatever the owner column says — every
    // row is theirs, full stop — and a conflict never names whose account
    // it actually is, unconditionally: kept fully separate from the
    // resolveOwnerRef path below so that path's unredacted messages can
    // never be reached for a creator, whatever selfAsOwner turns out to be.
    if (isCreator) {
      if (!selfAsOwner) return { ...base, status: "owner-missing", reason: "Couldn't verify your account — try again." };
      const same = matches.find((a) => a.ownerId === selfAsOwner.id);
      if (same) return { ...base, owner: selfAsOwner, ownerId: selfAsOwner.id, status: "exists", reason: `Already in Inventory under ${ownerLabel(selfAsOwner)}.` };
      if (matches.length > 0) return { ...base, owner: selfAsOwner, ownerId: selfAsOwner.id, status: "conflict", reason: "Already registered under another account — a page can't be under two accounts." };
      return { ...base, owner: selfAsOwner, ownerId: selfAsOwner.id };
    }

    const { owner, reason } = resolveOwnerRef(row.ownerRef, owners);
    if (owner) {
      const same = matches.find((a) => a.ownerId === owner.id);
      if (same) return { ...base, owner, ownerId: owner.id, status: "exists", reason: `Already in Inventory under ${ownerLabel(owner)}.` };
      if (matches.length > 0) return { ...base, owner, ownerId: owner.id, status: "conflict", reason: `Already registered under ${ownerLabel(matches[0].owner)} — a page can't be under two accounts.` };
      return { ...base, owner, ownerId: owner.id };
    }
    if (matches.length > 0) {
      return { ...base, owner: matches[0].owner, ownerId: matches[0].ownerId, status: "exists", reason: `Already in Inventory under ${ownerLabel(matches[0].owner)}.` };
    }
    if (row.ownerRef) return { ...base, status: "owner-unknown", reason };
    return { ...base, status: "owner-missing", reason: parsed.hasOwnerColumn ? "Owner cell is blank." : "Sheet has no owner column." };
  });

  const summary = {};
  for (const r of rows) summary[r.status] = (summary[r.status] ?? 0) + 1;
  return { rows, summary, totalRows: rows.length, hasOwnerColumn: parsed.hasOwnerColumn, owners };
}

/** One entry per format, positive amounts only — RateCard is unique per (asset, format). */
function dedupeRateCards(rateCards) {
  const seen = new Set();
  return (rateCards ?? []).filter((rc) => rc?.format && rc.amount > 0 && !seen.has(rc.format) && seen.add(rc.format)).map((rc) => ({ format: rc.format, amount: rc.amount }));
}

function ownerLabel(owner) {
  return owner?.name?.trim() || owner?.phoneNumber || "another account";
}

/**
 * `req.user` off the access token only ever carries {id, role} (see
 * requireAuth.js) — never the display fields a "you already have this page"
 * message or a result screen's "N pages under <name>" grouping needs, so a
 * CREATOR caller's own record is looked up fresh rather than trusted to be
 * on the object routes.js handed in. Shared by previewImport and importAssets.
 */
async function selfAsOwnerFor(user) {
  if (user?.role !== "CREATOR") return null;
  return prisma.user.findUnique({ where: { id: user.id }, select: { id: true, name: true, phoneNumber: true, email: true } });
}

/** Whoever a clash actually belongs to — except a creator, who's never told: that's the same creator-list leak `owners: []` exists to prevent in previewImport. */
function clashOwnerLabel(isCreator, owner) {
  return isCreator ? "another account" : ownerLabel(owner);
}

/** The skip reason for a handle that's already in Inventory, own account or someone else's — shared by importAssets' clash and lateClash checks. */
function clashReason(clash, owner, isCreator) {
  const sameOwner = clash.ownerId === owner.id;
  const under = sameOwner ? ownerLabel(owner) : clashOwnerLabel(isCreator, clash.owner);
  return sameOwner ? `Already in Inventory under ${under}.` : `Already registered under ${under}.`;
}

/**
 * Creates the confirmed rows. Re-validates everything the preview did —
 * the client's confirmation is a list of intents, not a trusted state —
 * so a handle registered by someone else between preview and confirm is
 * skipped with a reason rather than erroring the whole batch (same
 * created-vs-skipped pattern as links' bulk upload). Reachable by ADMIN,
 * CREATOR and PLAN_MAKER (25 Sep) — only CREATOR accounts can own pages.
 * A CREATOR's own rows are always forced onto their own id (never trusts
 * a client-sent ownerId for them, same as createAsset); a PLAN_MAKER picks
 * from `owners` like an admin does. Only an ADMIN's rows are auto-approved
 * and can carry a rate card — everyone else's land `pending`, no rates,
 * same rule as the single "Add page" flow.
 */
export async function importAssets(user, rows) {
  const isAdmin = user.role === "ADMIN";
  const isCreator = user.role === "CREATOR";
  // A creator's owner is always themselves (below) — never consults this
  // list, so skip fetching every creator account in the system for nothing.
  const owners = isCreator ? [] : await listPageOwners();
  const ownerById = new Map(owners.map((o) => [o.id, o]));
  const selfAsOwner = await selfAsOwnerFor(user);
  const created = [];
  const skipped = [];
  const seen = new Set();
  const candidates = [];

  // Pass 1 — everything checkable without Instagram.
  for (const input of rows) {
    const handle = normalizeHandle(input.handle);
    if (!handle || !isValidHandle(handle)) {
      skipped.push({ handle: input.handle, reason: "Not a valid Instagram handle." });
      continue;
    }
    const key = handle.toLowerCase();
    if (seen.has(key)) {
      skipped.push({ handle, reason: "Duplicate handle in this import." });
      continue;
    }
    seen.add(key);
    // A creator's own bulk import is always their own pages — never whatever
    // ownerId the client sent (same reasoning as createAsset's ownerId check).
    const owner = isCreator ? selfAsOwner : ownerById.get(input.ownerId);
    if (!owner) {
      skipped.push({ handle, reason: "Pick a creator account for this page." });
      continue;
    }
    const clash = await prisma.asset.findFirst({
      where: { platform: "instagram", handle: { equals: handle, mode: "insensitive" } },
      select: { ownerId: true, owner: { select: { name: true, phoneNumber: true } } },
    });
    if (clash) {
      skipped.push({ handle, reason: clashReason(clash, owner, isCreator) });
      continue;
    }
    candidates.push({ input, handle, owner });
  }

  // Pass 2 — every page must be confirmed on Instagram before it's stored
  // (user request, 22 Sep — "if page not found ... it won't be stored in
  // database"). The preview's live check is reused; anything it never
  // answered (expired, timed out, or the preview was skipped) is looked up
  // now in one batch. The client's word that a row is fine isn't trusted.
  // Snapshotted once, so an entry that expires while the lookup below runs
  // isn't then refused as "couldn't verify".
  const checked = new Map(candidates.map((c) => [c.handle, peekPreviewScrape(c.handle)]));
  const unchecked = candidates.filter((c) => checked.get(c.handle) === undefined).map((c) => c.handle);
  // A big stale batch would hold this request open for minutes; past the cap
  // the admin re-runs the check in the popup (one preview-sized chunk at a time).
  if (unchecked.length > 0 && unchecked.length <= MAX_IMPORT_VERIFY_HANDLES) {
    try {
      const results = await ApifyInstagramProvider.getAccountMetricsBatch(unchecked);
      for (const handle of unchecked) {
        if (!(handle in results)) continue;
        checked.set(handle, results[handle]);
        previewScrapeCache.set(handle.toLowerCase(), { metrics: results[handle], at: Date.now() });
      }
    } catch (err) {
      // Instagram unreachable: those rows stay unverified and are refused below.
      console.error("importAssets: couldn't verify pages on Instagram", err);
    }
  }

  const toStorePic = [];
  for (const { input, handle, owner } of candidates) {
    const metrics = checked.get(handle);
    if (metrics === null) {
      skipped.push({ handle, reason: "Link broken or page not found on Instagram." });
      continue;
    }
    if (metrics === undefined) {
      skipped.push({ handle, reason: "Couldn't verify this page on Instagram right now — try again." });
      continue;
    }
    // Checked again right before the insert: the Instagram lookup above can
    // take minutes, and the unique index is per owner, so another admin (or
    // the creator) registering the same page meanwhile would otherwise put
    // it under two accounts.
    const lateClash = await prisma.asset.findFirst({
      where: { platform: "instagram", handle: { equals: handle, mode: "insensitive" } },
      select: { ownerId: true, owner: { select: { name: true, phoneNumber: true } } },
    });
    if (lateClash) {
      skipped.push({ handle, reason: clashReason(lateClash, owner, isCreator) });
      continue;
    }
    // Only an admin's rate cards survive — a non-admin's import lands
    // pending, same as createAsset, so a rate can't be smuggled in through
    // a sheet column instead of the single-page form.
    const rateCards = isAdmin ? dedupeRateCards(input.rateCards) : [];
    let asset;
    try {
      asset = await prisma.asset.create({
        data: {
          ownerId: owner.id,
          platform: "instagram",
          handle,
          category: input.category || null,
          // The sheet's Page Name until Instagram gives its own (applyProfileMetrics below keeps it when Instagram has none).
          fullName: input.pageName?.trim() || null,
          followers: Math.min(metrics.followers ?? input.followers ?? 0, 2_147_483_647),
          approvalStatus: isAdmin ? "approved" : "pending",
          ...(rateCards.length > 0 ? { rateCards: { create: rateCards.map((rc) => ({ format: rc.format, amount: rc.amount })) } } : {}),
        },
        select: { id: true, handle: true, ownerId: true, approvalStatus: true },
      });
    } catch (err) {
      // Someone registered it between the check above and the insert (two
      // admins confirming the same sheet) — a skip, not a 500 that leaves
      // the earlier rows created and the client none the wiser.
      if (err?.code === "P2002") {
        skipped.push({ handle, reason: "Was registered by someone else just now." });
        continue;
      }
      throw err;
    }
    previewScrapeCache.delete(handle.toLowerCase());
    created.push({ ...asset, owner: { id: owner.id, name: owner.name, phoneNumber: owner.phoneNumber } });
    try {
      await applyProfileMetrics(asset.id, metrics);
      toStorePic.push(asset.id);
    } catch (err) {
      console.error(`importAssets: couldn't store fetched profile for ${handle}`, err);
    }
  }

  // Profile pictures → Cloudinary, one at a time in the background (each is
  // an Instagram download + an upload; not worth holding the response for).
  void storeProfilePicsSequentially(toStorePic);

  return { created, skipped };
}

/**
 * Marks rows as "scrape queued" (the Inventory row's "Fetching…" state) —
 * awaited by callers *before* they respond, so a list refetch triggered by
 * the response can never observe the row without its marker.
 */
async function markScrapeQueued(assetIds) {
  const at = new Date();
  if (assetIds.length === 0) return at;
  await prisma.asset.updateMany({ where: { id: { in: assetIds } }, data: { scrapeQueuedAt: at } });
  return at;
}

/**
 * Runs the queued scrapes one at a time in the background (never awaited
 * by callers). A row whose marker was already cleared — the admin hit the
 * single-row refresh while it waited — is skipped rather than scraped a
 * second time. refreshAssetMetrics clears the marker on success/failure;
 * anything that dies before that (server restart) is swept on boot by
 * clearStaleScrapeQueue().
 */
async function scrapeSequentially(assetIds) {
  for (const id of assetIds) {
    try {
      const row = await prisma.asset.findUnique({ where: { id }, select: { scrapeQueuedAt: true } });
      if (!row?.scrapeQueuedAt) continue;
      await refreshAssetMetrics(id);
      await storeProfilePic(id);
    } catch (err) {
      console.error(`scrapeSequentially: Apify scrape failed for asset ${id}`, err);
      // refreshAssetMetrics clears the marker itself on a scrape failure;
      // this covers a throw before it got that far (e.g. a DB blip).
      await prisma.asset.update({ where: { id }, data: { scrapeQueuedAt: null } }).catch(() => {});
    }
  }
}

/** Server boot: a chain interrupted by a restart/deploy must not leave rows on "Fetching…" forever. */
export async function clearStaleScrapeQueue() {
  const { count } = await prisma.asset.updateMany({ where: { scrapeQueuedAt: { not: null } }, data: { scrapeQueuedAt: null } });
  if (count > 0) console.log(`clearStaleScrapeQueue: cleared ${count} interrupted profile scrape(s)`);
}

/**
 * "Attach a Google Sheet link" for the Inventory import (user request, 14
 * Sep) — same public-link → CSV fetch the campaign and plan sheet imports
 * use (campaigns/service.js's fetchSheetCsv, which already handles the
 * "not shared" and "too large" cases), then the same parser/preview as an
 * uploaded file.
 */
export async function previewImportFromSheetUrl(url, user) {
  const csv = await fetchSheetCsv(url);
  const parsed = await parseImportSheetOrThrow(Buffer.from(csv, "utf8"), "sheet.csv");
  return previewImport(parsed, user);
}

// Followers/avg views fetched during an import *preview* (user request, 14
// Sep), kept briefly so confirming the import can store them straight onto
// the new pages instead of scraping each one again. Keyed by lowercased
// handle. (The sheet's own follower column is still accepted as a starting
// value on import, as before; a cache hit simply overwrites it with the
// scraped number.)
const previewScrapeCache = new Map(); // handle -> { metrics, at }
const PREVIEW_SCRAPE_TTL_MS = 30 * 60 * 1000;
export const MAX_PREVIEW_SCRAPE_HANDLES = 100;
// How many never-checked pages importAssets will look up itself before
// refusing them as "couldn't verify" (same size as one preview check).
export const MAX_IMPORT_VERIFY_HANDLES = 100;

/**
 * The preview's Instagram check — live follower counts / avg views for its
 * handles, one Apify run for the whole batch. A handle that came back
 * private/missing is null, which the popup shows as "link broken / not
 * found" and importAssets refuses (22 Sep). A total failure (Apify down, no
 * token) is a 502 the popup shows as "couldn't verify"; those rows can't be
 * imported until a retry confirms them.
 */
export async function fetchImportFollowers(handles) {
  const clean = [...new Set(handles.map((h) => normalizeHandle(h)).filter((h) => h && isValidHandle(h)))];
  if (clean.length === 0) return { profiles: {} };
  // Sweep stale entries (previewed sheets that were never imported) so the
  // cache can't grow without bound on a long-lived process.
  for (const [key, entry] of previewScrapeCache) if (Date.now() - entry.at > PREVIEW_SCRAPE_TTL_MS) previewScrapeCache.delete(key);
  let results;
  try {
    results = await ApifyInstagramProvider.getAccountMetricsBatch(clean);
  } catch (err) {
    throw new ApiError(502, "FOLLOWERS_FETCH_FAILED", `Couldn't fetch follower counts from Instagram right now (${String(err?.message ?? err).slice(0, 120)}). Retry the check — pages can't be imported until Instagram confirms them.`);
  }
  // A handle absent from `results` (its chunk timed out) is left out of the
  // response — "unknown", not "not found" — so the modal keeps the sheet's
  // number and the post-import scrape fills it in.
  const profiles = {};
  for (const handle of clean) {
    if (!(handle in results)) continue;
    const metrics = results[handle];
    // A "not found" answer is cached too (metrics: null) — importAssets
    // trusts it and refuses the row instead of paying for a second lookup.
    previewScrapeCache.set(handle.toLowerCase(), { metrics, at: Date.now() });
    profiles[handle] = metrics ? { followers: metrics.followers, avgViews: metrics.avgViews, avgLikes: metrics.avgLikes, avgComments: metrics.avgComments, fullName: metrics.fullName } : null;
  }
  return { profiles };
}

/** `undefined` = never checked (or expired); `null` = Instagram said not found; else the metrics. */
function peekPreviewScrape(handle) {
  const hit = previewScrapeCache.get(handle.toLowerCase());
  if (!hit || Date.now() - hit.at >= PREVIEW_SCRAPE_TTL_MS) return undefined;
  return hit.metrics;
}

/** parseImportSheet with its parse errors surfaced as 400s (the parser itself stays HTTP-agnostic for its unit tests). */
export async function parseImportSheetOrThrow(buffer, fileName) {
  try {
    return await parseImportSheet(buffer, fileName);
  } catch (err) {
    if (err instanceof ImportParseError) throw new ApiError(400, "IMPORT_SHEET_INVALID", err.message);
    throw err;
  }
}
