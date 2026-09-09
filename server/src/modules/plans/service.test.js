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

const { createPlan, updatePlan, deletePlan, listPlans, getPlan, submitPlan, approvePlan, rejectPlan, forClientPdf } = await import("./service.js");

const admin = { id: "admin-1", role: "ADMIN" };
const asset = { id: "asset-1", handle: "demo.page", category: "Meme page", followers: 100000, rateCards: [{ format: "reel", amount: 5000 }] };

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
      isGstPlan: false,
      items: [{ assetId: "asset-1", format: "reel", cost: 5000, clientCost: null, postsPerProfile: 1, asset }],
    });

    const plan = await createPlan(admin, { name: "Q1 Pitch", clientName: "Acme", items: [{ assetId: "asset-1", format: "reel" }] });

    expect(mockPrisma.plan.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          items: { create: [{ assetId: "asset-1", format: "reel", cost: 5000, clientCost: null, postsPerProfile: 1 }] },
        }),
      })
    );
    expect(plan.totalCost).toBe(5000);
  });

  it("uses an explicit cost when the line item provides one, overriding the rate card", async () => {
    mockPrisma.asset.findMany.mockResolvedValue([asset]);
    mockPrisma.plan.create.mockResolvedValue({
      id: "plan-1",
      budget: null,
      isGstPlan: false,
      items: [{ assetId: "asset-1", format: "reel", cost: 4200, clientCost: null, postsPerProfile: 1, asset }],
    });

    await createPlan(admin, { name: "Q1 Pitch", clientName: "Acme", items: [{ assetId: "asset-1", format: "reel", cost: 4200 }] });

    expect(mockPrisma.plan.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          items: { create: [{ assetId: "asset-1", format: "reel", cost: 4200, clientCost: null, postsPerProfile: 1 }] },
        }),
      })
    );
  });

  it("rejects a format with no rate card and no explicit cost", async () => {
    mockPrisma.asset.findMany.mockResolvedValue([asset]);

    await expect(
      createPlan(admin, { name: "Q1 Pitch", clientName: "Acme", items: [{ assetId: "asset-1", format: "story" }] })
    ).rejects.toMatchObject({ code: "NO_RATE_CARD" });
  });
});

describe("createPlan — postsPerProfile and clientCost (newTask.md, 8 Sep)", () => {
  it("passes clientCost and postsPerProfile through to the created item", async () => {
    mockPrisma.asset.findMany.mockResolvedValue([asset]);
    mockPrisma.plan.create.mockResolvedValue({
      id: "plan-1",
      budget: null,
      isGstPlan: false,
      items: [{ assetId: "asset-1", format: "reel", cost: 5000, clientCost: 6000, postsPerProfile: 3, asset }],
    });

    await createPlan(admin, {
      name: "Q1",
      clientName: "Acme",
      items: [{ assetId: "asset-1", format: "reel", clientCost: 6000, postsPerProfile: 3 }],
    });

    expect(mockPrisma.plan.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          items: { create: [{ assetId: "asset-1", format: "reel", cost: 5000, clientCost: 6000, postsPerProfile: 3 }] },
        }),
      })
    );
  });

  it("multiplies internal totalCost by postsPerProfile", async () => {
    mockPrisma.asset.findMany.mockResolvedValue([asset]);
    mockPrisma.plan.create.mockResolvedValue({
      id: "plan-1",
      budget: null,
      isGstPlan: false,
      items: [{ assetId: "asset-1", format: "reel", cost: 5000, clientCost: null, postsPerProfile: 3, asset }],
    });

    const plan = await createPlan(admin, { name: "Q1", clientName: "Acme", items: [{ assetId: "asset-1", format: "reel", postsPerProfile: 3 }] });

    expect(plan.totalCost).toBe(15000);
  });
});

