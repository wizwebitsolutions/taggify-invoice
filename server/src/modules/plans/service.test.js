import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ApiError } from "../../middleware/errorHandler.js";

const mockPrisma = {
  asset: { findMany: vi.fn(), create: vi.fn() },
  plan: { create: vi.fn(), update: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), delete: vi.fn(), count: vi.fn() },
  planItem: { deleteMany: vi.fn(), createMany: vi.fn(), create: vi.fn(), findMany: vi.fn() },
  campaign: { create: vi.fn(), findMany: vi.fn() },
  appSetting: { findUnique: vi.fn(), findMany: vi.fn(), upsert: vi.fn() },
  clientInvoice: { upsert: vi.fn() },
  campaignAssignment: { findMany: vi.fn(), update: vi.fn() },
  link: { findFirst: vi.fn() },
  user: { findUnique: vi.fn() },
  // createPlanVariant wraps its count+create in a transaction (code review,
  // 10 Sep — closes a duplicate-label race) — `tx` is just `mockPrisma`
  // itself here, so every existing plan.update/count/create mock below
  // keeps working unchanged whether or not it's called through $transaction.
  $transaction: vi.fn((cb) => cb(mockPrisma)),
};
vi.mock("../../lib/prisma.js", () => ({ prisma: mockPrisma }));

const mockGetAvgEngagement = vi.fn();
const mockCreateAsset = vi.fn();
vi.mock("../assets/service.js", () => ({ getAvgEngagement: (...args) => mockGetAvgEngagement(...args), createAsset: (...args) => mockCreateAsset(...args) }));
// Execution sheet sync (23 Sep): the sheet fetch and the link creation are
// other modules' jobs — mocked so this file tests only the row → slot logic.
const mockFetchSheetCsv = vi.fn();
vi.mock("../campaigns/service.js", () => ({ fetchSheetCsv: (...args) => mockFetchSheetCsv(...args) }));
const mockAutoAttachLink = vi.fn();
vi.mock("../links/service.js", () => ({ autoAttachLink: (...args) => mockAutoAttachLink(...args) }));

const mockCreateSpreadsheet = vi.fn();
const mockDeleteSheetTab = vi.fn();
const mockEnsureSheetTabsExist = vi.fn();
const mockWriteSheetTab = vi.fn();
const mockGetSheetTabIds = vi.fn();
const mockBatchUpdateSpreadsheet = vi.fn();
// Tabs already in the file — read to rename a plan's tabs in place (29 Sep). None by default.
const mockGetExistingSheetTabs = vi.fn(async () => []);
vi.mock("../../lib/googleSheetsClient.js", () => ({
  getExistingSheetTabs: (...args) => mockGetExistingSheetTabs(...args),
  createSpreadsheet: (...args) => mockCreateSpreadsheet(...args),
  deleteSheetTab: (...args) => mockDeleteSheetTab(...args),
  ensureSheetTabsExist: (...args) => mockEnsureSheetTabsExist(...args),
  writeSheetTab: (...args) => mockWriteSheetTab(...args),
  getSheetTabIds: (...args) => mockGetSheetTabIds(...args),
  batchUpdateSpreadsheet: (...args) => mockBatchUpdateSpreadsheet(...args),
}));

const mockMakeFilePublicViewable = vi.fn();
const mockShareFileWithEditor = vi.fn();
vi.mock("../../lib/googleDriveClient.js", () => ({
  makeFilePublicViewable: (...args) => mockMakeFilePublicViewable(...args),
  shareFileWithEditor: (...args) => mockShareFileWithEditor(...args),
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
  refreshGeneratedSheets,
  importPlanSheetPages,
  createPlanFromSheet,
  syncPlanFromSheet,
  addPendingPage,
  getExecutionSheetTemplate,
  getExecutionSheetTemplatePreview,
  generateClientInvoice,
  getClientInvoice,
  forClientInvoice,
  requestInvoiceAttachmentUpload,
  confirmInvoiceAttachment,
  removeInvoiceAttachment,
  syncExecutionSheet,
} = await import("./service.js");

const admin = { id: "admin-1", role: "ADMIN" };
const asset = { id: "asset-1", handle: "demo.page", category: "Meme page", followers: 100000, rateCards: [{ format: "reel", amount: 5000 }] };

beforeEach(() => {
  vi.clearAllMocks();
  // The pages already on a plan (read by the inactive-page check); tests that care set their own.
  mockPrisma.planItem.findMany.mockResolvedValue([]);
  mockGetAvgEngagement.mockResolvedValue({ avgLikes: 1000, avgComments: 10, avgViews: 5000, sampleSize: 2 });
  // assertCanAccessPlan / listPlans / listSavedClients (23 Sep) read the
  // caller's effective permissions fresh from the DB — derive a plausible
  // role from this file's id fixtures (admin-*/pm-*/creator-*/fin-*) so
  // existing calls work without every test stubbing this.
  mockPrisma.user.findUnique.mockImplementation(async ({ where }) => ({
    role: where.id?.startsWith("admin") ? "ADMIN" : where.id?.startsWith("pm") ? "PLAN_MAKER" : where.id?.startsWith("fin") ? "FINANCE" : "CREATOR",
    permissions: null,
  }));
});

describe("createPlan — item costs (newTask.md #13: cost calculation)", () => {
  it("uses the page's rate card when a line item has no explicit cost", async () => {
    mockPrisma.asset.findMany.mockResolvedValue([asset]);
    mockPrisma.plan.create.mockResolvedValue({
      id: "plan-1",
      budget: null,
      gstPercent: null,
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
      gstPercent: null,
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
      gstPercent: null,
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
      gstPercent: null,
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
      gstPercent: null,
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
      gstPercent: null,
      items: [{ assetId: "asset-1", format: "reel", cost: 5000, clientCost: 8000, postsPerProfile: 1, asset }],
    });

    const plan = await createPlan(admin, { name: "Q1", clientName: "Acme", items: [{ assetId: "asset-1", format: "reel", clientCost: 8000 }] });

    expect(plan.totalCost).toBe(5000); // internal, unaffected by clientCost
    expect(plan.overview.subtotal).toBe(8000); // client-facing, uses the markup
  });

  it("adds GST on the client subtotal at the plan's gstPercent", async () => {
    mockPrisma.asset.findMany.mockResolvedValue([asset]);
    mockPrisma.plan.create.mockResolvedValue({
      id: "plan-1",
      budget: null,
      gstPercent: 18,
      items: [{ assetId: "asset-1", format: "reel", cost: 10000, clientCost: null, postsPerProfile: 1, asset }],
    });

    const plan = await createPlan(admin, { name: "Q1", clientName: "Acme", gstPercent: 18, items: [{ assetId: "asset-1", format: "reel" }] });

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
      gstPercent: null,
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
      gstPercent: null,
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
      gstPercent: null,
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
      gstPercent: null,
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
      gstPercent: null,
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
      gstPercent: null,
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
      gstPercent: null,
      clientName: "Acme",
      name: "Q1",
      createdAt: new Date("2026-01-01"),
      clientContact: null,
      items: [{ assetId: "asset-1", format: "reel", cost: 5000, clientCost: 8000, postsPerProfile: 2, asset }],
    });
    const plan = await createPlan(admin, { name: "Q1", clientName: "Acme", items: [{ assetId: "asset-1", format: "reel", clientCost: 8000 }] });

    const forPdf = forClientPdf(plan);

    // expectedViews (8 Oct): the line's reach, for the sheet's per-category views — not a cost.
    expect(forPdf.items).toEqual([
      { format: "reel", postsPerProfile: 2, displayCost: 8000, expectedViews: 10000, asset: { handle: "demo.page", category: "Meme page", followers: 100000 } },
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
      gstPercent: null,
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
      gstPercent: null,
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

  it("opens the full list to a staff account granted plans.edit or plans.approve — never to an own-scope role (23/24 Sep)", async () => {
    mockPrisma.plan.findMany.mockResolvedValue([]);

    mockPrisma.user.findUnique.mockResolvedValueOnce({ role: "FINANCE", permissions: { "plans.edit": true } });
    await listPlans({ id: "fin-1", role: "FINANCE" });
    expect(mockPrisma.plan.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: {} }));

    // regression (24 Sep — own-scope roles never get global access): a stored grant on a TEAM_MEMBER or PLAN_MAKER doesn't open other people's plans.
    mockPrisma.user.findUnique.mockResolvedValueOnce({ role: "TEAM_MEMBER", permissions: { "plans.approve": true } });
    await listPlans({ id: "tm-1", role: "TEAM_MEMBER" });
    expect(mockPrisma.plan.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { createdById: "tm-1" } }));
    mockPrisma.user.findUnique.mockResolvedValueOnce({ role: "PLAN_MAKER", permissions: { "plans.edit": true } });
    await listPlans({ id: "pm-7", role: "PLAN_MAKER" });
    expect(mockPrisma.plan.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { createdById: "pm-7" } }));

    // A plain Finance account without the grant stays scoped to its own.
    mockPrisma.user.findUnique.mockResolvedValueOnce({ role: "FINANCE", permissions: null });
    await listPlans({ id: "fin-2", role: "FINANCE" });
    expect(mockPrisma.plan.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { createdById: "fin-2" } }));
  });

  it("getPlan 404s (not 403s) when a Plan Maker requests a plan they didn't create", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue({ id: "plan-1", createdById: "pm-1", status: "DRAFT", items: [] });

    await expect(getPlan("plan-1", otherPlanMaker)).rejects.toBeInstanceOf(ApiError);
  });

  it("getPlan succeeds for the Plan Maker who created it, and for any ADMIN", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue({ id: "plan-1", createdById: "pm-1", status: "DRAFT", budget: null, gstPercent: null, items: [] });

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
    mockPrisma.plan.update.mockResolvedValue({ id: "plan-1", status: "APPROVED", budget: null, gstPercent: null, items: [] });

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
    mockPrisma.plan.update.mockResolvedValue({ id: "plan-1", status: "APPROVED", budget: 20000, gstPercent: null, campaignId: "campaign-1", items: [] });

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
    mockPrisma.plan.update.mockResolvedValue({ id: "plan-1", status: "APPROVED", budget: null, gstPercent: null, items: [] });

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
    mockPrisma.plan.update.mockResolvedValue({ id: "plan-1", status: "REJECTED", budget: null, gstPercent: null, items: [] });

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
    mockPrisma.plan.update.mockResolvedValue({ id: "plan-1", status: "REJECTED", budget: null, gstPercent: null, items: [] });

    const plan = await rejectPlan("plan-1", admin);

    expect(mockPrisma.plan.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "REJECTED", approvedById: "admin-1", approvedAt: expect.any(Date) } })
    );
    expect(plan.status).toBe("REJECTED");
  });

  it("refuses to approve/reject a plan that's already been approved", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue({ id: "plan-1", createdById: "admin-1", status: "APPROVED" });

    await expect(approvePlan("plan-1", admin)).rejects.toMatchObject({ code: "INVALID_PLAN_STATUS" });
    await expect(rejectPlan("plan-1", admin)).rejects.toMatchObject({ code: "INVALID_PLAN_STATUS" });
    expect(mockPrisma.plan.update).not.toHaveBeenCalled();
  });

  // 8 Oct — "if a plan is rejected it can be approved again".
  it("a rejected plan can be approved later, creating its campaign like a draft would", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue({ id: "plan-1", createdById: "pm-1", status: "REJECTED", name: "Q1 Push", clientName: "Acme", clientCompany: null, budget: null, items: [{ assetId: "asset-1", format: "reel", cost: 5000, postsPerProfile: 1, asset }] });
    mockPrisma.campaign.create.mockResolvedValue({ id: "campaign-9" });
    mockPrisma.plan.update.mockResolvedValue({ id: "plan-1", status: "APPROVED", budget: null, gstPercent: null, campaignId: "campaign-9", items: [] });

    const plan = await approvePlan("plan-1", planMaker);

    expect(mockPrisma.campaign.create).toHaveBeenCalled();
    expect(mockPrisma.plan.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "APPROVED", approvedById: "pm-1", campaignId: "campaign-9" }) }));
    expect(plan.status).toBe("APPROVED");
  });

  it("a rejected plan can't be rejected again", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue({ id: "plan-1", createdById: "pm-1", status: "REJECTED", items: [] });
    await expect(rejectPlan("plan-1", planMaker)).rejects.toMatchObject({ code: "INVALID_PLAN_STATUS" });
    expect(mockPrisma.plan.update).not.toHaveBeenCalled();
  });
});

