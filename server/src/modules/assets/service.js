import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../middleware/errorHandler.js";
import { refreshAssetMetrics, applyProfileMetrics } from "../scraping/service.js";
import { ApifyInstagramProvider } from "../../lib/apifyClient.js";
import { normalizeHandle, isValidHandle, parseImportSheet, ImportParseError } from "./importParser.js";
import { fetchSheetCsv } from "../campaigns/service.js";
import { uploadProfilePic, isCloudinaryConfigured } from "../../lib/cloudinaryClient.js";
import { loadEffectivePermissions } from "../../lib/effectivePermissions.js";
import { REQUIRED_RATE_FORMATS, formatLabel } from "../../lib/formats.js";

/**
 * Mandatory rates (16 Oct): a page can only be approved once it has Reel
 * and Story rates (REQUIRED_RATE_FORMATS). Returns the required format keys
 * missing from `rateCards` (positive amounts only), in the fixed order.
 */
export function missingRequiredRates(rateCards) {
  const have = new Set(dedupeRateCards(rateCards).map((rc) => rc.format));
  return REQUIRED_RATE_FORMATS.filter((f) => !have.has(f));
}

function listLabels(formats) {
  const labels = formats.map(formatLabel);
  return labels.length <= 1 ? labels.join("") : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

function ratesRequiredError(missing) {
  return new ApiError(400, "RATES_REQUIRED", `Add the ${listLabels(missing)} rate${missing.length > 1 ? "s" : ""}`);
}

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
  // Who proposed each pending edit (16 Oct) — one lookup for the whole list.
  const proposerIds = [...new Set(assets.map((a) => a.pendingEditById).filter(Boolean))];
  const proposers = proposerIds.length ? await prisma.user.findMany({ where: { id: { in: proposerIds } }, select: { id: true, name: true, email: true } }) : [];
  const proposerById = new Map(proposers.map((u) => [u.id, u]));
  return Promise.all(
    assets.map(async (asset) => {
      const { assignments, ...rest } = asset;
      const campaignsById = new Map((assignments ?? []).map((a) => [a.campaign.id, a.campaign]));
      return {
        ...rest,
        pendingEditBy: asset.pendingEditById ? proposerById.get(asset.pendingEditById) ?? null : null,
        campaigns: [...campaignsById.values()],
        engagement: await getAvgEngagement(asset.id, asset),
      };
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
//
// `incompleteRates` (14 Oct) decides what happens when an ADMIN's page is
// missing one of the required rates (Reel, Story — 16 Oct):
// "reject" (default — the Create page form) is a 400 RATES_REQUIRED naming
// them; "pending" (plans/service.js addPendingPage, which only knows the one
// rate from the sheet) creates the page pending so the admin fills the rest
// in before approving.
export async function createAsset(user, { platform, handle, category, ownerId, rateCards, followers, grade, groupLink }, { incompleteRates = "reject" } = {}) {
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
  const missing = user.role === "ADMIN" ? missingRequiredRates(rates) : [];
  if (missing.length > 0 && incompleteRates !== "pending") throw ratesRequiredError(missing);
  let asset;
  try {
    asset = await prisma.asset.create({
      data: {
        ownerId: ownerId ?? user.id,
        platform,
        handle,
        category,
        // Grade + group link (16 Oct) — optional, whoever adds the page may set them.
        ...(grade !== undefined ? { grade } : {}),
        ...(groupLink !== undefined ? { groupLink } : {}),
        ...(followers != null ? { followers } : {}),
        approvalStatus: user.role === "ADMIN" && missing.length === 0 ? "approved" : "pending",
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
  // Approving needs whatever REQUIRED_RATE_FORMATS lists — nothing, since 16 Oct
  // (later): any page can be approved with any rates or none. A page that's
  // already approved stays approvable (a repeat click changes nothing).
  if (approvalStatus === "approved") {
    const current = await prisma.asset.findUnique({ where: { id: assetId }, select: { approvalStatus: true, rateCards: { select: { format: true, amount: true } } } });
    if (current && current.approvalStatus !== "approved") {
      const missing = missingRequiredRates(current.rateCards.map((rc) => ({ format: rc.format, amount: Number(rc.amount) })));
      if (missing.length > 0) throw new ApiError(400, "RATES_REQUIRED", `Set ${listLabels(REQUIRED_RATE_FORMATS)} rates before approving.`);
    }
  }
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
/**
 * Where GET /assets/:id/profile-pic should send the browser (design-fix #5,
 * 7 Oct — avatars are on nearly every screen): the stored Cloudinary copy
 * as a redirect, so the CDN and the browser cache serve it and the API stops
 * streaming bytes; otherwise the proxied Instagram picture via fetchProfilePic.
 */
export async function getProfilePicSource(assetId) {
  const asset = await prisma.asset.findUnique({ where: { id: assetId }, select: { profilePicStoredUrl: true } });
  if (asset?.profilePicStoredUrl) return { redirect: asset.profilePicStoredUrl };
  return fetchProfilePic(assetId);
}

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
  if ("grade" in fields) data.grade = fields.grade;
  if ("groupLink" in fields) data.groupLink = fields.groupLink;
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

/* ── Planner edit proposals (16 Oct — "planner can add and edit inventory,
 * but admin approves first") ───────────────────────────────────────────
 * A plan maker can't change a live page directly (PUT /:id/details and
 * /:id/rate-card are inventory.edit with no bare role). Instead their edit
 * is parked on the row as `pendingEdit` and an admin applies or discards it.
 * One proposal per page at a time: a newer one replaces the older.
 */
export async function proposeAssetEdit(user, assetId, fields) {
  // An admin edits directly — a proposal from them would only wait on themselves.
  if (user.role === "ADMIN") throw new ApiError(400, "USE_DIRECT_EDIT", "Admins edit pages directly.");
  const asset = await prisma.asset.findUnique({ where: { id: assetId }, select: { id: true, ownerId: true } });
  if (!asset) throw new ApiError(404, "ASSET_NOT_FOUND", "Page not found");
  // Scope (review, 16 Oct): a plan maker may suggest an edit on any page (they
  // price pages for clients); any other role that holds inventory.edit may only
  // suggest changes to a page it owns — never park an edit on someone else's.
  if (user.role !== "PLAN_MAKER" && asset.ownerId !== user.id) {
    throw new ApiError(403, "FORBIDDEN", "You can only suggest changes to your own pages.");
  }
  const pendingEdit = {};
  if ("category" in fields) pendingEdit.category = fields.category;
  if ("grade" in fields) pendingEdit.grade = fields.grade;
  if ("groupLink" in fields) pendingEdit.groupLink = fields.groupLink;
  if (fields.rateCards) pendingEdit.rateCards = dedupeRateCards(fields.rateCards);
  if (Object.keys(pendingEdit).length === 0) throw new ApiError(400, "NOTHING_TO_CHANGE", "Nothing to change.");
  return prisma.asset.update({ where: { id: assetId }, data: { pendingEdit, pendingEditById: user.id, pendingEditAt: new Date() }, include: { rateCards: true } });
}

/** Admin applies ("approve") or discards ("reject") a page's pending edit. */
export async function decideAssetEdit(assetId, decision) {
  const asset = await prisma.asset.findUnique({ where: { id: assetId } });
  if (!asset) throw new ApiError(404, "ASSET_NOT_FOUND", "Page not found");
  const pending = asset.pendingEdit;
  if (!pending || typeof pending !== "object") throw new ApiError(400, "NO_PENDING_EDIT", "This page has no edit waiting for approval.");
  const clear = { pendingEdit: null, pendingEditById: null, pendingEditAt: null };
  if (decision === "reject") return prisma.asset.update({ where: { id: assetId }, data: clear, include: { rateCards: true } });

  const data = { ...clear };
  if ("category" in pending) data.category = pending.category;
  if ("grade" in pending) data.grade = pending.grade;
  if ("groupLink" in pending) data.groupLink = pending.groupLink;
  const rateCards = Array.isArray(pending.rateCards) ? dedupeRateCards(pending.rateCards) : [];
  return prisma.$transaction(async (tx) => {
    for (const entry of rateCards) {
      await tx.rateCard.upsert({
        where: { assetId_format: { assetId, format: entry.format } },
        create: { assetId, format: entry.format, amount: entry.amount },
        update: { amount: entry.amount, effectiveFrom: new Date() },
      });
    }
    return tx.asset.update({ where: { id: assetId }, data, include: { rateCards: true } });
  });
}

/* ── "Is this page still up?" (17 Oct — plan wizard) ─────────────────────
 * Before a plan goes out, its pages are confirmed to exist on Instagram.
 * Only pages not confirmed within the last 24h cost an Apify call; the rest
 * answer from their last check. A page Instagram knows nothing about
 * (deactivated, renamed, private) is marked `profileBroken` so the wizard
 * can offer a replacement; one it finds has its numbers refreshed too.
 */
export const PROFILE_CHECK_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export async function checkProfiles(assetIds, { maxAgeMs = PROFILE_CHECK_MAX_AGE_MS, force = false } = {}) {
  const assets = await prisma.asset.findMany({
    where: { id: { in: [...new Set(assetIds)] } },
    select: { id: true, handle: true, platform: true, profileCheckedAt: true, profileBroken: true, lastScrapeError: true },
  });
  const now = Date.now();
  const stale = (a) => force || !a.profileCheckedAt || now - new Date(a.profileCheckedAt).getTime() > maxAgeMs;
  const due = assets.filter((a) => a.platform === "instagram" && stale(a));
  let results = {};
  let error = null;
  if (due.length > 0) {
    try {
      results = await ApifyInstagramProvider.getAccountMetricsBatch(due.map((a) => a.handle));
    } catch (err) {
      console.error("checkProfiles: Apify batch failed", err);
      error = "Couldn't reach Instagram right now. Pages checked earlier show their last result.";
    }
  }
  const out = [];
  for (const a of assets) {
    if (!due.includes(a)) {
      out.push({ assetId: a.id, handle: a.handle, broken: a.profileBroken === true, checkedAt: a.profileCheckedAt, fresh: false, reason: a.profileBroken ? a.lastScrapeError : null });
      continue;
    }
    const metrics = results[a.handle];
    if (metrics === undefined) {
      // Not answered (outage, timeout): say so rather than guess either way.
      out.push({ assetId: a.id, handle: a.handle, broken: a.profileBroken === true, checkedAt: a.profileCheckedAt, fresh: false, unknown: true, reason: a.profileBroken ? a.lastScrapeError : null });
      continue;
    }
    if (metrics === null) {
      const reason = "Not found on Instagram — deactivated, renamed or private.";
      await prisma.asset.update({ where: { id: a.id }, data: { profileBroken: true, profileCheckedAt: new Date(), lastScrapeError: reason } });
      out.push({ assetId: a.id, handle: a.handle, broken: true, checkedAt: new Date(), fresh: true, reason });
      continue;
    }
    try {
      // Found: store the fresh numbers (applyProfileMetrics also clears broken + stamps the check).
      await applyProfileMetrics(a.id, metrics);
    } catch (err) {
      console.error(`checkProfiles: couldn't store metrics for ${a.handle}`, err);
      await prisma.asset.update({ where: { id: a.id }, data: { profileBroken: false, profileCheckedAt: new Date() } });
    }
    out.push({ assetId: a.id, handle: a.handle, broken: false, checkedAt: new Date(), fresh: true, reason: null });
  }
  return { results: out, checked: due.length, ...(error ? { error } : {}) };
}

/* ── Remove a page (16 Oct — "inventory remove option, admin only") ──────
 * A page that has posted (links) or sits on an approved plan is history
 * other records point at — it can be deactivated, not deleted. Anything
 * else goes, along with its draft/rejected plan lines, rate cards and
 * snapshots (the latter two cascade in the schema).
 */
export async function deleteAsset(assetId) {
  const asset = await prisma.asset.findUnique({ where: { id: assetId }, select: { id: true, handle: true } });
  if (!asset) throw new ApiError(404, "ASSET_NOT_FOUND", "Page not found");
  const links = await prisma.link.count({ where: { assetId } });
  if (links > 0) throw new ApiError(409, "ASSET_IN_USE", `@${asset.handle} has ${links} post${links === 1 ? "" : "s"} on record — deactivate it instead of deleting.`);
  const approvedLines = await prisma.planItem.count({ where: { assetId, plan: { status: "APPROVED" } } });
  if (approvedLines > 0) throw new ApiError(409, "ASSET_IN_USE", `@${asset.handle} is on an approved plan — deactivate it instead of deleting.`);
  await prisma.$transaction([prisma.planItem.deleteMany({ where: { assetId } }), prisma.asset.delete({ where: { id: assetId } })]);
  return { id: assetId };
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

/** A parsed row's vendor columns as one object, or null when the sheet had no vendor data for that row. */
function vendorOf(row) {
  const name = row.vendorName?.trim() || null;
  const phone = row.vendorPhone?.trim() || null;
  const email = row.vendorEmail?.trim().toLowerCase() || null;
  return name || phone || email ? { name, phone, email } : null;
}

/** What a vendor is called in a message: its name, else its contact. */
function vendorLabel(vendor) {
  return vendor.name || vendor.phone || vendor.email;
}

/**
 * Matches a sheet's vendor (14 Oct — Vendor Name + Vendor Contact columns)
 * to an existing creator account: by phone first (last 10 digits), then
 * email, then exact name (all case-insensitive). A name shared by two
 * accounts is ambiguous — `ambiguous: true`, never silently picked, and not
 * offered as a new vendor either. No match at all → `isNew: true`.
 */
export function resolveVendor(vendor, owners) {
  if (!vendor) return { owner: null, reason: null, isNew: false, ambiguous: false };
  if (vendor.phone) {
    const key = phoneKey(vendor.phone);
    const byPhone = key.length >= 10 ? owners.find((o) => phoneKey(o.phoneNumber) === key) : null;
    if (byPhone) return { owner: byPhone, reason: null, isNew: false, ambiguous: false };
  }
  if (vendor.email) {
    const lower = vendor.email.trim().toLowerCase();
    const byEmail = owners.find((o) => o.email && o.email.trim().toLowerCase() === lower);
    if (byEmail) return { owner: byEmail, reason: null, isNew: false, ambiguous: false };
  }
  if (vendor.name) {
    const lower = vendor.name.trim().toLowerCase();
    const byName = owners.filter((o) => o.name && o.name.trim().toLowerCase() === lower);
    if (byName.length === 1) return { owner: byName[0], reason: null, isNew: false, ambiguous: false };
    if (byName.length > 1) {
      return { owner: null, reason: `"${vendor.name}" matches ${byName.length} vendor accounts — add their phone or email, or pick one.`, isNew: false, ambiguous: true };
    }
  }
  return { owner: null, reason: `New vendor: ${vendorLabel(vendor)}`, isNew: true, ambiguous: false };
}

/** Grouping key for one new vendor across rows: last 10 phone digits, else lowercased email, else lowercased name. */
function vendorKey(vendor) {
  if (vendor.phone) return phoneKey(vendor.phone);
  if (vendor.email) return vendor.email.trim().toLowerCase();
  return vendor.name.trim().toLowerCase();
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
 *   owner-unknown  — owner cell didn't match any creator; admin picks one.
 *                    A row with vendor columns that match no account is
 *                    "New vendor: …" and is grouped into `newVendors` so the
 *                    popup can approve + create that vendor (14 Oct)
 *
 * Every row carries `vendor` ({name, phone, email} or null). A CREATOR
 * caller never gets vendor data back: `vendor` is null and `newVendors` is [].
 *
 * A CREATOR's own import (25 Sep) never reaches owner-missing/owner-unknown —
 * every row is forced onto their own account regardless of the sheet's owner
 * column, and the full creator list is never fetched or returned to them
 * (an ordinary Creator has no business seeing every other creator's name,
 * phone and email — this was a real leak before this role could reach here).
 */
/**
 * Import sheet's required cells (17 Oct — "mandatory fields are page name,
 * page link, vendor and phone number, entertainment, reel, story cost"):
 * Page Link is what the row is (an invalid one is "invalid"); the vendor is
 * the account the row resolves to (missing → "owner-missing"/"owner-unknown",
 * and a new vendor needs a contact to be created); this names the rest.
 * Creators' own sheets carry no rates or vendor, so only Page Name applies.
 */
export const IMPORT_REQUIRED_RATES = ["entertainment", "reel", "story"];
export function missingImportFields(row, { isCreator = false } = {}) {
  const missing = [];
  if (!row.pageName?.trim()) missing.push("Page Name");
  if (!isCreator) {
    const have = new Set(dedupeRateCards(row.rateCards).map((rc) => rc.format));
    for (const f of IMPORT_REQUIRED_RATES) if (!have.has(f)) missing.push(`${formatLabel(f)} Rate`);
  }
  return missing;
}

export async function previewImport(parsed, user) {
  const isCreator = user?.role === "CREATOR";
  const isAdmin = user?.role === "ADMIN";
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
  const newVendorRows = [];
  const rows = parsed.rows.map((row) => {
    // A creator's own sheet: vendor columns are ignored entirely.
    const vendor = isCreator ? null : vendorOf(row);
    // missingRates (16 Oct): an admin's row without a Reel or Story rate
    // still imports, but lands pending until those rates are set.
    // Empty for anyone else — their pages land pending, without rates, anyway.
    const missingRates = isAdmin ? missingRequiredRates(row.rateCards) : [];
    const base = { rowNumber: row.rowNumber, rawHandle: row.rawHandle, handle: row.handle, pageName: row.pageName ?? null, category: row.category, grade: row.grade ?? null, groupLink: row.groupLink ?? null, followers: row.followers, rateCards: row.rateCards, missingRates, missingFields: [], ownerRef: row.ownerRef, vendor, owner: null, ownerId: null, status: "ready", reason: null };
    if (row.problem) return { ...base, status: "invalid", reason: row.problem };
    const key = row.handle.toLowerCase();
    if (seen.has(key)) return { ...base, status: "duplicate", reason: "Same handle appears earlier in this sheet." };
    seen.add(key);

    const matches = existingByHandle.get(key) ?? [];

    // Required cells (17 Oct). A page already in Inventory is reported as such
    // instead — nothing would be created from that row anyway.
    const missingFields = missingImportFields(row, { isCreator });
    if (missingFields.length > 0 && matches.length === 0) {
      return { ...base, missingFields, status: "incomplete", reason: `Missing: ${missingFields.join(", ")}.` };
    }

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

    // Vendor columns, when the row has them, decide the owner; otherwise the legacy owner cell does.
    const { owner, reason, isNew } = vendor ? resolveVendor(vendor, owners) : resolveOwnerRef(row.ownerRef, owners);
    if (owner) {
      const same = matches.find((a) => a.ownerId === owner.id);
      if (same) return { ...base, owner, ownerId: owner.id, status: "exists", reason: `Already in Inventory under ${ownerLabel(owner)}.` };
      if (matches.length > 0) return { ...base, owner, ownerId: owner.id, status: "conflict", reason: `Already registered under ${ownerLabel(matches[0].owner)} — a page can't be under two accounts.` };
      return { ...base, owner, ownerId: owner.id };
    }
    if (matches.length > 0) {
      return { ...base, owner: matches[0].owner, ownerId: matches[0].ownerId, status: "exists", reason: `Already in Inventory under ${ownerLabel(matches[0].owner)}.` };
    }
    if (vendor) {
      if (isNew) newVendorRows.push({ vendor, rowNumber: row.rowNumber });
      return { ...base, status: "owner-unknown", reason };
    }
    if (row.ownerRef) return { ...base, status: "owner-unknown", reason };
    return { ...base, status: "owner-missing", reason: parsed.hasOwnerColumn ? "Owner cell is blank." : "Sheet has no owner column." };
  });

  // One entry per new vendor, merged across its rows (first non-null value wins).
  // One entry per vendor even when rows name them differently (phone on one row, email on
  // another — the template's own examples do this): rows join a group sharing their phone or
  // email, or their name when the phones and emails don't contradict it (14 Oct review).
  const groups = [];
  const lower = (s) => (s ? s.trim().toLowerCase() : null);
  const clash = (a, b) => (a && b && a !== b);
  for (const { vendor, rowNumber } of newVendorRows) {
    const phone = vendor.phone ? phoneKey(vendor.phone) : null;
    const email = lower(vendor.email);
    const name = lower(vendor.name);
    const joins = groups.filter(
      (g) => (phone && g.phones.has(phone)) || (email && g.emails.has(email)) || (name && g.names.has(name) && ![...g.phones].some((p) => clash(p, phone)) && ![...g.emails].some((e) => clash(e, email)))
    );
    let group = joins[0];
    if (!group) {
      group = { entry: { key: vendorKey(vendor), name: vendor.name, phone: vendor.phone, email: vendor.email, rowNumbers: [] }, phones: new Set(), emails: new Set(), names: new Set() };
      groups.push(group);
    }
    for (const other of joins.slice(1)) {
      // This row links two groups: fold the later one in.
      group.entry.name ??= other.entry.name;
      group.entry.phone ??= other.entry.phone;
      group.entry.email ??= other.entry.email;
      group.entry.rowNumbers.push(...other.entry.rowNumbers);
      other.phones.forEach((p) => group.phones.add(p));
      other.emails.forEach((e) => group.emails.add(e));
      other.names.forEach((n) => group.names.add(n));
      groups.splice(groups.indexOf(other), 1);
    }
    group.entry.name ??= vendor.name;
    group.entry.phone ??= vendor.phone;
    group.entry.email ??= vendor.email;
    group.entry.rowNumbers.push(rowNumber);
    if (phone) group.phones.add(phone);
    if (email) group.emails.add(email);
    if (name) group.names.add(name);
  }
  for (const g of groups) g.entry.rowNumbers.sort((a, b) => a - b);
  const newVendors = isCreator ? [] : groups.map((g) => g.entry);

  const summary = {};
  for (const r of rows) summary[r.status] = (summary[r.status] ?? 0) + 1;
  return { rows, summary, totalRows: rows.length, hasOwnerColumn: parsed.hasOwnerColumn, owners, newVendors };
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
          // Grade + group link (16 Oct), optional sheet columns.
          grade: input.grade ?? null,
          groupLink: input.groupLink ?? null,
          // The sheet's Page Name until Instagram gives its own (applyProfileMetrics below keeps it when Instagram has none).
          fullName: input.pageName?.trim() || null,
          followers: Math.min(metrics.followers ?? input.followers ?? 0, 2_147_483_647),
          // An admin's row missing a required rate imports pending (14 Oct).
          approvalStatus: isAdmin && missingRequiredRates(rateCards).length === 0 ? "approved" : "pending",
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

/**
 * Admin's Active / Inactive switch for a page (8 Oct). Inactive only stops the
 * page being added to new plans; it stays everywhere else (campaigns, posts,
 * payouts, plans it's already on).
 */
export async function setAssetActive(assetId, isActive) {
  const asset = await prisma.asset.findUnique({ where: { id: assetId }, select: { id: true } });
  if (!asset) throw new ApiError(404, "ASSET_NOT_FOUND", "Page not found");
  return prisma.asset.update({ where: { id: assetId }, data: { isActive } });
}