describe("createPlan — overview (newTask.md, 8 Sep: matches the example sheet's Overview tab)", () => {
  it("subtotal falls back to the internal cost when no clientCost is set", async () => {
    mockPrisma.asset.findMany.mockResolvedValue([asset]);
    mockPrisma.plan.create.mockResolvedValue({
      id: "plan-1",
      budget: null,
      isGstPlan: false,
      items: [{ assetId: "asset-1", format: "reel", cost: 5000, clientCost: null, postsPerProfile: 1, asset }],
    });

    const plan = await createPlan(admin, { name: "Q1", clientName: "Acme", items: [{ assetId: "asset-1", format: "reel" }] });

    expect(plan.overview.subtotal).toBe(5000);
    expect(plan.overview.gstAmount).toBe(0);
    expect(plan.overview.total).toBe(5000);
  });

  it("uses clientCost instead of the internal cost when one is set, independent of totalCost", async () => {
    mockPrisma.asset.findMany.mockResolvedValue([asset]);
    mockPrisma.plan.create.mockResolvedValue({
      id: "plan-1",
      budget: null,
      isGstPlan: false,
      items: [{ assetId: "asset-1", format: "reel", cost: 5000, clientCost: 8000, postsPerProfile: 1, asset }],
    });

    const plan = await createPlan(admin, { name: "Q1", clientName: "Acme", items: [{ assetId: "asset-1", format: "reel", clientCost: 8000 }] });

    expect(plan.totalCost).toBe(5000); // internal, unaffected by clientCost
    expect(plan.overview.subtotal).toBe(8000); // client-facing, uses the markup
  });

  it("adds 18% GST on the client subtotal when isGstPlan is true", async () => {
    mockPrisma.asset.findMany.mockResolvedValue([asset]);
    mockPrisma.plan.create.mockResolvedValue({
      id: "plan-1",
      budget: null,
      isGstPlan: true,
      items: [{ assetId: "asset-1", format: "reel", cost: 10000, clientCost: null, postsPerProfile: 1, asset }],
    });

    const plan = await createPlan(admin, { name: "Q1", clientName: "Acme", isGstPlan: true, items: [{ assetId: "asset-1", format: "reel" }] });

    expect(plan.overview.subtotal).toBe(10000);
    expect(plan.overview.gstAmount).toBe(1800);
    expect(plan.overview.total).toBe(11800);
  });

  it("totalPosts sums postsPerProfile across items; totalFollowers counts each distinct page once", async () => {
    const asset2 = { id: "asset-2", handle: "second.page", category: "News", followers: 50000, rateCards: [] };
    mockPrisma.asset.findMany.mockResolvedValue([asset, asset2]);
    mockPrisma.plan.create.mockResolvedValue({
      id: "plan-1",
      budget: null,
      isGstPlan: false,
      items: [
        { assetId: "asset-1", format: "reel", cost: 5000, clientCost: null, postsPerProfile: 2, asset },
        { assetId: "asset-1", format: "story", cost: 3000, clientCost: null, postsPerProfile: 1, asset },
        { assetId: "asset-2", format: "reel", cost: 4000, clientCost: null, postsPerProfile: 3, asset: asset2 },
      ],
    });

    const plan = await createPlan(admin, {
      name: "Q1",
      clientName: "Acme",
      items: [
        { assetId: "asset-1", format: "reel", cost: 5000, postsPerProfile: 2 },
        { assetId: "asset-1", format: "story", cost: 3000, postsPerProfile: 1 },
        { assetId: "asset-2", format: "reel", cost: 4000, postsPerProfile: 3 },
      ],
    });

    expect(plan.overview.totalPosts).toBe(6); // 2 + 1 + 3
    expect(plan.overview.totalFollowers).toBe(150000); // 100000 + 50000, asset-1 counted once
  });

  it("expectedImpressions estimates from avg. views per post × postsPerProfile", async () => {
    mockPrisma.asset.findMany.mockResolvedValue([asset]);
    mockPrisma.plan.create.mockResolvedValue({
      id: "plan-1",
      budget: null,
      isGstPlan: false,
      items: [{ assetId: "asset-1", format: "reel", cost: 5000, clientCost: null, postsPerProfile: 4, asset }],
    });

    const plan = await createPlan(admin, { name: "Q1", clientName: "Acme", items: [{ assetId: "asset-1", format: "reel", postsPerProfile: 4 }] });

    expect(plan.overview.expectedImpressions).toBe(20000); // avgViews 5000 × 4 posts
  });
});