// 8 Oct — a plan's sheet layout is chosen per plan.
describe("sheetFormat", () => {
  it("a variant keeps its source plan's sheet format", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue({ id: "plan-1", createdById: "admin-1", name: "Q1", clientName: "Acme", pitchGroupId: "g", sheetFormat: "summary", items: [] });
    mockPrisma.plan.count.mockResolvedValue(1);
    mockPrisma.plan.create.mockResolvedValue({ id: "plan-2", variantLabel: "Plan B", pitchGroupId: "g", items: [] });

    await createPlanVariant("plan-1", admin);

    expect(mockPrisma.plan.create.mock.calls[0][0].data.sheetFormat).toBe("summary");
  });

  it("the schemas accept only the two formats", async () => {
    const { createPlanSchema, updatePlanSchema } = await import("./schemas.js");
    expect(updatePlanSchema.safeParse({ sheetFormat: "summary" }).success).toBe(true);
    expect(updatePlanSchema.safeParse({ sheetFormat: "breakdown" }).success).toBe(true);
    expect(updatePlanSchema.safeParse({ sheetFormat: "fancy" }).success).toBe(false);
    expect(createPlanSchema.safeParse({ name: "Q1", clientName: "Acme", notes: "x", sheetFormat: "summary" }).success).toBe(true);
  });
});

describe("Step 3 overrides — client-facing overview vs. internal computed (user request, 10 Sep)", () => {
  it("overview reflects an override when set; internal.computed* always keeps the real number", async () => {
    mockPrisma.asset.findMany.mockResolvedValue([asset]);
    mockPrisma.plan.create.mockResolvedValue({
      id: "plan-1",
      budget: null,
      gstPercent: null,
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
      gstPercent: null,
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
    gstPercent: 18,
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
      gstPercent: 18,
      variantLabel: "Plan B",
      pitchGroupId: "plan-1",
      items: sourcePlan.items,
    });

    await createPlanVariant("plan-1", admin);

    expect(mockPrisma.plan.update).toHaveBeenCalledWith({ where: { id: "plan-1" }, data: { pitchGroupId: "plan-1" } });
  });

  it("carries over client details, brief and GST %, but starts budget, pages and the Step 3 overrides empty (23 Sep)", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue({ ...sourcePlan, pitchGroupId: "group-1" });
    mockPrisma.plan.count.mockResolvedValue(1);
    mockPrisma.plan.create.mockResolvedValue({
      id: "plan-2",
      budget: 10000,
      gstPercent: 18,
      variantLabel: "Plan B",
      pitchGroupId: "group-1",
      items: sourcePlan.items,
    });

    await createPlanVariant("plan-1", admin);

    const { data } = mockPrisma.plan.create.mock.calls[0][0];
    expect(data).toMatchObject({
      name: "Q1 Pitch",
      clientName: "Acme",
      clientContact: "acme@example.com",
      clientCompany: "Acme Inc",
      clientGstNumber: "GST123",
      clientAddress: "1 Acme Way",
      notes: "Rush job",
      gstPercent: 18,
      pitchGroupId: "group-1",
      variantLabel: "Plan B",
    });
    for (const key of ["budget", "items", "overrideCost", "overrideImpressions", "overrideFollowers", "overridePosts"]) {
      expect(data).not.toHaveProperty(key);
    }
  });

  it("labels by sibling count — a third plan in the group is Plan C", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue({ ...sourcePlan, pitchGroupId: "group-1" });
    mockPrisma.plan.count.mockResolvedValue(2);
    mockPrisma.plan.create.mockResolvedValue({ id: "plan-3", variantLabel: "Plan C", pitchGroupId: "group-1", items: [] });

    await createPlanVariant("plan-1", admin);

    expect(mockPrisma.plan.create.mock.calls[0][0].data.variantLabel).toBe("Plan C");
  });

  it("404s when the source plan doesn't exist", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue(null);
    await expect(createPlanVariant("missing", admin)).rejects.toBeInstanceOf(ApiError);
  });

  it("a Plan Maker cannot spin a variant off someone else's plan", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue({ ...sourcePlan, createdById: "pm-1" });
    await expect(createPlanVariant("plan-1", { id: "pm-2", role: "PLAN_MAKER" })).rejects.toBeInstanceOf(ApiError);
  });
  // 7 Oct — "New variant" opens the plan form; the variant is saved with its
  // own budget and pages in one call, so a failed save never leaves an empty draft.
  it("saves the variant's own budget and pages with it, priced like a new plan", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue({ ...sourcePlan, pitchGroupId: "group-1" });
    mockPrisma.asset.findMany.mockResolvedValue([{ ...asset, id: "asset-1", rateCards: [{ format: "reel", amount: "5000" }] }]);
    mockPrisma.plan.count.mockResolvedValue(1);
    mockPrisma.plan.create.mockResolvedValue({ id: "plan-2", variantLabel: "Plan B", pitchGroupId: "group-1", items: [] });

    await createPlanVariant("plan-1", admin, { budget: 20000, items: [{ assetId: "asset-1", format: "reel", postsPerProfile: 2 }] });

    const { data } = mockPrisma.plan.create.mock.calls[0][0];
    expect(data.budget).toBe(20000);
    expect(data.clientName).toBe("Acme");
    expect(data.items.create).toEqual([expect.objectContaining({ assetId: "asset-1", format: "reel", postsPerProfile: 2, cost: 5000 })]);
  });

  it("refuses pages over the variant's budget before writing anything", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue({ ...sourcePlan, pitchGroupId: "group-1" });
    mockPrisma.asset.findMany.mockResolvedValue([{ ...asset, id: "asset-1", rateCards: [{ format: "reel", amount: "5000" }] }]);

    await expect(createPlanVariant("plan-1", admin, { budget: 4000, items: [{ assetId: "asset-1", format: "reel", postsPerProfile: 1 }] })).rejects.toMatchObject({ code: "PLAN_OVER_BUDGET" });
    expect(mockPrisma.plan.create).not.toHaveBeenCalled();
  });
});

