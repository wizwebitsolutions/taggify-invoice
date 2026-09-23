import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Inventory "Import pages" (user request, 14 Sep) — the preview/confirm
 * half that needs accounts and existing pages: which creator a row's
 * owner cell resolves to, and what happens to rows that are duplicated,
 * already registered (under the same or a different account), or have no
 * usable owner. Mocked Prisma, no DB.
 */
const mockPrisma = {
  user: { findMany: vi.fn() },
  asset: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn(async () => ({ count: 1 })), findUnique: vi.fn(async () => ({ scrapeQueuedAt: new Date() })), update: vi.fn(async () => ({})) },
  link: { findMany: vi.fn(async () => []) },
};
vi.mock("../../lib/prisma.js", () => ({ prisma: mockPrisma }));
const applyProfileMetrics = vi.fn(async () => ({}));
vi.mock("../scraping/service.js", () => ({ refreshAssetMetrics: vi.fn(async () => {}), applyProfileMetrics: (...a) => applyProfileMetrics(...a) }));
const getAccountMetricsBatch = vi.fn();
vi.mock("../../lib/apifyClient.js", () => ({ ApifyInstagramProvider: { getAccountMetricsBatch: (...a) => getAccountMetricsBatch(...a) } }));
const fetchSheetCsv = vi.fn();
vi.mock("../campaigns/service.js", () => ({ fetchSheetCsv: (...a) => fetchSheetCsv(...a) }));
vi.mock("../../lib/cloudinaryClient.js", () => ({ uploadProfilePic: vi.fn(async () => "https://res.cloudinary.com/x/profile-pics/a.jpg"), isCloudinaryConfigured: () => true }));

// What Instagram "returns" for a page it found (22 Sep: every imported page
// must be confirmed on Instagram before it's stored).
const found = (over = {}) => ({ followers: 4321, mediaCount: 3, avgViews: null, avgLikes: null, avgComments: null, sampleSize: 0, fullName: null, biography: null, profilePicUrl: null, ...over });

const { previewImport, importAssets, resolveOwnerRef, previewImportFromSheetUrl, fetchImportFollowers } = await import("./service.js");
const { ApiError } = await import("../../middleware/errorHandler.js");
const { refreshAssetMetrics } = await import("../scraping/service.js");

const priya = { id: "creator-1", name: "Priya Creator", phoneNumber: "+919000000001", email: "priya@example.com" };
const rahul = { id: "creator-2", name: "Rahul Creator", phoneNumber: "+919000000002", email: null };
const rahul2 = { id: "creator-3", name: "Rahul Creator", phoneNumber: "+919000000003", email: null };
const owners = [priya, rahul, rahul2];

const row = (overrides) => ({ rowNumber: 2, rawHandle: "x", handle: "x", ownerRef: null, category: null, followers: null, rateCards: [], problem: null, ...overrides });

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.user.findMany.mockResolvedValue(owners);
  mockPrisma.asset.findMany.mockResolvedValue([]);
  mockPrisma.asset.findFirst.mockResolvedValue(null);
  mockPrisma.asset.create.mockImplementation(async ({ data }) => ({ id: `asset-${data.handle}`, handle: data.handle, ownerId: data.ownerId }));
  // By default every page asked about exists on Instagram.
  getAccountMetricsBatch.mockImplementation(async (handles) => Object.fromEntries(handles.map((h) => [h, found()])));
});

describe("resolveOwnerRef — matching a sheet's owner cell to a creator account", () => {
  it("matches by phone regardless of +91 / spaces / dashes", () => {
    expect(resolveOwnerRef("9000000001", owners).owner).toBe(priya);
    expect(resolveOwnerRef("+91 90000-00001", owners).owner).toBe(priya);
    expect(resolveOwnerRef("91 9000000002", owners).owner).toBe(rahul);
  });

  it("falls back to email, then to an exact (case-insensitive) name", () => {
    expect(resolveOwnerRef("PRIYA@example.com", owners).owner).toBe(priya);
    expect(resolveOwnerRef("priya creator", owners).owner).toBe(priya);
  });

  it("refuses to guess between two creators with the same name", () => {
    const result = resolveOwnerRef("Rahul Creator", owners);
    expect(result.owner).toBeNull();
    expect(result.reason).toMatch(/matches 2 creator accounts/);
  });

  it("never phone-matches an email or a name that merely contains ten digits", () => {
    expect(resolveOwnerRef("creator9000000001@gmail.com", owners).owner).toBeNull();
    expect(resolveOwnerRef("Shop 9000000001 Media", owners).owner).toBeNull();
  });

  it("reports an unknown reference", () => {
    expect(resolveOwnerRef("nobody", owners)).toEqual({ owner: null, reason: 'No creator account matches "nobody".' });
  });
});

