import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ApiError } from "../../middleware/errorHandler.js";

const mockPrisma = {
  asset: { findMany: vi.fn(), create: vi.fn() },
  plan: { create: vi.fn(), update: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), delete: vi.fn(), count: vi.fn() },
  planItem: { deleteMany: vi.fn(), createMany: vi.fn() },
  campaign: { create: vi.fn() },
  appSetting: { findUnique: vi.fn(), upsert: vi.fn() },
  // createPlanVariant wraps its count+create in a transaction (code review,
  // 10 Sep — closes a duplicate-label race) — `tx` is just `mockPrisma`
  // itself here, so every existing plan.update/count/create mock below
  // keeps working unchanged whether or not it's called through $transaction.
  $transaction: vi.fn((cb) => cb(mockPrisma)),
};
vi.mock("../../lib/prisma.js", () => ({ prisma: mockPrisma }));

const mockGetAvgEngagement = vi.fn();
vi.mock("../assets/service.js", () => ({ getAvgEngagement: (...args) => mockGetAvgEngagement(...args) }));

const mockCreateSpreadsheet = vi.fn();
const mockDeleteSheetTab = vi.fn();
const mockEnsureSheetTabsExist = vi.fn();
const mockWriteSheetTab = vi.fn();
const mockGetSheetTabIds = vi.fn();
const mockBatchUpdateSpreadsheet = vi.fn();
vi.mock("../../lib/googleSheetsClient.js", () => ({
  createSpreadsheet: (...args) => mockCreateSpreadsheet(...args),
  deleteSheetTab: (...args) => mockDeleteSheetTab(...args),
  ensureSheetTabsExist: (...args) => mockEnsureSheetTabsExist(...args),
  writeSheetTab: (...args) => mockWriteSheetTab(...args),
  getSheetTabIds: (...args) => mockGetSheetTabIds(...args),
  batchUpdateSpreadsheet: (...args) => mockBatchUpdateSpreadsheet(...args),
}));

const mockMakeFilePublicViewable = vi.fn();
vi.mock("../../lib/googleDriveClient.js", () => ({
  makeFilePublicViewable: (...args) => mockMakeFilePublicViewable(...args),
}));

// getUserAccessToken/isGoogleOAuthConfigured (not getAccessToken/env vars) —
// per-plan spreadsheets need a real Google account's own Drive quota, so
// generatePlanSheet/getExecutionSheetTemplate authenticate via the OAuth
// flow (googleOAuthClient.js) instead of the zero-quota service account
// (user request, 10 Sep — "1 spreadsheet generation per plan, not just
// write access").
const mockGetUserAccessToken = vi.fn();
const mockIsGoogleOAuthConfigured = vi.fn();
vi.mock("../../lib/googleOAuthClient.js", () => ({
  getUserAccessToken: (...args) => mockGetUserAccessToken(...args),
  isGoogleOAuthConfigured: (...args) => mockIsGoogleOAuthConfigured(...args),
}));

const mockCloudinary = {
  buildPlanInvoiceAttachmentKey: vi.fn((id) => `plan-invoice-attachments/${id}/uuid`),
  getUploadParams: vi.fn((publicId) => ({ uploadUrl: "https://upload", apiKey: "k", timestamp: 1, signature: "s", publicId })),
  objectExists: vi.fn(async () => true),
  publicUrlFor: vi.fn((id) => `https://cdn/${id}`),
};
vi.mock("../../lib/cloudinaryClient.js", () => mockCloudinary);

