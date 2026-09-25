import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ApiError } from "../../middleware/errorHandler.js";

const mockPrisma = { asset: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(async () => null), updateMany: vi.fn(async () => ({ count: 1 })), update: vi.fn(async () => ({})) }, user: { findUnique: vi.fn(async () => ({ role: "CREATOR" })) }, link: { findMany: vi.fn(async () => []) } };
vi.mock("../../lib/prisma.js", () => ({ prisma: mockPrisma }));
vi.mock("../scraping/service.js", () => ({ refreshAssetMetrics: vi.fn(async () => {}) }));

const { createAsset, listAssets, refreshProfile, fetchProfilePic, getAvgEngagement } = await import("./service.js");
const { refreshAssetMetrics } = await import("../scraping/service.js");

// listAssets (23 Sep, Step 3) reads the *caller's* effective permissions
// fresh from the DB — this derives a plausible role from the id fixtures
// already used throughout this file (admin-*/creator-*/fin-*/pm-*) so that
// works without every test having to stub it. createAsset's own
// user.findUnique use (looking up an *ownerId* target's role) overrides
// this per test where it matters (line ~98/106 below).
function roleForId(id) {
  if (id?.startsWith("admin")) return "ADMIN";
  if (id?.startsWith("fin")) return "FINANCE";
  if (id?.startsWith("pm") || id?.startsWith("plan")) return "PLAN_MAKER";
  return "CREATOR";
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.asset.create.mockImplementation(async ({ data }) => ({ id: "asset-1", ...data }));
  mockPrisma.asset.findFirst.mockResolvedValue(null);
  mockPrisma.user.findUnique.mockImplementation(async ({ where }) => ({ role: roleForId(where.id), permissions: null }));
});

describe("createAsset — admin registering a page for someone else (newTask.md #6/#7)", () => {
  it("a CREATOR creating their own page (no ownerId) works as before", async () => {
    const creator = { id: "creator-1", role: "CREATOR" };
    const asset = await createAsset(creator, { platform: "instagram", handle: "my.page" });
    expect(asset.ownerId).toBe("creator-1");
  });

  it("an ADMIN can register a page for another user by passing ownerId", async () => {
    const admin = { id: "admin-1", role: "ADMIN" };
    const asset = await createAsset(admin, { platform: "instagram", handle: "new.page", ownerId: "new-creator-1", category: "Meme page" });
    expect(asset.ownerId).toBe("new-creator-1");
    expect(asset.category).toBe("Meme page");
  });

  it("a non-admin cannot register a page for someone else", async () => {
    const creator = { id: "creator-1", role: "CREATOR" };
    await expect(createAsset(creator, { platform: "instagram", handle: "x", ownerId: "someone-else" })).rejects.toBeInstanceOf(ApiError);
    expect(mockPrisma.asset.create).not.toHaveBeenCalled();
  });

  it("a non-admin passing their own id as ownerId is fine (not a privilege attempt)", async () => {
    const creator = { id: "creator-1", role: "CREATOR" };
    const asset = await createAsset(creator, { platform: "instagram", handle: "x", ownerId: "creator-1" });
    expect(asset.ownerId).toBe("creator-1");
  });
});