describe("previewImport — per-row status", () => {
  it("marks a resolvable new page ready and attaches the account it will sit under", async () => {
    const preview = await previewImport({ hasOwnerColumn: true, rows: [row({ handle: "new.page", ownerRef: "9000000001" })] });
    expect(preview.rows[0]).toMatchObject({ status: "ready", ownerId: "creator-1", owner: priya });
    expect(preview.summary).toEqual({ ready: 1 });
    expect(preview.owners).toEqual(owners);
  });

  it("flags duplicates within the sheet (case-insensitive) so only the first copy imports", async () => {
    const preview = await previewImport({ hasOwnerColumn: true, rows: [row({ handle: "Same.Page", ownerRef: "9000000001" }), row({ rowNumber: 3, handle: "same.page", ownerRef: "9000000001" })] });
    expect(preview.rows.map((r) => r.status)).toEqual(["ready", "duplicate"]);
  });

  it("distinguishes 'already under this account' from 'already under someone else'", async () => {
    mockPrisma.asset.findMany.mockResolvedValue([{ id: "a1", handle: "taken.page", ownerId: "creator-2", owner: { id: "creator-2", name: "Rahul Creator", phoneNumber: "+919000000002" } }]);
    const preview = await previewImport({
      hasOwnerColumn: true,
      rows: [row({ handle: "taken.page", ownerRef: "9000000002" }), row({ rowNumber: 3, handle: "other.page", ownerRef: "9000000001" }), row({ rowNumber: 4, handle: "taken.page", ownerRef: "9000000001" })],
    });
    expect(preview.rows[0]).toMatchObject({ status: "exists", ownerId: "creator-2" });
    expect(preview.rows[0].reason).toMatch(/under Rahul Creator/);
    expect(preview.rows[1].status).toBe("ready");
    // Row 4 is a duplicate of row 2 within the sheet — duplicate wins over conflict.
    expect(preview.rows[2].status).toBe("duplicate");
  });

  it("marks a page as conflict when its handle is registered under a different creator", async () => {
    mockPrisma.asset.findMany.mockResolvedValue([{ id: "a1", handle: "taken.page", ownerId: "creator-2", owner: { id: "creator-2", name: "Rahul Creator", phoneNumber: "+919000000002" } }]);
    const preview = await previewImport({ hasOwnerColumn: true, rows: [row({ handle: "taken.page", ownerRef: "9000000001" })] });
    expect(preview.rows[0].status).toBe("conflict");
    expect(preview.rows[0].reason).toMatch(/can't be under two accounts/);
  });

  it("asks for an account when the owner cell is blank or unknown, and shows the existing owner when the page already exists anyway", async () => {
    mockPrisma.asset.findMany.mockResolvedValue([{ id: "a1", handle: "known.page", ownerId: "creator-1", owner: priya }]);
    const preview = await previewImport({
      hasOwnerColumn: false,
      rows: [row({ handle: "fresh.page" }), row({ rowNumber: 3, handle: "other.page", ownerRef: "nobody" }), row({ rowNumber: 4, handle: "known.page" })],
    });
    expect(preview.rows[0]).toMatchObject({ status: "owner-missing", reason: "Sheet has no owner column." });
    expect(preview.rows[1]).toMatchObject({ status: "owner-unknown", reason: 'No creator account matches "nobody".' });
    expect(preview.rows[2]).toMatchObject({ status: "exists", ownerId: "creator-1" });
  });

  it("passes parser-level problems through as invalid rows and never looks them up", async () => {
    const preview = await previewImport({ hasOwnerColumn: true, rows: [row({ handle: null, rawHandle: "", problem: "Missing handle." })] });
    expect(preview.rows[0]).toMatchObject({ status: "invalid", reason: "Missing handle." });
    expect(mockPrisma.asset.findMany).not.toHaveBeenCalled();
  });
});

// "Attach a Google Sheet link" (user request, 14 Sep) — same fetch helper the
// campaign/plan imports use, then the same parser + preview as a file.
describe("previewImportFromSheetUrl", () => {
  it("fetches the shared sheet as CSV and previews it exactly like an uploaded file", async () => {
    fetchSheetCsv.mockResolvedValue("handle,owner\n@sheet.page,+919000000001\n");
    const preview = await previewImportFromSheetUrl("https://docs.google.com/spreadsheets/d/abc/edit#gid=0");
    expect(fetchSheetCsv).toHaveBeenCalledWith("https://docs.google.com/spreadsheets/d/abc/edit#gid=0");
    expect(preview.rows[0]).toMatchObject({ handle: "sheet.page", status: "ready", ownerId: "creator-1" });
  });

  it("surfaces the fetch helper's own errors (not shared / unreachable) untouched", async () => {
    fetchSheetCsv.mockRejectedValue(new ApiError(400, "SHEET_NOT_SHARED", "Couldn't read that sheet — make sure it's shared."));
    await expect(previewImportFromSheetUrl("https://docs.google.com/spreadsheets/d/private/edit")).rejects.toMatchObject({ code: "SHEET_NOT_SHARED" });
  });

  it("turns a sheet with no handle column into the same readable 400 as a bad file", async () => {
    fetchSheetCsv.mockResolvedValue("name,phone\nx,y\n");
    await expect(previewImportFromSheetUrl("https://docs.google.com/spreadsheets/d/abc/edit")).rejects.toMatchObject({ code: "IMPORT_SHEET_INVALID" });
  });
});

// Followers/avg views fetched during the preview (user request, 14 Sep) —
// one batch run, private/missing profiles come back null, and a confirmed
// import stores the numbers instead of scraping the same handle again.
describe("fetchImportFollowers → importAssets reuse", () => {
  it("normalizes + dedupes handles, returns per-handle numbers (null for not found), and never throws for one bad profile", async () => {
    getAccountMetricsBatch.mockResolvedValue({ "big.page": { followers: 5000, mediaCount: 10, avgViews: 900, avgLikes: 50, avgComments: 2, sampleSize: 5, fullName: "Big", biography: null, profilePicUrl: null }, "private.page": null });
    const out = await fetchImportFollowers(["@big.page", "BIG.PAGE ", "private.page", "bad handle!"]);
    expect(getAccountMetricsBatch).toHaveBeenCalledWith(["big.page", "BIG.PAGE", "private.page"]);
    expect(out.profiles["big.page"]).toEqual({ followers: 5000, avgViews: 900, avgLikes: 50, avgComments: 2, fullName: "Big" });
    expect(out.profiles["private.page"]).toBeNull();
  });

  it("leaves a handle out of the response (unknown) when its chunk timed out, rather than calling it not found", async () => {
    getAccountMetricsBatch.mockResolvedValue({ "seen.page": null });
    const out = await fetchImportFollowers(["seen.page", "unreached.page"]);
    expect(out.profiles).toEqual({ "seen.page": null });
    expect(out.profiles).not.toHaveProperty("unreached.page");
  });

  it("still creates the page when saving the fetched profile fails (logged), and doesn't re-scrape it", async () => {
    getAccountMetricsBatch.mockResolvedValue({ "flaky.page": found({ followers: 1 }) });
    await fetchImportFollowers(["flaky.page"]);
    applyProfileMetrics.mockRejectedValueOnce(new Error("db hiccup"));
    const admin = { id: "admin-1", role: "ADMIN" };
    const result = await importAssets(admin, [{ handle: "flaky.page", ownerId: "creator-1" }]);
    expect(result.created).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 10));
    expect(refreshAssetMetrics).not.toHaveBeenCalled();
  });

  it("turns an Apify outage into a 502 the modal can show, without blocking the import", async () => {
    getAccountMetricsBatch.mockRejectedValue(new Error("APIFY_TOKEN is not set"));
    await expect(fetchImportFollowers(["x.page"])).rejects.toMatchObject({ statusCode: 502, code: "FOLLOWERS_FETCH_FAILED" });
  });

  it("reuses the preview's answer and only looks up pages the preview never checked", async () => {
    getAccountMetricsBatch.mockResolvedValueOnce({ "cached.page": found({ followers: 777 }) });
    await fetchImportFollowers(["cached.page"]);
    getAccountMetricsBatch.mockClear();
    const admin = { id: "admin-1", role: "ADMIN" };
    const result = await importAssets(admin, [
      { handle: "cached.page", ownerId: "creator-1" },
      { handle: "fresh.page", ownerId: "creator-1" },
    ]);
    expect(result.created.map((a) => a.handle)).toEqual(["cached.page", "fresh.page"]);
    expect(getAccountMetricsBatch).toHaveBeenCalledTimes(1);
    expect(getAccountMetricsBatch).toHaveBeenCalledWith(["fresh.page"]);
    expect(applyProfileMetrics).toHaveBeenCalledWith("asset-cached.page", expect.objectContaining({ followers: 777 }));
    expect(applyProfileMetrics).toHaveBeenCalledWith("asset-fresh.page", expect.objectContaining({ followers: 4321 }));
    // Nothing is left for a background scrape to do.
    await new Promise((r) => setTimeout(r, 10));
    expect(refreshAssetMetrics).not.toHaveBeenCalled();
  });
});

