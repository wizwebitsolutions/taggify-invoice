import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApiError } from "../../middleware/errorHandler.js";

const mockPrisma = {
  asset: { findMany: vi.fn() },
  plan: { create: vi.fn(), update: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), delete: vi.fn() },
  planItem: { deleteMany: vi.fn() },
};
vi.mock("../../lib/prisma.js", () => ({ prisma: mockPrisma }));

const mockGetAvgEngagement = vi.fn();
vi.mock("../assets/service.js", () => ({ getAvgEngagement: (...args) => mockGetAvgEngagement(...args) }));

const { createPlan, updatePlan, deletePlan } = await import("./service.js");

const admin = { id: "admin-1", role: "ADMIN" };
const asset = { id: "asset-1", handle: "demo.page", rateCards: [{ format: "reel", amount: 5000 }] };

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAvgEngagement.mockResolvedValue({ avgLikes: 1000, avgComments: 10, avgViews: 5000, sampleSize: 2 });
});

describe("createPlan — item costs (newTask.md #13: cost calculation)", () => {
  it("uses the page's rate card when a line item has no explicit cost", async () => {
    mockPrisma.asset.findMany.mockResolvedValue([asset]);
    mockPrisma.plan.create.mockResolvedValue({
      id: "plan-1",
      budget: null,
      items: [{ assetId: "asset-1", format: "reel", cost: 5000, asset }],
    });

    const plan = await createPlan(admin, { name: "Q1 Pitch", clientName: "Acme", items: [{ assetId: "asset-1", format: "reel" }] });

    expect(mockPrisma.plan.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ items: { create: [{ assetId: "asset-1", format: "reel", cost: 5000 }] } }) })
    );
    expect(plan.totalCost).toBe(5000);
  });

  it("uses an explicit cost when the line item provides one, overriding the rate card", async () => {
    mockPrisma.asset.findMany.mockResolvedValue([asset]);
    mockPrisma.plan.create.mockResolvedValue({
      id: "plan-1",
      budget: null,
      items: [{ assetId: "asset-1", format: "reel", cost: 4200, asset }],
    });

    await createPlan(admin, { name: "Q1 Pitch", clientName: "Acme", items: [{ assetId: "asset-1", format: "reel", cost: 4200 }] });

    expect(mockPrisma.plan.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ items: { create: [{ assetId: "asset-1", format: "reel", cost: 4200 }] } }) })
    );
  });

  it("rejects a format with no rate card and no explicit cost", async () => {
    mockPrisma.asset.findMany.mockResolvedValue([asset]);

    await expect(
      createPlan(admin, { name: "Q1 Pitch", clientName: "Acme", items: [{ assetId: "asset-1", format: "story" }] })
    ).rejects.toMatchObject({ code: "NO_RATE_CARD" });
  });
});

describe("createPlan — budget variance (newTask.md #13: extra cost or less cost)", () => {
  it("is positive (under budget) when total cost is below budget", async () => {
    mockPrisma.asset.findMany.mockResolvedValue([asset]);
    mockPrisma.plan.create.mockResolvedValue({
      id: "plan-1",
      budget: 10000,
      items: [{ assetId: "asset-1", format: "reel", cost: 5000, asset }],
    });

    const plan = await createPlan(admin, { name: "Q1", clientName: "Acme", budget: 10000, items: [{ assetId: "asset-1", format: "reel" }] });

    expect(plan.totalCost).toBe(5000);
    expect(plan.budgetVariance).toBe(5000);
  });

  it("is negative (over budget) when total cost exceeds budget", async () => {
    mockPrisma.asset.findMany.mockResolvedValue([asset]);
    mockPrisma.plan.create.mockResolvedValue({
      id: "plan-1",
      budget: 3000,
      items: [{ assetId: "asset-1", format: "reel", cost: 5000, asset }],
    });

    const plan = await createPlan(admin, { name: "Q1", clientName: "Acme", budget: 3000, items: [{ assetId: "asset-1", format: "reel" }] });

    expect(plan.budgetVariance).toBe(-2000);
  });

  it("is null when no budget was set", async () => {
    mockPrisma.asset.findMany.mockResolvedValue([asset]);
    mockPrisma.plan.create.mockResolvedValue({ id: "plan-1", budget: null, items: [{ assetId: "asset-1", format: "reel", cost: 5000, asset }] });

    const plan = await createPlan(admin, { name: "Q1", clientName: "Acme", items: [{ assetId: "asset-1", format: "reel" }] });

    expect(plan.budgetVariance).toBeNull();
  });
});

describe("createPlan — expected engagement", () => {
  it("counts each distinct page once even if it's added for multiple formats", async () => {
    mockPrisma.asset.findMany.mockResolvedValue([asset]);
    mockPrisma.plan.create.mockResolvedValue({
      id: "plan-1",
      budget: null,
      items: [
        { assetId: "asset-1", format: "reel", cost: 5000, asset },
        { assetId: "asset-1", format: "story", cost: 3000, asset },
      ],
    });

    const plan = await createPlan(admin, {
      name: "Q1",
      clientName: "Acme",
      items: [
        { assetId: "asset-1", format: "reel", cost: 5000 },
        { assetId: "asset-1", format: "story", cost: 3000 },
      ],
    });

    expect(mockGetAvgEngagement).toHaveBeenCalledTimes(1); // one distinct asset, not once per item
    expect(plan.expectedEngagement).toEqual({ likes: 1000, views: 5000 });
  });
});

describe("updatePlan", () => {
  it("404s on a plan that doesn't exist", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue(null);

    await expect(updatePlan("missing", { name: "New name" })).rejects.toBeInstanceOf(ApiError);
  });

  it("replaces every item when a new items array is given", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue({ id: "plan-1" });
    mockPrisma.asset.findMany.mockResolvedValue([asset]);
    mockPrisma.planItem.deleteMany.mockResolvedValue({ count: 2 });
    mockPrisma.plan.update.mockResolvedValue({ id: "plan-1", budget: null, items: [{ assetId: "asset-1", format: "reel", cost: 5000, asset }] });

    await updatePlan("plan-1", { items: [{ assetId: "asset-1", format: "reel" }] });

    expect(mockPrisma.planItem.deleteMany).toHaveBeenCalledWith({ where: { planId: "plan-1" } });
  });
});

describe("deletePlan", () => {
  it("404s on a plan that doesn't exist", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue(null);

    await expect(deletePlan("missing")).rejects.toBeInstanceOf(ApiError);
    expect(mockPrisma.plan.delete).not.toHaveBeenCalled();
  });
});
