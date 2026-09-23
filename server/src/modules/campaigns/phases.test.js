import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Phases vs extra posts, and deleting a phase (user request, 22 Sep):
 *  - a page booked for 2 reels → its 2nd post is an extra-post row of phase 1
 *    (postNumber 2): the creator sees it as the next numbered phase, admins
 *    see one phase where that page has 2 posts;
 *  - a phase added by admin / plan maker → a real phase everyone sees,
 *    starting with Phase 1's pages;
 *  - creator numbering is one running count across both kinds;
 *  - an admin can delete a phase (not Phase 1) unless posts/invoices exist.
 * Runs against a tiny in-memory stand-in for Prisma so the real queries are
 * exercised, not a scripted sequence of mock return values.
 */

let db;
function matches(row, where = {}) {
  return Object.entries(where).every(([key, cond]) => {
    if (key === "OR") return cond.some((w) => matches(row, w));
    if (key === "AND") return cond.every((w) => matches(row, w));
    if (key === "asset") return matches(db.assets.find((a) => a.id === row.assetId) ?? {}, cond);
    if (key === "campaign") return true; // plan-maker scoping isn't what these tests cover
    const value = row[key];
    if (cond === null) return value === null || value === undefined;
    if (typeof cond === "object" && !(cond instanceof Date)) {
      if ("in" in cond) return cond.in.includes(value);
      if ("not" in cond) return cond.not === null ? value !== null && value !== undefined : value !== cond.not;
      if ("gt" in cond) return value > cond.gt;
      if ("equals" in cond) return String(value).toLowerCase() === String(cond.equals).toLowerCase();
      return true;
    }
    return value === cond;
  });
}
// A nested select (e.g. postSnapshots: { take: 1 }) just passes the stored value through.
const pick = (row, select) => (select ? Object.fromEntries(Object.keys(select).map((k) => [k, k in row ? row[k] : typeof select[k] === "object" ? [] : undefined])) : { ...row });
const table = (name) => ({
  findMany: vi.fn(async ({ where, select } = {}) => db[name].filter((r) => matches(r, where)).map((r) => pick(r, select))),
  findUnique: vi.fn(async ({ where, select }) => {
    const r = db[name].find((x) => x.id === where.id);
    return r ? pick(r, select) : null;
  }),
  findFirst: vi.fn(async ({ where, select } = {}) => {
    const r = db[name].find((x) => matches(x, where));
    return r ? pick(r, select) : null;
  }),
  count: vi.fn(async ({ where } = {}) => db[name].filter((r) => matches(r, where)).length),
  create: vi.fn(async ({ data }) => {
    const { assignments, ...rest } = data;
    const row = { id: `new-${db[name].length + 1}`, parentCampaignId: null, phaseNumber: 1, postNumber: 1, createdAt: new Date(), ...rest };
    db[name].push(row);
    for (const a of assignments?.create ?? []) db.campaignAssignments.push({ id: `a-${db.campaignAssignments.length + 1}`, campaignId: row.id, ...a });
    return row;
  }),
  update: vi.fn(async ({ where, data }) => Object.assign(db[name].find((x) => x.id === where.id), data)),
  deleteMany: vi.fn(async ({ where }) => {
    const before = db[name].length;
    db[name] = db[name].filter((r) => !matches(r, where));
    if (name === "campaigns") db.campaignAssignments = db.campaignAssignments.filter((a) => db.campaigns.some((c) => c.id === a.campaignId));
    return { count: before - db[name].length };
  }),
});

