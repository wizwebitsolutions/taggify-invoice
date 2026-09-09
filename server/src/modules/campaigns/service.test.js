import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApiError } from "../../middleware/errorHandler.js";

const mockPrisma = {
  campaign: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  link: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
  linkStatusEvent: { create: vi.fn() },
  campaignAssignment: { findMany: vi.fn(), create: vi.fn(), createMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), count: vi.fn() },
  asset: { findMany: vi.fn(), findUnique: vi.fn() },
};
vi.mock("../../lib/prisma.js", () => ({ prisma: mockPrisma }));
// campaigns/service.js imports links/service.js (for autoAttachLink) —
// links/service.js's own top-level imports pull these in transitively even
// though autoAttachLink itself doesn't call refreshLinkMetrics/notify, same
// mocks links/service.test.js already needs for the same reason.
vi.mock("../../lib/cloudinaryClient.js", () => ({ publicUrlFor: vi.fn((id) => `https://cloudinary/${id}`) }));
vi.mock("../scraping/service.js", () => ({ refreshLinkMetrics: vi.fn(async () => ({ ok: true })) }));
vi.mock("../notifications/service.js", () => ({ notify: vi.fn() }));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const { listCampaigns, createCampaign, resolveAssignment, listAssignments, googleSheetCsvExportUrl, fetchSheetCsv, getCampaignById, createPhase } =
  await import("./service.js");

beforeEach(() => {
  vi.clearAllMocks();
  // Sensible defaults so tests that don't care about assignments/links don't
  // have to stub every call — override per-test where it matters.
  mockPrisma.link.findMany.mockResolvedValue([]);
  mockPrisma.link.findFirst.mockResolvedValue(null);
  mockPrisma.campaignAssignment.findMany.mockResolvedValue([]);
  mockPrisma.campaignAssignment.count.mockResolvedValue(0);
});

const baseCampaign = {
  id: "c1",
  title: "Launch",
  brandName: "Acme",
  deadline: null,
  costCap: null,
  createdAt: new Date("2026-01-01"),
};

describe("listCampaigns — card preview (newTask.md #1: thumbnail, caption, total likes)", () => {
  it("picks the most recently posted link with a thumbnail as the representative post", async () => {
    mockPrisma.campaign.findMany.mockResolvedValue([baseCampaign]);
    mockPrisma.link.findMany.mockResolvedValue([
      {
        campaignId: "c1",
        cost: 1000,
        status: "SCREENSHOT_APPROVED",
        postedAt: new Date("2026-01-01"),
        createdAt: new Date("2026-01-01"),
        postSnapshots: [{ thumbnailUrl: "old.jpg", caption: "old caption", likeCount: 10 }],
      },
      {
        campaignId: "c1",
        cost: 2000,
        status: "SCREENSHOT_APPROVED",
        postedAt: new Date("2026-02-01"),
        createdAt: new Date("2026-02-01"),
        postSnapshots: [{ thumbnailUrl: "new.jpg", caption: "new caption", likeCount: 20 }],
      },
    ]);

    const [campaign] = await listCampaigns();

    expect(campaign.representativePost).toEqual({ thumbnailUrl: "new.jpg", caption: "new caption" });
    expect(campaign.totalLikes).toBe(30);
    expect(campaign.postCount).toBe(2);
  });

  it("falls back to the most recent link even when nothing has a thumbnail yet", async () => {
    mockPrisma.campaign.findMany.mockResolvedValue([baseCampaign]);
    mockPrisma.link.findMany.mockResolvedValue([
      { campaignId: "c1", cost: 1000, status: "SUBMITTED", postedAt: null, createdAt: new Date("2026-01-01"), postSnapshots: [] },
    ]);

    const [campaign] = await listCampaigns();

    expect(campaign.representativePost).toBeNull();
    expect(campaign.totalLikes).toBe(0);
    expect(campaign.postCount).toBe(1);
  });

  it("excludes Apify's -1 'unknown/hidden' sentinel from the total-likes sum", async () => {
    mockPrisma.campaign.findMany.mockResolvedValue([baseCampaign]);
    mockPrisma.link.findMany.mockResolvedValue([
      { campaignId: "c1", cost: 100, status: "SUBMITTED", postedAt: new Date(), createdAt: new Date(), postSnapshots: [{ thumbnailUrl: null, caption: null, likeCount: -1 }] },
      { campaignId: "c1", cost: 100, status: "SUBMITTED", postedAt: new Date(), createdAt: new Date(), postSnapshots: [{ thumbnailUrl: null, caption: null, likeCount: 50 }] },
    ]);

    const [campaign] = await listCampaigns();

    expect(campaign.totalLikes).toBe(50);
  });

  it("skips the links query entirely when there are no campaigns", async () => {
    mockPrisma.campaign.findMany.mockResolvedValue([]);

    const result = await listCampaigns();

    expect(result).toEqual([]);
    expect(mockPrisma.link.findMany).not.toHaveBeenCalled();
  });
});