describe("importPlanSheetPages — attach a Google Sheet of pages (user request, 10 Sep)", () => {
  it("matches an existing handle and adds it as a plan item without creating a new page", async () => {
    mockPrisma.asset.findMany.mockResolvedValue([asset]);
    mockPrisma.planItem.createMany.mockResolvedValue({ count: 1 });
    // Two calls hit plan.findUnique: the initial existence/access check, then getPlan's own at the end.
    mockPrisma.plan.findUnique.mockResolvedValueOnce({ id: "plan-1", createdById: "admin-1" });
    mockPrisma.plan.findUnique.mockResolvedValueOnce({ id: "plan-1", createdById: "admin-1", budget: null, gstPercent: null, items: [] });

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
    mockPrisma.plan.findUnique.mockResolvedValueOnce({ id: "plan-1", createdById: "admin-1", budget: null, gstPercent: null, items: [] });

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
    mockPrisma.plan.findUnique.mockResolvedValueOnce({ id: "plan-1", createdById: "admin-1", budget: null, gstPercent: null, items: [] });

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

describe("Upload plan from a Google Sheet (user request, 22 Sep) — createPlanFromSheet / syncPlanFromSheet / addPendingPage", () => {
  const planMaker = { id: "pm-1", role: "PLAN_MAKER" };
  const emptyPlan = (extra = {}) => ({ id: "plan-1", createdById: "pm-1", status: "DRAFT", budget: null, gstPercent: null, items: [], sourceSheetPending: null, ...extra });
  const sheetUrl = "https://docs.google.com/spreadsheets/d/abc/edit";

  beforeEach(() => {
    mockPrisma.planItem.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.plan.update.mockImplementation(async ({ data }) => emptyPlan({ ...data, items: (data.items?.create ?? []).map((i) => ({ ...i, asset })) }));
  });

  it("creates the plan with the sheet's fields, matched rows as items and unknown / no-cost rows as pending", async () => {
    mockPrisma.plan.create.mockResolvedValue({ id: "plan-1" });
    mockPrisma.asset.findMany.mockResolvedValue([asset, { id: "asset-2", handle: "no.rate", rateCards: [] }]);

    const plan = await createPlanFromSheet(planMaker, {
      sourceSheetUrl: sheetUrl,
      fields: { name: "Q1 Push", clientName: "Acme", budget: 20000, gstPercent: 18 },
      rows: [{ handle: "@Demo.Page", postsPerProfile: 2 }, { handle: "no.rate" }, { handle: "brand.new", followers: 5000, cost: 1500 }],
    });

    expect(mockPrisma.plan.create).toHaveBeenCalledWith({ data: { name: "Q1 Push", clientName: "Acme", createdById: "pm-1", sourceSheetUrl: sheetUrl } });
    expect(mockPrisma.planItem.deleteMany).toHaveBeenCalledWith({ where: { planId: "plan-1" } });
    const { data } = mockPrisma.plan.update.mock.calls[0][0];
    expect(data).toMatchObject({ name: "Q1 Push", clientName: "Acme", budget: 20000, gstPercent: 18, items: { create: [{ assetId: "asset-1", format: "reel", cost: 5000, clientCost: null, postsPerProfile: 2 }] } });
    expect(data.sourceSheetFetchedAt).toBeInstanceOf(Date);
    expect(data.sourceSheetPending).toEqual([
      expect.objectContaining({ kind: "page", handle: "no.rate", reason: expect.stringMatching(/No cost in the sheet/) }),
      expect.objectContaining({ kind: "page", handle: "brand.new", followers: 5000, cost: 1500, reason: "Not in Inventory yet." }),
    ]);
    expect(plan.sourceSheetPending).toHaveLength(2);
    expect(plan.totalCost).toBe(10000);
  });

  it("doesn't store a budget the pages exceed — reports it as a pending budget entry instead", async () => {
    mockPrisma.plan.create.mockResolvedValue({ id: "plan-1" });
    mockPrisma.asset.findMany.mockResolvedValue([asset]);

    await createPlanFromSheet(planMaker, { sourceSheetUrl: sheetUrl, fields: { name: "P", clientName: "C", budget: 4000 }, rows: [{ handle: "demo.page" }] });

    const { data } = mockPrisma.plan.update.mock.calls[0][0];
    expect(data.budget).toBeNull();
    expect(data.sourceSheetPending).toEqual([expect.objectContaining({ kind: "budget", sheetBudget: 4000 })]);
  });

  it("Refresh: non-blank sheet cells overwrite, blank ones keep what was typed in the app; items are rebuilt", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue(emptyPlan({ sourceSheetUrl: sheetUrl, notes: "typed in app", clientContact: "Rohit" }));
    mockPrisma.asset.findMany.mockResolvedValue([asset]);

    await syncPlanFromSheet("plan-1", planMaker, { fields: { name: "Renamed", clientContact: "", notes: undefined }, rows: [{ handle: "demo.page", cost: 7000 }] });

    const { data } = mockPrisma.plan.update.mock.calls[0][0];
    expect(data.name).toBe("Renamed");
    expect(data).not.toHaveProperty("notes");
    expect(data).not.toHaveProperty("clientContact");
    expect(data.items.create).toEqual([{ assetId: "asset-1", format: "reel", cost: 7000, clientCost: null, postsPerProfile: 1 }]);
    expect(mockPrisma.planItem.deleteMany).toHaveBeenCalled();
  });

  it("Refresh: a sheet with no page table leaves the plan's pages alone (blank keeps in-app), and the in-app budget is checked against them", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue(emptyPlan({ sourceSheetUrl: sheetUrl, budget: 3000 }));
    mockPrisma.planItem.findMany.mockResolvedValue([{ assetId: "asset-1", cost: 5000, clientCost: null, postsPerProfile: 1 }]);

    await syncPlanFromSheet("plan-1", planMaker, { fields: { name: "Renamed" }, rows: [] });

    expect(mockPrisma.planItem.deleteMany).not.toHaveBeenCalled();
    const { data } = mockPrisma.plan.update.mock.calls[0][0];
    expect(data).not.toHaveProperty("items");
    // In-app budget 3000 < the kept pages' 5000 → cleared and asked for again.
    expect(data.budget).toBeNull();
    expect(data.sourceSheetPending).toEqual([expect.objectContaining({ kind: "budget", sheetBudget: 3000 })]);
  });

  it("saving a budget on the plan clears the sheet's pending budget entry", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue(emptyPlan({ budget: null, sourceSheetPending: [{ kind: "budget", sheetBudget: 100, reason: "x" }, { kind: "page", handle: "p", reason: "y" }] }));
    mockPrisma.planItem.findMany.mockResolvedValue([]);

    await updatePlan("plan-1", planMaker, { budget: 9000 });

    expect(mockPrisma.plan.update.mock.calls[0][0].data.sourceSheetPending).toEqual([{ kind: "page", handle: "p", reason: "y" }]);
  });

  it("Add to inventory respects the plan's budget like every other way of adding a page", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue(emptyPlan({ budget: 2000, sourceSheetPending: [{ kind: "page", handle: "big", cost: 1500, postsPerProfile: 2, reason: "x" }] }));
    mockPrisma.planItem.findMany.mockResolvedValue([]);

    await expect(addPendingPage("plan-1", planMaker, { handle: "big" })).rejects.toMatchObject({ code: "PLAN_OVER_BUDGET" });
    expect(mockCreateAsset).not.toHaveBeenCalled();
  });

  it("Refresh refuses a plan that wasn't uploaded from a sheet, one that's no longer a draft, and someone else's plan", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue(emptyPlan({ sourceSheetUrl: null }));
    await expect(syncPlanFromSheet("plan-1", planMaker, { fields: {}, rows: [] })).rejects.toMatchObject({ code: "PLAN_NOT_FROM_SHEET" });
    mockPrisma.plan.findUnique.mockResolvedValue(emptyPlan({ sourceSheetUrl: sheetUrl, status: "APPROVED" }));
    await expect(syncPlanFromSheet("plan-1", planMaker, { fields: {}, rows: [] })).rejects.toMatchObject({ code: "PLAN_NOT_DRAFT" });
    mockPrisma.plan.findUnique.mockResolvedValue(emptyPlan({ sourceSheetUrl: sheetUrl, createdById: "someone-else" }));
    await expect(syncPlanFromSheet("plan-1", planMaker, { fields: {}, rows: [] })).rejects.toMatchObject({ code: "PLAN_NOT_FOUND" });
    expect(mockPrisma.plan.update).not.toHaveBeenCalled();
  });

  it("Add to inventory: registers the page via createAsset (own account for a Plan Maker), adds the item and drops the pending row", async () => {
    const pendingRow = { kind: "page", handle: "brand.new", category: "Meme page", followers: 5000, format: null, cost: 1500, clientCost: null, postsPerProfile: 2, reason: "Not in Inventory yet." };
    const other = { kind: "page", handle: "other", cost: null, reason: "x" };
    mockPrisma.plan.findUnique.mockResolvedValue(emptyPlan({ sourceSheetPending: [pendingRow, other] }));
    mockCreateAsset.mockResolvedValue({ id: "asset-new" });
    mockPrisma.planItem.create.mockResolvedValue({});

    await addPendingPage("plan-1", planMaker, { handle: "@brand.new" });

    expect(mockCreateAsset).toHaveBeenCalledWith(planMaker, { platform: "instagram", handle: "brand.new", category: "Meme page", ownerId: undefined, followers: 5000, rateCards: undefined });
    expect(mockPrisma.planItem.create).toHaveBeenCalledWith({ data: { planId: "plan-1", assetId: "asset-new", format: "reel", cost: 1500, clientCost: null, postsPerProfile: 2 } });
    expect(mockPrisma.plan.update.mock.calls[0][0].data.sourceSheetPending).toEqual([other]);
  });

  it("Add to inventory: an Admin may pick the owner and the sheet cost becomes the page's rate card", async () => {
    const pendingRow = { kind: "page", handle: "brand.new", format: "story", cost: 900, postsPerProfile: 1, reason: "Not in Inventory yet." };
    mockPrisma.plan.findUnique.mockResolvedValue(emptyPlan({ createdById: "admin-1", sourceSheetPending: [pendingRow] }));
    mockCreateAsset.mockResolvedValue({ id: "asset-new" });
    mockPrisma.planItem.create.mockResolvedValue({});

    await addPendingPage("plan-1", admin, { handle: "brand.new", ownerId: "creator-9" });

    expect(mockCreateAsset).toHaveBeenCalledWith(admin, expect.objectContaining({ ownerId: "creator-9", rateCards: [{ format: "story", amount: 900 }] }));
  });

  it("Add to inventory: a row with no cost stays pending; a handle that isn't pending 404s", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue(emptyPlan({ sourceSheetPending: [{ kind: "page", handle: "no.cost", cost: null, reason: "x" }] }));
    await expect(addPendingPage("plan-1", planMaker, { handle: "no.cost" })).rejects.toMatchObject({ code: "PENDING_PAGE_NO_COST" });
    await expect(addPendingPage("plan-1", planMaker, { handle: "unknown" })).rejects.toMatchObject({ code: "PENDING_PAGE_NOT_FOUND" });
    expect(mockCreateAsset).not.toHaveBeenCalled();
  });
});