const mockPrisma = {
  campaign: table("campaigns"),
  campaignAssignment: {
    ...table("campaignAssignments"),
    findMany: vi.fn(async ({ where, select, include } = {}) =>
      db.campaignAssignments
        .filter((r) => matches(r, where))
        .map((r) => (include ? { ...r, campaign: { postNumber: db.campaigns.find((c) => c.id === r.campaignId)?.postNumber ?? 1 }, asset: null, link: null } : pick(r, select)))
    ),
  },
  link: {
    ...table("links"),
    // listLinks includes each link's campaign row.
    findMany: vi.fn(async ({ where, select, include } = {}) =>
      db.links.filter((r) => matches(r, where)).map((r) => (include ? { ...r, campaign: db.campaigns.find((c) => c.id === r.campaignId) ?? null, asset: null, screenshot: null, invoiceItem: null, postSnapshots: [] } : pick(r, select)))
    ),
  },
  invoice: {
    ...table("invoices"),
    findMany: vi.fn(async ({ where } = {}) => db.invoices.filter((r) => matches(r, where)).map((r) => ({ ...r, items: [], creator: null, campaign: null, raisedBy: null }))),
  },
  asset: table("assets"),
  user: table("users"),
  $transaction: vi.fn(async (arg) => (Array.isArray(arg) ? Promise.all(arg) : arg(mockPrisma))),
  // createPhase/deletePhase lock the campaign's root row first (SELECT … FOR UPDATE).
  $queryRaw: vi.fn(async () => []),
};
vi.mock("../../lib/prisma.js", () => ({ prisma: mockPrisma }));
vi.mock("../../lib/cloudinaryClient.js", () => ({ publicUrlFor: vi.fn(() => null) }));
vi.mock("../scraping/service.js", () => ({ refreshLinkMetrics: vi.fn() }));
vi.mock("../notifications/service.js", () => ({ notify: vi.fn() }));
vi.mock("../billing/service.js", () => ({ getApprovedForUser: vi.fn() }));
const canPlanMakerAccessCampaign = vi.fn(async () => true);
vi.mock("../../lib/campaignAccess.js", () => ({
  campaignVisibilityWhere: () => ({}),
  planMakerCampaignWhere: () => ({}),
  canPlanMakerAccessCampaign: (...a) => canPlanMakerAccessCampaign(...a),
}));

const { listCampaigns, getCampaignById, createPhase, deletePhase, listAssignments } = await import("./service.js");
const { listLinks } = await import("../links/service.js");
const { listInvoices } = await import("../invoices/service.js");
const { creatorPhaseNumberIn, creatorPhaseTitle } = await import("../../lib/campaignPhases.js");

const admin = { id: "admin-1", role: "ADMIN" };
const creatorA = { id: "creator-a", role: "CREATOR" };
const creatorB = { id: "creator-b", role: "CREATOR" };
const t0 = new Date("2026-09-01T00:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  canPlanMakerAccessCampaign.mockResolvedValue(true);
  mockPrisma.$transaction.mockImplementation(async (arg) => (Array.isArray(arg) ? Promise.all(arg) : arg(mockPrisma)));
  // "Diwali": phase 1 where page A is booked for 2 reels (an extra-post row),
  // plus a real phase 2 (pages A and B).
  db = {
    campaigns: [
      { id: "root", title: "Diwali", brandName: "Acme", parentCampaignId: null, phaseNumber: 1, postNumber: 1, costCap: 50000, sheetLink: null, createdAt: t0 },
      { id: "p1-post2", title: "Diwali", brandName: "Acme", parentCampaignId: "root", phaseNumber: 1, postNumber: 2, costCap: null, createdAt: t0 },
      { id: "phase2", title: "Diwali — Phase 2", brandName: "Acme", parentCampaignId: "root", phaseNumber: 2, postNumber: 1, costCap: null, createdAt: new Date("2026-09-10") },
    ],
    assets: [
      { id: "asset-a", ownerId: "creator-a", handle: "page.a" },
      { id: "asset-b", ownerId: "creator-b", handle: "page.b" },
    ],
    // Read fresh by campaigns/service.js's view-scoping checks (23 Sep,
    // Step 3) — every requester used below needs a row here now.
    users: [
      { id: "admin-1", role: "ADMIN", permissions: null },
      { id: "creator-a", role: "CREATOR", permissions: null },
      { id: "creator-b", role: "CREATOR", permissions: null },
    ],
    campaignAssignments: [
      { id: "as1", campaignId: "root", assetId: "asset-a", pageHandle: "page.a", format: "reel", cost: 5000, status: "matched", creatorPhone: null },
      { id: "as2", campaignId: "root", assetId: "asset-b", pageHandle: "page.b", format: "reel", cost: 4000, status: "matched", creatorPhone: null },
      { id: "as3", campaignId: "p1-post2", assetId: "asset-a", pageHandle: "page.a", format: "reel", cost: 5000, status: "matched", creatorPhone: null },
      { id: "as4", campaignId: "phase2", assetId: "asset-a", pageHandle: "page.a", format: "reel", cost: 5000, status: "matched", creatorPhone: null },
      { id: "as5", campaignId: "phase2", assetId: "asset-b", pageHandle: "page.b", format: "reel", cost: 4000, status: "matched", creatorPhone: null },
    ],
    links: [
      { id: "l1", campaignId: "root", assetId: "asset-a", cost: 5000, status: "SUBMITTED", postedAt: null, createdAt: t0, postSnapshots: [] },
      { id: "l2", campaignId: "p1-post2", assetId: "asset-a", cost: 5000, status: "SUBMITTED", postedAt: null, createdAt: t0, postSnapshots: [] },
    ],
    invoices: [],
  };
});

