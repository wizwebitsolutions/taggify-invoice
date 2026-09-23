import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApiError } from "../../middleware/errorHandler.js";

const mockPrisma = {
  link: { findUnique: vi.fn(), update: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
  linkCostRevision: { create: vi.fn(), findMany: vi.fn() },
  linkStatusEvent: { create: vi.fn() },
  campaign: { findMany: vi.fn() },
  asset: { findMany: vi.fn() },
  user: { findUnique: vi.fn() },
  $transaction: vi.fn(async (ops) => Promise.all(ops)),
};
vi.mock("../../lib/prisma.js", () => ({ prisma: mockPrisma }));
vi.mock("../../lib/cloudinaryClient.js", () => ({ publicUrlFor: vi.fn((id) => `https://cloudinary/${id}`) }));
vi.mock("../scraping/service.js", () => ({ refreshLinkMetrics: vi.fn(async () => ({ ok: true })) }));
vi.mock("../notifications/service.js", () => ({ notify: vi.fn() }));

const { reviseLinkCost, getLinkCostRevisions, bulkImportLinks, markLinkInvalid, autoAttachLink, reviewScreenshot, listLinks } = await import("./service.js");
const { transitionLinkStatus } = await import("./statusTimeline.js");
const { notify } = await import("../notifications/service.js");

const admin = { id: "admin-1", role: "ADMIN" };

beforeEach(() => {
  vi.clearAllMocks();
  // links.view scoping (23 Sep, Step 3) is read fresh from the DB — derive
  // a plausible role from this file's id fixtures (admin-*/fin-*/creator-*)
  // so existing calls work without every test stubbing this.
  mockPrisma.user.findUnique.mockImplementation(async ({ where }) => ({
    role: where.id?.startsWith("admin") ? "ADMIN" : where.id?.startsWith("fin") ? "FINANCE" : where.id?.startsWith("pm") ? "PLAN_MAKER" : "CREATOR",
    permissions: null,
  }));
});

describe("listLinks — unbilled filter (22 Sep)", () => {
  it("unbilled=true restricts to links with no invoice item; without it the where is status-only", async () => {
    mockPrisma.$transaction.mockResolvedValueOnce([[], 0]).mockResolvedValueOnce([[], 0]);
    mockPrisma.link.findMany = vi.fn().mockReturnValue("findMany");
    mockPrisma.link.count = vi.fn().mockReturnValue("count");

    await listLinks(admin, { status: "SUBMITTED,INSIGHTS_APPROVED", unbilled: true, page: 1, pageSize: 100 });
    expect(mockPrisma.link.findMany.mock.calls[0][0].where).toEqual({ status: { in: ["SUBMITTED", "INSIGHTS_APPROVED"] }, invoiceItem: null });

    await listLinks(admin, { status: "SUBMITTED", unbilled: false, page: 1, pageSize: 100 });
    expect(mockPrisma.link.findMany.mock.calls[1][0].where).toEqual({ status: "SUBMITTED" });
  });
});

describe("listLinks — links.view scoping is read fresh, not just role (23 Sep, Step 3)", () => {
  beforeEach(() => {
    // Fresh mocks of our own — the "unbilled filter" test above permanently
    // reassigns mockPrisma.link.findMany/count to string-returning stubs
    // that vi.clearAllMocks() doesn't undo (it clears call history, not a
    // reassigned implementation), so this suite can't rely on the file's
    // shared defaults if it runs afterward.
    mockPrisma.link.findMany = vi.fn(async () => []);
    mockPrisma.link.count = vi.fn(async () => 0);
    mockPrisma.$transaction.mockImplementation(async (ops) => Promise.all(ops));
  });

  it("a plain ADMIN or FINANCE account (links.view true by baseline) sees every link", async () => {
    await listLinks({ id: "fin-1", role: "FINANCE" }, { page: 1, pageSize: 100 });
    expect(mockPrisma.link.findMany.mock.calls.at(-1)[0].where).toEqual({});
  });

  it("restricting a FINANCE account's links.view now actually scopes them to their own pages' links — it used to be a no-op", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      role: "FINANCE",
      permissions: { "links.view": false, "links.edit": false, "links.approve": false },
    });
    await listLinks({ id: "fin-1", role: "FINANCE" }, { page: 1, pageSize: 100 });
    expect(mockPrisma.link.findMany.mock.calls.at(-1)[0].where).toEqual({ asset: { ownerId: "fin-1" } });
  });

  it("granting links.view to a role that doesn't normally hold it opens the full list", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ role: "TEAM_MEMBER", permissions: { "links.view": true } });
    await listLinks({ id: "tm-1", role: "TEAM_MEMBER" }, { page: 1, pageSize: 100 });
    expect(mockPrisma.link.findMany.mock.calls.at(-1)[0].where).toEqual({});
  });
});