describe("listPlanGroup — every plan sharing a pitchGroupId (code review, 10 Sep: was untested)", () => {
  it("returns every plan in the group, ordered oldest first", async () => {
    mockPrisma.plan.findMany.mockResolvedValue([
      { id: "plan-1", createdById: "admin-1", pitchGroupId: "group-1", budget: null, gstPercent: null, items: [] },
      { id: "plan-2", createdById: "admin-1", pitchGroupId: "group-1", budget: null, gstPercent: null, items: [] },
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
      { id: "plan-1", createdById: "pm-1", pitchGroupId: "group-1", budget: null, gstPercent: null, items: [] },
      { id: "plan-2", createdById: "someone-else", pitchGroupId: "group-1", budget: null, gstPercent: null, items: [] },
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
    gstPercent: null,
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
    // Plain text only since 22 Sep (no =HYPERLINK formulas) — written RAW, never USER_ENTERED.
    expect(mockWriteSheetTab.mock.calls[1][0].valueInputOption).toBeUndefined();
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

  // 8 Oct — "on sheet generation there should be edit access to that email as well who's generating sheet".
  it("gives the person generating the sheet edit access, on a new sheet and on a regenerate", async () => {
    mockPrisma.user.findUnique.mockImplementation(async () => ({ role: "ADMIN", permissions: null, email: "maker@taggify.in" }));
    mockPrisma.plan.findUnique.mockResolvedValue(basePlan);
    mockGetSheetTabIds.mockResolvedValue({});

    const created = await generatePlanSheet("plan-1", admin);
    expect(mockShareFileWithEditor).toHaveBeenCalledWith({ accessToken: "access-token", fileId: "new-sheet-1", email: "maker@taggify.in" });
    expect(created.sharedWith).toBe("maker@taggify.in");

    mockPrisma.plan.findUnique.mockResolvedValue({ ...basePlan, clientSheetUrl: "https://docs.google.com/spreadsheets/d/existing-sheet-1/edit" });
    await generatePlanSheet("plan-1", admin, { internal: true });
    expect(mockShareFileWithEditor).toHaveBeenLastCalledWith(expect.objectContaining({ email: "maker@taggify.in" }));
  });

  it("a sharing failure doesn't fail the generation; it's reported back", async () => {
    mockPrisma.user.findUnique.mockImplementation(async () => ({ role: "ADMIN", permissions: null, email: "someone@company.com" }));
    mockPrisma.plan.findUnique.mockResolvedValue(basePlan);
    mockGetSheetTabIds.mockResolvedValue({});
    mockShareFileWithEditor.mockRejectedValueOnce(new Error("Google Drive API error sharing file: 400"));

    const result = await generatePlanSheet("plan-1", admin);

    expect(result.spreadsheetUrl).toBe("https://docs.google.com/spreadsheets/d/new-sheet-1/edit");
    expect(result.shareError).toContain("someone@company.com");
    expect(mockPrisma.plan.update).toHaveBeenCalled();
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

/**
 * User report, 29 Sep — "on modifying plan after generation, in google sheet
 * it's not updating". The sheet was only written by an explicit Generate, but
 * its link is shared with the client, who opens it directly. An edit now
 * rewrites whatever sheet was already generated (routes.js fires this after
 * the response), and never fails or stalls the save itself.
 */
describe("refreshGeneratedSheets — an edit rewrites the already-generated sheet", () => {
  const plan = {
    id: "plan-1",
    name: "Q1 Push",
    variantLabel: "Plan A",
    pitchGroupId: null,
    createdById: "admin-1",
    clientName: "Acme",
    budget: null,
    gstPercent: null,
    clientSheetUrl: "https://docs.google.com/spreadsheets/d/existing-sheet/edit?gid=7#gid=7",
    internalSheetUrl: null,
    items: [{ assetId: "asset-1", format: "reel", cost: 5000, clientCost: null, postsPerProfile: 2, asset }],
  };

  beforeEach(() => {
    mockIsGoogleOAuthConfigured.mockReturnValue(true);
    mockGetUserAccessToken.mockResolvedValue("access-token");
    mockGetSheetTabIds.mockImplementation(({ titles }) => Object.fromEntries(titles.map((t, i) => [t, 100 + i])));
  });

  it("rewrites the existing client sheet in place — same file, fresh tabs, no new spreadsheet", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue(plan);
    mockPrisma.plan.findMany.mockResolvedValue([plan]);

    await refreshGeneratedSheets("plan-1", admin);

    expect(mockCreateSpreadsheet).not.toHaveBeenCalled();
    expect(mockWriteSheetTab).toHaveBeenCalled();
    expect(mockWriteSheetTab.mock.calls.every(([args]) => args.spreadsheetId === "existing-sheet")).toBe(true);
  });

  it("touches only the variants already generated — no internal sheet is created just because the client one exists", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue(plan);
    mockPrisma.plan.findMany.mockResolvedValue([plan]);

    await refreshGeneratedSheets("plan-1", admin);

    // Every write went to the one existing (client) file; nothing was created for "internal".
    expect(mockCreateSpreadsheet).not.toHaveBeenCalled();
    expect(mockPrisma.plan.update).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ internalSheetUrl: expect.anything() }) }));
  });

  it("a plan nobody has generated a sheet for is left alone — generating is still an explicit action", async () => {
    const fresh = { ...plan, clientSheetUrl: null, internalSheetUrl: null };
    mockPrisma.plan.findUnique.mockResolvedValue(fresh);
    mockPrisma.plan.findMany.mockResolvedValue([fresh]);

    await refreshGeneratedSheets("plan-1", admin);

    expect(mockGetUserAccessToken).not.toHaveBeenCalled();
    expect(mockCreateSpreadsheet).not.toHaveBeenCalled();
    expect(mockWriteSheetTab).not.toHaveBeenCalled();
  });

  it("Plan B with no link of its own still refreshes the group's shared sheet", async () => {
    const planA = { ...plan, id: "plan-a", pitchGroupId: "g1" };
    const planB = { ...plan, id: "plan-b", pitchGroupId: "g1", variantLabel: "Plan B", clientSheetUrl: null };
    mockPrisma.plan.findUnique.mockResolvedValue(planB);
    mockPrisma.plan.findMany.mockResolvedValue([planA, planB]);

    await refreshGeneratedSheets("plan-b", admin);

    expect(mockWriteSheetTab).toHaveBeenCalled();
    expect(mockWriteSheetTab.mock.calls[0][0].spreadsheetId).toBe("existing-sheet");
  });

  it("a Google failure is logged, never thrown — it must not surface as a failed save", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue(plan);
    mockPrisma.plan.findMany.mockResolvedValue([plan]);
    mockGetUserAccessToken.mockResolvedValue(null); // disconnected
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(refreshGeneratedSheets("plan-1", admin)).resolves.toBeUndefined();
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("plan-1"), expect.stringContaining("No Google account is connected"));
    logged.mockRestore();
  });

  it("two edits at once don't interleave their writes — the second waits, and a burst costs one extra rewrite", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue(plan);
    mockPrisma.plan.findMany.mockResolvedValue([plan]);
    let inFlight = 0;
    let maxInFlight = 0;
    mockWriteSheetTab.mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
    });

    await Promise.all([refreshGeneratedSheets("plan-1", admin), refreshGeneratedSheets("plan-1", admin), refreshGeneratedSheets("plan-1", admin)]);

    expect(maxInFlight).toBe(1);
    // One rewrite + one catch-up for the burst (2 tabs each), not three.
    expect(mockWriteSheetTab).toHaveBeenCalledTimes(4);
  });
});