describe("creator running count", () => {
  it("numbers phase 1's posts, then later phases, in one sequence", () => {
    const group = [
      { id: "phase2", phaseNumber: 2, postNumber: 1 },
      { id: "root", phaseNumber: 1, postNumber: 1 },
      { id: "p1-post2", phaseNumber: 1, postNumber: 2 },
    ];
    expect(["root", "p1-post2", "phase2"].map((id) => creatorPhaseNumberIn(group, id))).toEqual([1, 2, 3]);
    expect(creatorPhaseTitle("Diwali", 1)).toBe("Diwali");
    expect(creatorPhaseTitle("Diwali", 3)).toBe("Diwali — Phase 3");
  });
});

describe("admin view — an extra post is a 2nd post of its phase, not a phase", () => {
  it("the campaign list counts real phases only, and phase 1's card includes the page's second post", async () => {
    const [card] = await listCampaigns({}, admin);
    expect(card.phaseCount).toBe(2);
    expect(card.postCount).toBe(2);
  });

  it("the campaign page lists real phases only, and phase 1 includes the extra post's links and pages", async () => {
    const c = await getCampaignById("root", admin);
    expect(c.phases.map((p) => p.phaseNumber)).toEqual([1, 2]);
    expect(c.postCount).toBe(2);
    const assignments = await listAssignments("root", admin);
    expect(assignments.map((a) => [a.pageHandle, a.postNumber])).toEqual([
      ["page.a", 1],
      ["page.b", 1],
      ["page.a", 2],
    ]);
  });

  it("opening the extra-post row directly answers with the phase it belongs to (so tabs, invoices and Edit act on Phase 1)", async () => {
    const c = await getCampaignById("p1-post2", admin);
    expect(c.id).toBe("root");
    expect(c.postCount).toBe(2);
    expect(c.phases.map((p) => p.id)).toEqual(["root", "phase2"]);
  });

  it("the phase's invoices include one raised on its extra post; a creator's filter stays exact", async () => {
    db.invoices.push({ id: "inv-post2", campaignId: "p1-post2", creatorId: "creator-a", status: "RAISED", dueDate: null }, { id: "inv-other", campaignId: "phase2", creatorId: "creator-b", status: "RAISED", dueDate: null });
    const forAdmin = await listInvoices(admin, { page: 1, pageSize: 50, campaignId: "root" });
    expect(forAdmin.items.map((i) => i.id)).toEqual(["inv-post2"]);
    const forCreator = await listInvoices(creatorA, { page: 1, pageSize: 50, campaignId: "root" });
    expect(forCreator.items).toEqual([]);
  });

  it("the attached sheet keeps pending rows after matched ones, and a page's post 2 right after its post 1", async () => {
    db.campaignAssignments.unshift({ id: "as-pend", campaignId: "root", assetId: null, pageHandle: "unmatched.page", status: "pending", createdAt: t0 });
    const rows = await listAssignments("root", admin);
    expect(rows.map((a) => [a.status, a.pageHandle, a.postNumber])).toEqual([
      ["matched", "page.a", 1],
      ["matched", "page.b", 1],
      ["matched", "page.a", 2],
      ["pending", "unmatched.page", 1],
    ]);
  });
});