// 22 Sep — a creator hit "already on invoice INV-…" for links that had
// drifted back to a ready-to-invoice status: a screenshot uploaded/reviewed
// after invoicing moved the status while the InvoiceItem stayed.
describe("INVOICED is terminal — only rejecting the invoice releases a link", () => {
  it("transitionLinkStatus refuses to move an INVOICED link anywhere else, without writing anything", async () => {
    mockPrisma.link.findUnique.mockResolvedValue({ id: "l1", status: "INVOICED" });
    await expect(transitionLinkStatus("l1", "PENDING_SCREENSHOT_REVIEW")).rejects.toMatchObject({ code: "ALREADY_INVOICED", statusCode: 409 });
    expect(mockPrisma.link.update).not.toHaveBeenCalled();
    expect(mockPrisma.linkStatusEvent.create).not.toHaveBeenCalled();
  });

  it("still transitions a non-invoiced link and records the event", async () => {
    mockPrisma.link.findUnique.mockResolvedValue({ id: "l1", status: "SUBMITTED" });
    mockPrisma.link.update.mockResolvedValue({ id: "l1", status: "PENDING_SCREENSHOT_REVIEW" });
    mockPrisma.linkStatusEvent.create.mockResolvedValue({});
    await expect(transitionLinkStatus("l1", "PENDING_SCREENSHOT_REVIEW")).resolves.toMatchObject({ status: "PENDING_SCREENSHOT_REVIEW" });
    expect(mockPrisma.link.update).toHaveBeenCalledWith({ where: { id: "l1" }, data: { status: "PENDING_SCREENSHOT_REVIEW" } });
  });

  it("reviewScreenshot on an INVOICED link is refused before the screenshot row is touched", async () => {
    mockPrisma.screenshot = { update: vi.fn() };
    mockPrisma.link.findUnique.mockResolvedValue({ id: "l1", status: "INVOICED", submittedById: "c1" });
    await expect(reviewScreenshot("l1", admin, { approved: true })).rejects.toMatchObject({ code: "ALREADY_INVOICED" });
    expect(mockPrisma.screenshot.update).not.toHaveBeenCalled();
  });
});

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