describe("generatePlanSheet — Plan A, B, C… share one sheet, two tabs per plan (user request, 23 Sep)", () => {
  const planA = { id: "plan-a", name: "Q1 Push", variantLabel: "Plan A", pitchGroupId: "g1", createdById: "admin-1", clientName: "Acme", budget: null, gstPercent: null, clientSheetUrl: "https://docs.google.com/spreadsheets/d/group-sheet/edit?gid=1#gid=1", internalSheetUrl: null, items: [{ assetId: "asset-1", format: "reel", cost: 5000, clientCost: null, postsPerProfile: 1, asset }] };
  // One page each: a plan's tabs are its Overview plus one tab per page category (8 Oct).
  const planB = { ...planA, id: "plan-b", variantLabel: "Plan B", clientSheetUrl: null };

  beforeEach(() => {
    mockIsGoogleOAuthConfigured.mockReturnValue(true);
    mockGetUserAccessToken.mockResolvedValue("access-token");
    mockGetSheetTabIds.mockImplementation(({ titles }) => Object.fromEntries(titles.map((t, i) => [t, 100 + i])));
  });

  it("generating from Plan B writes into the group's existing sheet, rewrites every plan's tab pair, and links each plan to its own Overview tab", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue(planB);
    mockPrisma.plan.findMany.mockResolvedValue([planA, planB]);

    const result = await generatePlanSheet("plan-b", admin);

    expect(mockCreateSpreadsheet).not.toHaveBeenCalled();
    const { spreadsheetId, titles } = mockEnsureSheetTabsExist.mock.calls[0][0];
    expect(spreadsheetId).toBe("group-sheet");
    expect(titles).toHaveLength(4);
    expect(titles.filter((t) => t.includes("Plan A"))).toHaveLength(2);
    expect(titles.filter((t) => t.includes("Plan B"))).toHaveLength(2);
    expect(mockWriteSheetTab).toHaveBeenCalledTimes(4);
    // Titles are [A overview, A pages, B overview, B pages] → gids 100..103.
    expect(result.spreadsheetUrl).toBe("https://docs.google.com/spreadsheets/d/group-sheet/edit?gid=102#gid=102");
    expect(mockPrisma.plan.update).toHaveBeenCalledWith({ where: { id: "plan-a" }, data: { clientSheetUrl: "https://docs.google.com/spreadsheets/d/group-sheet/edit?gid=100#gid=100" } });
    expect(mockPrisma.plan.update).toHaveBeenCalledWith({ where: { id: "plan-b" }, data: { clientSheetUrl: result.spreadsheetUrl } });
  });

  it("a brand-new group sheet is named without a variant label, since it holds every plan", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue({ ...planB });
    mockPrisma.plan.findMany.mockResolvedValue([{ ...planA, clientSheetUrl: null }, planB]);
    mockCreateSpreadsheet.mockResolvedValue({ spreadsheetId: "new-group-sheet", defaultSheetId: 0 });

    await generatePlanSheet("plan-b", admin);

    expect(mockCreateSpreadsheet).toHaveBeenCalledWith({ accessToken: "access-token", title: "Q1 Push — Client (Taggify)" });
  });

  it("leaves out a sibling a Plan Maker can't open instead of leaking it into their sheet", async () => {
    const pm = { id: "pm-1", role: "PLAN_MAKER" };
    mockPrisma.plan.findUnique.mockResolvedValue({ ...planB, createdById: "pm-1" });
    mockPrisma.plan.findMany.mockResolvedValue([{ ...planA, createdById: "someone-else" }, { ...planB, createdById: "pm-1" }]);

    await generatePlanSheet("plan-b", pm, { internal: true });

    const { titles } = mockEnsureSheetTabsExist.mock.calls[0][0];
    expect(titles).toHaveLength(2);
    expect(titles.every((t) => t.includes("Plan B"))).toBe(true);
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
    expect(mockWriteSheetTab.mock.calls.at(-1)[0].valueInputOption).toBeUndefined();
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

    expect(result.headers).toEqual(["S No", "Page Name", "Page Link", "Followers", "Date", "Posted Link"]);
    expect(result.rows).toHaveLength(2);
    expect(result.totalsRow[3]).toBe("13M"); // Followers total, 8,700,000 + 4,300,000
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
    gstPercent: 18,
    budget: null,
    overrideCost: null,
    clientInvoiceNumber: null,
    items: [{ id: "i1", assetId: "asset-1", format: "reel", cost: 4000, clientCost: 5000, postsPerProfile: 2, asset }],
    ...overrides,
  });
  const details = { clientCompany: " Acme Foods Pvt Ltd ", clientGstNumber: "27ABCDE1234F1Z5", clientAddress: "12 MG Road, Pune", clientPhone: "", invoiceDescription: " Influencer marketing services ", hsnSac: "" };
  const financeUser = { id: "fin-1", role: "FINANCE" };
  const numbering = (prefix, next) => [
    { key: "clientInvoicePrefix", value: prefix },
    { key: "clientInvoiceNextNumber", value: String(next) },
  ];
  beforeEach(() => mockPrisma.appSetting.findMany.mockResolvedValue(numbering("TAG/", 7)));

  it("writes the receivables ledger row (23 Sep): number + client-facing totals, issued by the requester; a regenerate only refreshes number/totals", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue(approvedPlan({ campaignId: "camp-1" }));
    mockPrisma.plan.update.mockImplementation(async ({ data }) => ({ ...approvedPlan({ campaignId: "camp-1" }), ...data }));

    await generateClientInvoice("plan-1", planMaker, details);

    // 2 posts × 5000 client cost = 10000, 18% GST = 1800.
    expect(mockPrisma.clientInvoice.upsert).toHaveBeenCalledWith({
      where: { planId: "plan-1" },
      create: expect.objectContaining({ planId: "plan-1", issuedById: "pm-1", invoiceNumber: "TAG/0007", subtotal: 10000, gstPercent: 18, gstAmount: 1800, total: 11800, campaignId: "camp-1" }),
      update: { invoiceNumber: "TAG/0007", subtotal: 10000, gstPercent: 18, gstAmount: 1800, total: 11800, campaignId: "camp-1" },
    });
    const { update } = mockPrisma.clientInvoice.upsert.mock.calls[0][0];
    expect(update).not.toHaveProperty("status");
    expect(update).not.toHaveProperty("issuedAt");
    expect(update).not.toHaveProperty("paidAt");
  });

  it("saves the popup's details onto the plan, takes the counter's next number and stamps the time", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue(approvedPlan());
    mockPrisma.plan.update.mockImplementation(async ({ data }) => ({ ...approvedPlan(), ...data }));

    const plan = await generateClientInvoice("plan-1", planMaker, details);

    const data = mockPrisma.plan.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ clientCompany: "Acme Foods Pvt Ltd", clientGstNumber: "27ABCDE1234F1Z5", clientAddress: "12 MG Road, Pune", clientPhone: null });
    expect(data).toMatchObject({ invoiceDescription: "Influencer marketing services", hsnSac: null });
    expect(data.clientInvoiceNumber).toBe("TAG/0007");
    // ...and the counter moves on only after the number was really taken.
    expect(mockPrisma.appSetting.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { key: "clientInvoiceNextNumber" }, update: { value: "8" } }));
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
    expect(mockPrisma.appSetting.upsert).not.toHaveBeenCalled(); // an old-series number never moves the counter
  });

  it("a role granted plans.edit (not ADMIN, not PLAN_MAKER) can invoice a plan it didn't create — 23 Sep, assertCanAccessPlan reads the permission, not bare role", async () => {
    // The plan belongs to pm-1, not fin-1 — before the 23 Sep fix this threw
    // PLAN_NOT_FOUND for anyone but an ADMIN-role account or the plan's own
    // creator, even though the route already let a plans.edit grant through.
    mockPrisma.user.findUnique.mockResolvedValueOnce({ role: "FINANCE", permissions: { "plans.edit": true } });
    mockPrisma.plan.findUnique.mockResolvedValue(approvedPlan());
    mockPrisma.plan.update.mockImplementation(async ({ data }) => ({ ...approvedPlan(), ...data }));

    await expect(generateClientInvoice("plan-1", financeUser, details)).resolves.toBeTruthy();
  });

  it("a plain FINANCE account (no grant) still can't invoice another maker's plan", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue(approvedPlan());

    await expect(generateClientInvoice("plan-1", financeUser, details)).rejects.toMatchObject({ code: "PLAN_NOT_FOUND" });
  });

  it("Admin/Finance can type the invoice number; ahead of the counter it pulls the counter past it", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue(approvedPlan({ createdById: "fin-1" }));
    mockPrisma.plan.update.mockImplementation(async ({ data }) => ({ ...approvedPlan(), ...data }));

    await generateClientInvoice("plan-1", financeUser, { ...details, clientInvoiceNumber: "TAG/0020" });

    expect(mockPrisma.plan.update.mock.calls[0][0].data.clientInvoiceNumber).toBe("TAG/0020");
    expect(mockPrisma.appSetting.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { value: "21" } }));
  });

  it("a typed number below the counter, or outside the series, leaves the counter alone", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue(approvedPlan());
    mockPrisma.plan.update.mockImplementation(async ({ data }) => ({ ...approvedPlan(), ...data }));

    await generateClientInvoice("plan-1", { id: "admin-1", role: "ADMIN" }, { ...details, clientInvoiceNumber: "TAG/0003" });
    await generateClientInvoice("plan-1", { id: "admin-1", role: "ADMIN" }, { ...details, clientInvoiceNumber: "MANUAL-9" });

    expect(mockPrisma.appSetting.upsert).not.toHaveBeenCalled();
  });

  it("a Plan Maker can't set the invoice number, but re-sending the plan's own number is fine", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue(approvedPlan({ clientInvoiceNumber: "TAG/0002" }));
    mockPrisma.plan.update.mockImplementation(async ({ data }) => ({ ...approvedPlan(), ...data }));

    await expect(generateClientInvoice("plan-1", planMaker, { ...details, clientInvoiceNumber: "TAG/0099" })).rejects.toMatchObject({ code: "INVOICE_NUMBER_FORBIDDEN" });
    expect(mockPrisma.plan.update).not.toHaveBeenCalled();
    await expect(generateClientInvoice("plan-1", planMaker, { ...details, clientInvoiceNumber: "TAG/0002" })).resolves.toBeTruthy();
  });

  it("a taken number the counter proposed is stepped past, so a Plan Maker (who can't type one) isn't stuck", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue(approvedPlan());
    // TAG/0007 is taken; the counter then reads 8.
    mockPrisma.appSetting.findMany.mockResolvedValueOnce(numbering("TAG/", 7)).mockResolvedValueOnce(numbering("TAG/", 7)).mockResolvedValue(numbering("TAG/", 8));
    mockPrisma.plan.update
      .mockRejectedValueOnce(Object.assign(new Error("unique"), { code: "P2002" }))
      .mockImplementation(async ({ data }) => ({ ...approvedPlan(), ...data }));

    const plan = await generateClientInvoice("plan-1", planMaker, details);

    expect(plan.clientInvoiceNumber).toBe("TAG/0008");
  });

  it("a typed number far too long to be a counter value never touches the counter", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue(approvedPlan());
    mockPrisma.plan.update.mockImplementation(async ({ data }) => ({ ...approvedPlan(), ...data }));

    await generateClientInvoice("plan-1", { id: "admin-1", role: "ADMIN" }, { ...details, clientInvoiceNumber: "TAG/1234567890123456789012" });

    expect(mockPrisma.appSetting.upsert).not.toHaveBeenCalled();
  });

  it("a number already used on another plan is a 409, and the counter doesn't move", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue(approvedPlan());
    mockPrisma.plan.update.mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002" }));

    await expect(generateClientInvoice("plan-1", { id: "admin-1", role: "ADMIN" }, { ...details, clientInvoiceNumber: "TAG/0001" })).rejects.toMatchObject({ code: "INVOICE_NUMBER_TAKEN" });
    expect(mockPrisma.appSetting.upsert).not.toHaveBeenCalled();
  });

  it("refuses a plan that isn't approved yet", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue(approvedPlan({ status: "DRAFT" }));
    await expect(generateClientInvoice("plan-1", planMaker, details)).rejects.toMatchObject({ code: "PLAN_NOT_APPROVED" });
    expect(mockPrisma.plan.update).not.toHaveBeenCalled();
  });

  it("the client's GST number is mandatory — on a GST plan and a non-GST plan alike (21 Sep)", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue(approvedPlan({ gstPercent: 18 }));
    await expect(generateClientInvoice("plan-1", planMaker, { ...details, clientGstNumber: "  " })).rejects.toMatchObject({ code: "CLIENT_GST_REQUIRED" });

    mockPrisma.plan.findUnique.mockResolvedValue(approvedPlan({ gstPercent: null }));
    await expect(generateClientInvoice("plan-1", planMaker, { ...details, clientGstNumber: "" })).rejects.toMatchObject({ code: "CLIENT_GST_REQUIRED" });
    expect(mockPrisma.plan.update).not.toHaveBeenCalled();
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
    mockPrisma.campaign.create.mockImplementation(async ({ data }) => ({ id: data.parentCampaignId ? `post-${data.postNumber}` : "root-1", brandName: data.brandName, title: data.title }));
    mockPrisma.plan.update.mockResolvedValue({ id: "plan-1", status: "APPROVED", budget: 50000, gstPercent: null, campaignId: "root-1", items: [] });

    const plan = await approvePlan("plan-1", planMaker);

    const calls = mockPrisma.campaign.create.mock.calls.map((c) => c[0].data);
    expect(calls).toHaveLength(3);
    // Phase 1: the root, no parent, all three pages, budget as the cap.
    expect(calls[0]).toMatchObject({ title: "Q1 Push", costCap: 50000 });
    expect(calls[0].parentCampaignId).toBeUndefined();
    expect(calls[0].assignments.create.map((a) => a.assetId)).toEqual(["asset-1", "asset-2", "asset-3"]);
    // 22 Sep — posts 2 and 3 are extra posts OF PHASE 1 (not real phases):
    // phaseNumber 1, postNumber 2/3, titled like the campaign. Creators still
    // see them as Phase 2/3 (lib/campaignPhases.js); admins see one phase.
    // Post 2: pages with ≥2 posts; post 3: pages with ≥3. Same brand, under the root, no separate cap.
    expect(calls[1]).toMatchObject({ brandName: "Acme", title: "Q1 Push", parentCampaignId: "root-1", phaseNumber: 1, postNumber: 2 });
    expect(calls[1].assignments.create.map((a) => a.assetId)).toEqual(["asset-1", "asset-2"]);
    expect(calls[1].costCap).toBeUndefined();
    expect(calls[2]).toMatchObject({ title: "Q1 Push", parentCampaignId: "root-1", phaseNumber: 1, postNumber: 3 });
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
    mockPrisma.plan.update.mockResolvedValue({ id: "plan-1", status: "APPROVED", budget: null, gstPercent: null, items: [] });
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
    mockPrisma.plan.update.mockResolvedValue({ id: "plan-1", status: "APPROVED", budget: null, gstPercent: null, items: [] });
    await approvePlan("plan-1", planMaker);
    expect(mockPrisma.campaign.create).toHaveBeenCalledTimes(1);
  });
});