// 22 Sep — "if page not found, showing with message link broken or not
// found and it won't be stored in database". The server decides, not the
// client: a row the client sends anyway is refused here.
describe("importAssets — only pages confirmed on Instagram are stored", () => {
  const admin = { id: "admin-1", role: "ADMIN" };

  it("a page the preview found missing is skipped with a clear reason and never written", async () => {
    getAccountMetricsBatch.mockResolvedValueOnce({ "gone.page": null });
    await fetchImportFollowers(["gone.page"]);
    getAccountMetricsBatch.mockClear();

    const result = await importAssets(admin, [{ handle: "gone.page", ownerId: "creator-1" }]);

    expect(result.created).toEqual([]);
    expect(result.skipped).toEqual([{ handle: "gone.page", reason: "Link broken or page not found on Instagram." }]);
    expect(mockPrisma.asset.create).not.toHaveBeenCalled();
    // The preview's "not found" is trusted — no second lookup.
    expect(getAccountMetricsBatch).not.toHaveBeenCalled();
  });

  it("a page first checked at import that Instagram doesn't know is skipped too", async () => {
    getAccountMetricsBatch.mockResolvedValueOnce({ "typo.pagee": null, "real.page2": found() });
    const result = await importAssets(admin, [
      { handle: "typo.pagee", ownerId: "creator-1" },
      { handle: "real.page2", ownerId: "creator-1" },
    ]);
    expect(result.created.map((a) => a.handle)).toEqual(["real.page2"]);
    expect(result.skipped).toEqual([{ handle: "typo.pagee", reason: "Link broken or page not found on Instagram." }]);
    expect(mockPrisma.asset.create).toHaveBeenCalledTimes(1);
  });

  it("when Instagram can't be reached, nothing unverified is stored", async () => {
    getAccountMetricsBatch.mockRejectedValueOnce(new Error("Apify timeout"));
    const result = await importAssets(admin, [{ handle: "unverified.page", ownerId: "creator-1" }]);
    expect(result.created).toEqual([]);
    expect(result.skipped).toEqual([{ handle: "unverified.page", reason: "Couldn't verify this page on Instagram right now — try again." }]);
    expect(mockPrisma.asset.create).not.toHaveBeenCalled();
  });

  it("a page whose lookup timed out (left out of the answer) is also refused", async () => {
    getAccountMetricsBatch.mockResolvedValueOnce({});
    const result = await importAssets(admin, [{ handle: "slow.page", ownerId: "creator-1" }]);
    expect(result.skipped).toEqual([{ handle: "slow.page", reason: "Couldn't verify this page on Instagram right now — try again." }]);
    expect(mockPrisma.asset.create).not.toHaveBeenCalled();
  });

  it("re-checks for the page right before creating it — someone registering it during the Instagram wait wins, no second owner", async () => {
    let lookups = 0;
    mockPrisma.asset.findFirst.mockImplementation(async () => {
      lookups += 1;
      // Free at the first check; registered under Rahul by the time the insert would run.
      return lookups === 1 ? null : { ownerId: "creator-2", owner: { name: "Rahul Creator", phoneNumber: "+919000000002" } };
    });
    const result = await importAssets(admin, [{ handle: "contested.page", ownerId: "creator-1" }]);
    expect(result.created).toEqual([]);
    expect(result.skipped).toEqual([{ handle: "contested.page", reason: "Already registered under Rahul Creator." }]);
    expect(mockPrisma.asset.create).not.toHaveBeenCalled();
  });

  it("won't hold the request open verifying a huge never-checked batch — past the cap those rows are refused, not stored", async () => {
    const rows = Array.from({ length: 101 }, (_, i) => ({ handle: `bulk.page${i}`, ownerId: "creator-1" }));
    const result = await importAssets(admin, rows);
    expect(getAccountMetricsBatch).not.toHaveBeenCalled();
    expect(result.created).toEqual([]);
    expect(result.skipped).toHaveLength(101);
    expect(result.skipped[0].reason).toMatch(/Couldn't verify/);
  });

  it("saves the sheet's Page Name as the display name and Instagram's follower count over the sheet's", async () => {
    getAccountMetricsBatch.mockResolvedValueOnce({ "named.page": found({ followers: 98765 }) });
    await importAssets(admin, [{ handle: "named.page", ownerId: "creator-1", pageName: "  Named Page  ", followers: 10 }]);
    expect(mockPrisma.asset.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ fullName: "Named Page", followers: 98765 }) }));
  });
});