describe("listCampaigns — budget (newTask.md #9: remaining budget)", () => {
  it("is null when no cost cap was set", async () => {
    mockPrisma.campaign.findMany.mockResolvedValue([baseCampaign]);
    mockPrisma.link.findMany.mockResolvedValue([{ campaignId: "c1", cost: 5000, status: "SUBMITTED", postedAt: null, createdAt: new Date(), postSnapshots: [] }]);

    const [campaign] = await listCampaigns();

    expect(campaign.spent).toBe(5000);
    expect(campaign.remainingBudget).toBeNull();
  });

  it("is costCap minus spent when a cap is set", async () => {
    mockPrisma.campaign.findMany.mockResolvedValue([{ ...baseCampaign, costCap: 20000 }]);
    mockPrisma.link.findMany.mockResolvedValue([
      { campaignId: "c1", cost: 5000, status: "SUBMITTED", postedAt: null, createdAt: new Date(), postSnapshots: [] },
      { campaignId: "c1", cost: 3000, status: "SCREENSHOT_APPROVED", postedAt: null, createdAt: new Date(), postSnapshots: [] },
    ]);

    const [campaign] = await listCampaigns();

    expect(campaign.spent).toBe(8000);
    expect(campaign.remainingBudget).toBe(12000);
  });

  it("excludes a rejected screenshot's cost from spend — it was never valid work", async () => {
    mockPrisma.campaign.findMany.mockResolvedValue([{ ...baseCampaign, costCap: 10000 }]);
    mockPrisma.link.findMany.mockResolvedValue([
      { campaignId: "c1", cost: 5000, status: "SCREENSHOT_REJECTED", postedAt: null, createdAt: new Date(), postSnapshots: [] },
      { campaignId: "c1", cost: 2000, status: "SUBMITTED", postedAt: null, createdAt: new Date(), postSnapshots: [] },
    ]);

    const [campaign] = await listCampaigns();

    expect(campaign.spent).toBe(2000);
    expect(campaign.remainingBudget).toBe(8000);
  });

  it("excludes a link an admin has marked invalid from spend (newTask.md, 8 Sep)", async () => {
    mockPrisma.campaign.findMany.mockResolvedValue([{ ...baseCampaign, costCap: 10000 }]);
    mockPrisma.link.findMany.mockResolvedValue([
      { campaignId: "c1", cost: 5000, status: "INVALID", postedAt: null, createdAt: new Date(), postSnapshots: [] },
      { campaignId: "c1", cost: 2000, status: "SUBMITTED", postedAt: null, createdAt: new Date(), postSnapshots: [] },
    ]);

    const [campaign] = await listCampaigns();

    expect(campaign.spent).toBe(2000);
    expect(campaign.remainingBudget).toBe(8000);
  });
});

