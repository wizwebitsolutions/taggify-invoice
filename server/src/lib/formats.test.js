import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  FORMATS,
  BOOKABLE_FORMATS,
  REQUIRED_RATE_FORMATS,
  COMBOS,
  COMBO_PART_FORMATS,
  isCombo,
  comboParts,
  FORMAT_LABELS,
  formatSchema,
  bookableFormatSchema,
  formatLabel,
  isReelLike,
  postsPerUnit,
  formatFromText,
  exactFormatAlias,
} from "./formats.js";
import { createLinkSchema, bulkCreateLinkSchema, bulkImportRowSchema } from "../modules/links/schemas.js";
import { rateCardEntrySchema } from "../modules/assets/schemas.js";
import { campaignAssignmentRowSchema } from "../modules/campaigns/schemas.js";
import { invoiceToDocument } from "./invoicePdf.js";
import { clientInvoiceToDocument } from "./clientInvoicePdf.js";
import { linkRecord } from "./financeRecords.js";
import { buildPlanSheetTabs } from "./planSheet.js";

describe("ten page costs (16 Oct)", () => {
  it("the lists, in the agreed order", () => {
    expect(FORMATS).toEqual(["reel", "entertainment", "pr", "political_reel", "post", "repost", "story", "political_story", "reel_story", "repost_story"]);
    expect(BOOKABLE_FORMATS).toEqual(["reel", "entertainment", "pr", "political_reel", "post", "repost", "story", "political_story"]);
    // No rate is mandatory (16 Oct, later): pages and plan lines work with any rates or none.
    expect(REQUIRED_RATE_FORMATS).toEqual([]);
    expect(COMBOS).toEqual({ reel_story: ["reel", "story"], repost_story: ["repost", "story"] });
    expect(COMBO_PART_FORMATS).toEqual(["reel", "story", "repost"]);
    expect(FORMAT_LABELS).toEqual({
      reel: "Reel",
      entertainment: "Entertainment / Brand",
      pr: "PR",
      political_reel: "Political",
      post: "Static & Carousel",
      repost: "Repost",
      story: "Story",
      political_story: "Political Story",
      reel_story: "Reel + Story",
      repost_story: "Repost + Story",
    });
    expect(Object.keys(FORMAT_LABELS)).toEqual(FORMATS);
  });

  it("isCombo / comboParts", () => {
    expect(isCombo("reel_story")).toBe(true);
    expect(isCombo("repost_story")).toBe(true);
    for (const f of [...BOOKABLE_FORMATS, "carousel", "", null, undefined, "toString", "__proto__"]) expect(isCombo(f)).toBe(false);
    expect(comboParts("reel_story")).toEqual(["reel", "story"]);
    expect(comboParts("repost_story")).toEqual(["repost", "story"]);
    expect(comboParts("reel")).toBeNull();
  });

  it("formatSchema takes all ten, bookableFormatSchema only the eight that are posted as links", () => {
    for (const f of FORMATS) expect(formatSchema.safeParse(f).success).toBe(true);
    expect(formatSchema.safeParse("carousel").success).toBe(false);
    expect(bookableFormatSchema.safeParse("reel_story").success).toBe(false);
    expect(bookableFormatSchema.safeParse("repost_story").success).toBe(false);
    for (const f of ["political_reel", "repost", "pr", "entertainment", "political_story"]) expect(bookableFormatSchema.safeParse(f).success).toBe(true);
  });

  it("labels — legacy carousel reads as Static & Carousel, unknown keys stay readable", () => {
    expect(formatLabel("post")).toBe("Static & Carousel");
    expect(formatLabel("political_reel")).toBe("Political");
    expect(formatLabel("reel_story")).toBe("Reel + Story");
    expect(formatLabel("repost_story")).toBe("Repost + Story");
    expect(formatLabel("carousel")).toBe("Static & Carousel");
    expect(formatLabel("Carousel")).toBe("Static & Carousel");
    expect(formatLabel("video")).toBe("Video");
    expect(formatLabel(null)).toBe("");
  });

  it("isReelLike and postsPerUnit", () => {
    expect(isReelLike("reel")).toBe(true);
    expect(isReelLike("political_reel")).toBe(true);
    expect(isReelLike("story")).toBe(false);
    expect(postsPerUnit("reel_story")).toBe(2);
    expect(postsPerUnit("repost_story")).toBe(2);
    expect(postsPerUnit("reel")).toBe(1);
    expect(postsPerUnit("repost")).toBe(1);
  });

  it("formatFromText resolves sheet aliases (case, spacing, plurals, a rate/cost/price/amount suffix)", () => {
    const cases = {
      Reel: "reel",
      reels: "reel",
      "Reel Rate": "reel",
      Entertainment: "entertainment",
      Brand: "entertainment",
      "Entertainment/Brand": "entertainment",
      "Entertainment / Brand Rate": "entertainment",
      "entertainment & brand": "entertainment",
      "Brand reel cost": "entertainment",
      PR: "pr",
      "P.R.": "pr",
      "PR reel": "pr",
      "PR Rate": "pr",
      "Public Relations": "pr",
      Story: "story",
      Stories: "story",
      "story cost": "story",
      Static: "post",
      Carousel: "post",
      post: "post",
      Posts: "post",
      "Static/Carousel": "post",
      "Static / Carousel Rate": "post",
      "Static & Carousel Rate": "post",
      "static and carousel": "post",
      "static or carousel": "post",
      "Static post": "post",
      Image: "post",
      "Feed post": "post",
      Repost: "repost",
      Reposts: "repost",
      "Re-post": "repost",
      "Repost price": "repost",
      Political: "political_reel",
      "Political Rate": "political_reel",
      "Political Reel": "political_reel",
      "political reels": "political_reel",
      "Political Reel Price": "political_reel",
      "Political Story": "political_story",
      "Political Stories": "political_story",
      "Political Story Rate": "political_story",
      "Reel + Story": "reel_story",
      "reel+story": "reel_story",
      "Reel & Story": "reel_story",
      "reel and story": "reel_story",
      "Reel/Story combo": "reel_story",
      Combo: "reel_story",
      "Reel + Story Rate": "reel_story",
      "Repost + Story": "repost_story",
      "repost+story": "repost_story",
      "Repost & Story": "repost_story",
      "repost and story": "repost_story",
      "Repost + Story Rate": "repost_story",
      "  REEL  ": "reel",
    };
    for (const [text, key] of Object.entries(cases)) expect([text, formatFromText(text)]).toEqual([text, key]);
    for (const text of ["video", "", null, "post link", "rate", "collaboration"]) expect(formatFromText(text)).toBeNull();
  });

  it("exactFormatAlias: whole string only — no plurals, no suffix, and a longer name never reads as its prefix", () => {
    expect(exactFormatAlias("Political Story")).toBe("political_story");
    expect(exactFormatAlias("Political")).toBe("political_reel");
    expect(exactFormatAlias("Repost + Story")).toBe("repost_story");
    expect(exactFormatAlias("Repost")).toBe("repost");
    expect(exactFormatAlias("Static & Carousel")).toBe("post");
    expect(exactFormatAlias("PR")).toBe("pr");
    for (const text of ["Reels", "Reel Rate", "Reposts", "Political Stories", null]) expect(exactFormatAlias(text)).toBeNull();
  });
});

