/**
 * Builds a Plan's Google Sheet deliverable: the row values (for
 * writeSheetTab) AND the cell formatting (for batchUpdateSpreadsheet) that
 * makes it actually look like the reference sheet — user request, 10 Sep:
 * "google sheet format should be like this, same styling" — colored
 * header bands, merged title cells, a bordered table, not plain unstyled
 * text. Colors/layout sampled directly from the two reference sheets
 * shared this session (the "ICCPL <> Taggify" plan doc and the "Trial
 * Sheet ... Taggify" execution doc) — same blue family in both.
 *
 * Two modes, same as planPdf.js:
 *  - client (default): takes ONLY plans/service.js's forClientPdf() output
 *    — no `cost`/`clientCost` field anywhere in that shape, just the
 *    already-resolved `displayCost`, so this module has no internal-cost
 *    field it could accidentally write even by mistake.
 *  - internal ({ internal: true }): takes the full annotated plan instead
 *    — real item.cost, real computed numbers, ignoring any Step 3 override.
 */

const money = (n) => `Rs. ${Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dateStr = (d) => (d ? new Date(d).toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric" }) : "—");

// ── Colors (sampled from the reference sheets) ──────────────────────────
const BLACK = { red: 0, green: 0, blue: 0 };
const WHITE = { red: 1, green: 1, blue: 1 };
const NAVY = { red: 0.11, green: 0.271, blue: 0.529 }; // "CAMPAIGN OVERVIEW" band
const MED_BLUE = { red: 0.435, green: 0.659, blue: 0.863 }; // labels / category+table headers / notes band
const LIGHT_BLUE = { red: 0.788, green: 0.855, blue: 0.973 }; // value cells / note body
const LINK_BLUE = { red: 0.067, green: 0.333, blue: 0.8 }; // Sheets' own hyperlink colour

const STYLES = {
  logo: { bg: BLACK, fg: WHITE, bold: true, italic: false, align: "CENTER", size: 14 },
  navyBand: { bg: NAVY, fg: WHITE, bold: true, italic: false, align: "CENTER", size: 12 },
  blueBand: { bg: MED_BLUE, fg: WHITE, bold: true, italic: true, align: "CENTER", size: 11 },
  titlePlain: { bg: WHITE, fg: BLACK, bold: true, italic: false, align: "LEFT", size: 12 },
  label: { bg: MED_BLUE, fg: BLACK, bold: true, italic: false, align: "LEFT", size: 10 },
  value: { bg: LIGHT_BLUE, fg: BLACK, bold: true, italic: false, align: "CENTER", size: 10 },
  note: { bg: LIGHT_BLUE, fg: BLACK, bold: false, italic: true, align: "LEFT", size: 9 },
  tableHeader: { bg: MED_BLUE, fg: WHITE, bold: true, italic: true, align: "CENTER", size: 10 },
  data: { bg: WHITE, fg: BLACK, bold: false, italic: true, align: "LEFT", size: 10 },
};

/** Google Sheets caps a tab title at 100 chars; keep comfortably under. */
function truncate(s, max) {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/**
 * One shared spreadsheet holds every plan's tabs (see plans/service.js's
 * generatePlanSheet for why — a service account has no Drive storage quota
 * of its own to create brand-new spreadsheets in), so titles need to stay
 * unique across every plan ever generated, not just within one plan's pair
 * of tabs. The plan id's last 6 chars are enough entropy for that while
 * staying legible, same spirit as a short order/ticket number.
 */
const OVERVIEW_PREFIX = "Overview of ";
const INTERNAL_PREFIX = "INTERNAL — ";

export function planSheetTabTitles(plan, { internal = false } = {}) {
  const prefix = internal ? INTERNAL_PREFIX : "";
  const suffix = ` · ${plan.id?.slice(-6) ?? ""}`;
  const base = truncate(`${plan.name} · ${plan.variantLabel ?? "Plan A"}`, 100 - prefix.length - OVERVIEW_PREFIX.length - suffix.length);
  return { overviewTitle: `${prefix}${OVERVIEW_PREFIX}${base}${suffix}`, pagesTitle: `${prefix}${base}${suffix}` };
}

// ── Row-spec builder — each "section" pushes both a values row and its
// matching format spec in lockstep, so the two can never drift apart. ────
function makeSection() {
  const rows = [];
  const rowSpecs = [];
  return {
    rows,
    rowSpecs,
    /** A row that's one visual band — every cell merged into one, styled as `type`. */
    band(cells, type) {
      rows.push(cells);
      rowSpecs.push({ cellTypes: [type], merge: true });
    },
    /** A row with one style per column (e.g. ["label", "value"]). `links`
     *  ({ [col]: uri }) makes those cells clickable while their text stays
     *  the visible value — a cell-level link, not a =HYPERLINK() formula
     *  (user request, 22 Sep — "page link ... should have hyperlink of that
     *  link as well, so can be redirected to instagram page"). */
    row(cells, cellTypes, { links } = {}) {
      rows.push(cells);
      rowSpecs.push({ cellTypes, merge: false, ...(links ? { links } : {}) });
    },
    /** Plain, unstyled text — still real content, just no color/weight. */
    plain(cells) {
      rows.push(cells);
      rowSpecs.push({ cellTypes: cells.map(() => null), merge: false });
    },
    spacer() {
      rows.push([]);
      rowSpecs.push({ cellTypes: [], merge: false });
    },
  };
}

export function buildPlanSheetTabs(plan, { internal = false } = {}) {
  const { overviewTitle, pagesTitle } = planSheetTabTitles(plan, { internal });
  const overview = buildOverviewSection(plan, internal);
  const pages = buildPagesSection(plan, internal);
  return {
    overviewTitle,
    overviewRows: overview.rows,
    overviewRowSpecs: overview.rowSpecs,
    overviewNumCols: 2,
    pagesTitle,
    pagesRows: pages.rows,
    pagesRowSpecs: pages.rowSpecs,
    pagesNumCols: internal ? 7 : 6,
  };
}

// A fixed, single tab (not per-plan) — the sample template (user request,
// 10 Sep — "give downloadable sample template for google sheet so they'll
// know how their execution should look like"; 11 Sep — pointed at a
// specific reference doc to match exactly: S No / Page Name / Page Link /
// Followers / Date / Posted link, plus a totals row summing Followers.
// Views/Likes/Comments/Shares dropped (user request, 23 Sep — "should
// support till column posted links ... not required"). A couple of
// example rows, not a blank grid, so it reads as "fill it in like this"
// rather than an empty form.
export const EXECUTION_TEMPLATE_TITLE = "Sample — Execution Sheet Template";
const EXECUTION_TEMPLATE_HEADER = ["S No", "Page Name", "Page Link", "Followers", "Date", "Posted Link"];

// Shared by buildExecutionSheetTemplate() (the live Google Sheet download,
// below) and previewExecutionSheetTemplate() (the in-app preview table,
// see plans/routes.js's GET /execution-sheet-template/preview) so the two
// can never drift apart on what the sample actually shows.
const EXECUTION_TEMPLATE_EXAMPLES = [
  { sNo: 1, pageName: "ghantaa", pageHandle: "ghantaa", followers: 8700000, date: "10 Sept 2026", postUrl: "https://instagram.com/reel/example1" },
  { sNo: 2, pageName: "Laughter Colours", pageHandle: "laughter.colours", followers: 4300000, date: "10 Sept 2026", postUrl: "https://instagram.com/reel/example2" },
];

function executionTemplateTotals() {
  return EXECUTION_TEMPLATE_EXAMPLES.reduce((acc, ex) => ({ followers: acc.followers + ex.followers }), { followers: 0 });
}

export function buildExecutionSheetTemplate() {
  const s = makeSection();
  s.band(["Fill in one row per post actually published — this is a sample, not a form to submit directly."], "note");
  s.row(EXECUTION_TEMPLATE_HEADER, EXECUTION_TEMPLATE_HEADER.map(() => "tableHeader"));
  for (const ex of EXECUTION_TEMPLATE_EXAMPLES) {
    s.row(
      [ex.sNo, ex.pageName, `https://instagram.com/${ex.pageHandle}`, ex.followers, ex.date, ex.postUrl],
      EXECUTION_TEMPLATE_HEADER.map(() => "data"),
      { links: { 2: `https://instagram.com/${ex.pageHandle}`, 5: ex.postUrl } }
    );
  }
  const t = executionTemplateTotals();
  s.row(["", "TOTAL", "", t.followers, "", ""], ["tableHeader", "tableHeader", "tableHeader", "tableHeader", "tableHeader", "tableHeader"]);
  return { title: EXECUTION_TEMPLATE_TITLE, rows: s.rows, rowSpecs: s.rowSpecs, numCols: EXECUTION_TEMPLATE_HEADER.length };
}