describe("syncExecutionSheet — execution sheet → links (user decision, 23 Sep: parse, auto-create links, list the rest as pending)", () => {
  const planMaker = { id: "pm-1", role: "PLAN_MAKER" };
  const page2 = { id: "asset-2", handle: "laughter.colours", followers: 4300000, rateCards: [] };
  const approved = (overrides = {}) => ({
    id: "plan-1",
    name: "Q1 Push",
    createdById: "pm-1",
    status: "APPROVED",
    campaignId: "camp-root",
    executionSheetUrl: "https://docs.google.com/spreadsheets/d/abc/edit",
    budget: null,
    gstPercent: null,
    overrideCost: null,
    items: [
      { id: "i1", assetId: "asset-1", format: "reel", cost: 4000, clientCost: 5000, postsPerProfile: 2, asset },
      { id: "i2", assetId: "asset-2", format: "story", cost: 1000, clientCost: 1200, postsPerProfile: 1, asset: page2 },
    ],
    ...overrides,
  });
  const CSV = [
    "S No,Page Name,Page Link,Followers,Date,Posted Link",
    "1,demo.page,https://instagram.com/demo.page,100000,10 Sept,https://instagram.com/reel/r1",
    "2,demo.page,https://instagram.com/demo.page,100000,11 Sept,https://instagram.com/reel/r2",
    "3,demo.page,https://instagram.com/demo.page,100000,12 Sept,https://instagram.com/reel/r3",
    "4,Laughter Colours,https://instagram.com/laughter.colours,4300000,10 Sept,",
    "5,Unknown Page,https://instagram.com/nobody,1,10 Sept,https://instagram.com/reel/r9",
    ",TOTAL,,,,",
  ].join("\n");
  // Slots the approval created: demo.page has 2 posts (root + postNumber 2), laughter.colours 1.
  const slots = () => [
    { id: "a-root-1", campaignId: "camp-root", assetId: "asset-1", format: "reel", cost: 4000, linkId: null, asset },
    { id: "a-p2-1", campaignId: "camp-p2", assetId: "asset-1", format: "reel", cost: 4000, linkId: null, asset },
    { id: "a-root-2", campaignId: "camp-root", assetId: "asset-2", format: "story", cost: 1000, linkId: null, asset: page2 },
  ];

  beforeEach(() => {
    mockPrisma.plan.findUnique.mockResolvedValue(approved());
    mockPrisma.plan.update.mockImplementation(async ({ data }) => ({ ...approved(), ...data }));
    mockPrisma.campaign.findMany.mockResolvedValue([{ id: "camp-root", postNumber: null }, { id: "camp-p2", postNumber: 2 }]);
    mockPrisma.campaignAssignment.findMany.mockResolvedValue(slots());
    mockPrisma.campaignAssignment.update.mockResolvedValue({});
    mockPrisma.link.findFirst.mockResolvedValue(null);
    mockFetchSheetCsv.mockResolvedValue(CSV);
    let n = 0;
    mockAutoAttachLink.mockImplementation(async () => ({ id: `link-${++n}` }));
  });

  it("creates one SUBMITTED link per posted row on the page's next free slot (1st post → root row, 2nd → postNumber 2), carrying the slot's format/cost", async () => {
    const { summary, plan } = await syncExecutionSheet("plan-1", planMaker);

    expect(mockFetchSheetCsv).toHaveBeenCalledWith("https://docs.google.com/spreadsheets/d/abc/edit");
    expect(mockAutoAttachLink).toHaveBeenCalledTimes(2);
    expect(mockAutoAttachLink.mock.calls[0]).toEqual([asset, { campaignId: "camp-root", url: "https://instagram.com/reel/r1", format: "reel", cost: 4000 }]);
    expect(mockAutoAttachLink.mock.calls[1]).toEqual([asset, { campaignId: "camp-p2", url: "https://instagram.com/reel/r2", format: "reel", cost: 4000 }]);
    // Each filled slot remembers its link + post URL, like the campaign sheet import does.
    expect(mockPrisma.campaignAssignment.update).toHaveBeenCalledWith({ where: { id: "a-root-1" }, data: { linkId: "link-1", postUrl: "https://instagram.com/reel/r1" } });
    expect(mockPrisma.campaignAssignment.update).toHaveBeenCalledWith({ where: { id: "a-p2-1" }, data: { linkId: "link-2", postUrl: "https://instagram.com/reel/r2" } });

    expect(summary).toEqual({ attached: 2, alreadyLinked: 0, pending: 3, rows: 5 });
    // Pending rows say why, in the order they appear in the sheet.
    expect(plan.executionSheetPending.map((p) => [p.rowNumber, p.reason])).toEqual([
      [4, "More posts than the plan booked for @demo.page (2)"],
      [5, "No posted link yet"],
      [6, "@nobody isn't a page on this plan"],
    ]);
    const { data } = mockPrisma.plan.update.mock.calls[0][0];
    expect(data.executionSheetFetchedAt).toBeInstanceOf(Date);
  });

  it("is idempotent: a URL already linked for the page is counted, not re-created, and a filled slot isn't reused", async () => {
    mockPrisma.link.findFirst.mockImplementation(async ({ where }) => (where.url === "https://instagram.com/reel/r1" ? { id: "link-existing" } : null));
    mockPrisma.campaignAssignment.findMany.mockResolvedValue(slots().map((s) => (s.id === "a-root-1" ? { ...s, linkId: "link-existing" } : s)));

    const { summary } = await syncExecutionSheet("plan-1", planMaker);

    expect(summary).toMatchObject({ attached: 1, alreadyLinked: 1 });
    expect(mockAutoAttachLink).toHaveBeenCalledTimes(1);
    expect(mockAutoAttachLink.mock.calls[0][1]).toMatchObject({ campaignId: "camp-p2", url: "https://instagram.com/reel/r2" });
  });

  it("a pricing/attach failure on one row becomes that row's pending reason and doesn't stop the rest", async () => {
    mockAutoAttachLink.mockRejectedValueOnce(new ApiError(400, "NO_RATE_CARD", 'No rate card set for format "reel" on @demo.page')).mockResolvedValue({ id: "link-x" });

    const { summary, plan } = await syncExecutionSheet("plan-1", planMaker);

    // The failed row's slot stays free, so rows 2 and 3 both attach.
    expect(summary.attached).toBe(2);
    expect(plan.executionSheetPending[0]).toMatchObject({ rowNumber: 2, reason: 'No rate card set for format "reel" on @demo.page' });
  });

  it("refuses without a sheet, before approval, and on a sheet with no recognisable header", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue(approved({ executionSheetUrl: null }));
    await expect(syncExecutionSheet("plan-1", planMaker)).rejects.toMatchObject({ code: "NO_EXECUTION_SHEET" });

    mockPrisma.plan.findUnique.mockResolvedValue(approved({ status: "DRAFT", campaignId: null }));
    await expect(syncExecutionSheet("plan-1", planMaker)).rejects.toMatchObject({ code: "PLAN_NOT_APPROVED" });

    mockPrisma.plan.findUnique.mockResolvedValue(approved());
    mockFetchSheetCsv.mockResolvedValue("Name,Amount\nx,1\n");
    await expect(syncExecutionSheet("plan-1", planMaker)).rejects.toMatchObject({ code: "SHEET_FORMAT" });
    expect(mockAutoAttachLink).not.toHaveBeenCalled();
  });

  it("404s a Plan Maker on someone else's plan", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue(approved({ createdById: "someone-else" }));
    await expect(syncExecutionSheet("plan-1", planMaker)).rejects.toMatchObject({ code: "PLAN_NOT_FOUND" });
  });
});