const {
  createPlan,
  updatePlan,
  deletePlan,
  listPlans,
  getPlan,
  approvePlan,
  rejectPlan,
  forClientPdf,
  createPlanVariant,
  listPlanGroup,
  generatePlanSheet,
  importPlanSheetPages,
  getExecutionSheetTemplate,
  getExecutionSheetTemplatePreview,
  generateClientInvoice,
  getClientInvoice,
  forClientInvoice,
  requestInvoiceAttachmentUpload,
  confirmInvoiceAttachment,
  removeInvoiceAttachment,
} = await import("./service.js");

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

  it("is negative (over budget) when our internal cost exceeds budget even though the client price fits it", async () => {
    mockPrisma.asset.findMany.mockResolvedValue([asset]);
    mockPrisma.plan.create.mockResolvedValue({
      id: "plan-1",
      budget: 3000,
      isGstPlan: false,
      items: [{ assetId: "asset-1", format: "reel", cost: 5000, clientCost: 2500, postsPerProfile: 1, asset }],
    });

    const plan = await createPlan(admin, { name: "Q1", clientName: "Acme", budget: 3000, items: [{ assetId: "asset-1", format: "reel", clientCost: 2500 }] });

    expect(plan.budgetVariance).toBe(-2000);
  });

  it("refuses to create a plan whose client-facing cost is over its budget (hard cap, 14 Sep)", async () => {
    mockPrisma.asset.findMany.mockResolvedValue([asset]);
    mockPrisma.plan.create.mockClear();
    await expect(createPlan(admin, { name: "Q1", clientName: "Acme", budget: 3000, items: [{ assetId: "asset-1", format: "reel" }] })).rejects.toMatchObject({ code: "PLAN_OVER_BUDGET" });
    expect(mockPrisma.plan.create).not.toHaveBeenCalled();
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

describe("Plan approval workflow — direct self-approval, no submit step (user request, 11 Sep)", () => {
  const planMaker = { id: "pm-1", role: "PLAN_MAKER" };
  const otherPlanMaker = { id: "pm-2", role: "PLAN_MAKER" };

  it("a Plan Maker can approve their own draft plan directly, no submit required", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue({ id: "plan-1", createdById: "pm-1", status: "DRAFT", items: [] });
    mockPrisma.plan.update.mockResolvedValue({ id: "plan-1", status: "APPROVED", budget: null, isGstPlan: false, items: [] });

    const plan = await approvePlan("plan-1", planMaker);

    expect(mockPrisma.plan.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "APPROVED", approvedById: "pm-1", approvedAt: expect.any(Date) } })
    );
    expect(plan.status).toBe("APPROVED");
    expect(mockPrisma.campaign.create).not.toHaveBeenCalled(); // no items — nothing to make visible
  });

  it("approving a plan with pages creates a real Campaign, one matched CampaignAssignment per distinct page, and links it onto the plan (user request, 10 Sep)", async () => {
    const asset2 = { id: "asset-2", handle: "second.page" };
    mockPrisma.plan.findUnique.mockResolvedValue({
      id: "plan-1",
      createdById: "pm-1",
      status: "DRAFT",
      name: "Q1 Push",
      clientName: "Acme",
      clientCompany: null,
      budget: 20000,
      items: [
        { assetId: "asset-1", format: "reel", cost: 5000, postsPerProfile: 2, asset },
        { assetId: "asset-1", format: "story", cost: 3000, postsPerProfile: 1, asset }, // same page again — should still be one assignment
        { assetId: "asset-2", format: "reel", cost: 4000, postsPerProfile: 1, asset: asset2 },
      ],
    });
    mockPrisma.campaign.create.mockResolvedValue({ id: "campaign-1" });
    mockPrisma.plan.update.mockResolvedValue({ id: "plan-1", status: "APPROVED", budget: 20000, isGstPlan: false, campaignId: "campaign-1", items: [] });

    const plan = await approvePlan("plan-1", planMaker);

    expect(mockPrisma.campaign.create).toHaveBeenCalledWith({
      data: {
        brandName: "Acme",
        title: "Q1 Push",
        costCap: 20000,
        assignments: {
          create: [
            { assetId: "asset-1", pageHandle: "demo.page", format: "reel", cost: 5000, status: "matched" },
            { assetId: "asset-2", pageHandle: "second.page", format: "reel", cost: 4000, status: "matched" },
          ],
        },
      },
    });
    expect(mockPrisma.plan.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "APPROVED", campaignId: "campaign-1" }) })
    );
    expect(plan.campaignId).toBe("campaign-1");
  });

  it("falls back to the plan's real internal cost as costCap when no budget was set", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue({
      id: "plan-1",
      createdById: "pm-1",
      status: "DRAFT",
      name: "Q1 Push",
      clientName: "Acme",
      clientCompany: null,
      budget: null,
      items: [{ assetId: "asset-1", format: "reel", cost: 5000, postsPerProfile: 2, asset }],
    });
    mockPrisma.campaign.create.mockResolvedValue({ id: "campaign-2" });
    mockPrisma.plan.update.mockResolvedValue({ id: "plan-1", status: "APPROVED", budget: null, isGstPlan: false, items: [] });

    await approvePlan("plan-1", planMaker);

    expect(mockPrisma.campaign.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ costCap: 10000 }) })); // 5000 × 2 posts
  });

  it("rejecting a plan never creates a campaign", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue({
      id: "plan-1",
      createdById: "pm-1",
      status: "DRAFT",
      items: [{ assetId: "asset-1", format: "reel", cost: 5000, postsPerProfile: 1, asset }],
    });
    mockPrisma.plan.update.mockResolvedValue({ id: "plan-1", status: "REJECTED", budget: null, isGstPlan: false, items: [] });

    await rejectPlan("plan-1", planMaker);

    expect(mockPrisma.campaign.create).not.toHaveBeenCalled();
  });

  it("a Plan Maker cannot approve or reject someone else's draft plan", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue({ id: "plan-1", createdById: "pm-1", status: "DRAFT" });

    await expect(approvePlan("plan-1", otherPlanMaker)).rejects.toBeInstanceOf(ApiError);
    await expect(rejectPlan("plan-1", otherPlanMaker)).rejects.toBeInstanceOf(ApiError);
    expect(mockPrisma.plan.update).not.toHaveBeenCalled();
  });

  it("ADMIN can approve or reject any Plan Maker's draft plan", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue({ id: "plan-1", createdById: "pm-1", status: "DRAFT" });
    mockPrisma.plan.update.mockResolvedValue({ id: "plan-1", status: "REJECTED", budget: null, isGstPlan: false, items: [] });

    const plan = await rejectPlan("plan-1", admin);

    expect(mockPrisma.plan.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "REJECTED", approvedById: "admin-1", approvedAt: expect.any(Date) } })
    );
    expect(plan.status).toBe("REJECTED");
  });

  it("refuses to approve/reject a plan that's already been decided", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue({ id: "plan-1", createdById: "admin-1", status: "APPROVED" });

    await expect(approvePlan("plan-1", admin)).rejects.toBeInstanceOf(ApiError);
    expect(mockPrisma.plan.update).not.toHaveBeenCalled();
  });
});

describe("Step 3 overrides — client-facing overview vs. internal computed (user request, 10 Sep)", () => {
  it("overview reflects an override when set; internal.computed* always keeps the real number", async () => {
    mockPrisma.asset.findMany.mockResolvedValue([asset]);
    mockPrisma.plan.create.mockResolvedValue({
      id: "plan-1",
      budget: null,
      isGstPlan: false,
      overrideFollowers: 500000,
      overridePosts: null,
      overrideImpressions: null,
      overrideCost: 9999,
      items: [{ assetId: "asset-1", format: "reel", cost: 5000, clientCost: null, postsPerProfile: 1, asset }],
    });

    const plan = await createPlan(admin, {
      name: "Q1",
      clientName: "Acme",
      overrideFollowers: 500000,
      overrideCost: 9999,
      items: [{ assetId: "asset-1", format: "reel" }],
    });

    expect(plan.overview.totalFollowers).toBe(500000); // overridden
    expect(plan.overview.totalPosts).toBe(1); // no override — falls back to computed
    expect(plan.overview.subtotal).toBe(9999); // overridden

    expect(plan.internal.computedFollowers).toBe(100000); // real, unaffected by the override
    expect(plan.internal.computedSubtotal).toBe(5000);
  });

  it("with no overrides set, overview and internal.computed* agree (unchanged behavior)", async () => {
    mockPrisma.asset.findMany.mockResolvedValue([asset]);
    mockPrisma.plan.create.mockResolvedValue({
      id: "plan-1",
      budget: null,
      isGstPlan: false,
      overrideFollowers: null,
      overridePosts: null,
      overrideImpressions: null,
      overrideCost: null,
      items: [{ assetId: "asset-1", format: "reel", cost: 5000, clientCost: null, postsPerProfile: 1, asset }],
    });

    const plan = await createPlan(admin, { name: "Q1", clientName: "Acme", items: [{ assetId: "asset-1", format: "reel" }] });

    expect(plan.overview.totalFollowers).toBe(plan.internal.computedFollowers);
    expect(plan.overview.subtotal).toBe(plan.internal.computedSubtotal);
  });
});