describe("creator view — every row is its own numbered phase", () => {
  it("a creator booked for 2 posts + phase 2 gets Phase 1, 2, 3 in their campaign list (what Upload links offers)", async () => {
    const list = await listCampaigns({}, creatorA);
    expect(list.map((c) => [c.id, c.creatorPhaseNumber, c.title])).toEqual([
      ["root", 1, "Diwali"],
      ["p1-post2", 2, "Diwali — Phase 2"],
      ["phase2", 3, "Diwali — Phase 3"],
    ]);
    // Their Phase 1 entry counts only phase 1's own post, not the extra one.
    expect(list[0].postCount).toBe(1);
  });

  it("a creator with one post per phase counts only their own rows — another page's 2nd reel leaves no gap (Phase 1, 2)", async () => {
    const list = await listCampaigns({}, creatorB);
    expect(list.map((c) => [c.id, c.creatorPhaseNumber, c.title])).toEqual([
      ["root", 1, "Diwali"],
      ["phase2", 2, "Diwali — Phase 2"],
    ]);
    // …and the campaign page agrees: "Phase 2 of 2", not "Phase 3 of 2".
    const page = await getCampaignById("phase2", creatorB);
    expect(page).toMatchObject({ creatorPhaseNumber: 2, title: "Diwali — Phase 2" });
    expect(page.phases.map((p) => p.phaseNumber)).toEqual([1, 2]);
    // …and so do their links.
    db.links.push({ id: "lb", campaignId: "phase2", assetId: "asset-b", cost: 4000, status: "SUBMITTED", postedAt: null, createdAt: t0, postSnapshots: [] });
    const { items } = await listLinks(creatorB, { page: 1, pageSize: 50 });
    expect(items.find((l) => l.id === "lb").campaign).toMatchObject({ title: "Diwali — Phase 2", creatorPhaseNumber: 2 });
  });

  it("the campaign page shows the creator their own number and title", async () => {
    const c = await getCampaignById("p1-post2", creatorA);
    expect(c).toMatchObject({ creatorPhaseNumber: 2, title: "Diwali — Phase 2", phaseNumber: 2, postCount: 1 });
    expect(c.phases.map((p) => p.phaseNumber)).toEqual([1, 2, 3]);
  });
});