describe("which writes take which formats (14 Oct, combos 16 Oct)", () => {
  const link = { campaignId: "c", assetId: "a", url: "https://instagram.com/p/x" };

  it("links take the bookable eight, never a combo or an unknown format", () => {
    expect(createLinkSchema.safeParse({ ...link, format: "post" }).success).toBe(true);
    expect(createLinkSchema.safeParse({ ...link, format: "political_reel" }).success).toBe(true);
    expect(createLinkSchema.safeParse({ ...link, format: "repost" }).success).toBe(true);
    expect(createLinkSchema.safeParse({ ...link, format: "reel_story" }).success).toBe(false);
    expect(createLinkSchema.safeParse({ ...link, format: "repost_story" }).success).toBe(false);
    expect(createLinkSchema.safeParse({ ...link, format: "video" }).success).toBe(false);
    expect(bulkCreateLinkSchema.safeParse({ campaignId: "c", assetId: "a", urls: [link.url], format: "reel_story" }).success).toBe(false);
    expect(bulkImportRowSchema.safeParse({ campaignTitle: "C", pageHandle: "p", url: link.url, format: "reel_story" }).success).toBe(false);
  });

  it("rate cards take all ten", () => {
    for (const f of FORMATS) expect(rateCardEntrySchema.safeParse({ format: f, amount: 100 }).success).toBe(true);
    expect(rateCardEntrySchema.safeParse({ format: "VOXPOP", amount: 100 }).success).toBe(false);
  });

  it("a campaign-sheet row booked as a combo gets a clear 'one row per post' message", () => {
    const row = { handle: "x", postUrl: "https://instagram.com/p/x" };
    expect(campaignAssignmentRowSchema.safeParse({ ...row, format: "post" }).success).toBe(true);
    expect(campaignAssignmentRowSchema.safeParse({ ...row, format: "carousel" }).success).toBe(false);
    const combo = campaignAssignmentRowSchema.safeParse({ ...row, format: "reel_story" });
    expect(combo.success).toBe(false);
    expect(combo.error.issues[0]).toMatchObject({ path: ["format"], message: "Reel + Story is two posts: use one row per post (Reel and Story)" });
    const repostCombo = campaignAssignmentRowSchema.safeParse({ ...row, format: "repost_story" });
    expect(repostCombo.success).toBe(false);
    expect(repostCombo.error.issues[0]).toMatchObject({ path: ["format"], message: "Repost + Story is two posts: use one row per post (Repost and Story)" });
    expect(campaignAssignmentRowSchema.safeParse({ ...row, format: "repost" }).success).toBe(true);
  });
});