describe("createPlanVariant — Plan B (user request, 10 Sep)", () => {
  const sourcePlan = {
    id: "plan-1",
    createdById: "admin-1",
    name: "Q1 Pitch",
    clientName: "Acme",
    clientContact: "acme@example.com",
    clientCompany: "Acme Inc",
    clientGstNumber: "GST123",
    clientAddress: "1 Acme Way",
    notes: "Rush job",
    budget: 10000,
    isGstPlan: true,
    overrideFollowers: null,
    overridePosts: null,
    overrideImpressions: 300000,
    overrideCost: 9000,
    pitchGroupId: null,
    items: [{ assetId: "asset-1", format: "reel", cost: 5000, clientCost: null, postsPerProfile: 1, asset }],
  };

  it("backfills a pitchGroupId on the source plan the first time a variant is made", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue(sourcePlan);
    mockPrisma.plan.count.mockResolvedValue(1);
    mockPrisma.plan.create.mockResolvedValue({
      id: "plan-2",
      budget: 10000,
      isGstPlan: true,
      variantLabel: "Plan B",
      pitchGroupId: "plan-1",
      items: sourcePlan.items,
    });

    await createPlanVariant("plan-1", admin);

    expect(mockPrisma.plan.update).toHaveBeenCalledWith({ where: { id: "plan-1" }, data: { pitchGroupId: "plan-1" } });
  });

  it("copies the client-details/budget shell, the Step 3 overrides, and the item selection onto the new variant", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue({ ...sourcePlan, pitchGroupId: "group-1" });
    mockPrisma.plan.count.mockResolvedValue(1);
    mockPrisma.plan.create.mockResolvedValue({
      id: "plan-2",
      budget: 10000,
      isGstPlan: true,
      variantLabel: "Plan B",
      pitchGroupId: "group-1",
      items: sourcePlan.items,
    });

    await createPlanVariant("plan-1", admin);

    expect(mockPrisma.plan.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          clientName: "Acme",
          clientCompany: "Acme Inc",
          clientGstNumber: "GST123",
          clientAddress: "1 Acme Way",
          budget: 10000,
          isGstPlan: true,
          overrideImpressions: 300000,
          overrideCost: 9000,
          pitchGroupId: "group-1",
          variantLabel: "Plan B",
          items: { create: [{ assetId: "asset-1", format: "reel", cost: 5000, clientCost: null, postsPerProfile: 1 }] },
        }),
      })
    );
  });

  it("404s when the source plan doesn't exist", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue(null);
    await expect(createPlanVariant("missing", admin)).rejects.toBeInstanceOf(ApiError);
  });

  it("a Plan Maker cannot spin a variant off someone else's plan", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue({ ...sourcePlan, createdById: "pm-1" });
    await expect(createPlanVariant("plan-1", { id: "pm-2", role: "PLAN_MAKER" })).rejects.toBeInstanceOf(ApiError);
  });
});

describe("importPlanSheetPages — attach a Google Sheet of pages (user request, 10 Sep)", () => {
  it("matches an existing handle and adds it as a plan item without creating a new page", async () => {
    mockPrisma.asset.findMany.mockResolvedValue([asset]);
    mockPrisma.planItem.createMany.mockResolvedValue({ count: 1 });
    // Two calls hit plan.findUnique: the initial existence/access check, then getPlan's own at the end.
    mockPrisma.plan.findUnique.mockResolvedValueOnce({ id: "plan-1", createdById: "admin-1" });
    mockPrisma.plan.findUnique.mockResolvedValueOnce({ id: "plan-1", createdById: "admin-1", budget: null, isGstPlan: false, items: [] });

    const result = await importPlanSheetPages("plan-1", admin, [{ handle: "demo.page" }]);

    expect(mockPrisma.asset.create).not.toHaveBeenCalled();
    expect(mockPrisma.planItem.createMany).toHaveBeenCalledWith({
      data: [{ assetId: "asset-1", format: "reel", cost: 5000, postsPerProfile: 1, planId: "plan-1" }],
    });
    expect(result.matchedCount).toBe(1);
    expect(result.createdCount).toBe(0);
    expect(result.failures).toEqual([]);
  });

  it("creates a new pending Inventory page for an unmatched handle when the row gives a cost", async () => {
    mockPrisma.plan.findUnique.mockResolvedValueOnce({ id: "plan-1", createdById: "admin-1" });
    mockPrisma.asset.findMany.mockResolvedValue([]);
    mockPrisma.asset.create.mockResolvedValue({ id: "asset-new", handle: "new.page", rateCards: [] });
    mockPrisma.planItem.createMany.mockResolvedValue({ count: 1 });
    mockPrisma.plan.findUnique.mockResolvedValueOnce({ id: "plan-1", createdById: "admin-1", budget: null, isGstPlan: false, items: [] });

    const result = await importPlanSheetPages("plan-1", admin, [{ handle: "new.page", category: "Meme page", cost: 3000 }]);

    expect(mockPrisma.asset.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ handle: "new.page", category: "Meme page", approvalStatus: "pending", ownerId: "admin-1" }) })
    );
    expect(result.createdCount).toBe(1);
    expect(result.matchedCount).toBe(0);
  });

  it("reports a failure (doesn't crash the whole import) for an unmatched handle with no cost given", async () => {
    mockPrisma.plan.findUnique.mockResolvedValueOnce({ id: "plan-1", createdById: "admin-1" });
    mockPrisma.asset.findMany.mockResolvedValue([]);
    mockPrisma.planItem.createMany.mockResolvedValue({ count: 0 });
    mockPrisma.plan.findUnique.mockResolvedValueOnce({ id: "plan-1", createdById: "admin-1", budget: null, isGstPlan: false, items: [] });

    const result = await importPlanSheetPages("plan-1", admin, [{ handle: "no.rate.card" }]);

    expect(mockPrisma.asset.create).not.toHaveBeenCalled();
    expect(result.createdCount).toBe(0);
    expect(result.failures).toEqual([{ handle: "no.rate.card", reason: "New page — a cost is required since it has no rate card yet." }]);
  });

  it("404s when the plan doesn't exist", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue(null);
    await expect(importPlanSheetPages("missing", admin, [{ handle: "demo.page" }])).rejects.toBeInstanceOf(ApiError);
  });
});

