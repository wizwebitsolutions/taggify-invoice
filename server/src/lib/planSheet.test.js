import { describe, it, expect } from "vitest";
import { buildPlanSheetTabs, planSheetTabTitles, buildFormatRequests, buildExecutionSheetTemplate, previewExecutionSheetTemplate, EXECUTION_TEMPLATE_TITLE } from "./planSheet.js";

/**
 * user request, 10 Sep — "plan will be of google sheet, not in pdf" then
 * "google sheet format should be like this, same styling" (colors/layout
 * sampled from the reference sheets). Same shapes/safety convention as
 * planPdf.test.js: smoke tests over forClientPdf()'s output for the values,
 * plus dedicated coverage for the format-request builder.
 */
const basePlan = {
  id: "plan-abc123",
  name: "Q1 Meme Page Push",
  variantLabel: "Plan A",
  clientName: "Acme",
  clientContact: "acme@example.com",
  clientCompany: "Acme Inc",
  clientGstNumber: "GST123",
  clientAddress: "1 Acme Way",
  notes: "Rush job",
  createdAt: new Date("2026-01-01"),
  isGstPlan: false,
  overview: { totalFollowers: 100000, totalPosts: 2, expectedImpressions: 10000, subtotal: 8000, gstAmount: 0, total: 8000 },
  items: [{ format: "reel", postsPerProfile: 2, displayCost: 8000, asset: { handle: "demo.page", category: "Meme page", followers: 100000 } }],
};

describe("planSheetTabTitles — unique across every plan sharing one spreadsheet", () => {
  it("includes the plan id's suffix so two differently-id'd plans with the same name/variant never collide", () => {
    const a = planSheetTabTitles({ ...basePlan, id: "plan-aaaaaa" });
    const b = planSheetTabTitles({ ...basePlan, id: "plan-bbbbbb" });

    expect(a.overviewTitle).not.toBe(b.overviewTitle);
    expect(a.pagesTitle).not.toBe(b.pagesTitle);
  });

  it("stays under Google Sheets' 100-char tab title limit even for a long plan name", () => {
    const { overviewTitle, pagesTitle } = planSheetTabTitles({ ...basePlan, name: "A".repeat(150) });

    expect(overviewTitle.length).toBeLessThanOrEqual(100);
    expect(pagesTitle.length).toBeLessThanOrEqual(100);
  });

  it("INTERNAL mode prefixes both titles, distinct from the client pair", () => {
    const client = planSheetTabTitles(basePlan);
    const internal = planSheetTabTitles(basePlan, { internal: true });

    expect(internal.overviewTitle).toMatch(/^INTERNAL — Overview of/);
    expect(internal.pagesTitle).toMatch(/^INTERNAL — /);
    expect(internal.overviewTitle).not.toBe(client.overviewTitle);
    expect(internal.pagesTitle).not.toBe(client.pagesTitle);
  });
});