describe("createPlan — budget variance (newTask.md #13: extra cost or less cost)", () => {
  it("is positive (under budget) when total cost is below budget", async () => {
    mockPrisma.asset.findMany.mockResolvedValue([asset]);
    mockPrisma.plan.create.mockResolvedValue({
      id: "plan-1",
      budget: 10000,
      isGstPlan: false,
      items: [{ assetId: "asset-1", format: "reel", cost: 5000, clientCost: null, postsPerProfile: 1, asset }],
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
      isGstPlan: false,
      items: [{ assetId: "asset-1", format: "reel", cost: 5000, clientCost: null, postsPerProfile: 1, asset }],
    });

    const plan = await createPlan(admin, { name: "Q1", clientName: "Acme", budget: 3000, items: [{ assetId: "asset-1", format: "reel" }] });

    expect(plan.budgetVariance).toBe(-2000);
  });

  it("is null when no budget was set", async () => {
    mockPrisma.asset.findMany.mockResolvedValue([asset]);
    mockPrisma.plan.create.mockResolvedValue({
      id: "plan-1",
      budget: null,
      isGstPlan: false,
      items: [{ assetId: "asset-1", format: "reel", cost: 5000, clientCost: null, postsPerProfile: 1, asset }],
    });

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
      isGstPlan: false,
      items: [
        { assetId: "asset-1", format: "reel", cost: 5000, clientCost: null, postsPerProfile: 1, asset },
        { assetId: "asset-1", format: "story", cost: 3000, clientCost: null, postsPerProfile: 1, asset },
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

describe("forClientPdf — strips internal cost before anything reaches the PDF (newTask.md, 8 Sep)", () => {
  it("uses clientCost as displayCost when set, and drops cost/clientCost entirely from the output", async () => {
    mockPrisma.asset.findMany.mockResolvedValue([asset]);
    mockPrisma.plan.create.mockResolvedValue({
      id: "plan-1",
      budget: null,
      isGstPlan: false,
      clientName: "Acme",
      name: "Q1",
      createdAt: new Date("2026-01-01"),
      clientContact: null,
      items: [{ assetId: "asset-1", format: "reel", cost: 5000, clientCost: 8000, postsPerProfile: 2, asset }],
    });
    const plan = await createPlan(admin, { name: "Q1", clientName: "Acme", items: [{ assetId: "asset-1", format: "reel", clientCost: 8000 }] });

    const forPdf = forClientPdf(plan);

    expect(forPdf.items).toEqual([
      { format: "reel", postsPerProfile: 2, displayCost: 8000, asset: { handle: "demo.page", category: "Meme page", followers: 100000 } },
    ]);
    expect(forPdf.items[0]).not.toHaveProperty("cost");
    expect(forPdf.items[0]).not.toHaveProperty("clientCost");
    expect(forPdf).not.toHaveProperty("totalCost");
    expect(forPdf).not.toHaveProperty("budgetVariance");
  });

  it("falls back to the internal cost as displayCost when no clientCost is set", async () => {
    mockPrisma.asset.findMany.mockResolvedValue([asset]);
    mockPrisma.plan.create.mockResolvedValue({
      id: "plan-1",
      budget: null,
      isGstPlan: false,
      clientName: "Acme",
      name: "Q1",
      createdAt: new Date("2026-01-01"),
      clientContact: null,
      items: [{ assetId: "asset-1", format: "reel", cost: 5000, clientCost: null, postsPerProfile: 1, asset }],
    });
    const plan = await createPlan(admin, { name: "Q1", clientName: "Acme", items: [{ assetId: "asset-1", format: "reel" }] });

    const forPdf = forClientPdf(plan);

    expect(forPdf.items[0].displayCost).toBe(5000);
  });
});

describe("updatePlan", () => {
  it("404s on a plan that doesn't exist", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue(null);

    await expect(updatePlan("missing", admin, { name: "New name" })).rejects.toBeInstanceOf(ApiError);
  });

  it("replaces every item when a new items array is given", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue({ id: "plan-1" });
    mockPrisma.asset.findMany.mockResolvedValue([asset]);
    mockPrisma.planItem.deleteMany.mockResolvedValue({ count: 2 });
    mockPrisma.plan.update.mockResolvedValue({
      id: "plan-1",
      budget: null,
      isGstPlan: false,
      items: [{ assetId: "asset-1", format: "reel", cost: 5000, clientCost: null, postsPerProfile: 1, asset }],
    });

    await updatePlan("plan-1", admin, { items: [{ assetId: "asset-1", format: "reel" }] });

    expect(mockPrisma.planItem.deleteMany).toHaveBeenCalledWith({ where: { planId: "plan-1" } });
  });
});

describe("deletePlan", () => {
  it("404s on a plan that doesn't exist", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue(null);

    await expect(deletePlan("missing", admin)).rejects.toBeInstanceOf(ApiError);
    expect(mockPrisma.plan.delete).not.toHaveBeenCalled();
  });
});

describe("Plan Maker access scoping (newTask.md, 8 Sep — \"Plan Maker... approves plans he created as well\")", () => {
  const planMaker = { id: "pm-1", role: "PLAN_MAKER" };
  const otherPlanMaker = { id: "pm-2", role: "PLAN_MAKER" };

  it("listPlans scopes to the requester's own plans for a non-admin, but not for ADMIN", async () => {
    mockPrisma.plan.findMany.mockResolvedValue([]);

    await listPlans(planMaker);
    expect(mockPrisma.plan.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { createdById: "pm-1" } }));

    await listPlans(admin);
    expect(mockPrisma.plan.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });

  it("getPlan 404s (not 403s) when a Plan Maker requests a plan they didn't create", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue({ id: "plan-1", createdById: "pm-1", status: "DRAFT", items: [] });

    await expect(getPlan("plan-1", otherPlanMaker)).rejects.toBeInstanceOf(ApiError);
  });

  it("getPlan succeeds for the Plan Maker who created it, and for any ADMIN", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue({ id: "plan-1", createdById: "pm-1", status: "DRAFT", budget: null, isGstPlan: false, items: [] });

    await expect(getPlan("plan-1", planMaker)).resolves.toMatchObject({ id: "plan-1" });
    await expect(getPlan("plan-1", admin)).resolves.toMatchObject({ id: "plan-1" });
  });

  it("updatePlan and deletePlan reject a Plan Maker touching someone else's plan", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue({ id: "plan-1", createdById: "pm-1" });

    await expect(updatePlan("plan-1", otherPlanMaker, { name: "Hijacked" })).rejects.toBeInstanceOf(ApiError);
    await expect(deletePlan("plan-1", otherPlanMaker)).rejects.toBeInstanceOf(ApiError);
    expect(mockPrisma.plan.update).not.toHaveBeenCalled();
    expect(mockPrisma.plan.delete).not.toHaveBeenCalled();
  });
});