describe("listPlanGroup — every plan sharing a pitchGroupId (code review, 10 Sep: was untested)", () => {
  it("returns every plan in the group, ordered oldest first", async () => {
    mockPrisma.plan.findMany.mockResolvedValue([
      { id: "plan-1", createdById: "admin-1", pitchGroupId: "group-1", budget: null, isGstPlan: false, items: [] },
      { id: "plan-2", createdById: "admin-1", pitchGroupId: "group-1", budget: null, isGstPlan: false, items: [] },
    ]);

    const plans = await listPlanGroup("group-1", admin);

    expect(mockPrisma.plan.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { pitchGroupId: "group-1" }, orderBy: { createdAt: "asc" } }));
    expect(plans.map((p) => p.id)).toEqual(["plan-1", "plan-2"]);
  });

  it("404s when nothing shares that pitchGroupId", async () => {
    mockPrisma.plan.findMany.mockResolvedValue([]);
    await expect(listPlanGroup("missing-group", admin)).rejects.toBeInstanceOf(ApiError);
  });

  it("rejects if any plan in the group isn't the requester's own (a Plan Maker can't see into a group via someone else's plan)", async () => {
    mockPrisma.plan.findMany.mockResolvedValue([
      { id: "plan-1", createdById: "pm-1", pitchGroupId: "group-1", budget: null, isGstPlan: false, items: [] },
      { id: "plan-2", createdById: "someone-else", pitchGroupId: "group-1", budget: null, isGstPlan: false, items: [] },
    ]);

    await expect(listPlanGroup("group-1", { id: "pm-1", role: "PLAN_MAKER" })).rejects.toBeInstanceOf(ApiError);
  });
});

describe("generatePlanSheet — one real spreadsheet per plan (user request, 10 Sep: \"plan will be of google sheet ... generate google sheet and will provide link\"; later, \"1 spreadsheet generation per plan, not just write access, and also public view access of sheet to anyone\")", () => {
  const basePlan = {
    id: "plan-1",
    name: "Q1 Push",
    variantLabel: "Plan A",
    clientName: "Acme",
    clientContact: null,
    clientCompany: null,
    clientGstNumber: null,
    clientAddress: null,
    notes: null,
    budget: null,
    isGstPlan: false,
    clientSheetUrl: null,
    internalSheetUrl: null,
    items: [{ assetId: "asset-1", format: "reel", cost: 5000, clientCost: null, postsPerProfile: 1, asset }],
  };

  beforeEach(() => {
    mockIsGoogleOAuthConfigured.mockReturnValue(true);
    mockGetUserAccessToken.mockResolvedValue("access-token");
    mockCreateSpreadsheet.mockResolvedValue({ spreadsheetId: "new-sheet-1", defaultSheetId: 0 });
  });

  it("throws SHEETS_NOT_CONFIGURED when no OAuth client is set up, and never touches the Sheets/Drive API", async () => {
    mockIsGoogleOAuthConfigured.mockReturnValue(false);

    await expect(generatePlanSheet("plan-1", admin)).rejects.toMatchObject({ code: "SHEETS_NOT_CONFIGURED" });
    expect(mockGetUserAccessToken).not.toHaveBeenCalled();
    expect(mockCreateSpreadsheet).not.toHaveBeenCalled();
  });

  it("throws GOOGLE_NOT_CONNECTED when configured but no admin has completed the connect flow yet", async () => {
    mockGetUserAccessToken.mockResolvedValue(null);

    await expect(generatePlanSheet("plan-1", admin)).rejects.toMatchObject({ code: "GOOGLE_NOT_CONNECTED" });
    expect(mockCreateSpreadsheet).not.toHaveBeenCalled();
  });

  it("creates a brand-new spreadsheet, drops the default tab, makes it publicly viewable, writes the tabs, and caches the link", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue(basePlan);
    mockGetSheetTabIds.mockImplementation(({ titles }) => Object.fromEntries(titles.map((t, i) => [t, 999 + i])));

    const result = await generatePlanSheet("plan-1", admin);

    expect(mockCreateSpreadsheet).toHaveBeenCalledWith(expect.objectContaining({ accessToken: "access-token", title: expect.stringContaining("Q1 Push") }));
    expect(mockDeleteSheetTab).toHaveBeenCalledWith(expect.objectContaining({ spreadsheetId: "new-sheet-1", sheetId: 0 }));
    // Public view access (user request, 10 Sep — "public view access of sheet to anyone").
    expect(mockMakeFilePublicViewable).toHaveBeenCalledWith({ accessToken: "access-token", fileId: "new-sheet-1" });
    expect(mockEnsureSheetTabsExist).toHaveBeenCalledWith(expect.objectContaining({ spreadsheetId: "new-sheet-1" }));
    expect(mockWriteSheetTab).toHaveBeenCalledTimes(2);
    // Pages tab needs USER_ENTERED so its =HYPERLINK(...) formula evaluates (see planSheet.js).
    expect(mockWriteSheetTab.mock.calls[1][0]).toMatchObject({ valueInputOption: "USER_ENTERED" });
    expect(mockBatchUpdateSpreadsheet).toHaveBeenCalledWith(
      expect.objectContaining({ spreadsheetId: "new-sheet-1", requests: expect.arrayContaining([expect.objectContaining({ unmergeCells: expect.anything() })]) })
    );
    expect(result.spreadsheetUrl).toBe("https://docs.google.com/spreadsheets/d/new-sheet-1/edit?gid=999#gid=999");
    expect(mockPrisma.plan.update).toHaveBeenCalledWith({ where: { id: "plan-1" }, data: { clientSheetUrl: result.spreadsheetUrl } });
  });

  it("regenerating reuses the plan's existing spreadsheet (parsed from clientSheetUrl) instead of creating a new file or re-sharing it", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue({ ...basePlan, clientSheetUrl: "https://docs.google.com/spreadsheets/d/existing-sheet-1/edit?gid=42#gid=42" });
    mockGetSheetTabIds.mockImplementation(({ titles }) => Object.fromEntries(titles.map((t, i) => [t, 42 + i])));

    const result = await generatePlanSheet("plan-1", admin);

    expect(mockCreateSpreadsheet).not.toHaveBeenCalled();
    expect(mockDeleteSheetTab).not.toHaveBeenCalled();
    expect(mockMakeFilePublicViewable).not.toHaveBeenCalled();
    expect(mockEnsureSheetTabsExist).toHaveBeenCalledWith(expect.objectContaining({ spreadsheetId: "existing-sheet-1" }));
    expect(result.spreadsheetUrl).toContain("existing-sheet-1");
  });

  it("falls back to the spreadsheet root link if the Overview tab's gid can't be resolved", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue({ ...basePlan, items: [] });
    mockGetSheetTabIds.mockResolvedValue({});

    const result = await generatePlanSheet("plan-1", admin);

    expect(result.spreadsheetUrl).toBe("https://docs.google.com/spreadsheets/d/new-sheet-1/edit");
  });

  it("{ internal: true } writes INTERNAL-prefixed tabs into their own spreadsheet, caches onto internalSheetUrl, and is never made public", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue({ ...basePlan, items: [{ assetId: "asset-1", format: "reel", cost: 5000, clientCost: 8000, postsPerProfile: 1, asset }] });
    mockGetSheetTabIds.mockImplementation(({ titles }) => ({ [titles[0]]: 111 }));

    const result = await generatePlanSheet("plan-1", admin, { internal: true });

    const [overviewTitle, pagesTitle] = mockEnsureSheetTabsExist.mock.calls[0][0].titles;
    expect(overviewTitle).toMatch(/^INTERNAL — Overview of/);
    expect(pagesTitle).toMatch(/^INTERNAL — /);
    expect(mockMakeFilePublicViewable).not.toHaveBeenCalled();
    expect(result.spreadsheetUrl).toBe("https://docs.google.com/spreadsheets/d/new-sheet-1/edit?gid=111#gid=111");
    expect(mockPrisma.plan.update).toHaveBeenCalledWith({ where: { id: "plan-1" }, data: { internalSheetUrl: result.spreadsheetUrl } });
  });
});