describe("updatePlan — saving an execution sheet link on an approved plan reads it straight away (23 Sep)", () => {
  const planMaker = { id: "pm-1", role: "PLAN_MAKER" };
  const base = { id: "plan-1", createdById: "pm-1", status: "APPROVED", campaignId: "camp-root", executionSheetUrl: null, budget: null, gstPercent: null, overrideCost: null, items: [], sourceSheetPending: null };
  const url = "https://docs.google.com/spreadsheets/d/xyz/edit";

  beforeEach(() => {
    mockPrisma.plan.findUnique.mockReset().mockResolvedValueOnce(base).mockResolvedValue({ ...base, executionSheetUrl: url });
    mockPrisma.plan.update.mockImplementation(async ({ data }) => ({ ...base, executionSheetUrl: url, ...data }));
    mockPrisma.campaign.findMany.mockResolvedValue([{ id: "camp-root", postNumber: null }]);
    mockPrisma.campaignAssignment.findMany.mockResolvedValue([]);
  });

  it("clears the old pending list, then syncs and returns the synced plan", async () => {
    mockFetchSheetCsv.mockResolvedValue("Page Name,Posted Link\n");

    const plan = await updatePlan("plan-1", planMaker, { executionSheetUrl: url });

    expect(mockPrisma.plan.update.mock.calls[0][0].data).toMatchObject({ executionSheetUrl: url, executionSheetPending: null, executionSheetFetchedAt: null });
    expect(mockFetchSheetCsv).toHaveBeenCalledWith(url);
    expect(plan.executionSheetFetchedAt).toBeInstanceOf(Date);
    expect(plan.executionSheetSyncError).toBeUndefined();
  });

  it("a sheet that can't be read still saves the link and reports the problem on the response instead of failing", async () => {
    mockFetchSheetCsv.mockRejectedValue(new ApiError(400, "SHEET_NOT_SHARED", "Couldn't read that sheet — make sure it's shared"));

    const plan = await updatePlan("plan-1", planMaker, { executionSheetUrl: url });

    expect(plan.executionSheetUrl).toBe(url);
    expect(plan.executionSheetSyncError).toMatch(/shared/);
  });

  it("does not try to read the sheet on a plan that isn't approved yet", async () => {
    mockPrisma.plan.findUnique.mockReset().mockResolvedValue({ ...base, status: "DRAFT", campaignId: null });
    mockPrisma.plan.update.mockImplementation(async ({ data }) => ({ ...base, status: "DRAFT", campaignId: null, ...data }));

    await updatePlan("plan-1", planMaker, { executionSheetUrl: url });

    expect(mockFetchSheetCsv).not.toHaveBeenCalled();
  });
});

