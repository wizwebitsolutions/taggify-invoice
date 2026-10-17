import { describe, it, expect } from "vitest";
import { buildPlanSheetTabs, planSheetTabTitles, pageTabTitle, categoryLabel, splitByWeight, reconcilePlanTabRequests, tabStatusRequests, buildFormatRequests, buildExecutionSheetTemplate, previewExecutionSheetTemplate, EXECUTION_TEMPLATE_TITLE } from "./planSheet.js";

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
  it("builds non-empty overview and page tabs for a normal plan, rows and specs in lockstep", () => {
    const t = buildPlanSheetTabs(basePlan);

    expect(t.overviewRows.length).toBe(t.overviewRowSpecs.length); // rows/specs never drift apart
    expect(t.pageTabs).toHaveLength(1);
    expect(t.pageTabs[0].rows.length).toBe(t.pageTabs[0].rowSpecs.length);
    expect(t.pageTabs[0].numCols).toBe(6);
    // Client details (user request, 10 Sep) stay on the sheet.
    expect(t.overviewRows.some((r) => r.join(" ").includes("Acme Inc"))).toBe(true);
    expect(t.overviewRows.some((r) => r.join(" ").includes("GST123"))).toBe(true);
  });

  it("handles an empty plan without crashing (no page tabs, a note on the overview)", () => {
    const t = buildPlanSheetTabs({ ...basePlan, items: [] });
    expect(t.pageTabs).toEqual([]);
    expect(t.overviewRows.flat().join(" ")).toContain("No pages added yet.");
  });

  // 8 Oct — both sample plans put each page category in its own tab.
  it("puts pages in one tab per category, biggest audience first; a page's row is a bare handle with a clickable link", () => {
    const t = buildPlanSheetTabs({
      ...basePlan,
      items: [
        { format: "reel", postsPerProfile: 1, displayCost: 5000, asset: { handle: "a.page", category: "Meme page", followers: 50000 } },
        { format: "story", postsPerProfile: 2, displayCost: 4000, asset: { handle: "b.page", category: "News", followers: 200000 } },
        { format: "reel", postsPerProfile: 1, displayCost: 1000, asset: { handle: "c.page", category: null, followers: 1000 } },
      ],
    });

    expect(t.pageTabs.map((tab) => tab.title)).toEqual([
      "News Pages — Q1 Meme Page Push · Plan A",
      "Meme Pages — Q1 Meme Page Push · Plan A",
      "Other Pages — Q1 Meme Page Push · Plan A",
    ]);
    const meme = t.pageTabs[1];
    const pageRow = meme.rows.find((r) => r[0] === 1);
    expect(pageRow[1]).toBe("a.page");
    expect(pageRow[2]).toBe("https://instagram.com/a.page");
    expect(meme.rowSpecs[meme.rows.indexOf(pageRow)].links).toEqual({ 2: "https://instagram.com/a.page" });
    expect(meme.rows.flat().join(" ")).not.toMatch(/HYPERLINK|@a\.page/);
    // Each tab ends with a followers total.
    expect(meme.rows.at(-1)).toEqual(["", "Total", "", "50K", "", 1]);
  });

  it("a page with both a reel and a story counts its followers once in the tab total", () => {
    const t = buildPlanSheetTabs({
      ...basePlan,
      items: [
        { format: "reel", postsPerProfile: 1, displayCost: 5000, asset: { handle: "a.page", category: "News", followers: 1_000_000 } },
        { format: "story", postsPerProfile: 2, displayCost: 2000, asset: { handle: "a.page", category: "News", followers: 1_000_000 } },
      ],
    });
    expect(t.pageTabs[0].rows.at(-1)).toEqual(["", "Total", "", "1M", "", 3]);
  });

  it("notes: the format's standard notes, then the plan's own brief (8 Oct)", () => {
    const breakdown = buildPlanSheetTabs(basePlan).overviewRows.flat().join(" ");
    expect(breakdown).toContain("Taggify manages post visibility for 45 days");
    expect(breakdown.indexOf("Rush job")).toBeGreaterThan(breakdown.indexOf("45 days"));

    const summary = buildPlanSheetTabs({ ...basePlan, sheetFormat: "summary" }).overviewRows.flat().join(" ");
    expect(summary).toContain("All prices mentioned above are exclusive of GST.");
    expect(summary).toContain("Rush job");

    expect(buildPlanSheetTabs({ ...basePlan, notes: "" }).overviewRows.flat().join(" ")).not.toContain("Rush job");
  });

  it("includes GST rows only when the plan has a gstPercent", () => {
    const withoutGst = buildPlanSheetTabs(basePlan).overviewRows.flat().join(" ");
    const withGst = buildPlanSheetTabs({ ...basePlan, isGstPlan: true, gstPercent: 18, overview: { ...basePlan.overview, gstAmount: 1440, total: 9440 } }).overviewRows.flat().join(" ");

    expect(withoutGst).not.toContain("GST (18%)");
    expect(withGst).toContain("GST (18%)");
    expect(withGst).toContain("₹9,440");
  });

  it("{ internal: true } uses real costs, adds a Cost/Post column, and shows the quote, margin and budget", () => {
    const annotatedPlan = {
      ...basePlan,
      isGstPlan: true,
      gstPercent: 18,
      totalCost: 5000,
      budgetVariance: -2000,
      overview: { ...basePlan.overview, subtotal: 8000, gstAmount: 1440, total: 9440 }, // overridden client-facing numbers
      internal: { computedFollowers: 100000, computedPosts: 2, computedImpressions: 10000, computedSubtotal: 5000, computedGstAmount: 900, computedTotal: 5900 },
      items: [{ format: "reel", postsPerProfile: 2, cost: 2500, clientCost: 4000, asset: { handle: "demo.page", category: "Meme page", followers: 100000 } }],
    };

    const t = buildPlanSheetTabs(annotatedPlan, { internal: true });
    const flatOverview = t.overviewRows.flat().join(" ");

    expect(t.pageTabs[0].numCols).toBe(7);
    expect(t.pageTabs[0].rows.flat()).toContain("Cost/Post");
    expect(flatOverview).toContain("₹5,000"); // 2 × 2,500 real cost, not the overridden 8,000
    expect(flatOverview).toContain("Quoted to client");
    expect(flatOverview).toContain("Over Budget");
    expect(t.pageTabs[0].title).toMatch(/^INTERNAL — Meme Pages — /);
  });
});