describe("listCampaigns — phases (newTask.md, 8 Sep)", () => {
  it("only returns root campaigns — a phase is reached from its root's detail page, not listed separately", async () => {
    mockPrisma.campaign.findMany
      .mockResolvedValueOnce([baseCampaign]) // roots query
      .mockResolvedValueOnce([{ id: "c2", parentCampaignId: "c1" }]); // phases query

    await listCampaigns();

    expect(mockPrisma.campaign.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({ where: expect.objectContaining({ parentCampaignId: null }) }));
  });

  it("rolls up spent/remainingBudget across phases on the root's card, using the root's cost cap", async () => {
    mockPrisma.campaign.findMany
      .mockResolvedValueOnce([{ ...baseCampaign, costCap: 10000 }])
      .mockResolvedValueOnce([{ id: "c2", parentCampaignId: "c1" }]);
    mockPrisma.link.findMany.mockResolvedValue([
      { campaignId: "c1", cost: 3000, status: "SCREENSHOT_APPROVED", postedAt: null, createdAt: new Date(), postSnapshots: [] },
      { campaignId: "c2", cost: 2000, status: "SCREENSHOT_APPROVED", postedAt: null, createdAt: new Date(), postSnapshots: [] },
    ]);

    const [campaign] = await listCampaigns();

    expect(mockPrisma.link.findMany).toHaveBeenCalledWith({ where: { campaignId: { in: ["c1", "c2"] } }, select: expect.any(Object) });
    expect(campaign.postCount).toBe(1); // just the root's own post
    expect(campaign.spent).toBe(5000); // both phases combined
    expect(campaign.remainingBudget).toBe(5000);
    expect(campaign.phaseCount).toBe(2);
  });

  it("phaseCount is 1 for a campaign with no phases", async () => {
    mockPrisma.campaign.findMany.mockResolvedValueOnce([baseCampaign]).mockResolvedValueOnce([]);

    const [campaign] = await listCampaigns();

    expect(campaign.phaseCount).toBe(1);
  });
});

describe("getCampaignById — single-campaign detail page (bugs.md #7)", () => {
  it("annotates the same way listCampaigns does, for just one campaign", async () => {
    mockPrisma.campaign.findUnique.mockResolvedValue({ ...baseCampaign, costCap: 10000 });
    mockPrisma.campaign.findMany.mockResolvedValue([{ id: "c1", phaseNumber: 1, title: "Launch", createdAt: baseCampaign.createdAt }]);
    mockPrisma.link.findMany.mockResolvedValue([
      { campaignId: "c1", cost: 3000, status: "SCREENSHOT_APPROVED", postedAt: new Date("2026-01-01"), createdAt: new Date("2026-01-01"), postSnapshots: [{ thumbnailUrl: "a.jpg", caption: "hi", likeCount: 15 }] },
    ]);
    mockPrisma.campaignAssignment.count.mockResolvedValue(2);

    const campaign = await getCampaignById("c1");

    expect(mockPrisma.campaign.findUnique).toHaveBeenCalledWith({ where: { id: "c1" } });
    expect(mockPrisma.link.findMany).toHaveBeenCalledWith({ where: { campaignId: { in: ["c1"] } }, select: expect.any(Object) });
    expect(mockPrisma.campaignAssignment.count).toHaveBeenCalledWith({ where: { campaignId: "c1", status: "pending" } });
    expect(campaign.spent).toBe(3000);
    expect(campaign.remainingBudget).toBe(7000);
    expect(campaign.totalLikes).toBe(15);
    expect(campaign.postCount).toBe(1);
    expect(campaign.pendingAssignmentCount).toBe(2);
    expect(campaign.phases).toEqual([{ id: "c1", phaseNumber: 1, title: "Launch", createdAt: baseCampaign.createdAt }]);
  });

  it("rejects a nonexistent campaign id", async () => {
    mockPrisma.campaign.findUnique.mockResolvedValue(null);

    await expect(getCampaignById("missing")).rejects.toBeInstanceOf(ApiError);
  });
});