/**
 * Same sample data as buildExecutionSheetTemplate() above, shaped as plain
 * headers/rows for the in-app "Preview template" table (user request, 11
 * Sep — "show in preview" before pasting an execution sheet link) instead
 * of Sheets-API formula-wrapped cells. No Google OAuth call and no live
 * spreadsheet involved, so it's instant and works even when Google isn't
 * connected — unlike the live download above. `linkColumns` names which
 * header indexes the client should render as clickable links.
 */
export function previewExecutionSheetTemplate() {
  const t = executionTemplateTotals();
  return {
    title: EXECUTION_TEMPLATE_TITLE,
    headers: EXECUTION_TEMPLATE_HEADER,
    linkColumns: [2, 5],
    rows: EXECUTION_TEMPLATE_EXAMPLES.map((ex) => [ex.sNo, ex.pageName, `https://instagram.com/${ex.pageHandle}`, ex.followers, ex.date, ex.postUrl]),
    totalsRow: ["", "TOTAL", "", t.followers, "", ""],
  };
}

function buildOverviewSection(plan, internal) {
  const s = makeSection();
  s.band(["TAGGIFY"], "logo");
  s.plain([internal ? `${plan.name} — INTERNAL, NOT FOR CLIENT` : plan.name]);
  s.plain([`Prepared for ${plan.clientName} · ${dateStr(plan.createdAt)}`]);
  if (plan.clientContact) s.plain([plan.clientContact]);
  const clientDetails = [plan.clientCompany, plan.clientGstNumber && `GSTIN: ${plan.clientGstNumber}`, plan.clientAddress].filter(Boolean);
  if (clientDetails.length > 0) s.plain([clientDetails.join(" · ")]);
  s.spacer();

  const followers = internal ? plan.internal.computedFollowers : plan.overview.totalFollowers;
  const posts = internal ? plan.internal.computedPosts : plan.overview.totalPosts;
  const impressions = internal ? plan.internal.computedImpressions : plan.overview.expectedImpressions;
  const subtotal = internal ? plan.internal.computedSubtotal : plan.overview.subtotal;
  const gstAmount = internal ? plan.internal.computedGstAmount : plan.overview.gstAmount;
  const total = internal ? plan.internal.computedTotal : plan.overview.total;

  s.band([internal ? "INTERNAL OVERVIEW" : "CAMPAIGN OVERVIEW"], "navyBand");
  s.row(["Total Followers Targeted Overall", followers], ["label", "value"]);
  s.row(["Total Posts", posts], ["label", "value"]);
  s.row(["Expected Impressions", `${impressions} (est.)`], ["label", "value"]);
  s.row([internal ? "Internal Cost" : "Cost", money(subtotal)], ["label", "value"]);
  if (plan.isGstPlan) s.row([`GST (${plan.gstPercent}%)`, money(gstAmount)], ["label", "value"]);
  s.row([plan.isGstPlan ? "Total Cost" : "Total Cost (excl. GST)", money(total)], ["label", "value"]);
  if (internal && plan.budgetVariance != null) {
    s.row([plan.budgetVariance < 0 ? "Over Budget" : "Under Budget", money(Math.abs(plan.budgetVariance))], ["label", "value"]);
  }
  s.spacer();

  // Only the brief typed on Step 1 goes here — no boilerplate (user request,
  // 14 Sep — "note in google sheet will be only the note filled by us").
  if (plan.notes) {
    s.band(["NOTES"], "blueBand");
    s.band([plan.notes], "note");
  }

  return s;
}