// 8 Oct — an admin can mark a page inactive: it can't be added to new plans, everything else stays the same.
describe("inactive pages can't be added to plans", () => {
  const inactive = { ...asset, id: "asset-off", handle: "off.page", isActive: false };

  it("createPlan refuses an inactive page", async () => {
    mockPrisma.asset.findMany.mockResolvedValue([inactive]);
    await expect(createPlan(admin, { name: "Q1", clientName: "Acme", notes: "x", items: [{ assetId: "asset-off", format: "reel" }] })).rejects.toMatchObject({ code: "PAGE_INACTIVE", statusCode: 400 });
    expect(mockPrisma.plan.create).not.toHaveBeenCalled();
  });

  it("createPlanVariant refuses an inactive page", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue({ id: "plan-1", createdById: "admin-1", pitchGroupId: "g", items: [] });
    mockPrisma.asset.findMany.mockResolvedValue([inactive]);
    await expect(createPlanVariant("plan-1", admin, { items: [{ assetId: "asset-off", format: "reel" }] })).rejects.toMatchObject({ code: "PAGE_INACTIVE" });
    expect(mockPrisma.plan.create).not.toHaveBeenCalled();
  });

  it("updatePlan keeps an inactive page that's already on the plan", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue({ id: "plan-1", createdById: "admin-1" });
    mockPrisma.planItem.findMany.mockResolvedValue([{ assetId: "asset-off" }]);
    mockPrisma.asset.findMany.mockResolvedValue([inactive]);
    mockPrisma.plan.update.mockResolvedValue({ id: "plan-1", budget: null, gstPercent: null, items: [] });
    await updatePlan("plan-1", admin, { items: [{ assetId: "asset-off", format: "reel", postsPerProfile: 2 }] });
    expect(mockPrisma.plan.update).toHaveBeenCalled();
  });

  it("updatePlan refuses adding an inactive page that wasn't on the plan", async () => {
    mockPrisma.plan.findUnique.mockResolvedValue({ id: "plan-1", createdById: "admin-1" });
    mockPrisma.planItem.findMany.mockResolvedValue([{ assetId: "asset-1" }]);
    mockPrisma.asset.findMany.mockResolvedValue([asset, inactive]);
    await expect(updatePlan("plan-1", admin, { items: [{ assetId: "asset-1", format: "reel" }, { assetId: "asset-off", format: "reel" }] })).rejects.toMatchObject({ code: "PAGE_INACTIVE" });
    expect(mockPrisma.planItem.deleteMany).not.toHaveBeenCalled();
  });

  it("importPlanSheetPages reports an inactive page as a failure and doesn't add it", async () => {
    mockPrisma.plan.findUnique.mockResolvedValueOnce({ id: "plan-1", createdById: "admin-1" });
    mockPrisma.plan.findUnique.mockResolvedValueOnce({ id: "plan-1", createdById: "admin-1", budget: null, gstPercent: null, items: [] });
    mockPrisma.asset.findMany.mockResolvedValue([inactive]);
    const result = await importPlanSheetPages("plan-1", admin, [{ handle: "off.page" }]);
    expect(result.failures).toEqual([{ handle: "off.page", reason: "This page is inactive and can't be added to a plan." }]);
    expect(mockPrisma.planItem.createMany).not.toHaveBeenCalled();
  });

  it("an uploaded plan sheet puts an inactive page in pending, not on the plan", async () => {
    mockPrisma.plan.create.mockResolvedValue({ id: "plan-9", createdById: "admin-1", sourceSheetPending: [] });
    mockPrisma.asset.findMany.mockResolvedValue([inactive]);
    mockPrisma.plan.update.mockResolvedValue({ id: "plan-9", budget: null, gstPercent: null, items: [] });
    await createPlanFromSheet(admin, { sourceSheetUrl: "https://docs.google.com/spreadsheets/d/x", fields: { name: "Q1", clientName: "Acme" }, rows: [{ handle: "off.page" }] });
    const { data } = mockPrisma.plan.update.mock.calls.at(-1)[0];
    expect(data.sourceSheetPending).toEqual([expect.objectContaining({ handle: "off.page", reason: "This page is inactive and can't be added to a plan." })]);
    expect(data.items).toEqual({ create: [] });
  });
});
