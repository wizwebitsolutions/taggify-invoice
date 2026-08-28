import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApiError } from "../../middleware/errorHandler.js";

const mockPrisma = { asset: { create: vi.fn() } };
vi.mock("../../lib/prisma.js", () => ({ prisma: mockPrisma }));
vi.mock("../scraping/service.js", () => ({ refreshAssetMetrics: vi.fn(async () => {}) }));

const { createAsset } = await import("./service.js");

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.asset.create.mockImplementation(async ({ data }) => ({ id: "asset-1", ...data }));
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
