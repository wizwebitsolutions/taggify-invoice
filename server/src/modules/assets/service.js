import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../middleware/errorHandler.js";
import { refreshAssetMetrics, applyProfileMetrics } from "../scraping/service.js";
import { ApifyInstagramProvider } from "../../lib/apifyClient.js";
import { normalizeHandle, isValidHandle, parseImportSheet, ImportParseError } from "./importParser.js";
import { fetchSheetCsv } from "../campaigns/service.js";

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
    // owner name/phone — Inventory's "filter by page owner" (newTask.md, 9
    // Sep) needs something human-readable to filter/group by; a Creator
    // only ever sees their own assets anyway, so this is a no-op for them.
    // assignments -> campaign — Inventory card's "campaigns they've made"
    // (user request, 11 Sep): every campaign this page has been assigned to,
    // via CampaignAssignment, deduped below (one page can have more than one
    // assignment row against the same campaign, e.g. re-attached sheets).
    include: {
      rateCards: true,
      owner: { select: { id: true, name: true, phoneNumber: true } },
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

/**
 * Avg. Likes / Comments / Views across this asset's posts (creator.wldd.in's
 * "Performance Metrics" on the Assets page) — one figure per link, taken
 * from its most recent scrape, averaged across every link that's been
 * scraped at least once. Links with no snapshot yet don't count toward it.
 */
export async function getAvgEngagement(assetId, asset = null) {
  const links = await prisma.link.findMany({
    where: { assetId },
    select: { postSnapshots: { orderBy: { capturedAt: "desc" }, take: 1 } },
  });
  const latest = links.map((l) => l.postSnapshots[0]).filter(Boolean);
  if (latest.length === 0) {
    // No links through the app yet — fall back to the profile-level
    // averages the Apify profile scrape stored (Inventory "Create page",
    // 14 Sep), so a freshly added page isn't stuck on "N/A".
    const profile = asset ?? (await prisma.asset.findUnique({ where: { id: assetId }, select: { profileAvgViews: true, profileAvgLikes: true, profileAvgComments: true, profileSampleSize: true } }));
    if (profile?.profileSampleSize > 0) {
      return { avgLikes: profile.profileAvgLikes, avgComments: profile.profileAvgComments, avgViews: profile.profileAvgViews, sampleSize: profile.profileSampleSize, source: "profile" };
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

export async function createAsset(user, { platform, handle, category, ownerId, rateCards }) {
  // Only an admin may register a page on someone else's behalf (the "create
  // a user with their first page(s)" flow on the Users page); a CREATOR
  // creating their own page never sends ownerId, so this never fires for them.
  if (ownerId && ownerId !== user.id && user.role !== "ADMIN") {
    throw new ApiError(403, "FORBIDDEN", "Only an admin can register a page for another user");
  }
  // Only a CREATOR account owns pages — an admin picking (or a client
  // sending) any other account's id is a mistake, not a page to create.
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
      .then(() => warmProfilePicCache(assetId))
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
  await warmProfilePicCache(assetId);
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
// 24h, matching assetProfileRescrapeJob's own cadence — warmProfilePicCache
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
  const asset = await prisma.asset.findUnique({ where: { id: assetId }, select: { profilePicUrl: true } });
  if (!asset?.profilePicUrl) throw new ApiError(404, "NO_PROFILE_PIC", "This page has no profile picture yet");

  const ATTEMPTS = 3;
  let lastError;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const upstream = await fetch(asset.profilePicUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
      if (!upstream.ok) {
        lastError = new Error(`Instagram returned ${upstream.status}`);
      } else {
        const result = { buffer: Buffer.from(await upstream.arrayBuffer()), contentType: upstream.headers.get("content-type") ?? "image/jpeg" };
        profilePicCache.set(assetId, { ...result, cachedAt: Date.now() });
        return result;
      }
    } catch (err) {
      lastError = err;
    }
    if (attempt < ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, attempt * 300));
  }

  throw new ApiError(
    502,
    "PROFILE_PIC_FETCH_FAILED",
    `Couldn't fetch this page's profile picture from Instagram after ${ATTEMPTS} attempts: ${lastError.message}`
  );
}

/**
 * Pre-populates fetchProfilePic's cache right after a scrape gets a fresh
 * profilePicUrl, so a real viewer's <img> is served from cache instead of
 * racing Instagram live on their page load. Called from every place that
 * calls refreshAssetMetrics (createAsset, setApprovalStatus, refreshProfile,
 * and the 24h assetProfileRescrapeJob cron) — never throws, since a failed
 * warm-up just means the on-demand path (still retried there) handles it
 * whenever someone actually views the card.
 */
export async function warmProfilePicCache(assetId) {
  try {
    await fetchProfilePic(assetId);
  } catch (err) {
    console.error(`warmProfilePicCache: couldn't pre-fetch asset ${assetId}'s profile picture`, err);
  }
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
 */
export async function previewImport(parsed) {
  const owners = await listPageOwners();
  const handles = [...new Set(parsed.rows.map((r) => r.handle).filter(Boolean))];
  const existing = handles.length
    ? await prisma.asset.findMany({
        where: { platform: "instagram", handle: { in: handles, mode: "insensitive" } },
        select: { id: true, handle: true, ownerId: true, owner: { select: { id: true, name: true, phoneNumber: true } } },
      })
    : [];
  const existingByHandle = new Map();
  for (const a of existing) {
    const k = a.handle.toLowerCase();
    existingByHandle.set(k, [...(existingByHandle.get(k) ?? []), a]);
  }

  const seen = new Set();
  const rows = parsed.rows.map((row) => {
    const base = { rowNumber: row.rowNumber, rawHandle: row.rawHandle, handle: row.handle, category: row.category, followers: row.followers, rateCards: row.rateCards, ownerRef: row.ownerRef, owner: null, ownerId: null, status: "ready", reason: null };
    if (row.problem) return { ...base, status: "invalid", reason: row.problem };
    const key = row.handle.toLowerCase();
    if (seen.has(key)) return { ...base, status: "duplicate", reason: "Same handle appears earlier in this sheet." };
    seen.add(key);

    const { owner, reason } = resolveOwnerRef(row.ownerRef, owners);
    const matches = existingByHandle.get(key) ?? [];
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
 * Creates the confirmed rows. Re-validates everything the preview did —
 * the client's confirmation is a list of intents, not a trusted state —
 * so a handle registered by someone else between preview and confirm is
 * skipped with a reason rather than erroring the whole batch (same
 * created-vs-skipped pattern as links' bulk upload). Only an ADMIN reaches
 * this (routes.js), and only CREATOR accounts can own pages.
 */
export async function importAssets(user, rows) {
  const owners = await listPageOwners();
  const ownerById = new Map(owners.map((o) => [o.id, o]));
  const created = [];
  const skipped = [];
  const seen = new Set();
  const toScrape = [];

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
    const owner = ownerById.get(input.ownerId);
    if (!owner) {
      skipped.push({ handle, reason: "Pick a creator account for this page." });
      continue;
    }
    const clash = await prisma.asset.findFirst({
      where: { platform: "instagram", handle: { equals: handle, mode: "insensitive" } },
      select: { ownerId: true, owner: { select: { name: true, phoneNumber: true } } },
    });
    if (clash) {
      skipped.push({ handle, reason: clash.ownerId === owner.id ? `Already in Inventory under ${ownerLabel(owner)}.` : `Already registered under ${ownerLabel(clash.owner)}.` });
      continue;
    }
    const rateCards = dedupeRateCards(input.rateCards);
    let asset;
    try {
      asset = await prisma.asset.create({
        data: {
          ownerId: owner.id,
          platform: "instagram",
          handle,
          category: input.category || null,
          followers: Math.min(input.followers ?? 0, 2_147_483_647),
          // Admin-only route (routes.js) → approved on creation, same as createAsset.
          approvalStatus: "approved",
          ...(rateCards.length > 0 ? { rateCards: { create: rateCards.map((rc) => ({ format: rc.format, amount: rc.amount })) } } : {}),
        },
        select: { id: true, handle: true, ownerId: true },
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
    created.push({ ...asset, owner: { id: owner.id, name: owner.name, phoneNumber: owner.phoneNumber } });

    // The preview already scraped this handle a moment ago — store that
    // instead of queueing a second identical Apify run.
    const scraped = takePreviewScrape(handle);
    if (scraped) {
      try {
        await applyProfileMetrics(asset.id, scraped);
        warmProfilePicCache(asset.id);
        continue;
      } catch (err) {
        console.error(`importAssets: couldn't store preview scrape for ${handle}`, err);
      }
    }
    toScrape.push(asset.id);
  }

  // Same background scrape createAsset() does for a single page, but one
  // at a time — 200 imported pages firing 200 concurrent Apify actor runs
  // would just get throttled/failed at Apify's end. Not awaited.
  await markScrapeQueued(toScrape);
  void scrapeSequentially(toScrape);

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
      await warmProfilePicCache(id);
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
export async function previewImportFromSheetUrl(url) {
  const csv = await fetchSheetCsv(url);
  const parsed = await parseImportSheetOrThrow(Buffer.from(csv, "utf8"), "sheet.csv");
  return previewImport(parsed);
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

/**
 * Live follower counts / avg views for the handles on a preview — one
 * Apify run for the whole batch. Handles that came back private/missing
 * are null (the row still imports; the post-create scrape retries them).
 * A total failure (Apify down, no token) is a 502 the modal shows as
 * "couldn't fetch now" — never a reason to block the import itself.
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
    throw new ApiError(502, "FOLLOWERS_FETCH_FAILED", `Couldn't fetch follower counts from Instagram right now (${String(err?.message ?? err).slice(0, 120)}). They'll be fetched after import instead.`);
  }
  // A handle absent from `results` (its chunk timed out) is left out of the
  // response — "unknown", not "not found" — so the modal keeps the sheet's
  // number and the post-import scrape fills it in.
  const profiles = {};
  for (const handle of clean) {
    if (!(handle in results)) continue;
    const metrics = results[handle];
    if (metrics) previewScrapeCache.set(handle.toLowerCase(), { metrics, at: Date.now() });
    profiles[handle] = metrics ? { followers: metrics.followers, avgViews: metrics.avgViews, avgLikes: metrics.avgLikes, avgComments: metrics.avgComments, fullName: metrics.fullName } : null;
  }
  return { profiles };
}

function takePreviewScrape(handle) {
  const key = handle.toLowerCase();
  const hit = previewScrapeCache.get(key);
  if (!hit) return null;
  previewScrapeCache.delete(key);
  return Date.now() - hit.at < PREVIEW_SCRAPE_TTL_MS ? hit.metrics : null;
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
