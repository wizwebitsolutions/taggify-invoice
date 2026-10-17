import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApiError } from "../../middleware/errorHandler.js";

const mockPrisma = {
  link: { findUnique: vi.fn(), update: vi.fn(), findFirst: vi.fn(), create: vi.fn(), delete: vi.fn() },
  linkCostRevision: { create: vi.fn(), findMany: vi.fn() },
  linkStatusEvent: { create: vi.fn() },
  campaign: { findMany: vi.fn(), findUnique: vi.fn(async () => null) },
  // Reel + Story combo lookups (14 Oct, lib/comboSlots.js): no plan by default.
  plan: { findUnique: vi.fn(async () => null) },
  asset: { findMany: vi.fn(), findUnique: vi.fn() },
  teamMembership: { findUnique: vi.fn() },
  user: { findUnique: vi.fn() },
  $transaction: vi.fn(async (ops) => Promise.all(ops)),
};
vi.mock("../../lib/prisma.js", () => ({ prisma: mockPrisma }));
vi.mock("../../lib/cloudinaryClient.js", () => ({ publicUrlFor: vi.fn((id) => `https://cloudinary/${id}`) }));
vi.mock("../scraping/service.js", () => ({ refreshLinkMetrics: vi.fn(async () => ({ ok: true })) }));
vi.mock("../notifications/service.js", () => ({ notify: vi.fn() }));
// The over-quota rule has its own tests (lib/postQuota.test.js); here it's
// only checked that creating a post triggers the recompute.
vi.mock("../../lib/postQuota.js", () => ({ recomputePostQuota: vi.fn(async () => []) }));
const { recomputePostQuota } = await import("../../lib/postQuota.js");

const { deleteLink, reviseLinkCost, getLinkCostRevisions, bulkImportLinks, markLinkInvalid, autoAttachLink, reviewScreenshot, listLinks, createLink, bulkCreateLink, getLinkTimeline } = await import("./service.js");
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

describe("listLinks — unbilled filter (22 Sep, broadened 23 Sep for Payouts)", () => {
  it("unbilled=true restricts to links with no invoice item and no payout item; without it the where is status-only", async () => {
    mockPrisma.$transaction.mockResolvedValueOnce([[], 0]).mockResolvedValueOnce([[], 0]);
    mockPrisma.link.findMany = vi.fn().mockReturnValue("findMany");
    mockPrisma.link.count = vi.fn().mockReturnValue("count");

    await listLinks(admin, { status: "SUBMITTED,INSIGHTS_APPROVED", unbilled: true, page: 1, pageSize: 100 });
    expect(mockPrisma.link.findMany.mock.calls[0][0].where).toEqual({ status: { in: ["SUBMITTED", "INSIGHTS_APPROVED"] }, invoiceItem: null, payoutItem: null, overQuota: false });

    await listLinks(admin, { status: "SUBMITTED", unbilled: false, page: 1, pageSize: 100 });
    expect(mockPrisma.link.findMany.mock.calls[1][0].where).toEqual({ status: "SUBMITTED" });
  });
});