describe("markLinkInvalid — admin confirms a broken/dead post (newTask.md, 8 Sep)", () => {
  it("transitions the link to INVALID, logs the note, and notifies the submitter", async () => {
    mockPrisma.link.findUnique.mockResolvedValue({ id: "link-1", status: "SUBMITTED", submittedById: "creator-1" });
    mockPrisma.link.update.mockResolvedValue({ id: "link-1", status: "INVALID" });
    mockPrisma.linkStatusEvent.create.mockResolvedValue({});

    await markLinkInvalid("link-1", admin, { note: "Post was deleted" });

    expect(mockPrisma.link.update).toHaveBeenCalledWith({ where: { id: "link-1" }, data: { status: "INVALID" } });
    expect(mockPrisma.linkStatusEvent.create).toHaveBeenCalledWith({
      data: { linkId: "link-1", status: "INVALID", actedById: "admin-1", note: "Post was deleted" },
    });
    expect(notify).toHaveBeenCalledWith("creator-1", "link_marked_invalid", { linkId: "link-1", status: "INVALID" });
  });

  it("refuses to invalidate a link that's already been invoiced", async () => {
    mockPrisma.link.findUnique.mockResolvedValue({ id: "link-1", status: "INVOICED" });

    await expect(markLinkInvalid("link-1", admin, { note: "too late" })).rejects.toMatchObject({ code: "ALREADY_INVOICED" });
    expect(mockPrisma.link.update).not.toHaveBeenCalled();
  });

  it("is idempotent — marking an already-invalid link invalid again is a no-op", async () => {
    mockPrisma.link.findUnique.mockResolvedValue({ id: "link-1", status: "INVALID" });

    const result = await markLinkInvalid("link-1", admin, { note: "still broken" });

    expect(result).toEqual({ id: "link-1", status: "INVALID" });
    expect(mockPrisma.link.update).not.toHaveBeenCalled();
  });

  it("404s on a link that doesn't exist", async () => {
    mockPrisma.link.findUnique.mockResolvedValue(null);

    await expect(markLinkInvalid("missing", admin, { note: "gone" })).rejects.toBeInstanceOf(ApiError);
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

describe("autoAttachLink — a sheet-named post is attached to the page owner, not the caller (newTask.md, 8 Sep)", () => {
  const asset = { id: "asset-1", handle: "demo.page", ownerId: "creator-1", rateCards: [{ format: "reel", amount: 5000 }] };

  it("creates the link with submittedById = the asset's owner, using the rate card when no cost is given", async () => {
    mockPrisma.link.findFirst.mockResolvedValue(null);
    mockPrisma.link.create.mockResolvedValue({ id: "link-1" });
    mockPrisma.linkStatusEvent.create.mockResolvedValue({});

    const link = await autoAttachLink(asset, { campaignId: "camp-1", url: "https://instagram.com/p/1", format: "reel" });

    expect(mockPrisma.link.create).toHaveBeenCalledWith({
      data: {
        campaignId: "camp-1",
        assetId: "asset-1",
        submittedById: "creator-1",
        url: "https://instagram.com/p/1",
        format: "reel",
        cost: 5000,
        customRate: false,
        status: "SUBMITTED",
      },
    });
    expect(mockPrisma.linkStatusEvent.create).toHaveBeenCalledWith({
      data: { linkId: "link-1", status: "SUBMITTED", actedById: "creator-1" },
    });
    expect(link).toEqual({ id: "link-1" });
  });

  it("uses an explicit cost over the rate card when given, and marks it customRate", async () => {
    mockPrisma.link.findFirst.mockResolvedValue(null);
    mockPrisma.link.create.mockResolvedValue({ id: "link-1" });

    await autoAttachLink(asset, { campaignId: "camp-1", url: "https://instagram.com/p/1", format: "reel", cost: 9000 });

    expect(mockPrisma.link.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ cost: 9000, customRate: true }) }));
  });

  it("returns null for a URL already submitted for this asset, without creating a second Link", async () => {
    mockPrisma.link.findFirst.mockResolvedValue({ id: "existing-link" });

    const result = await autoAttachLink(asset, { campaignId: "camp-1", url: "https://instagram.com/p/1", format: "reel" });

    expect(result).toBeNull();
    expect(mockPrisma.link.create).not.toHaveBeenCalled();
  });

  it("throws NO_RATE_CARD when no cost is given and the page has no rate card for that format", async () => {
    mockPrisma.link.findFirst.mockResolvedValue(null);
    const assetNoRate = { ...asset, rateCards: [] };

    await expect(autoAttachLink(assetNoRate, { campaignId: "camp-1", url: "https://instagram.com/p/1", format: "reel" })).rejects.toMatchObject({
      code: "NO_RATE_CARD",
    });
    expect(mockPrisma.link.create).not.toHaveBeenCalled();
  });

  // Code review, 23 Sep: the findFirst check above is a plain read, not a
  // lock — two overlapping calls (a double-clicked "Refresh links" on a
  // plan's execution sheet, or its auto-sync racing a manual one) can both
  // pass it before either insert lands. Link.@@unique([url, assetId]) is
  // the real guard: the second create() 404s on P2002, caught here and
  // treated exactly like the pre-existing-row case, so a post can never be
  // double-billed even under a genuine race the findFirst alone misses.
  it("returns null (not a thrown error) when the insert loses a race to a duplicate — the DB's unique constraint, not the findFirst read, is what actually prevents a double-billed post", async () => {
    mockPrisma.link.findFirst.mockResolvedValue(null); // the racing check that let both callers proceed
    const conflict = Object.assign(new Error("Unique constraint failed on the fields: (`url`,`assetId`)"), { code: "P2002" });
    mockPrisma.link.create.mockRejectedValue(conflict);

    const result = await autoAttachLink(asset, { campaignId: "camp-1", url: "https://instagram.com/p/1", format: "reel" });

    expect(result).toBeNull();
    expect(mockPrisma.linkStatusEvent.create).not.toHaveBeenCalled();
  });

  it("still throws a non-conflict error from create() rather than swallowing it", async () => {
    mockPrisma.link.findFirst.mockResolvedValue(null);
    mockPrisma.link.create.mockRejectedValue(new Error("connection lost"));

    await expect(autoAttachLink(asset, { campaignId: "camp-1", url: "https://instagram.com/p/1", format: "reel" })).rejects.toThrow("connection lost");
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