describe("buildPlanSheetTabs — values (doesn't crash on the shapes forClientPdf() produces)", () => {
  it("builds non-empty overview and page rows/specs for a normal plan, in lockstep", () => {
    const t = buildPlanSheetTabs(basePlan);

    expect(t.overviewRows.length).toBeGreaterThan(0);
    expect(t.overviewRows.length).toBe(t.overviewRowSpecs.length); // rows/specs never drift apart
    expect(t.pagesRows.length).toBeGreaterThan(0);
    expect(t.pagesRows.length).toBe(t.pagesRowSpecs.length);
    expect(t.overviewNumCols).toBe(2);
    expect(t.pagesNumCols).toBe(6);
    // Client details (user request, 10 Sep) appear on the sheet.
    expect(t.overviewRows.some((r) => r.join(" ").includes("Acme Inc"))).toBe(true);
    expect(t.overviewRows.some((r) => r.join(" ").includes("GST123"))).toBe(true);
  });

  it("handles an empty-plan state without crashing", () => {
    const t = buildPlanSheetTabs({ ...basePlan, items: [] });
    expect(t.pagesRows.length).toBeGreaterThan(0);
  });

  it("lists every page in one flat table — no per-category blocks, one header, S No running across categories (user request, 14 Sep)", () => {
    const t = buildPlanSheetTabs({
      ...basePlan,
      items: [
        { format: "reel", postsPerProfile: 1, displayCost: 5000, asset: { handle: "a.page", category: "Meme page", followers: 50000 } },
        { format: "story", postsPerProfile: 2, displayCost: 4000, asset: { handle: "b.page", category: "News", followers: 200000 } },
      ],
    });

    const flat = t.pagesRows.map((r) => r.join(" "));
    expect(flat.some((r) => r.includes("Meme page"))).toBe(false);
    expect(flat.some((r) => r.includes("News"))).toBe(false);
    expect(t.pagesRows.filter((r) => r[0] === "S No")).toHaveLength(1);
    expect(t.pagesRows.map((r) => r[0]).filter((v) => typeof v === "number")).toEqual([1, 2]);
    expect(flat.some((r) => r.includes('HYPERLINK("https://instagram.com/a.page"'))).toBe(true);
  });

  it("the NOTES block carries only the brief typed on Step 1 — no GST/availability boilerplate (user request, 14 Sep)", () => {
    const flat = buildPlanSheetTabs(basePlan).overviewRows.flat().join(" ");
    expect(flat).toContain("Rush job");
    expect(flat).not.toMatch(/inclusive of GST|exclusive of GST|subject to availability/);

    const withoutNotes = buildPlanSheetTabs({ ...basePlan, notes: "" }).overviewRows.flat().join(" ");
    expect(withoutNotes).not.toContain("NOTES");
  });

  it("includes GST rows only when isGstPlan is true", () => {
    const withoutGst = buildPlanSheetTabs(basePlan).overviewRows.flat().join(" ");
    const withGst = buildPlanSheetTabs({ ...basePlan, isGstPlan: true, overview: { ...basePlan.overview, gstAmount: 1440, total: 9440 } }).overviewRows
      .flat()
      .join(" ");

    expect(withoutGst).not.toContain("GST (18%)");
    expect(withGst).toContain("GST (18%)");
  });

  it("{ internal: true } takes the full annotated plan shape (raw item.cost, internal.computed*), adds a Cost/Post column, and uses the real numbers even when a Step 3 override is set", () => {
    const annotatedPlan = {
      ...basePlan,
      isGstPlan: true,
      totalCost: 5000,
      budgetVariance: -2000,
      overview: { ...basePlan.overview, subtotal: 8000, gstAmount: 1440, total: 9440 }, // overridden client-facing numbers
      internal: { computedFollowers: 100000, computedPosts: 2, computedImpressions: 10000, computedSubtotal: 5000, computedGstAmount: 900, computedTotal: 5900 },
      items: [{ format: "reel", postsPerProfile: 2, cost: 5000, clientCost: 8000, asset: { handle: "demo.page", category: "Meme page", followers: 100000 } }],
    };

    const t = buildPlanSheetTabs(annotatedPlan, { internal: true });
    const flatOverview = t.overviewRows.flat().join(" ");

    expect(t.pagesNumCols).toBe(7);
    expect(t.pagesRows.flat()).toContain("Cost/Post");
    expect(flatOverview).toContain("Rs. 5,000.00"); // internal.computedSubtotal, not the overridden 8000
    expect(flatOverview).toContain("Over Budget");
  });
});