describe("getExecutionSheetTemplate — the downloadable sample sheet (user request, 10 Sep), reused across requests via AppSetting", () => {
  beforeEach(() => {
    mockIsGoogleOAuthConfigured.mockReturnValue(true);
    mockGetUserAccessToken.mockResolvedValue("access-token");
  });

  it("throws SHEETS_NOT_CONFIGURED when no OAuth client is set up", async () => {
    mockIsGoogleOAuthConfigured.mockReturnValue(false);

    await expect(getExecutionSheetTemplate()).rejects.toMatchObject({ code: "SHEETS_NOT_CONFIGURED" });
    expect(mockGetUserAccessToken).not.toHaveBeenCalled();
  });

  it("throws GOOGLE_NOT_CONNECTED when no admin has connected an account yet", async () => {
    mockGetUserAccessToken.mockResolvedValue(null);

    await expect(getExecutionSheetTemplate()).rejects.toMatchObject({ code: "GOOGLE_NOT_CONNECTED" });
  });

  it("creates the template spreadsheet on first use, makes it public, and remembers its id in AppSetting", async () => {
    mockPrisma.appSetting.findUnique.mockResolvedValue(null);
    mockCreateSpreadsheet.mockResolvedValue({ spreadsheetId: "template-sheet-1", defaultSheetId: 0 });
    mockGetSheetTabIds.mockImplementation(({ titles }) => ({ [titles[0]]: 555 }));

    const result = await getExecutionSheetTemplate();

    expect(mockPrisma.plan.findUnique).not.toHaveBeenCalled();
    expect(mockCreateSpreadsheet).toHaveBeenCalled();
    expect(mockDeleteSheetTab).toHaveBeenCalledWith(expect.objectContaining({ spreadsheetId: "template-sheet-1", sheetId: 0 }));
    expect(mockMakeFilePublicViewable).toHaveBeenCalledWith({ accessToken: "access-token", fileId: "template-sheet-1" });
    expect(mockPrisma.appSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: "executionTemplateSpreadsheetId" }, create: { key: "executionTemplateSpreadsheetId", value: "template-sheet-1" } })
    );
    expect(mockWriteSheetTab).toHaveBeenCalledWith(expect.objectContaining({ valueInputOption: "USER_ENTERED" }));
    expect(result.spreadsheetUrl).toBe("https://docs.google.com/spreadsheets/d/template-sheet-1/edit?gid=555#gid=555");
  });

  it("reuses the cached spreadsheet id on a later call instead of creating a second template file", async () => {
    mockPrisma.appSetting.findUnique.mockResolvedValue({ key: "executionTemplateSpreadsheetId", value: "template-sheet-1" });
    mockGetSheetTabIds.mockImplementation(({ titles }) => ({ [titles[0]]: 555 }));

    const result = await getExecutionSheetTemplate();

    expect(mockCreateSpreadsheet).not.toHaveBeenCalled();
    expect(mockMakeFilePublicViewable).not.toHaveBeenCalled();
    expect(result.spreadsheetUrl).toContain("template-sheet-1");
  });
});

describe("getExecutionSheetTemplatePreview — the in-app preview table (user request, 11 Sep), no Google account needed", () => {
  it("returns the sample as plain headers/rows, matching the reference sheet's columns", () => {
    const result = getExecutionSheetTemplatePreview();

    expect(result.headers).toEqual(["S No", "Page Name", "Page Link", "Followers", "Date", "Posted Link", "Views", "Likes", "Comments", "Shares"]);
    expect(result.rows).toHaveLength(2);
    expect(result.totalsRow[3]).toBe(8700000 + 4300000); // Followers total
    expect(mockGetUserAccessToken).not.toHaveBeenCalled(); // never touches Google
  });
});