describe("exports print the format's label (14 Oct, relabelled 16 Oct)", () => {
  it("creator invoice lines", () => {
    const d = invoiceToDocument({
      invoiceNumber: "INV-1",
      createdAt: new Date("2026-10-01"),
      status: "RAISED",
      isGstInvoice: false,
      subtotal: 300,
      gstAmount: 0,
      amount: 300,
      creator: { name: "C" },
      campaign: { title: "Launch" },
      billingProfile: null,
      items: [
        { amount: 100, link: { format: "post", asset: { handle: "a" }, campaign: { title: "Launch" } } },
        { amount: 100, link: { format: "political_reel", asset: { handle: "a" }, campaign: { title: "Launch" } } },
        { amount: 100, link: { format: null, asset: { handle: "a" }, campaign: { title: "Launch" } } },
        { amount: 100, link: { format: "repost", asset: { handle: "a" }, campaign: { title: "Launch" } } },
        { amount: 100, link: { format: "political_story", asset: { handle: "a" }, campaign: { title: "Launch" } } },
        { amount: 100, link: { format: "carousel", asset: { handle: "a" }, campaign: { title: "Launch" } } },
      ],
    });
    expect(d.rows.map((r) => r.description)).toEqual(["Static & Carousel @a", "Political @a", "Post @a", "Repost @a", "Political Story @a", "Static & Carousel @a"]);
  });

  it("client invoice lines", () => {
    const d = clientInvoiceToDocument({
      name: "Q1",
      clientName: "Acme",
      gstPercent: 0,
      itemised: true,
      overview: { subtotal: 30000, gstAmount: 0, total: 30000 },
      items: [
        { format: "reel_story", postsPerProfile: 1, displayCost: 30000, asset: { handle: "demo.page" } },
        { format: "repost_story", postsPerProfile: 1, displayCost: 9000, asset: { handle: "demo.page" } },
        { format: "entertainment", postsPerProfile: 1, displayCost: 9000, asset: { handle: "demo.page" } },
      ],
    });
    expect(d.rows.map((r) => r.description)).toEqual(["Reel + Story @demo.page", "Repost + Story @demo.page", "Entertainment / Brand @demo.page"]);
  });

  it("finance link records", () => {
    expect(linkRecord({ format: "post", cost: 1, status: "SUBMITTED", createdAt: new Date() }).format).toBe("Static & Carousel");
    expect(linkRecord({ format: "pr", cost: 1, status: "SUBMITTED", createdAt: new Date() }).format).toBe("PR");
  });

  it("plan sheet: the breakdown's Utilization and the pages tab's Format column", () => {
    const plan = {
      id: "plan-1",
      name: "Q1",
      variantLabel: "Plan A",
      clientName: "Acme",
      createdAt: new Date("2026-01-01"),
      isGstPlan: false,
      sheetFormat: "breakdown",
      overview: { totalFollowers: 100000, totalPosts: 3, expectedImpressions: 0, subtotal: 38000, gstAmount: 0, total: 38000 },
      items: [
        { format: "reel_story", postsPerProfile: 1, displayCost: 30000, expectedViews: 0, asset: { handle: "a.page", category: "News", followers: 100000 } },
        { format: "post", postsPerProfile: 1, displayCost: 8000, expectedViews: 0, asset: { handle: "a.page", category: "News", followers: 100000 } },
        { format: "repost_story", postsPerProfile: 1, displayCost: 6000, expectedViews: 0, asset: { handle: "a.page", category: "News", followers: 100000 } },
      ],
    };
    const t = buildPlanSheetTabs(plan);
    const news = t.overviewRows.find((r) => r[0] === "News Pages");
    expect(news[1]).toBe("Instagram Reel + Story/Static & Carousel/Repost + Story");
    // Each combo is two posts.
    expect(news[4]).toBe(5);
    const pageRows = t.pageTabs.flatMap((tab) => tab.rows).filter((r) => r[1] === "a.page");
    expect(pageRows.map((r) => r[4])).toEqual(["Reel + Story", "Static & Carousel", "Repost + Story"]);
  });
});

// Review fix (16 Oct): client/lib/formats.ts mirrors this file; it had
// drifted (the "repost/story combo" spellings, a wider isReelLike).
describe("client/lib/formats.ts stays in sync with the server", () => {
  const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
  const aliasPairs = (src) => new Map([...src.matchAll(/^\s*\["([^"]+)", "([a-z_]+)"\],?\s*$/gm)].map((m) => [m[1], m[2]]));
  const server = read("./formats.js");
  const client = read("../../../client/lib/formats.ts");

  it("every server alias spelling resolves to the same format on the client", () => {
    const clientAliases = aliasPairs(client);
    const missing = [...aliasPairs(server)].filter(([alias, key]) => clientAliases.get(alias) !== key).map(([alias]) => alias);
    expect(missing).toEqual([]);
  });

  it("isReelLike is reel + political_reel on both sides", () => {
    const body = (src) => src.match(/function isReelLike\([^)]*\)[^{]*\{([^}]*)\}/)[1];
    const formatsIn = (text) => [...text.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]).sort();
    expect(formatsIn(body(client))).toEqual(formatsIn(body(server)));
    expect(formatsIn(body(server))).toEqual(["political_reel", "reel"]);
  });
});