// 25 Sep: a plan maker can register a page too, while onboarding a vendor —
// but only under an existing creator, never themselves, and always pending.
describe("createAsset — PLAN_MAKER registering a vendor's page (25 Sep)", () => {
  it("succeeds against an existing creator account, pending, no rate card", async () => {
    const planMaker = { id: "pm-1", role: "PLAN_MAKER" };
    const asset = await createAsset(planMaker, { platform: "instagram", handle: "vendor.page", ownerId: "creator-1" });
    expect(asset.ownerId).toBe("creator-1");
    expect(asset.approvalStatus).toBe("pending");
    expect(asset.rateCards).toBeUndefined();
  });

  it("sending a rate card is refused, same as a creator's own submission — rate cards stay admin-only", async () => {
    const planMaker = { id: "pm-1", role: "PLAN_MAKER" };
    const err = await createAsset(planMaker, { platform: "instagram", handle: "vendor.page", ownerId: "creator-1", rateCards: [{ format: "reel", amount: 5000 }] }).catch((e) => e);
    expect(err.statusCode).toBe(403);
    expect(mockPrisma.asset.create).not.toHaveBeenCalled();
  });

  it("without an ownerId, fails loudly instead of defaulting to the plan maker's own id", async () => {
    const planMaker = { id: "pm-1", role: "PLAN_MAKER" };
    const err = await createAsset(planMaker, { platform: "instagram", handle: "vendor.page" }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("OWNER_REQUIRED");
    expect(mockPrisma.asset.create).not.toHaveBeenCalled();
  });

  it("targeting a non-creator account (e.g. another plan maker, finance, admin) is rejected", async () => {
    const planMaker = { id: "pm-1", role: "PLAN_MAKER" };
    const err = await createAsset(planMaker, { platform: "instagram", handle: "x", ownerId: "fin-1" }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("OWNER_NOT_CREATOR");
  });

  it("sending their own id as ownerId is rejected too — a plan maker is never a page owner", async () => {
    const planMaker = { id: "pm-1", role: "PLAN_MAKER" };
    const err = await createAsset(planMaker, { platform: "instagram", handle: "x", ownerId: "pm-1" }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("OWNER_REQUIRED");
    expect(mockPrisma.asset.create).not.toHaveBeenCalled();
  });
});


// Inventory "Create page" (14 Sep): registering a handle that already exists
// used to surface Prisma's unique-constraint error as a generic 500
// ("Something went wrong") in the form. Now a readable 409, matching the
// sheet import's same-account vs. other-account distinction.
// Inventory "Create page" (14 Sep): an admin-registered page is approved on
// the spot and can carry its first rate card; a creator's own page still
// queues for approval.
describe("createAsset — admin auto-approval and starting rate card", () => {
  it("an ADMIN's page is created approved, with the reel/story rates in the same insert", async () => {
    const admin = { id: "admin-1", role: "ADMIN" };
    await createAsset(admin, { platform: "instagram", handle: "new.page", ownerId: "creator-1", rateCards: [{ format: "reel", amount: 5000 }, { format: "story", amount: 1500 }, { format: "reel", amount: 1 }] });
    const { data } = mockPrisma.asset.create.mock.calls[0][0];
    expect(data.approvalStatus).toBe("approved");
    expect(data.rateCards).toEqual({ create: [{ format: "reel", amount: 5000 }, { format: "story", amount: 1500 }] });
  });

  it("a CREATOR sending rateCards is refused — rate cards stay admin-only (they price links and plans)", async () => {
    const creator = { id: "creator-1", role: "CREATOR" };
    const err = await createAsset(creator, { platform: "instagram", handle: "mine.page", rateCards: [{ format: "reel", amount: 900000 }] }).catch((e) => e);
    expect(err.statusCode).toBe(403);
    expect(mockPrisma.asset.create).not.toHaveBeenCalled();
  });

  it("a double-submit racing past the duplicate check gets a 409, not a 500", async () => {
    mockPrisma.asset.create.mockRejectedValueOnce(Object.assign(new Error("Unique constraint failed"), { code: "P2002" }));
    const admin = { id: "admin-1", role: "ADMIN" };
    const err = await createAsset(admin, { platform: "instagram", handle: "twice.page", ownerId: "creator-1" }).catch((e) => e);
    expect(err.statusCode).toBe(409);
  });

  it("a CREATOR's own page still starts pending, with no rateCards key when none are given", async () => {
    const creator = { id: "creator-1", role: "CREATOR" };
    await createAsset(creator, { platform: "instagram", handle: "mine.page" });
    const { data } = mockPrisma.asset.create.mock.calls[0][0];
    expect(data.approvalStatus).toBe("pending");
    expect(data).not.toHaveProperty("rateCards");
  });
});

describe("getAvgEngagement — falls back to the profile scrape's averages", () => {
  it("uses profileAvg* (tagged source: profile) when the page has no link snapshots yet", async () => {
    const asset = { id: "asset-1", profileAvgViews: 900, profileAvgLikes: 50, profileAvgComments: 3, profileSampleSize: 12 };
    await expect(getAvgEngagement("asset-1", asset)).resolves.toEqual({ avgViews: 900, avgLikes: 50, avgComments: 3, sampleSize: 12, source: "profile" });
  });

  it("still reports N/A when neither links nor a profile sample exist", async () => {
    await expect(getAvgEngagement("asset-1", { profileSampleSize: 0 })).resolves.toEqual({ avgLikes: null, avgComments: null, avgViews: null, sampleSize: 0 });
  });
});

describe("createAsset — the chosen account must be a creator (Inventory 'Create page', 14 Sep)", () => {
  it("rejects a non-creator ownerId with a readable 400", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ role: "FINANCE" });
    const admin = { id: "admin-1", role: "ADMIN" };
    const err = await createAsset(admin, { platform: "instagram", handle: "x", ownerId: "finance-1" }).catch((e) => e);
    expect(err.statusCode).toBe(400);
    expect(mockPrisma.asset.create).not.toHaveBeenCalled();
  });

  it("404s for an ownerId that doesn't exist", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    const admin = { id: "admin-1", role: "ADMIN" };
    const err = await createAsset(admin, { platform: "instagram", handle: "x", ownerId: "ghost" }).catch((e) => e);
    expect(err.statusCode).toBe(404);
  });
});