describe("listLinks — Payments tab filters (tasks.md #5, 23 Sep)", () => {
  it("ownerId scopes to a vendor's pages", async () => {
    mockPrisma.$transaction.mockResolvedValueOnce([[], 0]);
    mockPrisma.link.findMany = vi.fn().mockReturnValue("findMany");
    mockPrisma.link.count = vi.fn().mockReturnValue("count");

    await listLinks(admin, { ownerId: "creator-1", page: 1, pageSize: 100 });
    expect(mockPrisma.link.findMany.mock.calls[0][0].where).toEqual({ AND: [{ asset: { ownerId: "creator-1" } }] });
  });

  it("regression (24 Sep review): a creator passing someone else's ownerId still only gets their own pages' links", async () => {
    mockPrisma.$transaction.mockResolvedValueOnce([[], 0]);
    mockPrisma.link.findMany = vi.fn().mockReturnValue("findMany");
    mockPrisma.link.count = vi.fn().mockReturnValue("count");

    await listLinks({ id: "creator-1", role: "CREATOR" }, { ownerId: "creator-2", page: 1, pageSize: 100 });
    const { where } = mockPrisma.link.findMany.mock.calls[0][0];
    // Own-pages scope is intact, and the requested owner is ANDed on top — so the result is empty, never creator-2's links.
    expect(where.asset).toEqual({ ownerId: "creator-1" });
    expect(where.AND).toEqual([{ asset: { ownerId: "creator-2" } }]);
  });

  it("unpaid=true excludes links already on a payout or an invoice", async () => {
    mockPrisma.$transaction.mockResolvedValueOnce([[], 0]);
    mockPrisma.link.findMany = vi.fn().mockReturnValue("findMany");
    mockPrisma.link.count = vi.fn().mockReturnValue("count");

    await listLinks(admin, { unpaid: true, page: 1, pageSize: 100 });
    expect(mockPrisma.link.findMany.mock.calls[0][0].where).toEqual({ payoutItem: null, invoiceItem: null, overQuota: false });
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

  it("regression (24 Sep — own-scope roles never get global access): a TEAM_MEMBER with a stored links.view grant still sees only their own pages' links", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ role: "TEAM_MEMBER", permissions: { "links.view": true } });
    await listLinks({ id: "tm-1", role: "TEAM_MEMBER" }, { page: 1, pageSize: 100 });
    expect(mockPrisma.link.findMany.mock.calls.at(-1)[0].where).toEqual({ asset: { ownerId: "tm-1" } });
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

// 7 Oct — Content's status menu (and Approvals) can act on a stale row. A proof
// review on a post that has already moved on must not walk it backwards.
describe("reviewScreenshot only decides a proof that's waiting for review", () => {
  for (const status of ["SUBMITTED", "SCREENSHOT_APPROVED", "INSIGHTS_PENDING", "INSIGHTS_APPROVED", "SCREENSHOT_REJECTED", "INVALID"]) {
    it(`refuses a ${status} post without touching the screenshot or status`, async () => {
      mockPrisma.screenshot = { update: vi.fn() };
      mockPrisma.link.findUnique.mockResolvedValue({ id: "l1", status, submittedById: "c1" });
      await expect(reviewScreenshot("l1", admin, { approved: true })).rejects.toMatchObject({ code: "INVALID_STATUS", statusCode: 400 });
      expect(mockPrisma.screenshot.update).not.toHaveBeenCalled();
      expect(mockPrisma.link.update).not.toHaveBeenCalled();
    });
  }
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
    // 29 Sep: every new post re-derives its page's quota, and the result says whether this one is over.
    expect(recomputePostQuota).toHaveBeenCalledWith("camp-1", "asset-1");
    expect(link).toEqual({ id: "link-1", overQuota: false });
  });

  it("a sheet-attached post past the booking comes back flagged over quota", async () => {
    mockPrisma.link.findFirst.mockResolvedValue(null);
    mockPrisma.link.create.mockResolvedValue({ id: "link-1" });
    recomputePostQuota.mockResolvedValueOnce(["link-1"]);

    const link = await autoAttachLink(asset, { campaignId: "camp-1", url: "https://instagram.com/p/1", format: "reel", cost: 9000 });

    expect(link.overQuota).toBe(true);
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

// 24 Sep — link submission only checked the role, so a creator could submit
// links (and get paid) against anyone's page.
describe("createLink / bulkCreateLink — only on your own pages (24 Sep)", () => {
  const someoneElsesPage = { id: "asset-9", ownerId: "creator-9", rateCards: [{ format: "reel", amount: 5000 }] };

  it("a creator submitting to another creator's page gets 403 NOT_YOUR_PAGE and nothing is created", async () => {
    mockPrisma.asset.findUnique.mockResolvedValue(someoneElsesPage);
    mockPrisma.link.create = vi.fn();
    const creator = { id: "creator-1", role: "CREATOR" };

    await expect(createLink(creator, { campaignId: "c1", assetId: "asset-9", url: "https://ig/p/1", format: "reel" })).rejects.toMatchObject({ code: "NOT_YOUR_PAGE", statusCode: 403 });
    await expect(bulkCreateLink(creator, { campaignId: "c1", assetId: "asset-9", format: "reel", urls: ["https://ig/p/1"] })).rejects.toMatchObject({ code: "NOT_YOUR_PAGE" });
    expect(mockPrisma.link.create).not.toHaveBeenCalled();
  });

  it("a team member may submit for the creator they work for, not for anyone else", async () => {
    mockPrisma.asset.findUnique.mockResolvedValue(someoneElsesPage);
    mockPrisma.link.create = vi.fn(async ({ data }) => ({ id: "new-link", ...data }));
    mockPrisma.linkStatusEvent.create = vi.fn();
    const member = { id: "tm-1", role: "TEAM_MEMBER" };

    mockPrisma.campaign.findUnique = vi.fn(async () => ({ id: "c1" }));
    mockPrisma.campaignAssignment = { findFirst: vi.fn(async () => ({ id: "booking-1" })) };
    mockPrisma.teamMembership.findUnique.mockResolvedValueOnce({ id: "m-1" });
    await expect(createLink(member, { campaignId: "c1", assetId: "asset-9", url: "https://ig/p/2", format: "reel" })).resolves.toMatchObject({ id: "new-link" });
    // 29 Sep: a submitted post re-derives its page's quota.
    expect(recomputePostQuota).toHaveBeenCalledWith("c1", "asset-9");

    mockPrisma.teamMembership.findUnique.mockResolvedValueOnce(null);
    await expect(createLink(member, { campaignId: "c1", assetId: "asset-9", url: "https://ig/p/3", format: "reel" })).rejects.toMatchObject({ code: "NOT_YOUR_PAGE" });
  });

  it("booked campaigns only: a link on a campaign row the page isn't booked on is refused with 403 PAGE_NOT_BOOKED", async () => {
    const ownPage = { id: "asset-1", ownerId: "creator-1", rateCards: [{ format: "reel", amount: 5000 }] };
    mockPrisma.asset.findUnique.mockResolvedValue(ownPage);
    mockPrisma.campaign.findUnique = vi.fn(async () => ({ id: "someone-elses-campaign" }));
    mockPrisma.campaignAssignment = { findFirst: vi.fn(async () => null) };
    mockPrisma.link.create = vi.fn();
    const creator = { id: "creator-1", role: "CREATOR" };

    await expect(createLink(creator, { campaignId: "someone-elses-campaign", assetId: "asset-1", url: "https://ig/p/4", format: "reel" })).rejects.toMatchObject({ code: "PAGE_NOT_BOOKED", statusCode: 403 });
    await expect(bulkCreateLink(creator, { campaignId: "someone-elses-campaign", assetId: "asset-1", format: "reel", urls: ["https://ig/p/4"] })).rejects.toMatchObject({ code: "PAGE_NOT_BOOKED" });
    expect(mockPrisma.campaignAssignment.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { campaignId: "someone-elses-campaign", assetId: "asset-1" } }));
    expect(mockPrisma.link.create).not.toHaveBeenCalled();

    // An unknown campaign is a 404, not a booking question.
    mockPrisma.campaign.findUnique = vi.fn(async () => null);
    await expect(createLink(creator, { campaignId: "nope", assetId: "asset-1", url: "https://ig/p/5", format: "reel" })).rejects.toMatchObject({ code: "CAMPAIGN_NOT_FOUND" });
  });
});

describe("getLinkTimeline — only for a link the caller can see (24 Sep)", () => {
  it("a creator gets 404 for a link that isn't on their page; staff with links.view read any", async () => {
    mockPrisma.linkStatusEvent.findMany = vi.fn(async () => [{ status: "SUBMITTED" }]);
    mockPrisma.link.findFirst.mockResolvedValueOnce(null);
    await expect(getLinkTimeline("someone-elses-link", { id: "creator-1", role: "CREATOR" })).rejects.toMatchObject({ code: "LINK_NOT_FOUND", statusCode: 404 });
    expect(mockPrisma.link.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "someone-elses-link", asset: { ownerId: "creator-1" } } }));
    expect(mockPrisma.linkStatusEvent.findMany).not.toHaveBeenCalled();

    mockPrisma.link.findFirst.mockResolvedValueOnce({ id: "own-link" });
    await expect(getLinkTimeline("own-link", { id: "creator-1", role: "CREATOR" })).resolves.toEqual([{ status: "SUBMITTED" }]);

    mockPrisma.link.findFirst.mockClear();
    await expect(getLinkTimeline("any-link", { id: "admin-1", role: "ADMIN" })).resolves.toHaveLength(1);
    expect(mockPrisma.link.findFirst).not.toHaveBeenCalled();
  });
});