describe("Client invoice (user request, 13 Sep — \"on clicking generate invoice, it'll ask for client details like gst, company address, phone number\")", () => {
  const planMaker = { id: "pm-1", role: "PLAN_MAKER" };
  const approvedPlan = (overrides = {}) => ({
    id: "plan-1",
    name: "Q1 Push",
    createdById: "pm-1",
    status: "APPROVED",
    isGstPlan: true,
    budget: null,
    overrideCost: null,
    clientInvoiceNumber: null,
    items: [{ id: "i1", assetId: "asset-1", format: "reel", cost: 4000, clientCost: 5000, postsPerProfile: 2, asset }],
    ...overrides,
  });
  const details = { clientCompany: " Acme Foods Pvt Ltd ", clientGstNumber: "27ABCDE1234F1Z5", clientAddress: "12 MG Road, Pune", clientPhone: "" };

  it("saves the popup's details onto the plan, mints a CINV number and stamps the time", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue(approvedPlan());
    mockPrisma.plan.update.mockImplementation(async ({ data }) => ({ ...approvedPlan(), ...data }));

    const plan = await generateClientInvoice("plan-1", planMaker, details);

    const data = mockPrisma.plan.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ clientCompany: "Acme Foods Pvt Ltd", clientGstNumber: "27ABCDE1234F1Z5", clientAddress: "12 MG Road, Pune", clientPhone: null });
    expect(data.clientInvoiceNumber).toMatch(/^CINV-\d+-[A-Z0-9]{6}$/); // no _ or - on a client-facing number
    expect(data.clientInvoiceAt).toBeInstanceOf(Date);
    expect(plan.clientInvoiceNumber).toBe(data.clientInvoiceNumber);
    // The client-facing total is what gets invoiced: 5000 × 2 posts + 18% GST.
    expect(plan.overview).toMatchObject({ subtotal: 10000, gstAmount: 1800, total: 11800 });
  });

  it("keeps the existing invoice number on regeneration — the client never sees two numbers for one plan", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue(approvedPlan({ clientInvoiceNumber: "CINV-1-ABCDEF" }));
    mockPrisma.plan.update.mockImplementation(async ({ data }) => ({ ...approvedPlan(), ...data }));

    await generateClientInvoice("plan-1", planMaker, { ...details, clientAddress: "New address" });

    expect(mockPrisma.plan.update.mock.calls[0][0].data).toMatchObject({ clientInvoiceNumber: "CINV-1-ABCDEF", clientAddress: "New address" });
  });

  it("refuses a plan that isn't approved yet", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue(approvedPlan({ status: "DRAFT" }));
    await expect(generateClientInvoice("plan-1", planMaker, details)).rejects.toMatchObject({ code: "PLAN_NOT_APPROVED" });
    expect(mockPrisma.plan.update).not.toHaveBeenCalled();
  });

  it("a GST plan needs the client's GST number; a non-GST plan doesn't", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue(approvedPlan({ isGstPlan: true }));
    await expect(generateClientInvoice("plan-1", planMaker, { ...details, clientGstNumber: "  " })).rejects.toMatchObject({ code: "CLIENT_GST_REQUIRED" });

    mockPrisma.plan.findUnique.mockResolvedValue(approvedPlan({ isGstPlan: false }));
    mockPrisma.plan.update.mockImplementation(async ({ data }) => ({ ...approvedPlan({ isGstPlan: false }), ...data }));
    await expect(generateClientInvoice("plan-1", planMaker, { ...details, clientGstNumber: "" })).resolves.toBeTruthy();
    expect(mockPrisma.plan.update.mock.calls[0][0].data.clientGstNumber).toBeNull();
  });

  it("refuses a plan with nothing to invoice (no client-facing cost)", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue(approvedPlan({ items: [] }));
    await expect(generateClientInvoice("plan-1", planMaker, details)).rejects.toMatchObject({ code: "PLAN_NOTHING_TO_INVOICE" });
  });

  it("a Plan Maker can't invoice someone else's plan; Admin can invoice any", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue(approvedPlan({ createdById: "pm-2" }));
    await expect(generateClientInvoice("plan-1", planMaker, details)).rejects.toMatchObject({ code: "PLAN_NOT_FOUND" });

    mockPrisma.plan.update.mockImplementation(async ({ data }) => ({ ...approvedPlan({ createdById: "pm-2" }), ...data }));
    await expect(generateClientInvoice("plan-1", admin, details)).resolves.toBeTruthy();
  });

  it("getClientInvoice 409s until one has been generated, then returns the client-safe shape with no internal cost", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue(approvedPlan());
    await expect(getClientInvoice("plan-1", admin)).rejects.toMatchObject({ code: "CLIENT_INVOICE_NOT_GENERATED" });

    mockPrisma.plan.findUnique.mockResolvedValue(
      approvedPlan({ clientInvoiceNumber: "CINV-1-ABCDEF", clientInvoiceAt: new Date("2026-09-13"), clientCompany: "Acme", clientPhone: "9876543210" })
    );
    const inv = await getClientInvoice("plan-1", admin);
    expect(inv).toMatchObject({ clientInvoiceNumber: "CINV-1-ABCDEF", clientCompany: "Acme", clientPhone: "9876543210", itemised: true });
    expect(inv.items[0]).toEqual(expect.objectContaining({ displayCost: 5000, postsPerProfile: 2 }));
    expect(inv.items[0]).not.toHaveProperty("cost");
    expect(inv).not.toHaveProperty("totalCost");
    expect(inv).not.toHaveProperty("internal");
  });

  it("forClientInvoice marks the plan non-itemised once the client-facing cost is overridden", () => {
    const base = { ...approvedPlan(), overview: { subtotal: 1, gstAmount: 0, total: 1 } };
    expect(forClientInvoice({ ...base, overrideCost: null }).itemised).toBe(true);
    expect(forClientInvoice({ ...base, overrideCost: 9000 }).itemised).toBe(false);
  });
});

