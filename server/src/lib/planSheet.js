import { compactFollowers } from "./followers.js";
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
// Approval status (user request, 29 Sep — only the approved plan of a pitch
// group reads "Active"; its siblings "Not active"), on the band + tab colour.
const ACTIVE_GREEN = { red: 0.204, green: 0.659, blue: 0.325 };
const INACTIVE_RED = { red: 0.851, green: 0.263, blue: 0.227 };

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
  statusActive: { bg: ACTIVE_GREEN, fg: WHITE, bold: true, italic: false, align: "CENTER", size: 11 },
  statusInactive: { bg: INACTIVE_RED, fg: WHITE, bold: true, italic: false, align: "CENTER", size: 11 },
};

/**
 * "Active" only for an approved plan — the one that actually went ahead. A
 * draft, one awaiting approval, or a rejected one is "Not active" (user
 * request, 29 Sep — "only plan a is approved it would show active ... and
 * unapproved will show not active").
 */
export function isActivePlan(plan) {
  return plan.status === "APPROVED";
}
function statusLabel(plan) {
  return isActivePlan(plan) ? "Active" : "Not active";
}
function statusBand(s, plan) {
  s.band([isActivePlan(plan) ? "● ACTIVE — approved plan" : "● NOT ACTIVE — not approved"], isActivePlan(plan) ? "statusActive" : "statusInactive");
}

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

const variantOf = (plan) => plan.variantLabel ?? "Plan A";

/**
 * Title shape: `[INTERNAL — ][Overview of ]<name> · <Plan X> · <Active|Not active>[ · <id6>]`.
 * Only the plan name is ever truncated — the variant and status are what a
 * reader scans for, and (see planTabOwnedBy) what finds the tab again.
 *
 * The client file identifies a plan's tabs by its variant label (unique within
 * a pitch group's file) and carries no id — it never had one in practice
 * (forClientPdf's output has no id, so the old suffix came out empty) and a
 * random code has no business in a tab name the client reads. The internal
 * file keeps the id suffix it has always had.
 */
export function planSheetTabTitles(plan, { internal = false } = {}) {
  const prefix = internal ? INTERNAL_PREFIX : "";
  const tail = ` · ${variantOf(plan)} · ${statusLabel(plan)}${internal ? ` · ${plan.id?.slice(-6) ?? ""}` : ""}`;
  const name = truncate(plan.name ?? "", 100 - prefix.length - OVERVIEW_PREFIX.length - tail.length);
  return { overviewTitle: `${prefix}${OVERVIEW_PREFIX}${name}${tail}`, pagesTitle: `${prefix}${name}${tail}` };
}

/** A page tab's separator between its category label and the plan's own title. */
const CATEGORY_SEP = " — ";

/**
 * One page tab per category (8 Oct — both sample plans split pages that way):
 * `[INTERNAL — ]<Category label> — <name> · <Plan X> · <status>[ · <id6>]`.
 */
export function pageTabTitle(plan, label, { internal = false } = {}) {
  const prefix = internal ? INTERNAL_PREFIX : "";
  const tail = ` · ${variantOf(plan)} · ${statusLabel(plan)}${internal ? ` · ${plan.id?.slice(-6) ?? ""}` : ""}`;
  const head = `${prefix}${truncate(label, 40)}${CATEGORY_SEP}`;
  return `${head}${truncate(plan.name ?? "", 100 - head.length - tail.length)}${tail}`;
}

/** The category part of a page tab title (null for the single all-pages tab older sheets had). */
function categoryKeyOf(title, internal) {
  const body = internal && title.startsWith(INTERNAL_PREFIX) ? title.slice(INTERNAL_PREFIX.length) : title;
  const at = body.indexOf(CATEGORY_SEP);
  return at > 0 ? body.slice(0, at) : null;
}

/**
 * Whether an existing tab belongs to `plan`, whatever name or status it was
 * written under. Internal: its id suffix. Client: its variant label followed by
 * a status, or by the bare " · " every client tab ended with before 29 Sep.
 */
function planTabOwnedBy(title, plan, internal) {
  if (internal) return title.endsWith(` · ${plan.id?.slice(-6)}`);
  const v = ` · ${variantOf(plan)} · `;
  return title.endsWith(`${v}Active`) || title.endsWith(`${v}Not active`) || title.endsWith(v);
}

