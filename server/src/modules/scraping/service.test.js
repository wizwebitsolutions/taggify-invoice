import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = { asset: { findUnique: vi.fn(), update: vi.fn(async ({ data }) => ({ id: "asset-1", ...data })) }, accountSnapshot: { create: vi.fn(async () => ({})) } };
vi.mock("../../lib/prisma.js", () => ({ prisma: mockPrisma }));
const getAccountMetrics = vi.fn();
vi.mock("../../lib/apifyClient.js", () => ({ ApifyInstagramProvider: { getAccountMetrics: (...a) => getAccountMetrics(...a) }, PostNotFoundError: class extends Error {} }));

const { refreshAssetMetrics } = await import("./service.js");

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.asset.findUnique.mockResolvedValue({ id: "asset-1", handle: "demo.page" });
});

/** Inventory "Create page" (14 Sep): the profile scrape now also stores avg views/likes/comments and when it last ran. */
describe("refreshAssetMetrics — profile engagement + scrape status", () => {
  it("stores followers, the latest-posts averages, lastScrapedAt, and clears any previous error", async () => {
    getAccountMetrics.mockResolvedValue({ followers: 5000, mediaCount: 40, fullName: "Demo", biography: null, profilePicUrl: null, avgViews: 1200, avgLikes: 80, avgComments: 4, sampleSize: 12 });
    await refreshAssetMetrics("asset-1");
    const { data } = mockPrisma.asset.update.mock.calls[0][0];
    expect(data).toMatchObject({ followers: 5000, profileAvgViews: 1200, profileAvgLikes: 80, profileAvgComments: 4, profileSampleSize: 12, lastScrapeError: null, scrapeQueuedAt: null });
    expect(data.lastScrapedAt).toBeInstanceOf(Date);
  });

  it("keeps an earlier good sample when the scrape saw no posts", async () => {
    getAccountMetrics.mockResolvedValue({ followers: 5000, mediaCount: 0, avgViews: null, avgLikes: null, avgComments: null, sampleSize: 0 });
    await refreshAssetMetrics("asset-1");
    const { data } = mockPrisma.asset.update.mock.calls[0][0];
    expect(data).not.toHaveProperty("profileAvgViews");
    expect(data).not.toHaveProperty("profileSampleSize");
  });

  it("records why the scrape failed on the asset, then rethrows", async () => {
    getAccountMetrics.mockRejectedValue(new Error('Apify: no profile for handle "demo.page" (private account)'));
    await expect(refreshAssetMetrics("asset-1")).rejects.toThrow(/private account/);
    expect(mockPrisma.asset.update).toHaveBeenCalledWith({ where: { id: "asset-1" }, data: { lastScrapeError: expect.stringMatching(/private account/), scrapeQueuedAt: null } });
    expect(mockPrisma.accountSnapshot.create).not.toHaveBeenCalled();
  });
});
