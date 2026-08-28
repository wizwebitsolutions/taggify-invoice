import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApiError } from "../../middleware/errorHandler.js";

const mockPrisma = {
  link: { findUnique: vi.fn(), update: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
  linkCostRevision: { create: vi.fn(), findMany: vi.fn() },
  linkStatusEvent: { create: vi.fn() },
  campaign: { findMany: vi.fn() },
  asset: { findMany: vi.fn() },
  $transaction: vi.fn(async (ops) => Promise.all(ops)),
};
vi.mock("../../lib/prisma.js", () => ({ prisma: mockPrisma }));
vi.mock("../../lib/cloudinaryClient.js", () => ({ publicUrlFor: vi.fn((id) => `https://cloudinary/${id}`) }));
vi.mock("../scraping/service.js", () => ({ refreshLinkMetrics: vi.fn(async () => ({ ok: true })) }));

const { reviseLinkCost, getLinkCostRevisions, bulkImportLinks } = await import("./service.js");

const admin = { id: "admin-1", role: "ADMIN" };

beforeEach(() => vi.clearAllMocks());

describe("reviseLinkCost — per-page cost revision (newTask.md #10)", () => {
  it("updates the link's cost and logs a revision with the previous value", async () => {
    mockPrisma.link.findUnique.mockResolvedValue({ id: "link-1", cost: 1000, status: "SCREENSHOT_APPROVED" });
    mockPrisma.link.update.mockResolvedValue({ id: "link-1", cost: 1500 });
    mockPrisma.linkCostRevision.create.mockResolvedValue({});

    await reviseLinkCost("link-1", admin, { cost: 1500, note: "renegotiated" });

    expect(mockPrisma.link.update).toHaveBeenCalledWith({ where: { id: "link-1" }, data: { cost: 1500, customRate: true } });
    expect(mockPrisma.linkCostRevision.create).toHaveBeenCalledWith({
      data: { linkId: "link-1", previousCost: 1000, newCost: 1500, note: "renegotiated", revisedById: "admin-1" },
    });
  });

  it("refuses to revise the cost of a link that's already been invoiced", async () => {
    mockPrisma.link.findUnique.mockResolvedValue({ id: "link-1", cost: 1000, status: "INVOICED" });

    await expect(reviseLinkCost("link-1", admin, { cost: 1500 })).rejects.toMatchObject({ code: "ALREADY_INVOICED" });
    expect(mockPrisma.link.update).not.toHaveBeenCalled();
  });

  it("404s on a link that doesn't exist", async () => {
    mockPrisma.link.findUnique.mockResolvedValue(null);

    await expect(reviseLinkCost("missing", admin, { cost: 1500 })).rejects.toBeInstanceOf(ApiError);
  });
});

describe("getLinkCostRevisions", () => {
  it("returns the revision history newest-first", async () => {
    mockPrisma.linkCostRevision.findMany.mockResolvedValue([{ id: "rev-1" }]);

    const result = await getLinkCostRevisions("link-1");

    expect(mockPrisma.linkCostRevision.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { linkId: "link-1" }, orderBy: { createdAt: "desc" } })
    );
    expect(result).toEqual([{ id: "rev-1" }]);
  });
});

describe("bulkImportLinks — admin sheet import of already-done work (newTask.md #8)", () => {
  const campaign = { id: "camp-1", title: "Launch Week" };
  const asset = { id: "asset-1", handle: "demo.page", rateCards: [{ format: "reel", amount: 5000 }] };

  it("resolves campaign/page by name and creates the link, using the sheet's cost when given", async () => {
    mockPrisma.campaign.findMany.mockResolvedValue([campaign]);
    mockPrisma.asset.findMany.mockResolvedValue([asset]);
    mockPrisma.link.findFirst.mockResolvedValue(null);
    mockPrisma.link.create.mockResolvedValue({ id: "link-1" });
    mockPrisma.linkStatusEvent.create.mockResolvedValue({});

    const result = await bulkImportLinks(admin, {
      rows: [{ campaignTitle: "Launch Week", pageHandle: "@demo.page", url: "https://instagram.com/p/1", format: "reel", cost: 9000 }],
    });

    expect(result.created).toHaveLength(1);
    expect(result.skipped).toEqual([]);
    expect(mockPrisma.link.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ campaignId: "camp-1", assetId: "asset-1", cost: 9000, customRate: true }) })
    );
  });

  it("falls back to the page's rate card when the sheet doesn't give a cost", async () => {
    mockPrisma.campaign.findMany.mockResolvedValue([campaign]);
    mockPrisma.asset.findMany.mockResolvedValue([asset]);
    mockPrisma.link.findFirst.mockResolvedValue(null);
    mockPrisma.link.create.mockResolvedValue({ id: "link-1" });
    mockPrisma.linkStatusEvent.create.mockResolvedValue({});

    await bulkImportLinks(admin, {
      rows: [{ campaignTitle: "Launch Week", pageHandle: "demo.page", url: "https://instagram.com/p/1", format: "reel" }],
    });

    expect(mockPrisma.link.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ cost: 5000, customRate: false }) })
    );
  });

  it("skips a row whose campaign title doesn't match anything, without touching other rows", async () => {
    mockPrisma.campaign.findMany.mockResolvedValue([]);
    mockPrisma.asset.findMany.mockResolvedValue([asset]);

    const result = await bulkImportLinks(admin, {
      rows: [{ campaignTitle: "Nonexistent Campaign", pageHandle: "demo.page", url: "https://instagram.com/p/1", format: "reel" }],
    });

    expect(result.created).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toMatch(/No campaign titled/);
    expect(mockPrisma.link.create).not.toHaveBeenCalled();
  });

  it("skips a row whose page handle doesn't match anything", async () => {
    mockPrisma.campaign.findMany.mockResolvedValue([campaign]);
    mockPrisma.asset.findMany.mockResolvedValue([]);

    const result = await bulkImportLinks(admin, {
      rows: [{ campaignTitle: "Launch Week", pageHandle: "unknown.page", url: "https://instagram.com/p/1", format: "reel" }],
    });

    expect(result.skipped[0].reason).toMatch(/No page @unknown\.page/);
  });

  it("skips a URL that's already been submitted for that page", async () => {
    mockPrisma.campaign.findMany.mockResolvedValue([campaign]);
    mockPrisma.asset.findMany.mockResolvedValue([asset]);
    mockPrisma.link.findFirst.mockResolvedValue({ id: "existing-link" });

    const result = await bulkImportLinks(admin, {
      rows: [{ campaignTitle: "Launch Week", pageHandle: "demo.page", url: "https://instagram.com/p/1", format: "reel" }],
    });

    expect(result.skipped[0].reason).toBe("Already submitted for this page");
    expect(mockPrisma.link.create).not.toHaveBeenCalled();
  });
});