// Delete a post (12 Oct): gone with its history, but never once money is attached.
describe("deleteLink", () => {
  const LINK = { id: "l1", status: "SUBMITTED", campaignId: "c1", assetId: "a1", invoiceItem: null, payoutItem: null };
  // Earlier tests can leave queued *Once values behind (clearAllMocks keeps them).
  // Other tests swap mockPrisma.campaignAssignment out wholesale, so set ours here.
  beforeEach(() => {
    mockPrisma.link.findUnique.mockReset();
    mockPrisma.campaignAssignment = { updateMany: vi.fn(), findFirst: vi.fn(async () => null) };
  });

  it("refuses a post on an invoice, by status or by invoice item, and writes nothing", async () => {
    mockPrisma.link.findUnique.mockResolvedValueOnce({ ...LINK, status: "INVOICED" });
    await expect(deleteLink("l1")).rejects.toMatchObject({ statusCode: 409, code: "ALREADY_INVOICED" });
    mockPrisma.link.findUnique.mockResolvedValueOnce({ ...LINK, status: "INSIGHTS_APPROVED", invoiceItem: { id: "ii1" } });
    await expect(deleteLink("l1")).rejects.toMatchObject({ statusCode: 409, code: "ALREADY_INVOICED" });
    expect(mockPrisma.link.delete).not.toHaveBeenCalled();
  });

  it("refuses a post on a vendor payout", async () => {
    mockPrisma.link.findUnique.mockResolvedValueOnce({ ...LINK, payoutItem: { id: "pi1" } });
    await expect(deleteLink("l1")).rejects.toMatchObject({ statusCode: 409, code: "ON_PAYOUT" });
    expect(mockPrisma.link.delete).not.toHaveBeenCalled();
  });

  it("404s an unknown post", async () => {
    mockPrisma.link.findUnique.mockResolvedValueOnce(null);
    await expect(deleteLink("nope")).rejects.toMatchObject({ statusCode: 404 });
  });

  it("unlinks the sheet row, deletes the post (history cascades) and recomputes the page's quota", async () => {
    mockPrisma.link.findUnique.mockResolvedValueOnce({ ...LINK, status: "INVALID" });
    mockPrisma.campaignAssignment.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.link.delete.mockResolvedValue({ id: "l1" });
    await expect(deleteLink("l1")).resolves.toEqual({ id: "l1" });
    expect(mockPrisma.campaignAssignment.updateMany).toHaveBeenCalledWith({ where: { linkId: "l1" }, data: { linkId: null } });
    expect(mockPrisma.link.delete).toHaveBeenCalledWith({ where: { id: "l1" } });
    expect(recomputePostQuota).toHaveBeenCalledWith("c1", "a1");
  });
});