/**
 * Tabs are addressed by title, so any change to a title — the plan renamed,
 * or its status flipping between Active and Not active — would otherwise make
 * the next write add a fresh tab pair and leave the old one behind in the
 * client's sheet for good. This finds each plan's existing tabs by the id at
 * the end of the title and renames them in place (keeping their gid, so shared
 * deep-links keep working), and deletes any stray duplicate a past rename
 * already left. Pure: returns the batchUpdate requests to send.
 *
 * `existing` is the spreadsheet's tabs ({ title, sheetId }); `sheets` is what
 * generatePlanSheet is about to write ({ plan, overviewTitle, pagesTitle }).
 */
export function reconcilePlanTabRequests(existing, sheets, { internal = false } = {}) {
  const overviewStart = `${internal ? INTERNAL_PREFIX : ""}${OVERVIEW_PREFIX}`;
  const requests = [];
  // A tab is claimed by at most one plan — two siblings can never both
  // rename (or one rename and the other delete) the same tab in one batch.
  const claimed = new Set();
  const rename = (tab, title) => {
    if (tab.title !== title) requests.push({ updateSheetProperties: { properties: { sheetId: tab.sheetId, title }, fields: "title" } });
  };
  for (const { plan, overviewTitle, pageTabs } of sheets) {
    const mine = existing.filter((t) => !claimed.has(t.sheetId) && planTabOwnedBy(t.title, plan, internal));
    for (const t of mine) claimed.add(t.sheetId);

    // Overview: the one the plan's saved (and possibly already shared) link
    // points at wins when a rename left two candidates, so the link still lands on it.
    const linkedGid = Number(/[?#&]gid=(\d+)/.exec((internal ? plan.internalSheetUrl : plan.clientSheetUrl) ?? "")?.[1]);
    const overviews = mine.filter((t) => t.title.startsWith(overviewStart));
    const keepOverview = overviews.find((t) => t.title === overviewTitle) ?? overviews.find((t) => t.sheetId === linkedGid) ?? overviews[0];
    if (keepOverview) rename(keepOverview, overviewTitle);
    for (const stray of overviews) if (stray !== keepOverview) requests.push({ deleteSheet: { sheetId: stray.sheetId } });

    // Page tabs, one per category (8 Oct): each wanted tab keeps the existing
    // tab with its exact title or, after a plan rename / status flip, the one
    // for the same category. Anything left — a category no longer on the
    // plan, or the single all-pages tab older sheets had — is removed.
    const pages = mine.filter((t) => !t.title.startsWith(overviewStart));
    const kept = new Set();
    for (const { title } of pageTabs) {
      const key = categoryKeyOf(title, internal);
      const keep = pages.find((t) => !kept.has(t) && t.title === title) ?? pages.find((t) => !kept.has(t) && key && categoryKeyOf(t.title, internal) === key);
      if (!keep) continue; // first write of this tab — ensureSheetTabsExist creates it
      kept.add(keep);
      rename(keep, title);
    }
    for (const stray of pages) if (!kept.has(stray)) requests.push({ deleteSheet: { sheetId: stray.sheetId } });
  }
  return requests;
}

/** The tab itself coloured by status, so Active/Not active shows in the tab strip, not just on the page. */
export function tabStatusRequests(sheetId, plan) {
  return [
    {
      updateSheetProperties: {
        properties: { sheetId, tabColorStyle: { rgbColor: isActivePlan(plan) ? ACTIVE_GREEN : INACTIVE_RED } },
        fields: "tabColorStyle",
      },
    },
  ];
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

/** The two client-facing layouts a plan's sheet can use (8 Oct); the plan stores its choice. */
export const SHEET_FORMATS = ["breakdown", "summary"];

export function buildPlanSheetTabs(plan, { internal = false } = {}) {
  const { overviewTitle } = planSheetTabTitles(plan, { internal });
  const groups = groupByCategory(plan.items ?? []);
  const overview = plan.sheetFormat === "summary" ? buildSummaryOverview(plan, internal) : buildBreakdownOverview(plan, internal, groups);
  // Tab names must be unique (ignoring case); two long labels cut to the same 40 characters get a number.
  const used = new Set();
  const pageTabs = groups.map((g) => {
    const section = buildPagesSection(plan, internal, g.items);
    let title = pageTabTitle(plan, g.label, { internal });
    for (let n = 2; used.has(title.toLowerCase()); n++) title = pageTabTitle(plan, `${truncate(g.label, 34)} (${n})`, { internal });
    used.add(title.toLowerCase());
    return { title, rows: section.rows, rowSpecs: section.rowSpecs, numCols: PAGE_HEADER.length + (internal ? 1 : 0) };
  });
  return { overviewTitle, overviewRows: overview.rows, overviewRowSpecs: overview.rowSpecs, overviewNumCols: overview.numCols, pageTabs };
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
      [ex.sNo, ex.pageName, `https://instagram.com/${ex.pageHandle}`, compactFollowers(ex.followers), ex.date, ex.postUrl],
      EXECUTION_TEMPLATE_HEADER.map(() => "data"),
      { links: { 2: `https://instagram.com/${ex.pageHandle}`, 5: ex.postUrl } }
    );
  }
  const t = executionTemplateTotals();
  s.row(["", "TOTAL", "", compactFollowers(t.followers), "", ""], ["tableHeader", "tableHeader", "tableHeader", "tableHeader", "tableHeader", "tableHeader"]);
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
    rows: EXECUTION_TEMPLATE_EXAMPLES.map((ex) => [ex.sNo, ex.pageName, `https://instagram.com/${ex.pageHandle}`, compactFollowers(ex.followers), ex.date, ex.postUrl]),
    totalsRow: ["", "TOTAL", "", compactFollowers(t.followers), "", ""],
  };
}