describe("getCampaignById — phase budget rollup (newTask.md, 8 Sep)", () => {
  it("rolls up spent/remainingBudget across every phase, using the root's cost cap", async () => {
    // Viewing phase 2 specifically — its own links are just phase 2's post,
    // but the budget shown should reflect phase 1 + phase 2 combined.
    mockPrisma.campaign.findUnique
      .mockResolvedValueOnce({ id: "c2", parentCampaignId: "c1", phaseNumber: 2, title: "Launch — Phase 2", costCap: null })
      .mockResolvedValueOnce({ id: "c1", parentCampaignId: null, phaseNumber: 1, title: "Launch", costCap: 10000 });
    mockPrisma.campaign.findMany.mockResolvedValue([
      { id: "c1", phaseNumber: 1, title: "Launch", createdAt: baseCampaign.createdAt },
      { id: "c2", phaseNumber: 2, title: "Launch — Phase 2", createdAt: baseCampaign.createdAt },
    ]);
    mockPrisma.link.findMany.mockResolvedValue([
      { campaignId: "c1", cost: 3000, status: "SCREENSHOT_APPROVED", postedAt: null, createdAt: new Date(), postSnapshots: [] },
      { campaignId: "c2", cost: 2000, status: "SCREENSHOT_APPROVED", postedAt: null, createdAt: new Date(), postSnapshots: [] },
    ]);

    const campaign = await getCampaignById("c2");

    expect(mockPrisma.link.findMany).toHaveBeenCalledWith({ where: { campaignId: { in: ["c1", "c2"] } }, select: expect.any(Object) });
    expect(campaign.postCount).toBe(1); // just this phase's own post
    expect(campaign.spent).toBe(5000); // both phases combined
    expect(campaign.remainingBudget).toBe(5000); // root's 10000 cap - 5000
    expect(campaign.phases).toHaveLength(2);
  });

  it("uses the root's live cost cap, not whatever the phase's own (never-updated) column holds", async () => {
    // Root's cap was raised to 20000 *after* phase 2 already existed —
    // phase 2's own costCap column is still whatever it was at creation
    // (here, deliberately a stale/different value) and must be ignored.
    mockPrisma.campaign.findUnique
      .mockResolvedValueOnce({ id: "c2", parentCampaignId: "c1", phaseNumber: 2, title: "Launch — Phase 2", costCap: null })
      .mockResolvedValueOnce({ id: "c1", parentCampaignId: null, phaseNumber: 1, title: "Launch", costCap: 20000 });
    mockPrisma.campaign.findMany.mockResolvedValue([
      { id: "c1", phaseNumber: 1, title: "Launch", createdAt: baseCampaign.createdAt },
      { id: "c2", phaseNumber: 2, title: "Launch — Phase 2", createdAt: baseCampaign.createdAt },
    ]);
    mockPrisma.link.findMany.mockResolvedValue([]);

    const campaign = await getCampaignById("c2");

    expect(campaign.costCap).toBe(20000);
    expect(campaign.remainingBudget).toBe(20000);
  });
});

describe("createPhase — adding a phase to a campaign (newTask.md, 8 Sep)", () => {
  it("creates a new phase under the root, inheriting brand/sheet link but NOT cost cap", async () => {
    // costCap is deliberately excluded from the new row — it's always read
    // live from the root at request time (getCampaignById/listCampaigns),
    // not copied here, so a later change to the root's cap isn't frozen out.
    mockPrisma.campaign.findUnique.mockResolvedValue({ id: "c1", parentCampaignId: null, brandName: "Acme", title: "Launch", costCap: 10000, sheetLink: "https://sheet" });
    mockPrisma.campaign.findMany.mockResolvedValue([{ phaseNumber: 1 }]);
    mockPrisma.campaign.create.mockResolvedValue({ id: "c2" });

    await createPhase("c1");

    expect(mockPrisma.campaign.create).toHaveBeenCalledWith({
      data: {
        brandName: "Acme",
        title: "Launch — Phase 2",
        sheetLink: "https://sheet",
        parentCampaignId: "c1",
        phaseNumber: 2,
      },
    });
  });

  it("resolves to the root when called on an existing phase, not just phase 1", async () => {
    mockPrisma.campaign.findUnique
      .mockResolvedValueOnce({ id: "c2", parentCampaignId: "c1", brandName: "Acme", title: "Launch — Phase 2" })
      .mockResolvedValueOnce({ id: "c1", parentCampaignId: null, brandName: "Acme", title: "Launch", costCap: null, sheetLink: null });
    mockPrisma.campaign.findMany.mockResolvedValue([{ phaseNumber: 1 }, { phaseNumber: 2 }]);
    mockPrisma.campaign.create.mockResolvedValue({ id: "c3" });

    await createPhase("c2", { title: "Custom phase 3 title" });

    expect(mockPrisma.campaign.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ parentCampaignId: "c1", phaseNumber: 3, title: "Custom phase 3 title" }),
    });
  });

  it("404s on a nonexistent campaign", async () => {
    mockPrisma.campaign.findUnique.mockResolvedValue(null);

    await expect(createPhase("missing")).rejects.toBeInstanceOf(ApiError);
  });
});

