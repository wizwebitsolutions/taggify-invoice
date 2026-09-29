import { describe, it, expect } from "vitest";
import { buildPlanSheetTabs, planSheetTabTitles, reconcilePlanTabRequests, tabStatusRequests, buildFormatRequests, buildExecutionSheetTemplate, previewExecutionSheetTemplate, EXECUTION_TEMPLATE_TITLE } from "./planSheet.js";

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

describe("planSheetTabTitles — unique within a pitch group's file", () => {
  // Each pitch group has its own spreadsheet (Plan A, B, C… in one file), so
  // the variant label is what keeps sibling tabs apart. The client file never
  // actually carried the id: forClientPdf's output has none (29 Sep finding).
  it("Plan A and Plan B of one group never collide, and the client title carries no id", () => {
    const a = planSheetTabTitles({ ...basePlan, variantLabel: "Plan A" });
    const b = planSheetTabTitles({ ...basePlan, variantLabel: "Plan B" });

    expect(a.overviewTitle).not.toBe(b.overviewTitle);
    expect(a.pagesTitle).not.toBe(b.pagesTitle);
    expect(a.pagesTitle).not.toContain("abc123");
  });

  it("the internal file keeps its id suffix", () => {
    expect(planSheetTabTitles(basePlan, { internal: true }).pagesTitle).toMatch(/ · abc123$/);
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
    // 22 Sep — bare handle as Page Name, the plain profile URL as text (no
    // "@" prefix, no =HYPERLINK() formula) in Page Link.
    const pageRow = t.pagesRows.find((r) => r[0] === 1);
    expect(pageRow[1]).toBe("a.page");
    expect(pageRow[2]).toBe("https://instagram.com/a.page");
    expect(flat.some((r) => r.includes("HYPERLINK") || r.includes("@a.page"))).toBe(false);
    // …and the Page Link cell is clickable through a cell-level link (later
    // 22 Sep — "should have hyperlink of that link as well"), never a formula.
    const pageSpec = t.pagesRowSpecs[t.pagesRows.indexOf(pageRow)];
    expect(pageSpec.links).toEqual({ 2: "https://instagram.com/a.page" });
  });

  it("the NOTES block carries only the brief typed on Step 1 — no GST/availability boilerplate (user request, 14 Sep)", () => {
    const flat = buildPlanSheetTabs(basePlan).overviewRows.flat().join(" ");
    expect(flat).toContain("Rush job");
    expect(flat).not.toMatch(/inclusive of GST|exclusive of GST|subject to availability/);

    const withoutNotes = buildPlanSheetTabs({ ...basePlan, notes: "" }).overviewRows.flat().join(" ");
    expect(withoutNotes).not.toContain("NOTES");
  });

  it("includes GST rows only when the plan has a gstPercent", () => {
    const withoutGst = buildPlanSheetTabs(basePlan).overviewRows.flat().join(" ");
    const withGst = buildPlanSheetTabs({ ...basePlan, isGstPlan: true, gstPercent: 18, overview: { ...basePlan.overview, gstAmount: 1440, total: 9440 } }).overviewRows
      .flat()
      .join(" ");

    expect(withoutGst).not.toContain("GST (18%)");
    expect(withGst).toContain("GST (18%)");
  });

  it("{ internal: true } takes the full annotated plan shape (raw item.cost, internal.computed*), adds a Cost/Post column, and uses the real numbers even when a Step 3 override is set", () => {
    const annotatedPlan = {
      ...basePlan,
      isGstPlan: true,
      gstPercent: 18,
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

  it("a row's `links` become cell-level link formats after the style request, so the style can't wipe them (22 Sep)", () => {
    const rowSpecs = [{ cellTypes: ["data", "data", "data"], merge: false, links: { 2: "https://instagram.com/a.page" } }];
    const requests = buildFormatRequests(5, rowSpecs, 3);

    const link = requests.find((r) => r.repeatCell?.cell?.userEnteredFormat?.textFormat?.link);
    expect(link.repeatCell.range).toMatchObject({ sheetId: 5, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 2, endColumnIndex: 3 });
    expect(link.repeatCell.cell.userEnteredFormat.textFormat.link).toEqual({ uri: "https://instagram.com/a.page" });
    expect(link.repeatCell.fields).toContain("textFormat.link");
    const styleOfLinkedCell = requests.findIndex((r) => r.repeatCell?.cell?.userEnteredFormat?.backgroundColor && r.repeatCell.range.startColumnIndex === 2);
    expect(requests.indexOf(link)).toBeGreaterThan(styleOfLinkedCell);
  });

  it("skips styling for a null cellType (a plain, unstyled row) without throwing", () => {
    const rowSpecs = [{ cellTypes: [null], merge: false }];
    expect(() => buildFormatRequests(1, rowSpecs, 1)).not.toThrow();
  });
});

/**
 * buildExecutionSheetTemplate — the downloadable sample (user request, 10
 * Sep — "give downloadable sample template for google sheet so they'll
 * know how their execution should look like"; 11 Sep — matched to a
 * reference doc's columns; 23 Sep — trimmed to stop at Posted Link,
 * Views/Likes/Comments/Shares dropped as "not required").
 */
describe("buildExecutionSheetTemplate", () => {
  const HEADER = ["S No", "Page Name", "Page Link", "Followers", "Date", "Posted Link"];

  it("has the reference sheet's exact header columns, with example rows below it, in lockstep with the format specs", () => {
    const t = buildExecutionSheetTemplate();

    expect(t.title).toBe(EXECUTION_TEMPLATE_TITLE);
    expect(t.rows.length).toBe(t.rowSpecs.length);
    const headerRow = t.rows.find((r) => r[0] === "S No");
    expect(headerRow).toEqual(HEADER);
    expect(t.numCols).toBe(6);
  });

  it("includes real example rows (not a blank grid) with Page Link and Posted Link as plain URL text, page names without an @ (22 Sep)", () => {
    const t = buildExecutionSheetTemplate();
    const exampleRow = t.rows.find((r) => r[1] === "ghantaa");

    expect(exampleRow).toBeDefined();
    expect(exampleRow[2]).toBe("https://instagram.com/ghantaa");
    expect(exampleRow[5]).toBe("https://instagram.com/reel/example1");
    expect(t.rows.flat().some((c) => String(c).includes("HYPERLINK"))).toBe(false);
  });

  it("ends with a totals row summing Followers across the example rows", () => {
    const t = buildExecutionSheetTemplate();
    const totalsRow = t.rows.at(-1);

    expect(totalsRow).toEqual(["", "TOTAL", "", 8700000 + 4300000, "", ""]);
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
    expect(preview.headers).toEqual(["S No", "Page Name", "Page Link", "Followers", "Date", "Posted Link"]);
    expect(preview.rows).toHaveLength(2);
    expect(preview.rows[0][2]).toBe("https://instagram.com/ghantaa"); // plain URL, no =HYPERLINK(...) wrapper
    expect(preview.linkColumns).toEqual([2, 5]);
    expect(preview.totalsRow[3]).toBe(8700000 + 4300000);
  });
});

/**
 * User request, 29 Sep — "if there are 2 plans for same campaign, plan a and
 * plan b, and only plan a is approved it would show active in google sheet,
 * and unapproved will show not active in sheet tab name as well, make it
 * highlighted in google sheet also".
 */
describe("Active / Not active — tab name, band and tab colour (29 Sep)", () => {
  const approved = { ...basePlan, status: "APPROVED", variantLabel: "Plan A" };
  const draft = { ...basePlan, status: "DRAFT", variantLabel: "Plan B" };

  it("an approved plan's tabs say Active; anything else — draft, awaiting approval, rejected — says Not active", () => {
    expect(planSheetTabTitles(approved).pagesTitle).toBe("Q1 Meme Page Push · Plan A · Active");
    expect(planSheetTabTitles(approved).overviewTitle).toBe("Overview of Q1 Meme Page Push · Plan A · Active");
    for (const status of ["DRAFT", "PENDING_APPROVAL", "REJECTED"]) {
      expect(planSheetTabTitles({ ...draft, status }).pagesTitle).toBe("Q1 Meme Page Push · Plan B · Not active");
    }
  });

  it("a long name is what gets shortened — never the variant or the status", () => {
    const { overviewTitle } = planSheetTabTitles({ ...approved, name: "A".repeat(150) });
    expect(overviewTitle.length).toBeLessThanOrEqual(100);
    expect(overviewTitle).toMatch(/ · Plan A · Active$/);
  });

  it("both tabs open with a highlighted status band, green for Active and red for Not active", () => {
    const on = buildPlanSheetTabs(approved);
    const off = buildPlanSheetTabs(draft);

    // Overview: right under the TAGGIFY logo. Pages: the first row, above the table.
    expect(on.overviewRows[1][0]).toContain("ACTIVE");
    expect(on.overviewRowSpecs[1]).toMatchObject({ cellTypes: ["statusActive"], merge: true });
    expect(on.pagesRows[0][0]).toContain("ACTIVE");
    expect(off.overviewRows[1][0]).toContain("NOT ACTIVE");
    expect(off.pagesRowSpecs[0]).toMatchObject({ cellTypes: ["statusInactive"], merge: true });

    const [green] = buildFormatRequests(7, on.pagesRowSpecs, on.pagesNumCols).filter((r) => r.repeatCell?.cell?.userEnteredFormat?.backgroundColor);
    const [red] = buildFormatRequests(7, off.pagesRowSpecs, off.pagesNumCols).filter((r) => r.repeatCell?.cell?.userEnteredFormat?.backgroundColor);
    expect(green.repeatCell.cell.userEnteredFormat.backgroundColor.green).toBeGreaterThan(green.repeatCell.cell.userEnteredFormat.backgroundColor.red);
    expect(red.repeatCell.cell.userEnteredFormat.backgroundColor.red).toBeGreaterThan(red.repeatCell.cell.userEnteredFormat.backgroundColor.green);
  });

  it("the tab itself is coloured by status too", () => {
    const [on] = tabStatusRequests(3, approved);
    const [off] = tabStatusRequests(4, draft);
    expect(on.updateSheetProperties).toMatchObject({ properties: { sheetId: 3 }, fields: "tabColorStyle" });
    expect(on.updateSheetProperties.properties.tabColorStyle.rgbColor.green).toBeGreaterThan(0.5);
    expect(off.updateSheetProperties.properties.tabColorStyle.rgbColor.red).toBeGreaterThan(0.8);
  });
});

/**
 * Tabs are found by title, so a changed title (status flip, or a renamed plan)
 * used to add a fresh tab pair and strand the old one in the client's sheet —
 * the live "thriftXredbull" file still has a "thriftXredbull · Plan A · " pair
 * from before Plan A was renamed "speedXredbull". reconcilePlanTabRequests
 * renames a plan's tabs in place instead (keeping their gid, so shared links
 * still land) and removes such leftovers.
 */
describe("reconcilePlanTabRequests — rename in place, never strand a tab (29 Sep)", () => {
  const planA = { ...basePlan, id: "plan-aaaaaa", name: "speedXredbull", variantLabel: "Plan A", status: "APPROVED" };
  const planB = { ...basePlan, id: "plan-bbbbbb", name: "thriftXredbull", variantLabel: "Plan B", status: "DRAFT" };
  const sheetsFor = (...plans) => plans.map((plan) => ({ plan, ...buildPlanSheetTabs(plan) }));
  const renames = (reqs) => reqs.filter((r) => r.updateSheetProperties).map((r) => [r.updateSheetProperties.properties.sheetId, r.updateSheetProperties.properties.title]);
  const deletes = (reqs) => reqs.filter((r) => r.deleteSheet).map((r) => r.deleteSheet.sheetId);

  it("upgrades the old untagged client tabs to the Active / Not active names, keeping the same tabs", () => {
    const existing = [
      { sheetId: 1, title: "Overview of speedXredbull · Plan A · " },
      { sheetId: 2, title: "speedXredbull · Plan A · " },
      { sheetId: 3, title: "Overview of thriftXredbull · Plan B · " },
      { sheetId: 4, title: "thriftXredbull · Plan B · " },
    ];

    const reqs = reconcilePlanTabRequests(existing, sheetsFor(planA, planB));

    expect(renames(reqs)).toEqual([
      [1, "Overview of speedXredbull · Plan A · Active"],
      [2, "speedXredbull · Plan A · Active"],
      [3, "Overview of thriftXredbull · Plan B · Not active"],
      [4, "thriftXredbull · Plan B · Not active"],
    ]);
    expect(deletes(reqs)).toEqual([]);
  });

  it("clears the stale pair a rename left behind — the live thriftXredbull file's case", () => {
    const existing = [
      { sheetId: 10, title: "Overview of thriftXredbull · Plan A · " }, // Plan A before its rename
      { sheetId: 11, title: "thriftXredbull · Plan A · " },
      { sheetId: 12, title: "Overview of speedXredbull · Plan A · " },
      { sheetId: 13, title: "speedXredbull · Plan A · " },
    ];

    const reqs = reconcilePlanTabRequests(existing, sheetsFor(planA));

    expect(renames(reqs)).toEqual([
      [10, "Overview of speedXredbull · Plan A · Active"],
      [11, "speedXredbull · Plan A · Active"],
    ]);
    expect(deletes(reqs).sort()).toEqual([12, 13]); // exactly one pair survives
  });

  // Found verifying on the live file: with two candidate pairs it kept the
  // stale one and deleted the tab the plan's saved link pointed at, so an
  // already-shared ?gid= link lost its target. The linked tab is kept now.
  it("of two leftover Overview tabs, keeps the one the plan's saved link points at", () => {
    const linked = { ...planA, clientSheetUrl: "https://docs.google.com/spreadsheets/d/f/edit?gid=12#gid=12" };
    const existing = [
      { sheetId: 10, title: "Overview of thriftXredbull · Plan A · " }, // stale, but first in the tab strip
      { sheetId: 12, title: "Overview of speedXredbull · Plan A · " }, // what the shared link opens
    ];

    const reqs = reconcilePlanTabRequests(existing, sheetsFor(linked));

    expect(renames(reqs)).toEqual([[12, "Overview of speedXredbull · Plan A · Active"]]);
    expect(deletes(reqs)).toEqual([10]);
  });

  it("a status flip renames the same tab — Plan B approved later goes Not active → Active", () => {
    const existing = [{ sheetId: 5, title: "thriftXredbull · Plan B · Not active" }];

    const reqs = reconcilePlanTabRequests(existing, sheetsFor({ ...planB, status: "APPROVED" }));

    expect(renames(reqs)).toEqual([[5, "thriftXredbull · Plan B · Active"]]);
  });

  it("already-correct tabs need no requests at all", () => {
    const existing = sheetsFor(planA).flatMap((s, i) => [
      { sheetId: 20 + i, title: s.overviewTitle },
      { sheetId: 30 + i, title: s.pagesTitle },
    ]);

    expect(reconcilePlanTabRequests(existing, sheetsFor(planA))).toEqual([]);
  });

  it("never touches a tab that isn't one of these plans' — a sibling it can't see, or anything added by hand", () => {
    const existing = [
      { sheetId: 40, title: "thriftXredbull · Plan C · " }, // a sibling this requester can't open
      { sheetId: 41, title: "Client's own notes" },
    ];

    expect(reconcilePlanTabRequests(existing, sheetsFor(planA, planB))).toEqual([]);
  });

  it("the internal file finds its tabs by the id suffix, across a rename", () => {
    const existing = [{ sheetId: 50, title: "INTERNAL — oldName · Plan A · aaaaaa" }];
    const sheets = [{ plan: planA, ...planSheetTabTitles(planA, { internal: true }) }];

    expect(renames(reconcilePlanTabRequests(existing, sheets, { internal: true }))).toEqual([[50, "INTERNAL — speedXredbull · Plan A · Active · aaaaaa"]]);
  });
});