// ── Plan sheet formats (8 Oct — "2 types of format to generate plan, user
// will select 1"), modelled on the two sample plans shared that day:
//  - "breakdown" (sample 1, "5 Paisa<>Taggify"): a table with one row per
//    page category, then totals, GST and the standard notes;
//  - "summary" (sample 2): one campaign-overview block with CPV.
// Both put the pages in one tab per category, and print the sample's
// standard notes followed by the plan's own brief.

const BREAKDOWN_NOTES = [
  "All media placements are subject to the availability and guidelines of each platform or partner. Taggify cannot guarantee placement on any specific channel if it becomes unavailable or if external factors intervene.",
  "Taggify manages post visibility for 45 days from publication and is not responsible for status beyond that period.",
  "The pricing outlined in our plan is valid for 20 days from the date it’s shared. After this period, Taggify reserves the right to modify costs based on market changes or updated project requirements.",
  "In order to maximize reach and consistency, Taggify will adapt and repurpose content for internal and external channels as needed. The number of versions or formats may vary depending on project scope.",
  "Our quoted fees include the cost of generating original content.",
  "The exact count of unique deliverables may change as we refine the strategy in response to audience insights, platform performance, or client feedback.",
  "Taggify may engage trusted subcontractors for specialized tasks. All partners are contractually bound to uphold our standards and maintain client confidentiality.",
];
const SUMMARY_NOTES = [
  "All prices mentioned above are exclusive of GST.",
  "Prices are applicable till next 20 days.",
  "All the mentioned accounts are subject to availability. In case any of them are unavailable at the time of execution, suitable and equivalent replacements will be provided.",
];