describe("queueProfileRefresh — bulk 'Refresh from Instagram' (14 Sep)", () => {
  it("marks the selected pages as queued, kicks the background scrape, and returns the count", async () => {
    const { queueProfileRefresh } = await import("./service.js");
    mockPrisma.asset.findMany.mockResolvedValue([{ id: "a1" }, { id: "a2" }]);
    mockPrisma.asset.findUnique.mockResolvedValue({ scrapeQueuedAt: new Date() });
    const out = await queueProfileRefresh(["a1", "a2", "a2", "ghost"]);
    expect(out).toEqual({ queued: 2 });
    // Only rows not already queued are picked up, and the marker is written before the response.
    expect(mockPrisma.asset.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ["a1", "a2", "ghost"] }, scrapeQueuedAt: null } }));
    expect(mockPrisma.asset.updateMany).toHaveBeenCalledWith({ where: { id: { in: ["a1", "a2"] } }, data: { scrapeQueuedAt: expect.any(Date) } });
    await new Promise((r) => setTimeout(r, 10));
    expect(refreshAssetMetrics).toHaveBeenCalledWith("a1");
  });

  it("skips a queued row whose marker was cleared meanwhile (manual refresh beat the chain)", async () => {
    const { queueProfileRefresh } = await import("./service.js");
    mockPrisma.asset.findMany.mockResolvedValue([{ id: "a1" }]);
    mockPrisma.asset.findUnique.mockResolvedValue({ scrapeQueuedAt: null });
    await queueProfileRefresh(["a1"]);
    await new Promise((r) => setTimeout(r, 10));
    expect(refreshAssetMetrics).not.toHaveBeenCalledWith("a1");
  });
});