describe("createCampaign — attaching a page/creator sheet (newTask.md #8)", () => {
  beforeEach(() => {
    mockPrisma.campaign.create.mockResolvedValue({ id: "c1", ...baseCampaign });
  });

  it("matches a sheet row to an existing page by handle (case/at-sign insensitive)", async () => {
    mockPrisma.asset.findMany.mockResolvedValue([{ id: "asset-1", handle: "demo.page" }]);
    mockPrisma.campaignAssignment.create.mockResolvedValue({ id: "a1", pageHandle: "Demo.Page", assetId: "asset-1", status: "matched", linkId: null });

    const result = await createCampaign({
      brandName: "Acme",
      title: "Launch",
      assignments: [{ handle: "@Demo.Page" }],
    });

    expect(mockPrisma.campaignAssignment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ pageHandle: "Demo.Page", assetId: "asset-1", status: "matched" }),
    });
    expect(result.matchedCount).toBe(1);
    expect(result.pendingCount).toBe(0);
    expect(result.autoAttachedCount).toBe(0);
  });

  it("leaves a row pending when no existing page matches its handle", async () => {
    mockPrisma.asset.findMany.mockResolvedValue([]);
    mockPrisma.campaignAssignment.create.mockResolvedValue({ id: "a1", pageHandle: "unknown.page", assetId: null, status: "pending", linkId: null });

    const result = await createCampaign({
      brandName: "Acme",
      title: "Launch",
      assignments: [{ handle: "unknown.page", phone: "+919999999999" }],
    });

    expect(mockPrisma.campaignAssignment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ pageHandle: "unknown.page", assetId: null, status: "pending", creatorPhone: "+919999999999" }),
    });
    expect(result.matchedCount).toBe(0);
    expect(result.pendingCount).toBe(1);
  });

  it("doesn't touch CampaignAssignment at all when no sheet was attached", async () => {
    const result = await createCampaign({ brandName: "Acme", title: "Launch" });

    expect(mockPrisma.asset.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.campaignAssignment.create).not.toHaveBeenCalled();
    expect(result.matchedCount).toBe(0);
    expect(result.pendingCount).toBe(0);
  });

  describe("auto-attaching a sheet-named post (newTask.md, 8 Sep)", () => {
    const asset = { id: "asset-1", handle: "demo.page", ownerId: "creator-1", rateCards: [{ format: "reel", amount: 5000 }] };

    it("attaches the post straight away when the row matches an existing page", async () => {
      mockPrisma.asset.findMany.mockResolvedValue([asset]);
      mockPrisma.campaignAssignment.create.mockResolvedValue({
        id: "a1",
        campaignId: "c1",
        assetId: "asset-1",
        status: "matched",
        postUrl: "https://instagram.com/p/1",
        format: "reel",
        cost: null,
        linkId: null,
      });
      mockPrisma.link.create.mockResolvedValue({ id: "link-1" });
      mockPrisma.campaignAssignment.update.mockResolvedValue({ id: "a1", linkId: "link-1" });

      const result = await createCampaign({
        brandName: "Acme",
        title: "Launch",
        assignments: [{ handle: "demo.page", postUrl: "https://instagram.com/p/1", format: "reel" }],
      });

      expect(mockPrisma.link.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ assetId: "asset-1", submittedById: "creator-1", url: "https://instagram.com/p/1", format: "reel", cost: 5000 }),
      });
      expect(mockPrisma.campaignAssignment.update).toHaveBeenCalledWith({ where: { id: "a1" }, data: { linkId: "link-1" } });
      expect(result.autoAttachedCount).toBe(1);
    });

    it("uses the sheet's own cost instead of the rate card when the row provides one", async () => {
      mockPrisma.asset.findMany.mockResolvedValue([asset]);
      mockPrisma.campaignAssignment.create.mockResolvedValue({
        id: "a1",
        campaignId: "c1",
        assetId: "asset-1",
        status: "matched",
        postUrl: "https://instagram.com/p/1",
        format: "reel",
        cost: 9000,
        linkId: null,
      });
      mockPrisma.link.create.mockResolvedValue({ id: "link-1" });
      mockPrisma.campaignAssignment.update.mockResolvedValue({ id: "a1", linkId: "link-1" });

      await createCampaign({
        brandName: "Acme",
        title: "Launch",
        assignments: [{ handle: "demo.page", postUrl: "https://instagram.com/p/1", format: "reel", cost: 9000 }],
      });

      expect(mockPrisma.link.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ cost: 9000, customRate: true }),
      });
    });

    it("doesn't create a Link for a pending row — postUrl/format are stored for resolveAssignment to use later", async () => {
      mockPrisma.asset.findMany.mockResolvedValue([]);
      mockPrisma.campaignAssignment.create.mockResolvedValue({ id: "a1", assetId: null, status: "pending", postUrl: "https://instagram.com/p/1", format: "reel", linkId: null });

      const result = await createCampaign({
        brandName: "Acme",
        title: "Launch",
        assignments: [{ handle: "unmatched.page", postUrl: "https://instagram.com/p/1", format: "reel" }],
      });

      expect(mockPrisma.link.create).not.toHaveBeenCalled();
      expect(result.autoAttachedCount).toBe(0);
    });

    it("skips a duplicate URL already submitted for that page, without failing the campaign creation", async () => {
      mockPrisma.asset.findMany.mockResolvedValue([asset]);
      mockPrisma.link.findFirst.mockResolvedValue({ id: "existing-link" }); // already submitted
      mockPrisma.campaignAssignment.create.mockResolvedValue({
        id: "a1",
        assetId: "asset-1",
        status: "matched",
        postUrl: "https://instagram.com/p/1",
        format: "reel",
        cost: null,
        linkId: null,
      });

      const result = await createCampaign({
        brandName: "Acme",
        title: "Launch",
        assignments: [{ handle: "demo.page", postUrl: "https://instagram.com/p/1", format: "reel" }],
      });

      expect(mockPrisma.link.create).not.toHaveBeenCalled();
      expect(mockPrisma.campaignAssignment.update).not.toHaveBeenCalled();
      expect(result.autoAttachedCount).toBe(0);
    });

    it("swallows a NO_RATE_CARD error rather than failing the whole campaign creation", async () => {
      const assetNoRate = { id: "asset-1", handle: "demo.page", ownerId: "creator-1", rateCards: [] };
      mockPrisma.asset.findMany.mockResolvedValue([assetNoRate]);
      mockPrisma.campaignAssignment.create.mockResolvedValue({
        id: "a1",
        assetId: "asset-1",
        status: "matched",
        postUrl: "https://instagram.com/p/1",
        format: "reel",
        cost: null,
        linkId: null,
      });

      const result = await createCampaign({
        brandName: "Acme",
        title: "Launch",
        assignments: [{ handle: "demo.page", postUrl: "https://instagram.com/p/1", format: "reel" }],
      });

      expect(mockPrisma.link.create).not.toHaveBeenCalled();
      expect(result.matchedCount).toBe(1); // the assignment itself still succeeded
      expect(result.autoAttachedCount).toBe(0);
    });
  });
});