describe("Attached invoice PDF (user request, 14 Sep — \"option of attaching invoice document in pdf format as well\")", () => {
  const planMaker = { id: "pm-1", role: "PLAN_MAKER" };
  const otherPlanMaker = { id: "pm-2", role: "PLAN_MAKER" };
  const ownPlan = (overrides = {}) => ({ id: "plan-1", createdById: "pm-1", status: "DRAFT", items: [], invoiceAttachmentPublicId: null, ...overrides });

  it("the plan's maker gets an upload key scoped to their plan — no approval needed", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue(ownPlan());
    const params = await requestInvoiceAttachmentUpload("plan-1", planMaker);
    expect(params.publicId).toBe("plan-invoice-attachments/plan-1/uuid");
  });

  it("another Plan Maker gets a 404, not the key; Admin can attach to any plan", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue(ownPlan());
    await expect(requestInvoiceAttachmentUpload("plan-1", otherPlanMaker)).rejects.toMatchObject({ code: "PLAN_NOT_FOUND" });
    await expect(requestInvoiceAttachmentUpload("plan-1", admin)).resolves.toMatchObject({ publicId: "plan-invoice-attachments/plan-1/uuid" });
  });

  it("confirm stores the key + file name + uploader and returns a usable URL", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue(ownPlan());
    mockPrisma.plan.update.mockImplementation(async ({ data }) => ({ ...ownPlan(), ...data }));

    const result = await confirmInvoiceAttachment("plan-1", planMaker, { publicId: "plan-invoice-attachments/plan-1/uuid", fileName: "signed-invoice.pdf" });

    expect(result).toMatchObject({ name: "signed-invoice.pdf", url: "https://cdn/plan-invoice-attachments/plan-1/uuid", uploadedById: "pm-1" });
    expect(mockPrisma.plan.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "plan-1" },
        data: expect.objectContaining({ invoiceAttachmentPublicId: "plan-invoice-attachments/plan-1/uuid", invoiceAttachmentName: "signed-invoice.pdf", invoiceAttachmentUploadedById: "pm-1" }),
      })
    );
  });

  it("confirm rejects a key that belongs to a different plan (or to the Invoice attachment folder)", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue(ownPlan());
    await expect(confirmInvoiceAttachment("plan-1", admin, { publicId: "plan-invoice-attachments/plan-2/uuid", fileName: "x.pdf" })).rejects.toMatchObject({ code: "KEY_MISMATCH" });
    await expect(confirmInvoiceAttachment("plan-1", admin, { publicId: "invoice-attachments/plan-1/uuid", fileName: "x.pdf" })).rejects.toMatchObject({ code: "KEY_MISMATCH" });
  });

  it("confirm 422s when nothing actually landed at the key", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue(ownPlan());
    mockCloudinary.objectExists.mockResolvedValueOnce(false);
    await expect(confirmInvoiceAttachment("plan-1", admin, { publicId: "plan-invoice-attachments/plan-1/uuid", fileName: "x.pdf" })).rejects.toMatchObject({ code: "UPLOAD_NOT_FOUND" });
  });

  it("remove clears the reference fields; a plan with nothing attached is a no-op", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue(ownPlan({ invoiceAttachmentPublicId: "plan-invoice-attachments/plan-1/old" }));
    mockPrisma.plan.update.mockResolvedValue({});
    await removeInvoiceAttachment("plan-1", planMaker);
    expect(mockPrisma.plan.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { invoiceAttachmentPublicId: null, invoiceAttachmentName: null, invoiceAttachmentUploadedById: null, invoiceAttachmentUploadedAt: null } })
    );

    mockPrisma.plan.update.mockClear();
    mockPrisma.plan.findUnique.mockResolvedValue(ownPlan());
    await removeInvoiceAttachment("plan-1", planMaker);
    expect(mockPrisma.plan.update).not.toHaveBeenCalled();
  });

  it("getPlan exposes the attachment as `invoiceAttachment` (null when none) so the card can render it", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue(ownPlan());
    expect((await getPlan("plan-1", planMaker)).invoiceAttachment).toBeNull();
    mockPrisma.plan.findUnique.mockResolvedValue(
      ownPlan({ invoiceAttachmentPublicId: "plan-invoice-attachments/plan-1/uuid", invoiceAttachmentName: "signed.pdf", invoiceAttachmentUploadedById: "pm-1", invoiceAttachmentUploadedAt: new Date("2026-09-14") })
    );
    expect((await getPlan("plan-1", planMaker)).invoiceAttachment).toMatchObject({ name: "signed.pdf", url: "https://cdn/plan-invoice-attachments/plan-1/uuid" });
  });
});

describe("Hard budget cap on update (user request, 14 Sep — \"can upto budget only\")", () => {
  const planMaker = { id: "pm-1", role: "PLAN_MAKER" };
  const draft = (overrides = {}) => ({ id: "plan-1", createdById: "pm-1", status: "DRAFT", budget: 10000, ...overrides });

  it("rejects a page list whose client-facing subtotal (clientCost ?? cost × posts) exceeds the plan's budget", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue(draft());
    mockPrisma.asset.findMany.mockResolvedValue([asset]); // reel rate 5000
    mockPrisma.planItem.deleteMany.mockClear();
    await expect(updatePlan("plan-1", planMaker, { items: [{ assetId: "asset-1", format: "reel", postsPerProfile: 3 }] })).rejects.toMatchObject({ code: "PLAN_OVER_BUDGET" });
    expect(mockPrisma.planItem.deleteMany).not.toHaveBeenCalled(); // nothing wiped before the check
  });

  it("uses the client price when set — a marked-down line can fit where the raw rate wouldn't", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue(draft());
    mockPrisma.asset.findMany.mockResolvedValue([asset]);
    mockPrisma.plan.update.mockResolvedValue({ ...draft(), items: [] });
    await expect(updatePlan("plan-1", planMaker, { items: [{ assetId: "asset-1", format: "reel", postsPerProfile: 3, clientCost: 3000 }] })).resolves.toBeTruthy();
  });

  it("a budget sent with the items is the one checked, not the stored one", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue(draft({ budget: 1 }));
    mockPrisma.asset.findMany.mockResolvedValue([asset]);
    mockPrisma.plan.update.mockResolvedValue({ ...draft(), items: [] });
    await expect(updatePlan("plan-1", planMaker, { budget: 20000, items: [{ assetId: "asset-1", format: "reel", postsPerProfile: 2 }] })).resolves.toBeTruthy();
  });

  it("the quoted client total (overrideCost) is NOT capped — it may exceed the budget, on save with items and on its own (user request, 14 Sep)", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue(draft());
    mockPrisma.asset.findMany.mockResolvedValue([asset]); // reel rate 5000
    mockPrisma.plan.update.mockResolvedValue({ ...draft(), items: [] });
    await expect(updatePlan("plan-1", planMaker, { overrideCost: 12000, items: [{ assetId: "asset-1", format: "reel", postsPerProfile: 1 }] })).resolves.toBeTruthy();
    await expect(updatePlan("plan-1", planMaker, { overrideCost: 250000 })).resolves.toBeTruthy();
    // ...while the pages themselves are still capped.
    await expect(updatePlan("plan-1", planMaker, { overrideCost: 9000, items: [{ assetId: "asset-1", format: "reel", postsPerProfile: 3 }] })).rejects.toMatchObject({ code: "PLAN_OVER_BUDGET" });
  });

  it("lowering the budget alone below what the existing pages already come to is refused", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue(draft());
    mockPrisma.planItem.findMany = vi.fn().mockResolvedValue([{ cost: 5000, clientCost: null, postsPerProfile: 2 }]);
    await expect(updatePlan("plan-1", planMaker, { budget: 9000 })).rejects.toMatchObject({ code: "PLAN_OVER_BUDGET" });
    mockPrisma.plan.update.mockResolvedValue({ ...draft(), items: [] });
    await expect(updatePlan("plan-1", planMaker, { budget: 10000 })).resolves.toBeTruthy();
  });

  it("exactly on budget is fine; no budget means no cap", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue(draft());
    mockPrisma.asset.findMany.mockResolvedValue([asset]);
    mockPrisma.plan.update.mockResolvedValue({ ...draft(), items: [] });
    await expect(updatePlan("plan-1", planMaker, { items: [{ assetId: "asset-1", format: "reel", postsPerProfile: 2 }] })).resolves.toBeTruthy();
    mockPrisma.plan.findUnique.mockResolvedValue(draft({ budget: null }));
    await expect(updatePlan("plan-1", planMaker, { items: [{ assetId: "asset-1", format: "reel", postsPerProfile: 50 }] })).resolves.toBeTruthy();
  });
});