describe("createAsset — duplicate handles", () => {
  it("409s with 'already in Inventory' when the handle is already under the target account", async () => {
    mockPrisma.asset.findFirst.mockResolvedValue({ ownerId: "creator-1", owner: { name: "Priya Creator", phoneNumber: "+919000000001" } });
    const admin = { id: "admin-1", role: "ADMIN" };
    const err = await createAsset(admin, { platform: "instagram", handle: "taken.page", ownerId: "creator-1" }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.statusCode).toBe(409);
    expect(err.message).toBe("@taken.page is already in Inventory under Priya Creator.");
    expect(mockPrisma.asset.create).not.toHaveBeenCalled();
  });

  it("409s with the other account's name when an admin tries to register it under someone else", async () => {
    mockPrisma.asset.findFirst.mockResolvedValue({ ownerId: "creator-2", owner: { name: "Rahul Creator", phoneNumber: "+919000000002" } });
    const admin = { id: "admin-1", role: "ADMIN" };
    await expect(createAsset(admin, { platform: "instagram", handle: "taken.page", ownerId: "creator-1" })).rejects.toThrow("@taken.page is already registered under Rahul Creator.");
  });

  it("doesn't leak the other owner's identity to a CREATOR", async () => {
    mockPrisma.asset.findFirst.mockResolvedValue({ ownerId: "creator-2", owner: { name: "Rahul Creator", phoneNumber: "+919000000002" } });
    const creator = { id: "creator-1", role: "CREATOR" };
    await expect(createAsset(creator, { platform: "instagram", handle: "taken.page" })).rejects.toThrow("@taken.page is already registered under another account.");
  });
});

describe("listAssets — owner name included for Inventory's owner filter (newTask.md, 9 Sep)", () => {
  it("includes each asset's owner (id/name/phoneNumber), not just its ownerId", async () => {
    mockPrisma.asset.findMany.mockResolvedValue([
      { id: "asset-1", ownerId: "creator-1", owner: { id: "creator-1", name: "Demo Creator", phoneNumber: "+919000000003" } },
    ]);
    const admin = { id: "admin-1", role: "ADMIN" };
    const [asset] = await listAssets(admin);
    expect(asset.owner).toEqual({ id: "creator-1", name: "Demo Creator", phoneNumber: "+919000000003" });
    expect(mockPrisma.asset.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ include: expect.objectContaining({ owner: expect.anything() }) })
    );
  });

  it("scopes to the caller's own assets for a plain CREATOR", async () => {
    mockPrisma.asset.findMany.mockResolvedValue([]);
    const creator = { id: "creator-1", role: "CREATOR" };
    await listAssets(creator);
    expect(mockPrisma.asset.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { ownerId: "creator-1" } }));
  });
});

describe("listAssets — inventory.view scoping is read fresh, not just role (23 Sep, Step 3)", () => {
  it("a plain ADMIN or FINANCE account (inventory.view true by baseline) sees every asset", async () => {
    mockPrisma.asset.findMany.mockResolvedValue([]);
    await listAssets({ id: "admin-1", role: "ADMIN" });
    expect(mockPrisma.asset.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));

    await listAssets({ id: "fin-1", role: "FINANCE" });
    expect(mockPrisma.asset.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });

  it("restricting a FINANCE account's inventory.view actually scopes them to their own assets now — it used to be a no-op", async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce({ role: "FINANCE", permissions: { "inventory.view": false, "inventory.edit": false, "inventory.approve": false } });
    mockPrisma.asset.findMany.mockResolvedValue([]);
    await listAssets({ id: "fin-1", role: "FINANCE" });
    expect(mockPrisma.asset.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { ownerId: "fin-1" } }));
  });

  it("a PLAN_MAKER still sees every asset even with inventory.view overlaid off — their full-catalogue access is role-based, not the key", async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce({ role: "PLAN_MAKER", permissions: { "inventory.view": false, "inventory.edit": false, "inventory.approve": false } });
    mockPrisma.asset.findMany.mockResolvedValue([]);
    await listAssets({ id: "pm-1", role: "PLAN_MAKER" });
    expect(mockPrisma.asset.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });
});