describe("resolveAssignment — admin points a pending row at a page (newTask.md #11)", () => {
  it("marks the assignment matched once the asset exists", async () => {
    mockPrisma.campaignAssignment.findUnique.mockResolvedValue({ id: "a1", campaignId: "c1", status: "pending", postUrl: null, format: null, linkId: null });
    mockPrisma.asset.findUnique.mockResolvedValue({ id: "asset-1", rateCards: [] });
    mockPrisma.campaignAssignment.update.mockResolvedValue({ id: "a1", assetId: "asset-1", status: "matched", postUrl: null, format: null, linkId: null });

    const result = await resolveAssignment("c1", "a1", "asset-1");

    expect(mockPrisma.campaignAssignment.update).toHaveBeenCalledWith({
      where: { id: "a1" },
      data: { assetId: "asset-1", status: "matched" },
    });
    expect(result.status).toBe("matched");
  });

  it("rejects an assignment id that belongs to a different campaign", async () => {
    mockPrisma.campaignAssignment.findUnique.mockResolvedValue({ id: "a1", campaignId: "other-campaign", status: "pending" });

    await expect(resolveAssignment("c1", "a1", "asset-1")).rejects.toBeInstanceOf(ApiError);
    expect(mockPrisma.campaignAssignment.update).not.toHaveBeenCalled();
  });

  it("rejects a nonexistent asset id", async () => {
    mockPrisma.campaignAssignment.findUnique.mockResolvedValue({ id: "a1", campaignId: "c1", status: "pending" });
    mockPrisma.asset.findUnique.mockResolvedValue(null);

    await expect(resolveAssignment("c1", "a1", "missing-asset")).rejects.toBeInstanceOf(ApiError);
  });

  describe("auto-attaching a deferred post once the row resolves (newTask.md, 8 Sep)", () => {
    it("attaches the post once a pending row with postUrl/format finally matches a page", async () => {
      mockPrisma.campaignAssignment.findUnique.mockResolvedValue({
        id: "a1",
        campaignId: "c1",
        status: "pending",
        postUrl: "https://instagram.com/p/1",
        format: "reel",
        cost: null,
        linkId: null,
      });
      mockPrisma.asset.findUnique.mockResolvedValue({ id: "asset-1", ownerId: "creator-1", rateCards: [{ format: "reel", amount: 5000 }] });
      mockPrisma.campaignAssignment.update
        .mockResolvedValueOnce({ id: "a1", campaignId: "c1", assetId: "asset-1", status: "matched", postUrl: "https://instagram.com/p/1", format: "reel", cost: null, linkId: null })
        .mockResolvedValueOnce({ id: "a1", linkId: "link-1" });
      mockPrisma.link.create.mockResolvedValue({ id: "link-1" });

      const result = await resolveAssignment("c1", "a1", "asset-1");

      expect(mockPrisma.link.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ url: "https://instagram.com/p/1", submittedById: "creator-1" }) }));
      expect(result.linkId).toBe("link-1");
    });

    it("is idempotent — a row that already has a linkId is never attached a second time", async () => {
      mockPrisma.campaignAssignment.findUnique.mockResolvedValue({
        id: "a1",
        campaignId: "c1",
        status: "pending",
        postUrl: "https://instagram.com/p/1",
        format: "reel",
        linkId: "already-attached",
      });
      mockPrisma.asset.findUnique.mockResolvedValue({ id: "asset-1", ownerId: "creator-1", rateCards: [] });
      mockPrisma.campaignAssignment.update.mockResolvedValue({
        id: "a1",
        assetId: "asset-1",
        status: "matched",
        postUrl: "https://instagram.com/p/1",
        format: "reel",
        linkId: "already-attached",
      });

      await resolveAssignment("c1", "a1", "asset-1");

      expect(mockPrisma.link.create).not.toHaveBeenCalled();
    });
  });
});