function buildPagesSection(plan, internal) {
  const s = makeSection();
  const header = ["S No", "Page Name", "Page Link", "Followers", "Format", "Post Per Profile", ...(internal ? ["Cost/Post"] : [])];
  s.row(header, header.map(() => "tableHeader"));

  if (plan.items.length === 0) {
    s.band(["No pages added yet."], "note");
    return s;
  }

  // One flat list, not a block per category (user request, 14 Sep — "it
  // won't for each category, all pages will display, same in google sheet").
  plan.items.forEach((item, i) => {
    const handle = item.asset?.handle ?? "—";
    // Bare handle and the profile URL as its own visible text (user request,
    // 22 Sep — "page name showing @ in front, please remove it ... show
    // original link not hyper links"), with the cell itself linked so a
    // click opens the page (later that day — "should have hyperlink of that
    // link as well"). Not a =HYPERLINK() formula: the sheet is written RAW.
    const pageUrl = `https://instagram.com/${handle}`;
    const row = [i + 1, handle, pageUrl, item.asset?.followers ?? 0, item.format, item.postsPerProfile];
    if (internal) row.push(money(item.cost));
    s.row(row, header.map(() => "data"), item.asset?.handle ? { links: { 2: pageUrl } } : {});
  });
  return s;
}

// ── Format-request builder — turns a section's rowSpecs into Sheets API
// batchUpdate requests for a given tab's numeric sheetId. ───────────────
const THIN_BLACK = { style: "SOLID", width: 1, color: BLACK };