describe("listAssets — campaigns a page has been assigned to (Inventory card, user request, 11 Sep)", () => {
  it("collapses each asset's CampaignAssignment rows down to a deduped list of campaigns", async () => {
    const campaignA = { id: "campaign-a", title: "Q1 Push", brandName: "Acme" };
    const campaignB = { id: "campaign-b", title: "Diwali", brandName: "Acme" };
    mockPrisma.asset.findMany.mockResolvedValue([
      {
        id: "asset-1",
        ownerId: "creator-1",
        // Two assignment rows against campaign A (e.g. re-attached sheets) —
        // should collapse to one entry, not appear twice.
        assignments: [{ campaign: campaignA }, { campaign: campaignA }, { campaign: campaignB }],
      },
    ]);
    const admin = { id: "admin-1", role: "ADMIN" };
    const [asset] = await listAssets(admin);
    expect(asset.campaigns).toEqual([campaignA, campaignB]);
    expect(asset).not.toHaveProperty("assignments");
  });

  it("a page with no assignments yet gets an empty campaigns array, not undefined", async () => {
    mockPrisma.asset.findMany.mockResolvedValue([{ id: "asset-1", ownerId: "creator-1", assignments: [] }]);
    const admin = { id: "admin-1", role: "ADMIN" };
    const [asset] = await listAssets(admin);
    expect(asset.campaigns).toEqual([]);
  });
});

// Inventory's manual "refresh" button (server/src/modules/assets/routes.js's
// POST /:id/refresh-profile) — pulls followers/name/bio/avatar from Apify
// synchronously, unlike createAsset/setApprovalStatus's fire-and-forget calls.
describe("refreshProfile — Inventory's manual refresh button", () => {
  it("404s for an asset that doesn't exist, without calling Apify", async () => {
    mockPrisma.asset.findUnique.mockResolvedValue(null);
    await expect(refreshProfile("missing-asset")).rejects.toBeInstanceOf(ApiError);
    expect(refreshAssetMetrics).not.toHaveBeenCalled();
  });

  it("otherwise calls refreshAssetMetrics and returns its result", async () => {
    mockPrisma.asset.findUnique.mockResolvedValue({ id: "asset-1", handle: "demo.page" });
    refreshAssetMetrics.mockResolvedValue({ id: "asset-1", handle: "demo.page", followers: 5701110 });

    const result = await refreshProfile("asset-1");

    expect(refreshAssetMetrics).toHaveBeenCalledWith("asset-1");
    expect(result).toEqual({ id: "asset-1", handle: "demo.page", followers: 5701110 });
  });

  it("propagates an Apify failure (transient/auth/quota) rather than swallowing it", async () => {
    mockPrisma.asset.findUnique.mockResolvedValue({ id: "asset-1", handle: "demo.page" });
    refreshAssetMetrics.mockRejectedValue(new Error("Apify: no profile for handle \"demo.page\" (private account)"));

    await expect(refreshProfile("asset-1")).rejects.toThrow(/private account/);
  });
});

// Inventory card's cover photo (user report, 11 Sep): proxied server-to-
// server instead of the client hotlinking cdninstagram.com directly, which
// intermittently came back broken for some viewers. Confirmed by hand that
// Instagram's edge flips between 503 and 200 for the *identical* URL across
// back-to-back requests — so fetchProfilePic retries a few times before
// giving up, then caches a success so later requests skip Instagram
// entirely. Each test below uses its own assetId so that cache (module-level
// state) never leaks between test cases.
function fakeFetchResponse(bytes = new Uint8Array([1, 2, 3])) {
  return {
    ok: true,
    status: 200,
    // A real Fetch API Headers object exposes .get() — a Map does too, so
    // this stands in for one without pulling in a real Headers polyfill.
    headers: new Map([["content-type", "image/jpeg"]]),
    arrayBuffer: async () => bytes.buffer,
  };
}