describe("buildFormatRequests — the styling that makes a tab actually look like the reference sheet", () => {
  it("returns nothing for an empty section", () => {
    expect(buildFormatRequests(42, [], 2)).toEqual([]);
  });

  it("emits a merge + style request for a banded row, and per-cell style requests for a label/value row", () => {
    const rowSpecs = [
      { cellTypes: ["logo"], merge: true },
      { cellTypes: ["label", "value"], merge: false },
    ];

    const requests = buildFormatRequests(99, rowSpecs, 2);

    const merge = requests.find((r) => r.mergeCells);
    expect(merge.mergeCells.range).toMatchObject({ sheetId: 99, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 2 });

    const styleRequests = requests.filter((r) => r.repeatCell?.cell?.userEnteredFormat?.backgroundColor);
    // logo band (1 merged style) + label cell + value cell = 3 styled ranges.
    expect(styleRequests.length).toBe(3);
    const labelStyle = styleRequests.find((r) => r.repeatCell.range.startRowIndex === 1 && r.repeatCell.range.startColumnIndex === 0);
    const valueStyle = styleRequests.find((r) => r.repeatCell.range.startRowIndex === 1 && r.repeatCell.range.startColumnIndex === 1);
    expect(labelStyle.repeatCell.cell.userEnteredFormat.textFormat.bold).toBe(true);
    expect(valueStyle.repeatCell.cell.userEnteredFormat.horizontalAlignment).toBe("CENTER");
  });

  it("resets formatting and applies borders across the whole populated range, not just the styled rows", () => {
    const rowSpecs = [{ cellTypes: ["logo"], merge: true }, { cellTypes: [null, null], merge: false }];
    const requests = buildFormatRequests(7, rowSpecs, 2);

    expect(requests[0]).toMatchObject({ unmergeCells: { range: { sheetId: 7, endRowIndex: 2, endColumnIndex: 2 } } });
    const borders = requests.find((r) => r.updateBorders);
    expect(borders.updateBorders.range).toMatchObject({ sheetId: 7, endRowIndex: 2, endColumnIndex: 2 });
    expect(borders.updateBorders.innerHorizontal.style).toBe("SOLID");
  });

  it("skips styling for a null cellType (a plain, unstyled row) without throwing", () => {
    const rowSpecs = [{ cellTypes: [null], merge: false }];
    expect(() => buildFormatRequests(1, rowSpecs, 1)).not.toThrow();
  });
});

/**
 * buildExecutionSheetTemplate — the downloadable sample (user request, 10
 * Sep — "give downloadable sample template for google sheet so they'll
 * know how their execution should look like"; 11 Sep — matched exactly to
 * a specific reference doc's columns: S No / Page Name / Page Link /
 * Followers / Date / Posted Link / Views / Likes / Comments / Shares,
 * plus a totals row).
 */
describe("buildExecutionSheetTemplate", () => {
  const HEADER = ["S No", "Page Name", "Page Link", "Followers", "Date", "Posted Link", "Views", "Likes", "Comments", "Shares"];

  it("has the reference sheet's exact header columns, with example rows below it, in lockstep with the format specs", () => {
    const t = buildExecutionSheetTemplate();

    expect(t.title).toBe(EXECUTION_TEMPLATE_TITLE);
    expect(t.rows.length).toBe(t.rowSpecs.length);
    const headerRow = t.rows.find((r) => r[0] === "S No");
    expect(headerRow).toEqual(HEADER);
    expect(t.numCols).toBe(10);
  });

  it("includes real example rows (not a blank grid) with Page Link and Posted Link as HYPERLINK formulas", () => {
    const t = buildExecutionSheetTemplate();
    const exampleRow = t.rows.find((r) => r[1] === "@ghantaa");

    expect(exampleRow[2]).toMatch(/^=HYPERLINK\(/);
    expect(exampleRow[5]).toMatch(/^=HYPERLINK\(/);
  });

  it("ends with a totals row summing Followers/Views/Likes/Comments/Shares across the example rows", () => {
    const t = buildExecutionSheetTemplate();
    const totalsRow = t.rows.at(-1);

    expect(totalsRow[1]).toBe("TOTAL");
    expect(totalsRow[3]).toBe(8700000 + 4300000); // Followers
    expect(totalsRow[6]).toBe(1207230 + 195976); // Views
    expect(totalsRow[7]).toBe(14600 + 4421); // Likes
  });
});

/**
 * previewExecutionSheetTemplate — the same sample, shaped for the in-app
 * "Preview template" table (user request, 11 Sep — "show in preview"
 * before pasting an execution sheet link) rather than Sheets-API formulas.
 */
describe("previewExecutionSheetTemplate", () => {
  it("returns plain headers/rows/totalsRow matching buildExecutionSheetTemplate's data", () => {
    const preview = previewExecutionSheetTemplate();

    expect(preview.title).toBe(EXECUTION_TEMPLATE_TITLE);
    expect(preview.headers).toEqual(["S No", "Page Name", "Page Link", "Followers", "Date", "Posted Link", "Views", "Likes", "Comments", "Shares"]);
    expect(preview.rows).toHaveLength(2);
    expect(preview.rows[0][2]).toBe("https://instagram.com/ghantaa"); // plain URL, no =HYPERLINK(...) wrapper
    expect(preview.linkColumns).toEqual([2, 5]);
    expect(preview.totalsRow[3]).toBe(8700000 + 4300000);
  });
});