describe("createPhase — a real phase, starting with Phase 1's pages", () => {
  it("numbers after the last real phase (extra posts don't count) and copies each Phase 1 page once, with no submitted post", async () => {
    db.campaignAssignments.push({ id: "as-dup", campaignId: "root", assetId: "asset-a", pageHandle: "page.a", format: "story", cost: 2000, status: "matched", postUrl: "https://x", linkId: "l1" });
    db.campaignAssignments.push({ id: "as-pending", campaignId: "root", assetId: null, pageHandle: "unknown.page", status: "pending" });

    const phase = await createPhase("root", {}, admin);

    expect(phase).toMatchObject({ phaseNumber: 3, postNumber: 1, parentCampaignId: "root", title: "Diwali — Phase 3" });
    const copied = db.campaignAssignments.filter((a) => a.campaignId === phase.id);
    expect(copied.map((a) => a.assetId).sort()).toEqual(["asset-a", "asset-b"]);
    expect(copied.every((a) => a.status === "matched" && !a.postUrl && !a.linkId)).toBe(true);
  });

  it("a plan maker can add a phase to their own plan's campaign, but gets a 404 for anyone else's", async () => {
    const planMaker = { id: "pm-1", role: "PLAN_MAKER" };
    await expect(createPhase("root", {}, planMaker)).resolves.toMatchObject({ phaseNumber: 3 });
    canPlanMakerAccessCampaign.mockResolvedValueOnce(false);
    await expect(createPhase("root", {}, planMaker)).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("deletePhase", () => {
  it("won't delete Phase 1 (the campaign itself)", async () => {
    await expect(deletePhase("root")).rejects.toMatchObject({ statusCode: 400, code: "CANNOT_DELETE_FIRST_PHASE" });
  });

  it("refuses while posts or invoices are on the phase (including its extra posts), deleting nothing", async () => {
    db.links.push({ id: "l3", campaignId: "phase2", assetId: "asset-b", cost: 4000, status: "SUBMITTED" });
    await expect(deletePhase("phase2")).rejects.toMatchObject({ statusCode: 409, code: "PHASE_HAS_POSTS", message: expect.stringContaining("1 submitted post") });
    expect(db.campaigns.some((c) => c.id === "phase2")).toBe(true);

    db.links = db.links.filter((l) => l.id !== "l3");
    db.invoices.push({ id: "inv-1", campaignId: "phase2" });
    await expect(deletePhase("phase2")).rejects.toMatchObject({ code: "PHASE_HAS_POSTS", message: expect.stringContaining("1 invoice") });
  });

  it("deletes an empty phase with its extra posts and pages, and moves later phases up a number (renaming auto titles)", async () => {
    db.campaigns.push(
      { id: "phase2-post2", title: "Diwali", parentCampaignId: "root", phaseNumber: 2, postNumber: 2, createdAt: t0 },
      { id: "phase3", title: "Diwali — Phase 3", parentCampaignId: "root", phaseNumber: 3, postNumber: 1, createdAt: t0 },
      { id: "phase4", title: "Custom name", parentCampaignId: "root", phaseNumber: 4, postNumber: 1, createdAt: t0 }
    );

    const result = await deletePhase("phase2");

    expect(result).toEqual({ deleted: 2, rootId: "root" });
    expect(db.campaigns.map((c) => c.id)).toEqual(["root", "p1-post2", "phase3", "phase4"]);
    expect(db.campaignAssignments.some((a) => a.campaignId === "phase2")).toBe(false);
    expect(db.campaigns.find((c) => c.id === "phase3")).toMatchObject({ phaseNumber: 2, title: "Diwali — Phase 2" });
    expect(db.campaigns.find((c) => c.id === "phase4")).toMatchObject({ phaseNumber: 3, title: "Custom name" });
    // Phase 1's extra post is untouched.
    expect(db.campaigns.find((c) => c.id === "p1-post2")).toMatchObject({ phaseNumber: 1, postNumber: 2 });
  });

  it("404s on an unknown phase", async () => {
    await expect(deletePhase("nope")).rejects.toMatchObject({ statusCode: 404 });
  });

  it("locks the campaign first, and a second delete of the same phase can't take out the phase renumbered into its place", async () => {
    db.campaigns.push({ id: "phase3", title: "Diwali — Phase 3", parentCampaignId: "root", phaseNumber: 3, postNumber: 1, createdAt: t0 });
    // The second request read the phase before the first one deleted it.
    const staleRead = { ...db.campaigns.find((c) => c.id === "phase2") };
    await deletePhase("phase2");
    expect(mockPrisma.$queryRaw).toHaveBeenCalled();
    mockPrisma.campaign.findUnique.mockResolvedValueOnce(staleRead); // its outside-the-lock read
    await expect(deletePhase("phase2")).rejects.toMatchObject({ statusCode: 404 });
    // Phase 3 (now Phase 2) survived.
    expect(db.campaigns.find((c) => c.id === "phase3")).toMatchObject({ phaseNumber: 2 });
  });
});

describe("links on a phase", () => {
  const filters = { page: 1, pageSize: 50, campaignId: "root" };

  it("an admin's phase-1 post list includes the page's second post (\"submitted twice\")", async () => {
    const { items } = await listLinks(admin, filters);
    expect(items.map((l) => [l.id, l.campaign.postNumber])).toEqual([
      ["l1", 1],
      ["l2", 2],
    ]);
  });

  it("a creator's own links carry their running-count phase title", async () => {
    const { items } = await listLinks(creatorA, { page: 1, pageSize: 50 });
    const byId = Object.fromEntries(items.map((l) => [l.id, l.campaign]));
    expect(byId.l1).toMatchObject({ title: "Diwali", creatorPhaseNumber: 1 });
    expect(byId.l2).toMatchObject({ title: "Diwali — Phase 2", creatorPhaseNumber: 2 });
  });

  it("a creator asking for one numbered row gets exactly that row, not the whole phase", async () => {
    const { items } = await listLinks(creatorA, { ...filters, campaignId: "p1-post2" });
    expect(items.map((l) => l.id)).toEqual(["l2"]);
  });
});