describe("Phases on approval (user request, 14 Sep — \"if post per page will be more than 1 ... phase 2, 3 like different campaigns\")", () => {
  const planMaker = { id: "pm-1", role: "PLAN_MAKER" };
  const asset2 = { id: "asset-2", handle: "second.page" };
  const asset3 = { id: "asset-3", handle: "third.page" };

  it("creates phase 1 with every page, then one extra phase per additional post, each holding only the pages that still have that post", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue({
      id: "plan-1",
      createdById: "pm-1",
      status: "DRAFT",
      name: "Q1 Push",
      clientName: "Acme",
      clientCompany: null,
      budget: 50000,
      items: [
        { assetId: "asset-1", format: "reel", cost: 5000, postsPerProfile: 3, asset },
        { assetId: "asset-2", format: "story", cost: 2000, postsPerProfile: 2, asset: asset2 },
        { assetId: "asset-3", format: "reel", cost: 4000, postsPerProfile: 1, asset: asset3 },
      ],
    });
    mockPrisma.campaign.create.mockClear();
    mockPrisma.campaign.create.mockImplementation(async ({ data }) => ({ id: data.parentCampaignId ? `phase-${data.phaseNumber}` : "root-1", brandName: data.brandName, title: data.title }));
    mockPrisma.plan.update.mockResolvedValue({ id: "plan-1", status: "APPROVED", budget: 50000, isGstPlan: false, campaignId: "root-1", items: [] });

    const plan = await approvePlan("plan-1", planMaker);

    const calls = mockPrisma.campaign.create.mock.calls.map((c) => c[0].data);
    expect(calls).toHaveLength(3);
    // Phase 1: the root, no parent, all three pages, budget as the cap.
    expect(calls[0]).toMatchObject({ title: "Q1 Push", costCap: 50000 });
    expect(calls[0].parentCampaignId).toBeUndefined();
    expect(calls[0].assignments.create.map((a) => a.assetId)).toEqual(["asset-1", "asset-2", "asset-3"]);
    // Phase 2: pages with ≥2 posts; phase 3: pages with ≥3. Same brand, under the root, no separate cap.
    expect(calls[1]).toMatchObject({ brandName: "Acme", title: "Q1 Push — Phase 2", parentCampaignId: "root-1", phaseNumber: 2 });
    expect(calls[1].assignments.create.map((a) => a.assetId)).toEqual(["asset-1", "asset-2"]);
    expect(calls[1].costCap).toBeUndefined();
    expect(calls[2]).toMatchObject({ title: "Q1 Push — Phase 3", parentCampaignId: "root-1", phaseNumber: 3 });
    expect(calls[2].assignments.create).toEqual([{ assetId: "asset-1", pageHandle: "demo.page", format: "reel", cost: 5000, status: "matched" }]);
    // The plan links to the root, not a phase.
    expect(mockPrisma.plan.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ campaignId: "root-1" }) }));
    expect(plan.campaignId).toBe("root-1");
  });

  it("a page listed twice (reel x1 + story x3) is a story job in phases 2-3, not the first line's reel", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue({
      id: "plan-1",
      createdById: "pm-1",
      status: "DRAFT",
      name: "Q1",
      clientName: "Acme",
      clientCompany: null,
      budget: null,
      items: [
        { assetId: "asset-1", format: "reel", cost: 5000, postsPerProfile: 1, asset },
        { assetId: "asset-1", format: "story", cost: 1000, postsPerProfile: 3, asset },
      ],
    });
    mockPrisma.campaign.create.mockClear();
    mockPrisma.campaign.create.mockImplementation(async ({ data }) => ({ id: data.parentCampaignId ? `phase-${data.phaseNumber}` : "root-1", brandName: data.brandName }));
    mockPrisma.plan.update.mockResolvedValue({ id: "plan-1", status: "APPROVED", budget: null, isGstPlan: false, items: [] });
    await approvePlan("plan-1", planMaker);
    const calls = mockPrisma.campaign.create.mock.calls.map((c) => c[0].data);
    expect(calls).toHaveLength(3);
    expect(calls[0].assignments.create).toEqual([expect.objectContaining({ assetId: "asset-1", format: "reel" })]); // one per page in phase 1
    expect(calls[1].assignments.create).toEqual([expect.objectContaining({ assetId: "asset-1", format: "story", cost: 1000 })]);
    expect(calls[2].assignments.create).toEqual([expect.objectContaining({ assetId: "asset-1", format: "story", cost: 1000 })]);
  });

  it("a plan with one post per page creates just the one campaign — no empty phases", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue({ id: "plan-1", createdById: "pm-1", status: "DRAFT", name: "Q1", clientName: "Acme", clientCompany: null, budget: null, items: [{ assetId: "asset-1", format: "reel", cost: 5000, postsPerProfile: 1, asset }] });
    mockPrisma.campaign.create.mockClear();
    mockPrisma.campaign.create.mockResolvedValue({ id: "root-1" });
    mockPrisma.plan.update.mockResolvedValue({ id: "plan-1", status: "APPROVED", budget: null, isGstPlan: false, items: [] });
    await approvePlan("plan-1", planMaker);
    expect(mockPrisma.campaign.create).toHaveBeenCalledTimes(1);
  });
});