describe("listAssignments — visibility (newTask.md, 8 Sep: \"visible to all creators listed in that sheet\")", () => {
  it("Admin/Finance see every row on the campaign, unscoped", async () => {
    await listAssignments("c1", { id: "admin-1", role: "ADMIN" });
    expect(mockPrisma.campaignAssignment.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { campaignId: "c1" } }));

    await listAssignments("c1", { id: "fin-1", role: "FINANCE" });
    expect(mockPrisma.campaignAssignment.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { campaignId: "c1" } }));
  });

  it("a Creator sees only the row(s) matched to a page they own — not the whole sheet", async () => {
    await listAssignments("c1", { id: "creator-1", role: "CREATOR" });

    expect(mockPrisma.campaignAssignment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { campaignId: "c1", asset: { ownerId: "creator-1" } } })
    );
  });

  it("with no requester (unscoped internal call), returns the whole campaign's rows", async () => {
    await listAssignments("c1");
    expect(mockPrisma.campaignAssignment.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { campaignId: "c1" } }));
  });
});

describe("googleSheetCsvExportUrl — turns a share link into its CSV export URL (bugs.md #6)", () => {
  it("extracts the id and defaults gid to 0 for a plain edit link", () => {
    expect(googleSheetCsvExportUrl("https://docs.google.com/spreadsheets/d/abc123/edit?usp=sharing")).toBe(
      "https://docs.google.com/spreadsheets/d/abc123/export?format=csv&gid=0"
    );
  });

  it("reads gid from the hash, the shape a link copied from the address bar actually has", () => {
    expect(googleSheetCsvExportUrl("https://docs.google.com/spreadsheets/d/abc123/edit#gid=456")).toBe(
      "https://docs.google.com/spreadsheets/d/abc123/export?format=csv&gid=456"
    );
  });

  it("reads gid from a query param when present there instead", () => {
    expect(googleSheetCsvExportUrl("https://docs.google.com/spreadsheets/d/abc123/edit?gid=789")).toBe(
      "https://docs.google.com/spreadsheets/d/abc123/export?format=csv&gid=789"
    );
  });

  it("rejects a non-Google-Sheets host", () => {
    expect(() => googleSheetCsvExportUrl("https://evil.example.com/spreadsheets/d/abc123/edit")).toThrow(ApiError);
  });

  it("rejects a docs.google.com URL that isn't a spreadsheet link", () => {
    expect(() => googleSheetCsvExportUrl("https://docs.google.com/document/d/abc123/edit")).toThrow(ApiError);
  });

  it("rejects a string that isn't a URL at all", () => {
    expect(() => googleSheetCsvExportUrl("not a url")).toThrow(ApiError);
  });
});