/** 8 Oct — the two sample plans the sheet formats are modelled on. */
describe("sheet formats (8 Oct)", () => {
  const twoCategories = {
    ...basePlan,
    isGstPlan: true,
    gstPercent: 18,
    overview: { totalFollowers: 9_400_000, totalPosts: 3, expectedImpressions: 900_000, subtotal: 100_000, gstAmount: 18_000, total: 118_000 },
    items: [
      { format: "reel", postsPerProfile: 1, displayCost: 30_000, expectedViews: 300_000, asset: { handle: "big.news", category: "News", followers: 9_000_000 } },
      { format: "reel", postsPerProfile: 2, displayCost: 10_000, expectedViews: 400_000, asset: { handle: "biz.page", category: "Business", followers: 400_000 } },
    ],
  };

  it("breakdown (sample 1): a row per category, with the quote split by what each category's pages cost", () => {
    const t = buildPlanSheetTabs({ ...twoCategories, sheetFormat: "breakdown" });
    const header = t.overviewRows.find((r) => r[0] === "Particulars");
    expect(header).toEqual(["Particulars", "Utilization", "Followers Count (in Millions)", "Followers Range", "No. of Items", "Total Final Cost", "Expected Views/Reach (in Millions)"]);
    const news = t.overviewRows.find((r) => r[0] === "News Pages");
    const biz = t.overviewRows.find((r) => r[0] === "Business Pages");
    // Pages cost 30,000 (News) and 20,000 (Business): the 1,00,000 quote splits 60/40.
    expect(news).toEqual(["News Pages", "Instagram Reel", "9", "9M-9M", 1, "₹60,000", "0.4"]);
    expect(biz).toEqual(["Business Pages", "Instagram Reel", "0.4", "400K-400K", 2, "₹40,000", "0.5"]);
    expect(t.overviewRows.find((r) => r[0] === "Total")).toEqual(["Total", "", "9.4", "", 3, "₹1,00,000", "0.9"]);
    expect(t.overviewRows.find((r) => r[4] === "GST (18%)")?.[5]).toBe("₹18,000");
    expect(t.overviewNumCols).toBe(7);
  });

  it("summary (sample 2): one campaign-overview block with CPV", () => {
    const t = buildPlanSheetTabs({ ...twoCategories, sheetFormat: "summary" });
    const rows = Object.fromEntries(t.overviewRows.filter((r) => r.length === 2).map((r) => [r[0], r[1]]));
    expect(rows).toMatchObject({
      "Total Followers Targeted Overall": "9 Million +",
      "Total Deliverables": 3,
      "Expected Impressions/Views": "900K +",
      Cost: "₹1,00,000",
      CPV: "0.11",
    });
    expect(t.overviewNumCols).toBe(2);
    // Same category page tabs either way.
    expect(t.pageTabs.map((tab) => tab.title.split(" — ")[0])).toEqual(["News Pages", "Business Pages"]);
  });

  it("no format saved yet means breakdown", () => {
    expect(buildPlanSheetTabs(twoCategories).overviewRows.some((r) => r[0] === "Particulars")).toBe(true);
  });

  it("category labels read like the samples' tab names", () => {
    expect(categoryLabel("News")).toBe("News Pages");
    expect(categoryLabel("Meme page")).toBe("Meme Pages");
    expect(categoryLabel("coverage handles")).toBe("Coverage Handles");
    expect(categoryLabel(null)).toBe("Other Pages");
  });

  it("categories differing only in case share one tab; long look-alike labels and dashes never collide", () => {
    const item = (handle, category) => ({ format: "reel", postsPerProfile: 1, displayCost: 1000, asset: { handle, category, followers: 1000 } });
    const long = "A very long category name that goes on and on";
    const t = buildPlanSheetTabs({ ...basePlan, items: [item("a", "news"), item("b", "NEWS"), item("c", `${long} one`), item("d", `${long} two`), item("e", "News — Hindi")] });
    const titles = t.pageTabs.map((tab) => tab.title);
    expect(titles.filter((x) => x.startsWith("News Pages — "))).toHaveLength(1);
    expect(new Set(titles.map((x) => x.toLowerCase())).size).toBe(titles.length);
    expect(titles.some((x) => x.startsWith("News - Hindi Pages — "))).toBe(true);
  });

  it("a split always adds back up to the total", () => {
    expect(splitByWeight(100, [1, 1, 1])).toEqual([33, 33, 34]);
    expect(splitByWeight(1000, [0, 0])).toEqual([500, 500]);
    expect(splitByWeight(0, [])).toEqual([]);
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

    // 8,700,000 + 4,300,000, written the way creators quote it (8 Oct).
    expect(totalsRow).toEqual(["", "TOTAL", "", "13M", "", ""]);
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
    expect(preview.rows[0][3]).toBe("8.7M");
    expect(preview.totalsRow[3]).toBe("13M"); // 8,700,000 + 4,300,000
  });
});