describe("importAssets — creating the confirmed rows", () => {
  const admin = { id: "admin-1", role: "ADMIN" };

  it("creates each page under its account (approved, since only admins import), with any rate cards from the sheet", async () => {
    const result = await importAssets(admin, [
      { handle: "@One.Page", ownerId: "creator-1", category: "News page", followers: 1000, rateCards: [{ format: "reel", amount: 5000 }] },
      { handle: "two.page", ownerId: "creator-2" },
    ]);
    expect(result.skipped).toEqual([]);
    expect(result.created.map((a) => [a.handle, a.owner.id])).toEqual([
      ["One.Page", "creator-1"],
      ["two.page", "creator-2"],
    ]);
    expect(mockPrisma.asset.create).toHaveBeenCalledWith(
      expect.objectContaining({
        // Admin-only route → approved on creation (14 Sep), same as createAsset.
        data: expect.objectContaining({ handle: "One.Page", ownerId: "creator-1", category: "News page", followers: 4321, approvalStatus: "approved", rateCards: { create: [{ format: "reel", amount: 5000 }] } }),
      })
    );
    // The confirmed Instagram profile is stored straight away.
    expect(applyProfileMetrics).toHaveBeenCalledWith("asset-One.Page", expect.objectContaining({ followers: 4321 }));
  });

  it("skips (not fails) rows whose owner isn't a creator, whose handle is taken, or that repeat within the batch", async () => {
    mockPrisma.asset.findFirst.mockImplementation(async ({ where }) => (where.handle.equals === "taken.page" ? { ownerId: "creator-2", owner: { name: "Rahul Creator", phoneNumber: "+919000000002" } } : null));
    const result = await importAssets(admin, [
      { handle: "ok.page", ownerId: "creator-1" },
      { handle: "ok.page", ownerId: "creator-1" },
      { handle: "taken.page", ownerId: "creator-1" },
      { handle: "no.owner", ownerId: "admin-1" },
      { handle: "bad handle", ownerId: "creator-1" },
    ]);
    expect(result.created.map((a) => a.handle)).toEqual(["ok.page"]);
    expect(result.skipped).toEqual([
      { handle: "ok.page", reason: "Duplicate handle in this import." },
      { handle: "taken.page", reason: "Already registered under Rahul Creator." },
      { handle: "no.owner", reason: "Pick a creator account for this page." },
      { handle: "bad handle", reason: "Not a valid Instagram handle." },
    ]);
    expect(mockPrisma.asset.create).toHaveBeenCalledTimes(1);
  });

  it("turns a unique-constraint race on insert into a skipped row instead of failing the batch", async () => {
    mockPrisma.asset.create.mockImplementationOnce(async () => {
      const err = new Error("Unique constraint failed");
      err.code = "P2002";
      throw err;
    });
    const result = await importAssets(admin, [
      { handle: "raced.page", ownerId: "creator-1" },
      { handle: "fine.page", ownerId: "creator-1" },
    ]);
    expect(result.created.map((a) => a.handle)).toEqual(["fine.page"]);
    expect(result.skipped).toEqual([{ handle: "raced.page", reason: "Was registered by someone else just now." }]);
  });

  it("drops a repeated rate-card format within one row (rate cards are unique per asset+format)", async () => {
    await importAssets(admin, [{ handle: "r.page", ownerId: "creator-1", rateCards: [{ format: "reel", amount: 1 }, { format: "reel", amount: 2 }] }]);
    expect(mockPrisma.asset.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ rateCards: { create: [{ format: "reel", amount: 1 }] } }) }));
  });
});
