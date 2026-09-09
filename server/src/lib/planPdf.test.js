import { describe, it, expect } from "vitest";
import { buildPlanPdf } from "./planPdf.js";

/**
 * Smoke tests, not content assertions — same convention this codebase
 * already uses for PDF rendering (invoicePdf.js has none either): the real
 * logic worth asserting on lives in plans/service.js's forClientPdf(),
 * already covered there. This just catches "the rewrite (newTask.md, 8
 * Sep — category grouping, Overview block, notes) throws or produces
 * garbage" — a real risk given how much of the layout changed.
 */
describe("buildPlanPdf — doesn't crash on the shapes forClientPdf() produces", () => {
  const basePlan = {
    name: "Q1 Meme Page Push",
    clientName: "Acme",
    clientContact: "acme@example.com",
    createdAt: new Date("2026-01-01"),
    isGstPlan: false,
    overview: { totalFollowers: 100000, totalPosts: 2, expectedImpressions: 10000, subtotal: 8000, gstAmount: 0, total: 8000 },
    items: [
      { format: "reel", postsPerProfile: 2, displayCost: 8000, asset: { handle: "demo.page", category: "Meme page", followers: 100000 } },
    ],
  };

  it("renders a non-empty PDF buffer for a normal plan", async () => {
    const pdf = await buildPlanPdf(basePlan);
    expect(pdf).toBeInstanceOf(Buffer);
    expect(pdf.length).toBeGreaterThan(0);
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  });

  it("renders with GST applied", async () => {
    const pdf = await buildPlanPdf({
      ...basePlan,
      isGstPlan: true,
      overview: { ...basePlan.overview, gstAmount: 1440, total: 9440 },
    });
    expect(pdf.length).toBeGreaterThan(0);
  });

  it("renders an empty-plan state without crashing", async () => {
    const pdf = await buildPlanPdf({
      ...basePlan,
      items: [],
      overview: { totalFollowers: 0, totalPosts: 0, expectedImpressions: 0, subtotal: 0, gstAmount: 0, total: 0 },
    });
    expect(pdf.length).toBeGreaterThan(0);
  });

  it("groups multiple categories without crashing", async () => {
    const pdf = await buildPlanPdf({
      ...basePlan,
      items: [
        { format: "reel", postsPerProfile: 1, displayCost: 5000, asset: { handle: "a.page", category: "Meme page", followers: 50000 } },
        { format: "story", postsPerProfile: 2, displayCost: 4000, asset: { handle: "b.page", category: "News", followers: 200000 } },
        { format: "reel", postsPerProfile: 1, displayCost: 3000, asset: { handle: "c.page", category: null, followers: 10000 } },
      ],
    });
    expect(pdf.length).toBeGreaterThan(0);
  });

  it("handles many pages across a page break without crashing", async () => {
    const items = Array.from({ length: 60 }, (_, i) => ({
      format: "reel",
      postsPerProfile: 1,
      displayCost: 1000,
      asset: { handle: `page-${i}`, category: "Meme page", followers: 1000 },
    }));
    const pdf = await buildPlanPdf({ ...basePlan, items });
    expect(pdf.length).toBeGreaterThan(0);
  });
});