/**
 * User request, 29 Sep — "if there are 2 plans for same campaign, plan a and
 * plan b, and only plan a is approved it would show active in google sheet,
 * and unapproved will show not active in sheet tab name as well, make it
 * highlighted in google sheet also".
 */
describe("Active / Not active — internal file only (29 Sep; client mark dropped 16 Oct)", () => {
  const approved = { ...basePlan, status: "APPROVED", variantLabel: "Plan A" };
  const draft = { ...basePlan, status: "DRAFT", variantLabel: "Plan B" };
  const internal = { internal: true };

  // 16 Oct — "in client sheet it should not show active mark".
  it("the client file carries no status anywhere: not in tab names, not as a band, not as a tab colour", () => {
    expect(planSheetTabTitles(approved).pagesTitle).toBe("Q1 Meme Page Push · Plan A");
    expect(planSheetTabTitles(approved).overviewTitle).toBe("Overview of Q1 Meme Page Push · Plan A");
    for (const status of ["DRAFT", "PENDING_APPROVAL", "REJECTED", "APPROVED"]) {
      const t = buildPlanSheetTabs({ ...draft, status });
      expect(planSheetTabTitles({ ...draft, status }).pagesTitle).toBe("Q1 Meme Page Push · Plan B");
      expect(JSON.stringify(t.overviewRows)).not.toMatch(/ACTIVE/i);
      expect(JSON.stringify(t.pageTabs.map((p) => p.rows))).not.toMatch(/ACTIVE/i);
      expect(t.overviewRowSpecs[0].cellTypes[0]).toBe("navyBand");
      expect(t.pageTabs[0].rowSpecs[0].cellTypes[0]).toBe("tableHeader");
    }
    expect(tabStatusRequests(3, approved)).toEqual([]);
    expect(tabStatusRequests(3, approved, { internal: false })).toEqual([]);
  });

  it("the internal file's tabs say Active for an approved plan and Not active otherwise", () => {
    expect(planSheetTabTitles(approved, internal).pagesTitle).toBe("INTERNAL — Q1 Meme Page Push · Plan A · Active · abc123");
    for (const status of ["DRAFT", "PENDING_APPROVAL", "REJECTED"]) {
      expect(planSheetTabTitles({ ...draft, status }, internal).pagesTitle).toBe("INTERNAL — Q1 Meme Page Push · Plan B · Not active · abc123");
    }
  });

  it("a long name is what gets shortened — never the variant or the status", () => {
    const { overviewTitle } = planSheetTabTitles({ ...approved, name: "A".repeat(150) }, internal);
    expect(overviewTitle.length).toBeLessThanOrEqual(100);
    expect(overviewTitle).toMatch(/ · Plan A · Active · abc123$/);
    const client = planSheetTabTitles({ ...approved, name: "A".repeat(150) });
    expect(client.overviewTitle.length).toBeLessThanOrEqual(100);
    expect(client.overviewTitle).toMatch(/ · Plan A$/);
  });

  const annotated = (plan) => ({ ...plan, internal: { computedFollowers: 100000, computedPosts: 2, computedImpressions: 10000, computedSubtotal: 8000, computedGstAmount: 0, computedTotal: 8000 }, items: plan.items.map((i) => ({ ...i, cost: 3000 })) });

  it("internal tabs open with a highlighted status band, green for Active and red for Not active", () => {
    const on = buildPlanSheetTabs(annotated(approved), internal);
    const off = buildPlanSheetTabs(annotated(draft), internal);

    expect(on.overviewRows[0][0]).toContain("ACTIVE");
    expect(on.overviewRowSpecs[0]).toMatchObject({ cellTypes: ["statusActive"], merge: true });
    expect(on.pageTabs[0].rows[0][0]).toContain("ACTIVE");
    expect(off.overviewRows[0][0]).toContain("NOT ACTIVE");
    expect(off.pageTabs[0].rowSpecs[0]).toMatchObject({ cellTypes: ["statusInactive"], merge: true });

    const [green] = buildFormatRequests(7, on.pageTabs[0].rowSpecs, on.pageTabs[0].numCols).filter((r) => r.repeatCell?.cell?.userEnteredFormat?.backgroundColor);
    const [red] = buildFormatRequests(7, off.pageTabs[0].rowSpecs, off.pageTabs[0].numCols).filter((r) => r.repeatCell?.cell?.userEnteredFormat?.backgroundColor);
    expect(green.repeatCell.cell.userEnteredFormat.backgroundColor.green).toBeGreaterThan(green.repeatCell.cell.userEnteredFormat.backgroundColor.red);
    expect(red.repeatCell.cell.userEnteredFormat.backgroundColor.red).toBeGreaterThan(red.repeatCell.cell.userEnteredFormat.backgroundColor.green);
  });

  it("the internal tab itself is coloured by status too", () => {
    const [on] = tabStatusRequests(3, approved, internal);
    const [off] = tabStatusRequests(4, draft, internal);
    expect(on.updateSheetProperties).toMatchObject({ properties: { sheetId: 3 }, fields: "tabColorStyle" });
    expect(on.updateSheetProperties.properties.tabColorStyle.rgbColor.green).toBeGreaterThan(0.5);
    expect(off.updateSheetProperties.properties.tabColorStyle.rgbColor.red).toBeGreaterThan(0.8);
  });
});