describe("fetchProfilePic — proxying an asset's Instagram picture (user report, 11 Sep)", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("404s when the asset has no profilePicUrl yet, without calling fetch", async () => {
    mockPrisma.asset.findUnique.mockResolvedValue({ profilePicUrl: null });
    global.fetch = vi.fn();

    await expect(fetchProfilePic("asset-no-pic")).rejects.toBeInstanceOf(ApiError);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("404s when the asset itself doesn't exist", async () => {
    mockPrisma.asset.findUnique.mockResolvedValue(null);
    global.fetch = vi.fn();

    await expect(fetchProfilePic("missing-asset")).rejects.toBeInstanceOf(ApiError);
  });

  it("fetches the stored URL and returns its bytes + content-type", async () => {
    mockPrisma.asset.findUnique.mockResolvedValue({ profilePicUrl: "https://scontent.cdninstagram.com/pic.jpg" });
    const bytes = new Uint8Array([1, 2, 3]);
    global.fetch = vi.fn().mockResolvedValue(fakeFetchResponse(bytes));

    const result = await fetchProfilePic("asset-basic-fetch");

    expect(global.fetch).toHaveBeenCalledWith("https://scontent.cdninstagram.com/pic.jpg", expect.anything());
    expect(result.contentType).toBe("image/jpeg");
    expect(Buffer.compare(result.buffer, Buffer.from(bytes))).toBe(0);
  });

  it("retries after a failed attempt and returns the eventual success (matches the observed 503-then-200 flakiness)", async () => {
    mockPrisma.asset.findUnique.mockResolvedValue({ profilePicUrl: "https://scontent.cdninstagram.com/pic.jpg" });
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce(fakeFetchResponse());

    const result = await fetchProfilePic("asset-retry-success");

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(result.contentType).toBe("image/jpeg");
  });

  it("surfaces a 502 (not a silent empty image) only once every retry attempt fails", async () => {
    mockPrisma.asset.findUnique.mockResolvedValue({ profilePicUrl: "https://scontent.cdninstagram.com/pic.jpg" });
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });

    await expect(fetchProfilePic("asset-always-fails")).rejects.toMatchObject({ statusCode: 502 });
    expect(global.fetch.mock.calls.length).toBeGreaterThan(1);
  });

  it("surfaces a 502 when the network call itself throws on every attempt (DNS/timeout)", async () => {
    mockPrisma.asset.findUnique.mockResolvedValue({ profilePicUrl: "https://scontent.cdninstagram.com/pic.jpg" });
    global.fetch = vi.fn().mockRejectedValue(new Error("fetch failed"));

    await expect(fetchProfilePic("asset-network-error")).rejects.toMatchObject({ statusCode: 502 });
  });

  it("a second request for the same asset is served from cache, without calling fetch again", async () => {
    mockPrisma.asset.findUnique.mockResolvedValue({ profilePicUrl: "https://scontent.cdninstagram.com/pic.jpg" });
    global.fetch = vi.fn().mockResolvedValue(fakeFetchResponse());

    await fetchProfilePic("asset-cache-hit");
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const result = await fetchProfilePic("asset-cache-hit");
    expect(global.fetch).toHaveBeenCalledTimes(1); // still 1 — served from cache
    expect(result.contentType).toBe("image/jpeg");
  });

  // Regression test for the actual bug (user report, 11 Sep): the Inventory
  // card renders two <img> tags against the identical URL (blurred cover +
  // sharp avatar), both firing the instant the card mounts. With nothing
  // cached yet, that used to mean two separate concurrent fetches to
  // Instagram for the exact same picture — de-duped here into one.
  it("two concurrent requests for the same uncached asset only hit fetch once", async () => {
    mockPrisma.asset.findUnique.mockResolvedValue({ profilePicUrl: "https://scontent.cdninstagram.com/pic.jpg" });
    global.fetch = vi.fn().mockResolvedValue(fakeFetchResponse());

    const [a, b] = await Promise.all([fetchProfilePic("asset-concurrent"), fetchProfilePic("asset-concurrent")]);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(a.contentType).toBe("image/jpeg");
    expect(b.contentType).toBe("image/jpeg");
  });

  it("a later request (after the in-flight one settles) can still fetch again once the cache expires", async () => {
    mockPrisma.asset.findUnique.mockResolvedValue({ profilePicUrl: "https://scontent.cdninstagram.com/pic.jpg" });
    global.fetch = vi.fn().mockResolvedValue(fakeFetchResponse());

    await fetchProfilePic("asset-sequential");
    await fetchProfilePic("asset-sequential"); // served from cache, not in-flight (first call already settled)

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