function fullRange(sheetId, numRows, numCols) {
  return { sheetId, startRowIndex: 0, endRowIndex: numRows, startColumnIndex: 0, endColumnIndex: numCols };
}
function rowRange(sheetId, row, colStart, colEnd) {
  return { sheetId, startRowIndex: row, endRowIndex: row + 1, startColumnIndex: colStart, endColumnIndex: colEnd };
}
function cellStyleRequest(range, style) {
  return {
    repeatCell: {
      range,
      cell: {
        userEnteredFormat: {
          backgroundColor: style.bg,
          horizontalAlignment: style.align,
          textFormat: { foregroundColor: style.fg, bold: style.bold, italic: style.italic, fontSize: style.size, underline: style.underline ?? false },
        },
      },
      fields: "userEnteredFormat(backgroundColor,horizontalAlignment,textFormat)",
    },
  };
}

/**
 * `rowSpecs`/`numCols` from buildOverviewSection/buildPagesSection above.
 * Resets formatting first (not just an overwrite) so regenerating a plan
 * whose row count shrank doesn't leave stale styling past the new content
 * — same "clear, don't overwrite-in-place" reasoning writeSheetTab already
 * uses for values.
 */
export function buildFormatRequests(sheetId, rowSpecs, numCols) {
  const numRows = rowSpecs.length;
  if (numRows === 0) return [];
  const requests = [
    { unmergeCells: { range: fullRange(sheetId, numRows, numCols) } },
    { repeatCell: { range: fullRange(sheetId, numRows, numCols), cell: { userEnteredFormat: {} }, fields: "userEnteredFormat" } },
  ];

  rowSpecs.forEach((spec, i) => {
    if (spec.merge) {
      const range = rowRange(sheetId, i, 0, numCols);
      requests.push({ mergeCells: { range, mergeType: "MERGE_ALL" } });
      const style = STYLES[spec.cellTypes[0]];
      if (style) requests.push(cellStyleRequest(range, style));
    } else {
      spec.cellTypes.forEach((type, col) => {
        if (!type) return;
        const style = STYLES[type];
        if (!style) return;
        requests.push(cellStyleRequest(rowRange(sheetId, i, col, col + 1), style));
      });
      // Clickable cells — after the style request, which rewrites textFormat
      // wholesale and would otherwise drop the link.
      for (const [col, uri] of Object.entries(spec.links ?? {})) {
        requests.push({
          repeatCell: {
            range: rowRange(sheetId, i, Number(col), Number(col) + 1),
            cell: { userEnteredFormat: { textFormat: { link: { uri }, underline: true, foregroundColor: LINK_BLUE } } },
            fields: "userEnteredFormat.textFormat.link,userEnteredFormat.textFormat.underline,userEnteredFormat.textFormat.foregroundColor",
          },
        });
      }
    }
  });

  requests.push({
    updateBorders: {
      range: fullRange(sheetId, numRows, numCols),
      top: THIN_BLACK,
      bottom: THIN_BLACK,
      left: THIN_BLACK,
      right: THIN_BLACK,
      innerHorizontal: THIN_BLACK,
      innerVertical: THIN_BLACK,
    },
  });

  return requests;
}
