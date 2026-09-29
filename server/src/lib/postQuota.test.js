import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./prisma.js", () => ({ prisma: {} }));
const { recomputePostQuota } = await import("./postQuota.js");

// A phase of one campaign: the root row plus a second post row. `booked` is
// how many assignment slots the page has across them; links are the posts.
let db;
let links;
let bookedSlots;
const day = (d) => new Date(`2026-09-${String(d).padStart(2, "0")}T00:00:00Z`);

function fakeDb() {
  return {
    campaign: {
      findUnique: vi.fn(async () => ({ id: "root", parentCampaignId: null, phaseNumber: 1 })),
      findMany: vi.fn(async () => [{ id: "root" }, { id: "post2" }]),
    },
    campaignAssignment: {
      count: vi.fn(async () => bookedSlots),
      findMany: vi.fn(async () => (bookedSlots > 0 ? [{ assetId: "page-a" }] : [])),
    },
    link: {
      findMany: vi.fn(async ({ distinct } = {}) => (distinct ? [...new Set(links.map((l) => l.assetId))].map((assetId) => ({ assetId })) : links.map((l) => ({ ...l })))),
      updateMany: vi.fn(async ({ where, data }) => {
        for (const l of links) if (where.id.in.includes(l.id)) Object.assign(l, data);
        return { count: where.id.in.length };
      }),
    },
  };
}

const link = (id, over = {}) => ({ id, assetId: "page-a", postedAt: null, createdAt: day(1), overQuota: false, ...over });
const flagged = () => links.filter((l) => l.overQuota).map((l) => l.id).sort();

beforeEach(() => {
  db = fakeDb();
});

describe("recomputePostQuota — the first N by posted date count, the rest are over quota (29 Sep)", () => {
  it("booked 2, posted 5: the 3 latest are flagged", async () => {
    bookedSlots = 2;
    links = [link("l1", { postedAt: day(1) }), link("l2", { postedAt: day(2) }), link("l3", { postedAt: day(3) }), link("l4", { postedAt: day(4) }), link("l5", { postedAt: day(5) })];

    await recomputePostQuota("root", "page-a", db);

    expect(flagged()).toEqual(["l3", "l4", "l5"]);
  });

  it("orders by posted date, not by submission order", async () => {
    bookedSlots = 1;
    // Submitted first, but posted last — so it's the extra one.
    links = [link("early-submit", { createdAt: day(1), postedAt: day(20) }), link("late-submit", { createdAt: day(5), postedAt: day(3) })];

    await recomputePostQuota("root", "page-a", db);

    expect(flagged()).toEqual(["early-submit"]);
  });

  it("a post with no posted date yet sorts by when it was submitted", async () => {
    bookedSlots = 1;
    links = [link("unscraped", { createdAt: day(2), postedAt: null }), link("scraped", { createdAt: day(1), postedAt: day(9) })];

    await recomputePostQuota("root", "page-a", db);

    // day(2) submission beats a day(9) post.
    expect(flagged()).toEqual(["scraped"]);
  });

  it("a later scrape filling in postedAt can change which posts count — recomputing moves the flag", async () => {
    bookedSlots = 1;
    links = [link("a", { createdAt: day(1) }), link("b", { createdAt: day(2) })];
    await recomputePostQuota("root", "page-a", db);
    expect(flagged()).toEqual(["b"]);

    // Insights land: "a" was actually posted after "b".
    links.find((l) => l.id === "a").postedAt = day(10);
    links.find((l) => l.id === "b").postedAt = day(3);
    await recomputePostQuota("root", "page-a", db);

    expect(flagged()).toEqual(["a"]);
  });

  it("a page with no booking in the phase is left uncapped — no limit set is not a limit of zero", async () => {
    bookedSlots = 0;
    links = [link("l1"), link("l2")];

    await recomputePostQuota("root", "page-a", db);

    expect(flagged()).toEqual([]);
  });

  it("growing the booking clears flags that no longer apply", async () => {
    bookedSlots = 1;
    links = [link("l1", { postedAt: day(1) }), link("l2", { postedAt: day(2), overQuota: true })];

    bookedSlots = 2; // admin adds a second slot
    await recomputePostQuota("root", "page-a", db);

    expect(flagged()).toEqual([]);
  });

  it("writes nothing when every flag is already right", async () => {
    bookedSlots = 1;
    links = [link("l1", { postedAt: day(1) }), link("l2", { postedAt: day(2), overQuota: true })];

    await recomputePostQuota("root", "page-a", db);

    expect(db.link.updateMany).not.toHaveBeenCalled();
  });

  it("counts the whole phase, not just the row it was called with", async () => {
    bookedSlots = 2;
    links = [link("l1", { postedAt: day(1) })];

    await recomputePostQuota("post2", "page-a", db);

    expect(db.campaignAssignment.count).toHaveBeenCalledWith({ where: { campaignId: { in: ["root", "post2"] }, assetId: "page-a" } });
  });
});

// Review finding (29 Sep): ranking only by posted date let a post scraped later
// jump ahead of one already paid, flag it and free its slot — so two posts got
// paid against a booking of one. A paid post now holds its slot for good.
describe("recomputePostQuota — a paid post keeps its slot", () => {
  const paidInvoice = { invoiceItem: { invoice: { status: "PAID" } } };

  it("a later scrape that dates another post earlier can't displace a paid one", async () => {
    bookedSlots = 1;
    // A: paid, never scraped, so it sorts on its day-3 submission.
    // B: scraped afterwards, posted on day 1 — earlier than A by date.
    links = [link("A", { createdAt: day(3), ...paidInvoice }), link("B", { createdAt: day(4), postedAt: day(1) })];

    await recomputePostQuota("root", "page-a", db);

    expect(flagged()).toEqual(["B"]); // not A — and so B stays unpayable
  });

  it("a paid post is never flagged, even when more were paid than booked", async () => {
    bookedSlots = 1;
    links = [link("p1", { postedAt: day(1), ...paidInvoice }), link("p2", { postedAt: day(2), payoutItem: { payout: { status: "PAID" } } }), link("open", { postedAt: day(3) })];

    await recomputePostQuota("root", "page-a", db);

    expect(flagged()).toEqual(["open"]);
  });

  it("a raised invoice or a draft payout isn't paid yet — those posts still compete for slots", async () => {
    bookedSlots = 1;
    links = [
      link("first", { postedAt: day(1) }),
      link("raised", { postedAt: day(2), invoiceItem: { invoice: { status: "RAISED" } } }),
      link("drafted", { postedAt: day(3), payoutItem: { payout: { status: "DRAFT" } } }),
    ];

    await recomputePostQuota("root", "page-a", db);

    expect(flagged()).toEqual(["drafted", "raised"]);
  });
});