const rupees = (n) => `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;
/** 19,300,000 → "19.3" (the samples' "in Millions" columns). */
const inMillions = (n) => (Math.round(((Number(n) || 0) / 1_000_000) * 10) / 10).toString();
/** 86,700,000 → "86 Million +", 850,000 → "850K +" (sample 2's overview). */
function roughly(n) {
  const v = Number(n) || 0;
  if (v >= 1_000_000) return `${Math.floor(v / 1_000_000)} Million +`;
  if (v >= 1000) return `${Math.floor(v / 1000)}K +`;
  return String(v);
}

/** "News" → "News Pages", "Meme page" → "Meme Pages", "Coverage Handles" stays; none → "Other Pages". */
export function categoryLabel(category) {
  const c = (category ?? "").trim();
  if (!c) return "Other Pages";
  // " — " separates a tab's category from the plan's title, so it never appears inside a label.
  const titled = c.replace(/\s+—\s+/g, " - ").replace(/\s+/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase());
  if (/\bhandles?$/i.test(titled)) return titled;
  return /\bpages?$/i.test(titled) ? titled.replace(/\bpages?$/i, "Pages") : `${titled} Pages`;
}

/** Plan lines grouped by page category, biggest audience first; pages inside by followers. */
function groupByCategory(items) {
  // Keyed case-insensitively: "news" and "NEWS" are one category (and one tab — Sheets tab names ignore case).
  const byKey = new Map();
  for (const item of items) {
    const label = categoryLabel(item.asset?.category);
    const key = label.toLowerCase();
    if (!byKey.has(key)) byKey.set(key, { label, items: [] });
    byKey.get(key).items.push(item);
  }
  const followersOf = (list) => distinctPages(list).reduce((sum, i) => sum + (i.asset?.followers ?? 0), 0);
  return [...byKey.values()]
    .map(({ label, items: list }) => ({ label, items: [...list].sort((a, b) => (b.asset?.followers ?? 0) - (a.asset?.followers ?? 0)) }))
    .sort((a, b) => followersOf(b.items) - followersOf(a.items));
}

/** One line per page: a page with a reel and a story counts its audience once. */
function distinctPages(items) {
  const seen = new Set();
  return items.filter((i) => {
    const key = i.asset?.handle ?? i;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const posts = (items) => items.reduce((sum, i) => sum + (i.postsPerProfile ?? 1), 0);
const lineCost = (i, internal) => (internal ? Number(i.cost) : Number(i.displayCost)) * (i.postsPerProfile ?? 1);

/**
 * Splits `total` across `weights` in proportion, in whole rupees/views that
 * add up exactly to the rounded total (the last share takes the rounding).
 * Used for the client's quoted total and expected views per category, so a
 * category row never claims more than the overall figure the client sees.
 */
export function splitByWeight(total, weights) {
  const whole = Math.round(Number(total) || 0);
  const sum = weights.reduce((a, b) => a + b, 0);
  if (weights.length === 0) return [];
  const shares = weights.map((w) => (sum > 0 ? Math.floor((whole * w) / sum) : Math.floor(whole / weights.length)));
  shares[shares.length - 1] += whole - shares.reduce((a, b) => a + b, 0);
  return shares;
}

function heading(s, plan, internal) {
  statusBand(s, plan);
  s.band([internal ? `${plan.clientName} <> Taggify — INTERNAL, NOT FOR CLIENT` : `${plan.clientName} <> Taggify`], "navyBand");
  s.plain([`${plan.name} · ${variantOf(plan)} · ${dateStr(plan.createdAt)}`]);
  if (plan.clientContact) s.plain([plan.clientContact]);
  // Client details (10 Sep) stay on the sheet whichever format it uses.
  const clientDetails = [plan.clientCompany, plan.clientGstNumber && `GSTIN: ${plan.clientGstNumber}`, plan.clientAddress].filter(Boolean);
  if (clientDetails.length > 0) s.plain([clientDetails.join(" · ")]);
  s.spacer();
}

/** Internal sheet only: how the pages' cost sits against the plan's budget. */
function budgetRow(plan) {
  return plan.budgetVariance != null ? [plan.budgetVariance < 0 ? "Over Budget" : "Under Budget", rupees(Math.abs(plan.budgetVariance))] : null;
}

function notes(s, plan, standard) {
  s.spacer();
  s.band(["NOTES"], "blueBand");
  for (const n of standard) s.band([n], "note");
  // The plan's own brief follows the standard notes (8 Oct).
  if (plan.notes) s.band([plan.notes], "note");
}

/** Sample 1: a row per page category, totals, GST, notes. */
function buildBreakdownOverview(plan, internal, groups) {
  const s = makeSection();
  const numCols = 7;
  heading(s, plan, internal);
  const header = ["Particulars", "Utilization", "Followers Count (in Millions)", "Followers Range", "No. of Items", internal ? "Internal Cost" : "Total Final Cost", "Expected Views/Reach (in Millions)"];
  s.row(header, header.map(() => "tableHeader"));

  const subtotal = internal ? groups.reduce((sum, g) => sum + g.items.reduce((a, i) => a + lineCost(i, true), 0), 0) : plan.overview.subtotal;
  const views = internal ? plan.internal.computedImpressions : plan.overview.expectedImpressions;
  const costs = internal ? groups.map((g) => g.items.reduce((a, i) => a + lineCost(i, true), 0)) : splitByWeight(subtotal, groups.map((g) => g.items.reduce((a, i) => a + lineCost(i, false), 0)));
  const reach = splitByWeight(views, groups.map((g) => g.items.reduce((a, i) => a + (i.expectedViews ?? 0), 0)));

  let followersTotal = 0;
  groups.forEach((g, n) => {
    const pages = distinctPages(g.items);
    const counts = pages.map((i) => i.asset?.followers ?? 0);
    const followers = counts.reduce((a, b) => a + b, 0);
    followersTotal += followers;
    const formats = [...new Set(g.items.map((i) => (i.format === "story" ? "Story" : "Reel")))].join("/");
    const range = counts.length ? `${compactFollowers(Math.min(...counts))}-${compactFollowers(Math.max(...counts))}` : "—";
    s.row([g.label, `Instagram ${formats}`, inMillions(followers), range, posts(g.items), rupees(costs[n]), inMillions(reach[n])], ["label", "data", "data", "data", "data", "data", "data"]);
  });
  if (groups.length === 0) s.band(["No pages added yet."], "note");

  const allItems = groups.flatMap((g) => g.items);
  s.row(["Total", "", inMillions(followersTotal), "", posts(allItems), rupees(subtotal), inMillions(views)], header.map(() => "label"));
  if (internal) {
    s.row(["", "", "", "", "Quoted to client", rupees(plan.overview.subtotal), ""], [null, null, null, null, "label", "value", null]);
    s.row(["", "", "", "", "Margin", rupees(plan.overview.subtotal - subtotal), ""], [null, null, null, null, "label", "value", null]);
    const budget = budgetRow(plan);
    if (budget) s.row(["", "", "", "", ...budget, ""], [null, null, null, null, "label", "value", null]);
  } else if (plan.isGstPlan) {
    s.row(["", "", "", "", `GST (${plan.gstPercent}%)`, rupees(plan.overview.gstAmount), ""], [null, null, null, null, "label", "value", null]);
    s.row(["", "", "", "", "Total", rupees(plan.overview.total), ""], [null, null, null, null, "label", "value", null]);
  }
  notes(s, plan, BREAKDOWN_NOTES);
  return { rows: s.rows, rowSpecs: s.rowSpecs, numCols };
}

/** Sample 2: one campaign-overview block with cost per view. */
function buildSummaryOverview(plan, internal) {
  const s = makeSection();
  const numCols = 2;
  heading(s, plan, internal);
  const followers = internal ? plan.internal.computedFollowers : plan.overview.totalFollowers;
  const deliverables = internal ? plan.internal.computedPosts : plan.overview.totalPosts;
  const views = internal ? plan.internal.computedImpressions : plan.overview.expectedImpressions;
  const cost = internal ? (plan.items ?? []).reduce((a, i) => a + lineCost(i, true), 0) : plan.overview.subtotal;

  s.band([internal ? "INTERNAL OVERVIEW" : "CAMPAIGN OVERVIEW"], "navyBand");
  s.row(["Total Followers Targeted Overall", roughly(followers)], ["label", "value"]);
  s.row(["Total Deliverables", deliverables], ["label", "value"]);
  s.row(["Expected Impressions/Views", roughly(views)], ["label", "value"]);
  s.row([internal ? "Internal Cost" : "Cost", rupees(cost)], ["label", "value"]);
  s.row(["CPV", views > 0 ? (cost / views).toFixed(2) : "—"], ["label", "value"]);
  if (internal) {
    s.row(["Quoted to client", rupees(plan.overview.subtotal)], ["label", "value"]);
    s.row(["Margin", rupees(plan.overview.subtotal - cost)], ["label", "value"]);
    const budget = budgetRow(plan);
    if (budget) s.row(budget, ["label", "value"]);
  }
  notes(s, plan, SUMMARY_NOTES);
  return { rows: s.rows, rowSpecs: s.rowSpecs, numCols };
}

const PAGE_HEADER = ["S No", "Page Name", "Page Link", "Followers", "Format", "Post Per Profile"];

/** One category's pages (both samples' page tabs), with a followers total. */
function buildPagesSection(plan, internal, items) {
  const s = makeSection();
  const header = [...PAGE_HEADER, ...(internal ? ["Cost/Post"] : [])];
  statusBand(s, plan);
  s.row(header, header.map(() => "tableHeader"));

  items.forEach((item, i) => {
    const handle = item.asset?.handle ?? "—";
    // Bare handle and the profile URL as its own visible text (22 Sep), with
    // the cell itself linked — not a =HYPERLINK() formula: the sheet is written RAW.
    const pageUrl = `https://instagram.com/${handle}`;
    const row = [i + 1, handle, pageUrl, compactFollowers(item.asset?.followers ?? 0), item.format, item.postsPerProfile];
    if (internal) row.push(money(item.cost));
    s.row(row, header.map(() => "data"), item.asset?.handle ? { links: { 2: pageUrl } } : {});
  });
  const followers = distinctPages(items).reduce((sum, i) => sum + (i.asset?.followers ?? 0), 0);
  s.row(["", "Total", "", compactFollowers(followers), "", posts(items), ...(internal ? [""] : [])], header.map(() => "label"));
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