describe("Flat discount rows (16 Oct)", () => {
  const discounted = { ...basePlan, isGstPlan: true, gstPercent: 18, overview: { ...basePlan.overview, subtotal: 8000, discount: 1000, taxable: 7000, gstAmount: 1260, total: 8260 } };
  const cell = (rows, label) => rows.find((r) => r.includes(label));

  it("breakdown: Discount and After Discount sit between the Total row and GST", () => {
    const t = buildPlanSheetTabs(discounted);
    expect(cell(t.overviewRows, "Discount")).toContain("- ₹1,000");
    expect(cell(t.overviewRows, "After Discount")).toContain("₹7,000");
    expect(cell(t.overviewRows, "GST (18%)")).toContain("₹1,260");
    const labels = t.overviewRows.map((r) => r[4]);
    expect(labels.indexOf("Discount")).toBeLessThan(labels.indexOf("GST (18%)"));
  });

  it("summary: Discount and Cost After Discount follow Cost", () => {
    const t = buildPlanSheetTabs({ ...discounted, sheetFormat: "summary" });
    const labels = t.overviewRows.map((r) => r[0]);
    expect(labels.indexOf("Cost")).toBeLessThan(labels.indexOf("Discount"));
    expect(cell(t.overviewRows, "Cost After Discount")).toContain("₹7,000");
  });

  it("no discount → no discount rows at all", () => {
    for (const format of ["breakdown", "summary"]) {
      const t = buildPlanSheetTabs({ ...basePlan, sheetFormat: format, overview: { ...basePlan.overview, discount: 0, taxable: 8000 } });
      expect(JSON.stringify(t.overviewRows)).not.toContain("Discount");
    }
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
describe("reconcilePlanTabRequests — rename in place, never strand a tab (29 Sep; category tabs 8 Oct)", () => {
  const planA = { ...basePlan, id: "plan-aaaaaa", name: "speedXredbull", variantLabel: "Plan A", status: "APPROVED" };
  const planB = { ...basePlan, id: "plan-bbbbbb", name: "thriftXredbull", variantLabel: "Plan B", status: "DRAFT" };
  const sheetsFor = (...plans) => plans.map((plan) => ({ plan, ...buildPlanSheetTabs(plan) }));
  const renames = (reqs) => reqs.filter((r) => r.updateSheetProperties).map((r) => [r.updateSheetProperties.properties.sheetId, r.updateSheetProperties.properties.title]);
  const deletes = (reqs) => reqs.filter((r) => r.deleteSheet).map((r) => r.deleteSheet.sheetId);

  it("upgrades old untagged tabs: the Overview is renamed in place, the old all-pages tab makes way for category tabs", () => {
    const existing = [
      { sheetId: 1, title: "Overview of speedXredbull · Plan A · " },
      { sheetId: 2, title: "speedXredbull · Plan A · " },
      { sheetId: 3, title: "Overview of thriftXredbull · Plan B · " },
      { sheetId: 4, title: "thriftXredbull · Plan B · " },
    ];

    const reqs = reconcilePlanTabRequests(existing, sheetsFor(planA, planB));

    expect(renames(reqs)).toEqual([
      [1, "Overview of speedXredbull · Plan A"],
      [3, "Overview of thriftXredbull · Plan B"],
    ]);
    expect(deletes(reqs).sort()).toEqual([2, 4]);
  });

  it("clears the stale Overview a rename left behind — the live thriftXredbull file's case", () => {
    const existing = [
      { sheetId: 10, title: "Overview of thriftXredbull · Plan A · " }, // Plan A before its rename
      { sheetId: 12, title: "Overview of speedXredbull · Plan A · " },
    ];

    const reqs = reconcilePlanTabRequests(existing, sheetsFor(planA));

    expect(renames(reqs)).toEqual([[10, "Overview of speedXredbull · Plan A"]]);
    expect(deletes(reqs)).toEqual([12]); // exactly one Overview survives
  });

  // Found verifying on the live file: with two candidates it kept the stale
  // one and deleted the tab the plan's saved link pointed at. The linked tab is kept now.
  it("of two leftover Overview tabs, keeps the one the plan's saved link points at", () => {
    const linked = { ...planA, clientSheetUrl: "https://docs.google.com/spreadsheets/d/f/edit?gid=12#gid=12" };
    const existing = [
      { sheetId: 10, title: "Overview of thriftXredbull · Plan A · " }, // stale, but first in the tab strip
      { sheetId: 12, title: "Overview of speedXredbull · Plan A · " }, // what the shared link opens
    ];

    const reqs = reconcilePlanTabRequests(existing, sheetsFor(linked));

    expect(renames(reqs)).toEqual([[12, "Overview of speedXredbull · Plan A"]]);
    expect(deletes(reqs)).toEqual([10]);
  });

  it("a rename keeps each category's own tab, and a tab written with the pre-16 Oct status suffix is renamed to the bare client title", () => {
    const existing = [{ sheetId: 5, title: "Meme Pages — oldName · Plan B · Not active" }];

    const reqs = reconcilePlanTabRequests(existing, sheetsFor({ ...planB, status: "APPROVED" }));

    expect(renames(reqs)).toEqual([[5, "Meme Pages — thriftXredbull · Plan B"]]);
    expect(deletes(reqs)).toEqual([]);
  });

  it("a category no longer on the plan loses its tab", () => {
    const existing = [
      { sheetId: 6, title: pageTabTitle(planA, "Meme Pages") },
      { sheetId: 7, title: pageTabTitle(planA, "News Pages") },
    ];
    expect(deletes(reconcilePlanTabRequests(existing, sheetsFor(planA)))).toEqual([7]);
  });

  it("already-correct tabs need no requests at all", () => {
    const existing = sheetsFor(planA).flatMap((s, i) => [{ sheetId: 20 + i, title: s.overviewTitle }, ...s.pageTabs.map((tab, n) => ({ sheetId: 30 + n, title: tab.title }))]);

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
    const existing = [
      { sheetId: 50, title: "INTERNAL — Overview of oldName · Plan A · aaaaaa" },
      { sheetId: 51, title: "INTERNAL — Meme Pages — oldName · Plan A · aaaaaa" },
    ];
    // The internal sheet takes the full annotated plan (real costs + internal numbers).
    const annotated = { ...planA, internal: { computedFollowers: 100000, computedPosts: 2, computedImpressions: 10000, computedSubtotal: 8000, computedGstAmount: 0, computedTotal: 8000 }, items: [{ ...planA.items[0], cost: 3000 }] };
    const sheets = [{ plan: annotated, ...buildPlanSheetTabs(annotated, { internal: true }) }];

    expect(renames(reconcilePlanTabRequests(existing, sheets, { internal: true }))).toEqual([
      [50, "INTERNAL — Overview of speedXredbull · Plan A · Active · aaaaaa"],
      [51, "INTERNAL — Meme Pages — speedXredbull · Plan A · Active · aaaaaa"],
    ]);
  });
});

// 8 Oct — "followers should show in million or in k".
describe("plan sheet followers read as K / M", () => {
  it("page rows use 100K, not 100000, and the summary overview reads like the sample", () => {
    const t = buildPlanSheetTabs(basePlan);
    expect(t.pageTabs[0].rows.some((r) => r[1] === "demo.page" && r[3] === "100K")).toBe(true);
    const summary = buildPlanSheetTabs({ ...basePlan, sheetFormat: "summary" });
    expect(summary.overviewRows.find((r) => r[0] === "Total Followers Targeted Overall")?.[1]).toBe("100K +");
  });
});

describe("internal Margin is after the discount (16 Oct review)", () => {
  it("Margin = (subtotal − discount) − our cost, in both layouts", () => {
    const plan = {
      ...basePlan,
      overview: { ...basePlan.overview, subtotal: 8000, discount: 1000, taxable: 7000 },
      internal: { computedFollowers: 100000, computedPosts: 2, computedImpressions: 10000, computedSubtotal: 8000, computedGstAmount: 0, computedTotal: 8000 },
      items: [{ ...basePlan.items[0], cost: 1500 }], // 2 posts × 1500 = 3000 our cost
    };
    for (const sheetFormat of ["breakdown", "summary"]) {
      const t = buildPlanSheetTabs({ ...plan, sheetFormat }, { internal: true });
      const margin = t.overviewRows.find((r) => r.includes("Margin"));
      expect(margin).toContain("₹4,000"); // 7000 − 3000, not 8000 − 3000
    }
  });
});