describe("fetchSheetCsv — fetches a public sheet's CSV export (bugs.md #6)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the CSV text on a successful fetch", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: new Map([["content-type", "text/csv; charset=utf-8"]]),
      text: async () => "handle,phone\n@page1,9876543210\n",
    });

    const csv = await fetchSheetCsv("https://docs.google.com/spreadsheets/d/abc123/edit");

    expect(csv).toBe("handle,phone\n@page1,9876543210\n");
    expect(mockFetch).toHaveBeenCalledWith("https://docs.google.com/spreadsheets/d/abc123/export?format=csv&gid=0");
  });

  it("rejects with a clear message when the sheet isn't link-shared (Google returns an HTML page, not CSV)", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: new Map([["content-type", "text/html; charset=utf-8"]]),
      text: async () => "<html>Sign in</html>",
    });

    await expect(fetchSheetCsv("https://docs.google.com/spreadsheets/d/abc123/edit")).rejects.toMatchObject({
      code: "SHEET_NOT_SHARED",
    });
  });

  it("rejects when the fetch itself fails", async () => {
    mockFetch.mockRejectedValue(new Error("network down"));

    await expect(fetchSheetCsv("https://docs.google.com/spreadsheets/d/abc123/edit")).rejects.toMatchObject({
      code: "SHEET_FETCH_FAILED",
    });
  });

  it("rejects a non-ok response", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404, headers: new Map() });

    await expect(fetchSheetCsv("https://docs.google.com/spreadsheets/d/abc123/edit")).rejects.toMatchObject({
      code: "SHEET_FETCH_FAILED",
    });
  });
});