describe("createLink on a Reel + Story combo page (14 Oct)", () => {
  const page = { id: "asset-1", ownerId: "creator-1", rateCards: [{ format: "reel", amount: 20000 }, { format: "story", amount: 15000 }] };
  const creator = { id: "creator-1", role: "CREATOR" };
  let tx;

  // `slots` are the page's open combo slots across the phase's rows ("c1" and
  // its extra-post row "c1-p2"); `slot` is shorthand for one on "c1".
  // `claimed` is what the conditional claim returns: a number for every
  // claim, or a function of the slot id (0 = someone else got it first).
  function comboCampaign({ slot, slots, claimed = 1, comboItems = [{ assetId: "asset-1", format: "reel_story" }] } = {}) {
    const open = slots ?? (slot ? [{ campaignId: "c1", ...slot }] : []);
    mockPrisma.asset.findUnique.mockResolvedValue(page);
    mockPrisma.campaign.findUnique = vi.fn(async () => ({ id: "c1", parentCampaignId: null, phaseNumber: 1 }));
    mockPrisma.campaign.findMany = vi.fn(async () => [{ id: "c1" }, { id: "c1-p2" }]);
    mockPrisma.plan.findUnique = vi.fn(async () => ({ items: comboItems }));
    mockPrisma.campaignAssignment = {
      // assertPageBooked → booked.
      findFirst: vi.fn(async () => ({ id: "booking-1" })),
      // openComboSlots → the open slots of the asked format on the asked rows.
      findMany: vi.fn(async ({ where }) => open.filter((s) => where.campaignId.in.includes(s.campaignId) && (!s.format || s.format === where.format))),
    };
    mockPrisma.link.create = vi.fn(async ({ data }) => ({ id: "rate-card-link", ...data }));
    mockPrisma.linkStatusEvent.create = vi.fn();
    tx = {
      link: { create: vi.fn(async ({ data }) => ({ id: "slot-link", ...data })) },
      campaignAssignment: { updateMany: vi.fn(async ({ where }) => ({ count: typeof claimed === "function" ? claimed(where.id) : claimed })) },
    };
    mockPrisma.$transaction = vi.fn(async (fn) => fn(tx));
  }

  it("a combo post takes the open slot's split cost and claims that slot in one transaction", async () => {
    comboCampaign({ slot: { id: "slot-reel", cost: 17142.85 } });

    const link = await createLink(creator, { campaignId: "c1", assetId: "asset-1", url: "https://ig/reel/1", format: "reel" });

    expect(link).toMatchObject({ id: "slot-link", cost: 17142.85, customRate: false, format: "reel" });
    expect(tx.campaignAssignment.updateMany).toHaveBeenCalledWith({ where: { id: "slot-reel", linkId: null }, data: { linkId: "slot-link", postUrl: "https://ig/reel/1" } });
    expect(mockPrisma.link.create).not.toHaveBeenCalled();
    // Slots are looked up across the phase's rows, for this format, unclaimed and priced.
    expect(mockPrisma.campaignAssignment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { campaignId: { in: ["c1", "c1-p2"] }, assetId: "asset-1", format: "reel", linkId: null, cost: { not: null } } })
    );
    // The page is a combo page because the root's plan has a reel_story line for it.
    expect(mockPrisma.plan.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { campaignId: "c1" } }));
    // Both combos' lines are read (16 Oct).
    expect(mockPrisma.plan.findUnique.mock.calls[0][0].select.items.where.format).toEqual({ in: ["reel_story", "repost_story"] });
  });

  // Repost + Story (16 Oct): the same slot claim, for the repost and story parts.
  describe("Repost + Story combo pages (16 Oct)", () => {
    const withRepostRate = () => mockPrisma.asset.findUnique.mockResolvedValue({ ...page, rateCards: [...page.rateCards, { format: "repost", amount: 6000 }] });

    it("a repost on a Repost + Story page claims the repost slot at its split cost", async () => {
      comboCampaign({ slots: [{ id: "slot-repost", campaignId: "c1", format: "repost", cost: 4285.71 }], comboItems: [{ assetId: "asset-1", format: "repost_story" }] });
      withRepostRate();

      const link = await createLink(creator, { campaignId: "c1", assetId: "asset-1", url: "https://ig/p/rp1", format: "repost" });

      expect(link).toMatchObject({ id: "slot-link", cost: 4285.71, format: "repost" });
      expect(tx.campaignAssignment.updateMany).toHaveBeenCalledWith({ where: { id: "slot-repost", linkId: null }, data: { linkId: "slot-link", postUrl: "https://ig/p/rp1" } });
      expect(mockPrisma.link.create).not.toHaveBeenCalled();
    });

    it("its story claims the story slot too", async () => {
      comboCampaign({ slots: [{ id: "slot-story", campaignId: "c1", format: "story", cost: 5714.29 }], comboItems: [{ assetId: "asset-1", format: "repost_story" }] });

      const link = await createLink(creator, { campaignId: "c1", assetId: "asset-1", url: "https://ig/s/rp", format: "story" });
      expect(link).toMatchObject({ id: "slot-link", cost: 5714.29 });
    });

    it("a repost on a Reel + Story-only page (and a reel on a Repost + Story-only page) is not a combo post: rate card, no slot lookup", async () => {
      comboCampaign({ slots: [{ id: "slot-repost", campaignId: "c1", format: "repost", cost: 1 }] });
      withRepostRate();
      const repost = await createLink(creator, { campaignId: "c1", assetId: "asset-1", url: "https://ig/p/rp2", format: "repost" });
      expect(repost).toMatchObject({ id: "rate-card-link", cost: 6000 });
      expect(mockPrisma.campaignAssignment.findMany).not.toHaveBeenCalled();

      comboCampaign({ slots: [{ id: "slot-reel", campaignId: "c1", format: "reel", cost: 1 }], comboItems: [{ assetId: "asset-1", format: "repost_story" }] });
      const reel = await createLink(creator, { campaignId: "c1", assetId: "asset-1", url: "https://ig/reel/rp3", format: "reel" });
      expect(reel).toMatchObject({ id: "rate-card-link", cost: 20000 });
      expect(mockPrisma.campaignAssignment.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it("a page with both combos takes reel, repost and story slots by format", async () => {
      const both = [
        { assetId: "asset-1", format: "reel_story" },
        { assetId: "asset-1", format: "repost_story" },
      ];
      comboCampaign({ slots: [{ id: "slot-repost", campaignId: "c1", format: "repost", cost: 4285.71 }, { id: "slot-reel", campaignId: "c1", format: "reel", cost: 17142.85 }], comboItems: both });
      withRepostRate();
      expect(await createLink(creator, { campaignId: "c1", assetId: "asset-1", url: "https://ig/p/b1", format: "repost" })).toMatchObject({ cost: 4285.71 });
      expect(await createLink(creator, { campaignId: "c1", assetId: "asset-1", url: "https://ig/reel/b2", format: "reel" })).toMatchObject({ cost: 17142.85 });
    });
  });

  it("a second post of the same format (no open slot left) falls back to the rate card", async () => {
    comboCampaign({ slot: null });

    const link = await createLink(creator, { campaignId: "c1", assetId: "asset-1", url: "https://ig/reel/2", format: "reel" });

    expect(link).toMatchObject({ id: "rate-card-link", cost: 20000, customRate: false });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("a slot claimed in the meantime (and no other open) rolls the insert back and falls back to the rate card", async () => {
    comboCampaign({ slot: { id: "slot-story", cost: 12857.15 }, claimed: 0 });

    const link = await createLink(creator, { campaignId: "c1", assetId: "asset-1", url: "https://ig/s/1", format: "story" });

    expect(tx.link.create).toHaveBeenCalled();
    expect(link).toMatchObject({ id: "rate-card-link", cost: 15000 });
  });

  it("an admin's custom amount still wins over the combo slot", async () => {
    comboCampaign({ slot: { id: "slot-reel", cost: 17142.85 } });

    // An admin sets a custom amount through the work import (createLink is the page owner's route).
    mockPrisma.campaign.findMany.mockResolvedValue([{ id: "c1", title: "Launch" }]);
    mockPrisma.asset.findMany.mockResolvedValue([{ ...page, handle: "demo.page" }]);
    mockPrisma.link.findFirst.mockResolvedValue(null);
    const result = await bulkImportLinks(admin, { rows: [{ campaignTitle: "Launch", pageHandle: "demo.page", url: "https://ig/reel/3", format: "reel", cost: 9999 }] });

    expect(result.created[0]).toMatchObject({ id: "rate-card-link", cost: 9999, customRate: true });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("a campaign without a plan (or a page with no combo line) is unchanged: rate card, no slot lookup", async () => {
    comboCampaign({ slot: { id: "slot-reel", cost: 1 } });
    mockPrisma.plan.findUnique = vi.fn(async () => null);

    const link = await createLink(creator, { campaignId: "c1", assetId: "asset-1", url: "https://ig/reel/4", format: "reel" });
    expect(link).toMatchObject({ id: "rate-card-link", cost: 20000 });

    // A format that isn't a combo half never even looks.
    mockPrisma.plan.findUnique.mockClear();
    page.rateCards.push({ format: "post", amount: 8000 });
    await createLink(creator, { campaignId: "c1", assetId: "asset-1", url: "https://ig/p/9", format: "post" });
    expect(mockPrisma.plan.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("bulk upload goes through the same path: the first reel claims the slot, the second is rate-card priced", async () => {
    let open = [{ id: "slot-reel", campaignId: "c1", cost: 17142.85 }];
    comboCampaign();
    mockPrisma.campaignAssignment.findMany = vi.fn(async () => {
      const s = open;
      open = [];
      return s;
    });
    mockPrisma.link.findFirst.mockResolvedValue(null);

    const result = await bulkCreateLink(creator, { campaignId: "c1", assetId: "asset-1", format: "reel", urls: ["https://ig/reel/a", "https://ig/reel/b"] });

    expect(result.created.map((l) => l.cost)).toEqual([17142.85, 20000]);
  });

  // Review fix (14 Oct): a plan with 2 posts per page puts post 2's combo
  // slots on their own row ("c1-p2"), and postQuota counts the booking over
  // the whole phase — so a second reel submitted on the root row must take
  // post 2's slot at its split price, not the full reel rate.
  it("a second combo reel on the root row claims the extra-post row's slot (split price), and the post stays on the row picked", async () => {
    comboCampaign({ slots: [{ id: "slot-reel-p2", campaignId: "c1-p2", format: "reel", cost: 17142.85 }] });

    const link = await createLink(creator, { campaignId: "c1", assetId: "asset-1", url: "https://ig/reel/p2", format: "reel" });

    expect(link).toMatchObject({ id: "slot-link", cost: 17142.85, campaignId: "c1" });
    expect(tx.campaignAssignment.updateMany).toHaveBeenCalledWith({ where: { id: "slot-reel-p2", linkId: null }, data: { linkId: "slot-link", postUrl: "https://ig/reel/p2" } });
    expect(mockPrisma.link.create).not.toHaveBeenCalled();
  });

  it("prefers the slot on the row the creator picked over an older one on another row", async () => {
    comboCampaign({
      slots: [
        { id: "slot-reel-root", campaignId: "c1", format: "reel", cost: 17142.85 },
        { id: "slot-reel-p2", campaignId: "c1-p2", format: "reel", cost: 17142.86 },
      ],
    });
    // The DB returns oldest first; the extra-post row's slot happens to be older.
    const findMany = mockPrisma.campaignAssignment.findMany;
    mockPrisma.campaignAssignment.findMany = vi.fn(async (args) => [...(await findMany(args))].reverse());

    await createLink(creator, { campaignId: "c1-p2", assetId: "asset-1", url: "https://ig/reel/x", format: "reel" });

    expect(tx.campaignAssignment.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.campaignAssignment.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "slot-reel-p2", linkId: null } }));
  });

  it("a slot claimed in the meantime moves on to the next open slot of that format instead of the rate card", async () => {
    comboCampaign({
      slots: [
        { id: "slot-story-root", campaignId: "c1", format: "story", cost: 12857.15 },
        { id: "slot-story-p2", campaignId: "c1-p2", format: "story", cost: 12857.14 },
      ],
      claimed: (id) => (id === "slot-story-root" ? 0 : 1),
    });

    const link = await createLink(creator, { campaignId: "c1", assetId: "asset-1", url: "https://ig/s/2", format: "story" });

    expect(link).toMatchObject({ id: "slot-link", cost: 12857.14 });
    expect(tx.campaignAssignment.updateMany).toHaveBeenCalledTimes(2);
    expect(mockPrisma.link.create).not.toHaveBeenCalled();
  });

  // Review fix (14 Oct): deleting a combo post frees its slot completely.
  it("deleting a post on a combo page clears the claimed slot's URL as well as its link", async () => {
    const claimed = { id: "slot-reel", campaignId: "c1", format: "reel", cost: 17142.85, linkId: "l9" };
    comboCampaign({ slots: [claimed] });
    mockPrisma.campaignAssignment.findFirst = vi.fn(async () => claimed);
    mockPrisma.link.findUnique.mockResolvedValueOnce({ id: "l9", status: "SUBMITTED", campaignId: "c1", assetId: "asset-1", invoiceItem: null, payoutItem: null });
    mockPrisma.campaignAssignment.updateMany = vi.fn(async () => ({ count: 1 }));
    mockPrisma.link.delete.mockResolvedValue({ id: "l9" });
    mockPrisma.$transaction = vi.fn(async (ops) => Promise.all(ops));

    await deleteLink("l9");

    expect(mockPrisma.campaignAssignment.updateMany).toHaveBeenCalledWith({ where: { linkId: "l9" }, data: { linkId: null, postUrl: null } });
  });

  // Review fix (16 Oct): only a combo part's slot had its URL written by a
  // claim. A regular full-price slot (or campaign-sheet row) on the same
  // combo page got its URL from the sheet — it's kept so the row can attach again.
  it("deleting a post on a combo page keeps the URL of a regular line's slot it was attached to", async () => {
    const regular = { id: "slot-reel-full", campaignId: "c1", format: "reel", cost: 20000, linkId: "l9" };
    comboCampaign({
      slots: [regular, { id: "slot-reel-combo", campaignId: "c1", format: "reel", cost: 17142.85, linkId: null }],
      comboItems: [
        { assetId: "asset-1", format: "reel", cost: 20000, postsPerProfile: 1 },
        { assetId: "asset-1", format: "reel_story", cost: 30000, postsPerProfile: 1 },
      ],
    });
    mockPrisma.campaignAssignment.findFirst = vi.fn(async () => regular);
    mockPrisma.link.findUnique.mockResolvedValueOnce({ id: "l9", status: "SUBMITTED", campaignId: "c1", assetId: "asset-1", invoiceItem: null, payoutItem: null });
    mockPrisma.campaignAssignment.updateMany = vi.fn(async () => ({ count: 1 }));
    mockPrisma.link.delete.mockResolvedValue({ id: "l9" });
    mockPrisma.$transaction = vi.fn(async (ops) => Promise.all(ops));

    await deleteLink("l9");

    expect(mockPrisma.campaignAssignment.updateMany).toHaveBeenCalledWith({ where: { linkId: "l9" }, data: { linkId: null } });
  });

  // Review fix (16 Oct): openComboSlots only offers combo slots.
  it("a combo reel never claims a regular Reel line's full-price slot, even an older one on the picked row", async () => {
    comboCampaign({
      slots: [
        { id: "slot-reel-full", campaignId: "c1", format: "reel", cost: 20000, linkId: null },
        { id: "slot-reel-combo", campaignId: "c1-p2", format: "reel", cost: 17142.85, linkId: null },
      ],
      comboItems: [
        { assetId: "asset-1", format: "reel", cost: 20000, postsPerProfile: 1 },
        { assetId: "asset-1", format: "reel_story", cost: 30000, postsPerProfile: 2 },
      ],
    });
    mockPrisma.campaign.findMany = vi.fn(async ({ select }) => (select?.postNumber ? [{ id: "c1", postNumber: 1 }, { id: "c1-p2", postNumber: 2 }] : [{ id: "c1" }, { id: "c1-p2" }]));

    const link = await createLink(creator, { campaignId: "c1", assetId: "asset-1", url: "https://ig/reel/c", format: "reel" });

    expect(link).toMatchObject({ id: "slot-link", cost: 17142.85 });
    expect(tx.campaignAssignment.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.campaignAssignment.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "slot-reel-combo", linkId: null } }));
  });

  it("with the regular slot already taken and only it left, a combo reel is priced from the rate card (and never takes it)", async () => {
    comboCampaign({
      slots: [
        { id: "slot-reel-full", campaignId: "c1", format: "reel", cost: 20000, linkId: null },
        { id: "slot-reel-combo", campaignId: "c1", format: "reel", cost: 17142.85, linkId: "earlier" },
      ],
      comboItems: [
        { assetId: "asset-1", format: "reel", cost: 20000, postsPerProfile: 1 },
        { assetId: "asset-1", format: "reel_story", cost: 30000, postsPerProfile: 1 },
      ],
    });

    const link = await createLink(creator, { campaignId: "c1", assetId: "asset-1", url: "https://ig/reel/d", format: "reel" });

    expect(link).toMatchObject({ id: "rate-card-link", cost: 20000 });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("a story on a page with both combos takes the Reel + Story story slot before the Repost + Story one, even when that one is older", async () => {
    comboCampaign({
      slots: [
        { id: "slot-story-repost", campaignId: "c1", format: "story", cost: 7500, linkId: null },
        { id: "slot-story-reel", campaignId: "c1", format: "story", cost: 12857.15, linkId: null },
      ],
      comboItems: [
        { assetId: "asset-1", format: "repost_story", cost: 10000, postsPerProfile: 1 },
        { assetId: "asset-1", format: "reel_story", cost: 30000, postsPerProfile: 1 },
      ],
    });
    mockPrisma.rateCard = { findMany: vi.fn(async () => [...page.rateCards, { format: "repost", amount: 5000 }]) };

    const link = await createLink(creator, { campaignId: "c1", assetId: "asset-1", url: "https://ig/s/both", format: "story" });

    expect(link).toMatchObject({ id: "slot-link", cost: 12857.15 });
    expect(tx.campaignAssignment.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "slot-story-reel", linkId: null } }));
  });
});
