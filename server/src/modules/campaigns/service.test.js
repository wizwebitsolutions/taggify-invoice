import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApiError } from "../../middleware/errorHandler.js";

const mockPrisma = {
  campaign: { findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
  link: { findMany: vi.fn() },
  campaignAssignment: { findMany: vi.fn(), createMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  asset: { findMany: vi.fn(), findUnique: vi.fn() },
};
vi.mock("../../lib/prisma.js", () => ({ prisma: mockPrisma }));

const { listCampaigns, createCampaign, resolveAssignment } = await import("./service.js");

beforeEach(() => {
  vi.clearAllMocks();
  // Sensible defaults so tests that don't care about assignments/links don't
  // have to stub every call — override per-test where it matters.
  mockPrisma.link.findMany.mockResolvedValue([]);
  mockPrisma.campaignAssignment.findMany.mockResolvedValue([]);
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
});

describe("createCampaign — attaching a page/creator sheet (newTask.md #8)", () => {
  beforeEach(() => {
    mockPrisma.campaign.create.mockResolvedValue({ id: "c1", ...baseCampaign });
  });

  it("matches a sheet row to an existing page by handle (case/at-sign insensitive)", async () => {
    mockPrisma.asset.findMany.mockResolvedValue([{ id: "asset-1", handle: "demo.page" }]);
    mockPrisma.campaignAssignment.createMany.mockResolvedValue({ count: 1 });

    const result = await createCampaign({
      brandName: "Acme",
      title: "Launch",
      assignments: [{ handle: "@Demo.Page" }],
    });

    expect(mockPrisma.campaignAssignment.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ pageHandle: "Demo.Page", assetId: "asset-1", status: "matched" })],
    });
    expect(result.matchedCount).toBe(1);
    expect(result.pendingCount).toBe(0);
  });

  it("leaves a row pending when no existing page matches its handle", async () => {
    mockPrisma.asset.findMany.mockResolvedValue([]);
    mockPrisma.campaignAssignment.createMany.mockResolvedValue({ count: 1 });

    const result = await createCampaign({
      brandName: "Acme",
      title: "Launch",
      assignments: [{ handle: "unknown.page", phone: "+919999999999" }],
    });

    expect(mockPrisma.campaignAssignment.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ pageHandle: "unknown.page", assetId: null, status: "pending", creatorPhone: "+919999999999" })],
    });
    expect(result.matchedCount).toBe(0);
    expect(result.pendingCount).toBe(1);
  });

  it("doesn't touch CampaignAssignment at all when no sheet was attached", async () => {
    const result = await createCampaign({ brandName: "Acme", title: "Launch" });

    expect(mockPrisma.asset.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.campaignAssignment.createMany).not.toHaveBeenCalled();
    expect(result.matchedCount).toBe(0);
    expect(result.pendingCount).toBe(0);
  });
});

describe("resolveAssignment — admin points a pending row at a page (newTask.md #11)", () => {
  it("marks the assignment matched once the asset exists", async () => {
    mockPrisma.campaignAssignment.findUnique.mockResolvedValue({ id: "a1", campaignId: "c1", status: "pending" });
    mockPrisma.asset.findUnique.mockResolvedValue({ id: "asset-1" });
    mockPrisma.campaignAssignment.update.mockResolvedValue({ id: "a1", assetId: "asset-1", status: "matched" });

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
});