describe("Plan approval workflow (newTask.md, 8 Sep — Plan → Approve step)", () => {
  const planMaker = { id: "pm-1", role: "PLAN_MAKER" };
  const otherPlanMaker = { id: "pm-2", role: "PLAN_MAKER" };

  it("submitPlan moves a DRAFT plan to PENDING_APPROVAL for its own creator", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue({ id: "plan-1", createdById: "pm-1", status: "DRAFT" });
    mockPrisma.plan.update.mockResolvedValue({ id: "plan-1", status: "PENDING_APPROVAL", budget: null, isGstPlan: false, items: [] });

    const plan = await submitPlan("plan-1", planMaker);

    expect(mockPrisma.plan.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "PENDING_APPROVAL" } }));
    expect(plan.status).toBe("PENDING_APPROVAL");
  });

  it("submitPlan refuses a plan that isn't DRAFT", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue({ id: "plan-1", createdById: "pm-1", status: "APPROVED" });

    await expect(submitPlan("plan-1", planMaker)).rejects.toBeInstanceOf(ApiError);
    expect(mockPrisma.plan.update).not.toHaveBeenCalled();
  });

  it("a Plan Maker can approve their own pending plan", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue({ id: "plan-1", createdById: "pm-1", status: "PENDING_APPROVAL" });
    mockPrisma.plan.update.mockResolvedValue({ id: "plan-1", status: "APPROVED", budget: null, isGstPlan: false, items: [] });

    const plan = await approvePlan("plan-1", planMaker);

    expect(mockPrisma.plan.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "APPROVED", approvedById: "pm-1", approvedAt: expect.any(Date) } })
    );
    expect(plan.status).toBe("APPROVED");
  });

  it("a Plan Maker cannot approve or reject someone else's pending plan", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue({ id: "plan-1", createdById: "pm-1", status: "PENDING_APPROVAL" });

    await expect(approvePlan("plan-1", otherPlanMaker)).rejects.toBeInstanceOf(ApiError);
    await expect(rejectPlan("plan-1", otherPlanMaker)).rejects.toBeInstanceOf(ApiError);
    expect(mockPrisma.plan.update).not.toHaveBeenCalled();
  });

  it("ADMIN can approve or reject any Plan Maker's pending plan", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue({ id: "plan-1", createdById: "pm-1", status: "PENDING_APPROVAL" });
    mockPrisma.plan.update.mockResolvedValue({ id: "plan-1", status: "REJECTED", budget: null, isGstPlan: false, items: [] });

    const plan = await rejectPlan("plan-1", admin);

    expect(mockPrisma.plan.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "REJECTED", approvedById: "admin-1", approvedAt: expect.any(Date) } })
    );
    expect(plan.status).toBe("REJECTED");
  });

  it("refuses to approve/reject a plan that isn't pending approval", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue({ id: "plan-1", createdById: "admin-1", status: "DRAFT" });

    await expect(approvePlan("plan-1", admin)).rejects.toBeInstanceOf(ApiError);
    expect(mockPrisma.plan.update).not.toHaveBeenCalled();
  });
});
