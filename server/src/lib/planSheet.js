import { compactFollowers } from "./followers.js";
import { formatLabel, postsPerUnit } from "./formats.js";
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
 *
 * 16 Oct: the status is INTERNAL only. The client sheet carries no
 * Active/Not active mark anywhere — not in tab names, not as a band, not as
 * a tab colour ("in client sheet it should not show active mark").
 */
export function isActivePlan(plan) {
  return plan.status === "APPROVED";
}
function statusLabel(plan) {
  return isActivePlan(plan) ? "Active" : "Not active";
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
/** `· Plan X[ · status · id6]` — status and id only on the internal file (16 Oct). */
function titleTail(plan, internal) {
  return internal ? ` · ${variantOf(plan)} · ${statusLabel(plan)} · ${plan.id?.slice(-6) ?? ""}` : ` · ${variantOf(plan)}`;
}

export function planSheetTabTitles(plan, { internal = false } = {}) {
  const prefix = internal ? INTERNAL_PREFIX : "";
  const tail = titleTail(plan, internal);
  const name = truncate(plan.name ?? "", 100 - prefix.length - OVERVIEW_PREFIX.length - tail.length);
  return { overviewTitle: `${prefix}${OVERVIEW_PREFIX}${name}${tail}`, pagesTitle: `${prefix}${name}${tail}` };
}

/**
 * "Plan comparison" layout (23 Nov — "overview of multiple plans should be in
 * one tab only"; sample 3): one Overview tab for the whole pitch group, Plan A /
 * Plan B / … side by side. Client: `Overview of <name> · All plans`. Internal:
 * `INTERNAL — Overview of <name> · All plans (<group id6>)` — the closing ")"
 * keeps planTabOwnedBy from reading it as one plan's own tab.
 */
const COMBINED_TAIL = " · All plans";
export function comparisonOverviewTitle(group, { internal = false } = {}) {
  const prefix = internal ? INTERNAL_PREFIX : "";
  const first = group[0] ?? {};
  const groupKey = (first.pitchGroupId ?? first.id ?? "").slice(-6);
  const tail = internal ? `${COMBINED_TAIL} (${groupKey})` : COMBINED_TAIL;
  const name = truncate(first.name ?? "", 100 - prefix.length - OVERVIEW_PREFIX.length - tail.length);
  return `${prefix}${OVERVIEW_PREFIX}${name}${tail}`;
}
/** Whether `title` is a combined overview tab (any plan name) for the group `pattern` was built for. */
function isCombinedOverview(title, internal, pattern) {
  const start = `${internal ? INTERNAL_PREFIX : ""}${OVERVIEW_PREFIX}`;
  if (!title.startsWith(start)) return false;
  if (!internal) return title.endsWith(COMBINED_TAIL);
  return title.endsWith(pattern.slice(pattern.lastIndexOf(`${COMBINED_TAIL} (`)));
}

/** A page tab's separator between its category label and the plan's own title. */
const CATEGORY_SEP = " — ";

/**
 * One page tab per category (8 Oct — both sample plans split pages that way):
 * `[INTERNAL — ]<Category label> — <name> · <Plan X> · <status>[ · <id6>]`.
 */
export function pageTabTitle(plan, label, { internal = false } = {}) {
  const prefix = internal ? INTERNAL_PREFIX : "";
  const tail = titleTail(plan, internal);
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
 * written under. Internal: its id suffix. Client: its variant label — bare
 * (16 Oct onwards), followed by a status (29 Sep – 16 Oct), or by the bare
 * " · " every client tab ended with before 29 Sep.
 */
function planTabOwnedBy(title, plan, internal) {
  if (internal) return title.endsWith(` · ${plan.id?.slice(-6)}`);
  const v = ` · ${variantOf(plan)} · `;
  return title.endsWith(` · ${variantOf(plan)}`) || title.endsWith(`${v}Active`) || title.endsWith(`${v}Not active`) || title.endsWith(v);
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
export function reconcilePlanTabRequests(existing, sheets, { internal = false, combinedTitle = null, combinedPattern = null } = {}) {
  const overviewStart = `${internal ? INTERNAL_PREFIX : ""}${OVERVIEW_PREFIX}`;
  const requests = [];
  // A tab is claimed by at most one plan — two siblings can never both
  // rename (or one rename and the other delete) the same tab in one batch.
  const claimed = new Set();
  const rename = (tab, title) => {
    if (tab.title !== title) requests.push({ updateSheetProperties: { properties: { sheetId: tab.sheetId, title }, fields: "title" } });
  };
  // Combined overview (23 Nov). `combinedPattern` recognises an existing one
  // even when the layout is per-plan again, so it is removed rather than left behind.
  const pattern = combinedTitle ?? combinedPattern;
  const combined = pattern ? existing.filter((t) => isCombinedOverview(t.title, internal, pattern)) : [];
  for (const t of combined) claimed.add(t.sheetId);
  let keepCombined = null;
  if (combinedTitle) {
    keepCombined = combined.find((t) => t.title === combinedTitle) ?? combined[0] ?? null;
    if (keepCombined) rename(keepCombined, combinedTitle);
  }
  for (const stray of combined) if (stray !== keepCombined) requests.push({ deleteSheet: { sheetId: stray.sheetId } });
  for (const { plan, overviewTitle, pageTabs } of sheets) {
    const mine = existing.filter((t) => !claimed.has(t.sheetId) && planTabOwnedBy(t.title, plan, internal));
    for (const t of mine) claimed.add(t.sheetId);

    // Overview: the one the plan's saved (and possibly already shared) link
    // points at wins when a rename left two candidates, so the link still lands on it.
    const linkedGid = Number(/[?#&]gid=(\d+)/.exec((internal ? plan.internalSheetUrl : plan.clientSheetUrl) ?? "")?.[1]);
    const overviews = mine.filter((t) => t.title.startsWith(overviewStart));
    // Comparison mode: no overview of its own. The first plan's old one becomes
    // the combined tab (keeping its gid, so a link already shared still opens); the rest go.
    let keepOverview = null;
    if (overviewTitle) {
      keepOverview = overviews.find((t) => t.title === overviewTitle) ?? overviews.find((t) => t.sheetId === linkedGid) ?? overviews[0];
      if (keepOverview) rename(keepOverview, overviewTitle);
    } else if (combinedTitle && !keepCombined && overviews.length > 0) {
      keepOverview = overviews.find((t) => t.sheetId === linkedGid) ?? overviews[0];
      keepCombined = keepOverview;
      rename(keepOverview, combinedTitle);
    }
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

/** Internal file only (16 Oct): the tab itself coloured by status, so Active/Not active shows in the tab strip. The client file gets no status colour. */
export function tabStatusRequests(sheetId, plan, { internal = false } = {}) {
  if (!internal) return [];
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
// "comparison" (23 Nov) is a pitch group's layout: one Overview tab with every plan side by side.
export const SHEET_FORMATS = ["breakdown", "summary", "comparison"];

export function buildPlanSheetTabs(plan, { internal = false, logoUrl = null } = {}) {
  const { overviewTitle } = planSheetTabTitles(plan, { internal });
  const groups = groupByCategory(plan.items ?? []);
  const overview = plan.sheetFormat === "summary" ? buildSummaryOverview(plan, internal, logoUrl) : buildBreakdownOverview(plan, internal, groups, logoUrl);
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

// A Reel + Story combo line is two posts per unit (14 Oct).
const posts = (items) => items.reduce((sum, i) => sum + (i.postsPerProfile ?? 1) * postsPerUnit(i.format), 0);
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

// ── Layouts cloned from the three reference sheets (23 Nov — "exact clone of
// the sheet … same font, highlight, size, cell size … for all 3 types of plan
// overview"). Measured from the samples' own files:
//   sample 1 "5 Paisa<>Taggify"  → breakdown   (Lexend 12, B:H, bands C9DAF8 / 6D9EEB)
//   sample 2 "CAMPAIGN OVERVIEW" → summary     (Lexend 11/16, B:E, band 1C4587)
//   sample 3 Plan A | B | C      → comparison  (Lexend 11/14 + Orbitron 15, band 073763)
// A layout is cell-addressed (the samples start in column B, merge label and
// value cells, and set column widths), unlike the row-typed sections above.
const hex = (h) => ({ red: parseInt(h.slice(0, 2), 16) / 255, green: parseInt(h.slice(2, 4), 16) / 255, blue: parseInt(h.slice(4, 6), 16) / 255 });
const TITLE_BLUE = hex("C9DAF8");
const HEAD_BLUE = hex("6D9EEB");
const SUMMARY_NAVY = hex("1C4587");
const COMPARE_NAVY = hex("073763");
const SAMPLE_LINK = hex("1155CC");
const RUPEE_FORMAT = "[$₹]#,##0";
/** Google's default column is 100px = 12.63 in the samples' files; widths below are the samples' own, converted. */
const px = (w) => Math.round((w / 12.63) * 100);
const DEFAULT_COL = 100;

const t = (over = {}) => ({ font: "Lexend", size: 12, bold: false, fg: BLACK, bg: null, align: "LEFT", wrap: false, ...over });

function makeLayout(numCols, colWidths) {
  const values = [];
  const layout = { kind: "layout", numCols, values, cells: [], merges: [], boxes: [], formulas: [], colWidths };
  const ensure = (r) => {
    while (values.length <= r) values.push(Array(numCols).fill(""));
  };
  /** Puts `value` at (r, c) with `style`, merged over `span` columns × `rowSpan` rows. */
  layout.set = (r, c, value, style, span = 1, rowSpan = 1) => {
    ensure(r + rowSpan - 1);
    values[r][c] = value ?? "";
    if (style) layout.cells.push({ r, c, r2: r + rowSpan, c2: c + span, style });
    if (span > 1 || rowSpan > 1) layout.merges.push({ r, c, r2: r + rowSpan, c2: c + span });
  };
  /** Thin black grid over rows r..r2-1, columns c..c2-1. */
  layout.box = (r, c, r2, c2) => layout.boxes.push({ r, c, r2, c2 });
  layout.blank = (r) => ensure(r);
  return layout;
}

/** The black logo band every sample opens with: the logo image, or the name when no image URL is available. */
function logoBand(layout, r, c, span, logoUrl) {
  layout.set(r, c, logoUrl ? "" : "TAGGIFY", t({ size: 14, bold: true, fg: WHITE, bg: BLACK, align: "CENTER" }), span, 2);
  if (logoUrl) layout.formulas.push({ r, c, formula: `=IMAGE("${String(logoUrl).replace(/"/g, "")}")` });
}

const statusStyle = (plan) => t({ bold: true, fg: WHITE, bg: isActivePlan(plan) ? ACTIVE_GREEN : INACTIVE_RED, align: "CENTER" });
const statusText = (plan) => (isActivePlan(plan) ? "● ACTIVE — approved plan" : "● NOT ACTIVE — not approved");

/** A plan with a flat discount (16 Oct) — annotatePlan puts it on overview.discount. */
function hasDiscount(plan) {
  return Number(plan.overview?.discount) > 0;
}
/** What the client pays before GST: the quoted subtotal less any discount (overview.taxable), or the subtotal on older shapes. */
function clientPays(plan) {
  return Number(plan.overview?.taxable ?? plan.overview?.subtotal ?? 0);
}
const whole = (n) => Math.round(Number(n) || 0);

/** Internal sheet only: how the pages' cost sits against the plan's budget — [label, rupees]. */
function budgetRow(plan) {
  return plan.budgetVariance != null ? [plan.budgetVariance < 0 ? "Over Budget" : "Under Budget", whole(Math.abs(plan.budgetVariance))] : null;
}

/**
 * Plan name, contact and client details (10 Sep — they stay on the sheet). The
 * samples have no such line, so it sits one row below the notes, unboxed, where
 * it doesn't change the cloned layout.
 */
function detailsLine(layout, r, c, span, plan) {
  const text = [`${plan.name ?? ""} · ${variantOf(plan)}`, plan.clientContact, plan.clientCompany, plan.clientGstNumber && `GSTIN: ${plan.clientGstNumber}`, plan.clientAddress].filter(Boolean).join(" · ");
  layout.set(r, c, text, t({ size: 10, wrap: true }), span);
}

/** The NOTES band and its merged, wrapped lines, as the samples lay them out. */
function notesBlock(layout, r, c, span, lines, bandStyle, lineStyle, bandText) {
  layout.set(r, c, bandText, bandStyle, span);
  lines.forEach((line, i) => layout.set(r + 1 + i, c, line, lineStyle, span));
  layout.box(r, c, r + 1 + lines.length, c + span);
  return r + 1 + lines.length;
}

/** Sample 1: a row per page category, totals, GST, notes. Columns B:H. */
function buildBreakdownOverview(plan, internal, groups, logoUrl) {
  const L = makeLayout(8, [px(6.5), px(23.75), px(23.5), px(17.5), DEFAULT_COL, DEFAULT_COL, px(20.38), px(30.88)]);
  const B = 1;
  const span = 7;
  L.blank(0);
  logoBand(L, 1, B, span, logoUrl);
  L.set(3, B, internal ? `${plan.clientName}<>Taggify — INTERNAL, NOT FOR CLIENT` : `${plan.clientName}<>Taggify`, t({ bold: true, bg: TITLE_BLUE, align: "CENTER", wrap: true }), span);
  // The sample leaves this merged row empty; the internal file uses it for the approval status.
  L.set(4, B, internal ? statusText(plan) : "", internal ? statusStyle(plan) : t(), span);
  L.box(3, B, 5, B + span);

  const head = (align) => t({ bold: true, bg: HEAD_BLUE, align, wrap: true });
  const header = ["Particulars", "Utilization", "Followers Count (in Millions)", "Followers Range", "No. of Items", internal ? "Internal Cost" : "Total Final Cost", "Expected Views/Reach (in Millions)"];
  header.forEach((h, i) => L.set(5, B + i, h, head(i === 0 ? "LEFT" : "CENTER")));

  const subtotal = internal ? groups.reduce((sum, g) => sum + g.items.reduce((a, i) => a + lineCost(i, true), 0), 0) : plan.overview.subtotal;
  const views = internal ? plan.internal.computedImpressions : plan.overview.expectedImpressions;
  const costs = internal ? groups.map((g) => g.items.reduce((a, i) => a + lineCost(i, true), 0)) : splitByWeight(subtotal, groups.map((g) => g.items.reduce((a, i) => a + lineCost(i, false), 0)));
  const reach = splitByWeight(views, groups.map((g) => g.items.reduce((a, i) => a + (i.expectedViews ?? 0), 0)));
  const millions = (n) => Number(inMillions(n));
  const num = t({ align: "CENTER" });
  const money = t({ align: "CENTER", numFmt: RUPEE_FORMAT });

  let r = 6;
  let followersTotal = 0;
  groups.forEach((g, n) => {
    const counts = distinctPages(g.items).map((i) => i.asset?.followers ?? 0);
    const followers = counts.reduce((a, b) => a + b, 0);
    followersTotal += followers;
    const formats = [...new Set(g.items.map((i) => formatLabel(i.format)))].join("/");
    const range = counts.length ? `${compactFollowers(Math.min(...counts))}-${compactFollowers(Math.max(...counts))}` : "—";
    L.set(r, B, g.label, t({ wrap: true }));
    L.set(r, B + 1, `Instagram ${formats}`, t({ wrap: true }));
    L.set(r, B + 2, millions(followers), num);
    L.set(r, B + 3, range, num);
    L.set(r, B + 4, posts(g.items), num);
    L.set(r, B + 5, whole(costs[n]), money);
    L.set(r, B + 6, millions(reach[n]), num);
    r += 1;
  });
  if (groups.length === 0) {
    L.set(r, B, "No pages added yet.", t({ align: "CENTER" }), span);
    r += 1;
  }
  const bold = { bold: true };
  L.set(r, B, "Total", t(bold));
  L.set(r, B + 2, millions(followersTotal), t({ ...bold, align: "CENTER" }));
  L.set(r, B + 4, posts(groups.flatMap((g) => g.items)), t({ ...bold, align: "CENTER" }));
  L.set(r, B + 5, whole(subtotal), t({ ...bold, align: "CENTER", numFmt: RUPEE_FORMAT }));
  L.set(r, B + 6, millions(views), t({ ...bold, align: "CENTER" }));
  r += 1;
  L.box(5, B, r, B + span);

  // Label in F, amount in G, like the sample's "GST (18%)" / "Total" pair.
  const kvStart = r;
  const kv = (label, value, strong = false) => {
    L.set(r, B + 4, label, t(bold));
    L.set(r, B + 5, value, t({ bold: strong, align: "CENTER", numFmt: RUPEE_FORMAT }));
    r += 1;
  };
  if (internal) {
    kv("Quoted to client", whole(plan.overview.subtotal));
    if (hasDiscount(plan)) kv("Discount", -whole(plan.overview.discount));
    // Margin = what the client actually pays (after any discount) − our cost.
    kv("Margin", whole(clientPays(plan) - subtotal), true);
    const budget = budgetRow(plan);
    if (budget) kv(budget[0], budget[1]);
  } else {
    // Discount (16 Oct) comes off before GST; the rows only appear when there is one.
    if (hasDiscount(plan)) {
      kv("Discount", -whole(plan.overview.discount));
      kv("After Discount", whole(plan.overview.taxable));
    }
    if (plan.isGstPlan) {
      kv(`GST (${plan.gstPercent}%)`, whole(plan.overview.gstAmount));
      kv("Total", whole(plan.overview.total), true);
    }
  }
  if (r > kvStart) L.box(kvStart, B + 4, r, B + 6);

  // Three empty rows, then the notes, as in the sample.
  r += 3;
  const lines = [...BREAKDOWN_NOTES, ...(plan.notes ? [plan.notes] : [])];
  const end = notesBlock(L, r, B, span, lines, t({ bold: true, bg: HEAD_BLUE, align: "CENTER" }), t({ bg: WHITE, wrap: true }), "NOTES :");
  detailsLine(L, end + 1, B, span, plan);
  return { rows: L.values, rowSpecs: L, numCols: L.numCols };
}

/** The figures a summary-style overview shows for one plan (summary and comparison layouts share them). */
function summaryFigures(plan, internal) {
  const followers = internal ? plan.internal.computedFollowers : plan.overview.totalFollowers;
  const deliverables = internal ? plan.internal.computedPosts : plan.overview.totalPosts;
  const views = internal ? plan.internal.computedImpressions : plan.overview.expectedImpressions;
  const cost = internal ? (plan.items ?? []).reduce((a, i) => a + lineCost(i, true), 0) : plan.overview.subtotal;
  return { followers, deliverables, views, cost };
}
const cpvOf = (f) => (f.views > 0 ? Number((f.cost / f.views).toFixed(2)) : "—");

/**
 * The label/value lines of a summary-style overview: [label, value per plan, isMoney].
 * One plan for the summary layout, every plan of the pitch for the comparison one.
 */
function summaryLines(plans, internal) {
  const figures = plans.map((p) => summaryFigures(p, internal));
  const lines = [];
  const line = (label, values, moneyRow = false) => lines.push({ label, values, money: moneyRow });
  if (internal) line("Status", plans.map(statusLabel));
  line("Total Followers Targeted Overall", figures.map((f) => roughly(f.followers)));
  line(plans.length > 1 ? "Total Posts" : "Total Deliverables", figures.map((f) => f.deliverables));
  line("Expected Impressions/Views", figures.map((f) => roughly(f.views)));
  line(internal ? "Internal Cost" : "Cost", figures.map((f) => whole(f.cost)), true);
  // Discount (16 Oct), client side: what's taken off and what's left, before GST.
  if (!internal && plans.some(hasDiscount)) {
    line("Discount", plans.map((p) => (hasDiscount(p) ? -whole(p.overview.discount) : "—")), true);
    line("Cost After Discount", plans.map((p) => whole(clientPays(p))), true);
  }
  line("CPV", figures.map(cpvOf));
  if (internal) {
    line("Quoted to client", plans.map((p) => whole(p.overview.subtotal)), true);
    if (plans.some(hasDiscount)) line("Discount", plans.map((p) => (hasDiscount(p) ? -whole(p.overview.discount) : "—")), true);
    line("Margin", plans.map((p, n) => whole(clientPays(p) - figures[n].cost)), true);
    if (plans.some((p) => budgetRow(p))) line("Budget", plans.map((p) => (budgetRow(p) ? `${budgetRow(p)[0]}: ${rupees(budgetRow(p)[1])}` : "—")));
  }
  return lines;
}

/** Sample 2: one campaign-overview block with cost per view. Columns B:E, label in B:C, value in D:E. */
function buildSummaryOverview(plan, internal, logoUrl) {
  const L = makeLayout(5, [px(9.63), DEFAULT_COL, px(16.88), DEFAULT_COL, px(17.63)]);
  const B = 1;
  L.blank(0);
  logoBand(L, 1, B, 4, logoUrl);
  L.set(3, B, internal ? "INTERNAL OVERVIEW" : "CAMPAIGN OVERVIEW", t({ size: 16, bold: true, fg: WHITE, bg: SUMMARY_NAVY, align: "CENTER" }), 4, 2);

  const label = t({ size: 11, bold: true, bg: WHITE, wrap: true });
  const value = (moneyRow) => t({ size: 11, bold: true, bg: WHITE, align: "CENTER", ...(moneyRow ? { numFmt: RUPEE_FORMAT } : {}) });
  let r = 5;
  for (const line of summaryLines([plan], internal)) {
    L.set(r, B, line.label, label, 2);
    L.set(r, B + 2, line.values[0], value(line.money && typeof line.values[0] === "number"), 2);
    r += 1;
  }
  L.box(5, B, r, B + 4);

  r += 1;
  const lines = [...SUMMARY_NOTES, ...(plan.notes ? [plan.notes] : [])];
  const end = notesBlock(L, r, B, 4, lines, t({ bold: true, fg: WHITE, bg: SUMMARY_NAVY, align: "CENTER" }), label, "NOTES:");
  detailsLine(L, end + 1, B, 4, plan);
  return { rows: L.values, rowSpecs: L, numCols: L.numCols };
}

/**
 * Sample 3 (23 Nov): one "CAMPAIGN OVERVIEW" table for the whole pitch group,
 * a merged pair of columns per plan (Plan A in D:E, Plan B in F:G, …), labels
 * in B:C. `plans` are already in the shape the file needs (client-safe for the
 * client file).
 */
export function buildComparisonOverview(plans, { internal = false, logoUrl = null } = {}) {
  const count = Math.max(plans.length, 1);
  // The sample's own widths for three plans; further plans repeat the first pair.
  const pairWidths = [[px(17.5), DEFAULT_COL], [DEFAULT_COL, px(20.38)], [px(18.88), DEFAULT_COL]];
  const L = makeLayout(3 + 2 * count, [px(6.5), px(16.5), px(17.75), ...Array.from({ length: count }, (_, i) => pairWidths[i] ?? pairWidths[0]).flat()]);
  const B = 1;
  const span = 2 + 2 * count;
  const band = t({ font: "Orbitron", size: 15, bold: true, fg: WHITE, bg: COMPARE_NAVY, align: "CENTER" });
  L.blank(1);
  logoBand(L, 2, B, span, logoUrl);
  L.set(4, B, internal ? "INTERNAL OVERVIEW" : "CAMPAIGN OVERVIEW", band, span);

  const label = t({ size: 11, bold: true, bg: WHITE, wrap: true });
  const value = (moneyRow) => t({ size: 11, bold: true, bg: WHITE, align: "CENTER", ...(moneyRow ? { numFmt: RUPEE_FORMAT } : {}) });
  L.set(5, B, "", t({ bg: WHITE }), 2);
  plans.forEach((p, i) => L.set(5, B + 2 + 2 * i, variantOf(p), t({ size: 14, bold: true, bg: WHITE, align: "CENTER" }), 2));
  let r = 6;
  for (const line of summaryLines(plans, internal)) {
    L.set(r, B, line.label, label, 2);
    line.values.forEach((v, i) => L.set(r, B + 2 + 2 * i, v, value(line.money && typeof v === "number"), 2));
    r += 1;
  }
  if (plans.length === 0) {
    L.set(r, B, "No plans yet.", label, span);
    r += 1;
  }
  L.box(5, B, r, B + span);

  // Two empty rows, then the notes, as in the sample. Each plan's own brief follows, labelled.
  r += 2;
  const lines = [...SUMMARY_NOTES, ...plans.filter((p) => p.notes).map((p) => `${variantOf(p)}: ${p.notes}`)];
  const end = notesBlock(L, r, B, span, lines, band, label, "NOTES:");
  if (plans[0]) detailsLine(L, end + 1, B, span, { ...plans[0], variantLabel: plans.map(variantOf).join(" / ") });
  return { rows: L.values, rowSpecs: L, numCols: L.numCols };
}

const PAGE_HEADER = ["S No", "Page Name", "Page Link", "Followers", "Format", "Post Per Profile"];

/**
 * One category's pages, styled like the samples' page tabs: a blue header
 * with white text, a bordered grid, and the followers total two rows below.
 * Sample 3's page tabs are set in Comic Sans MS (header 12, rows 11), so the
 * comparison layout's are too. Followers stay as K / M and the Format column
 * stays (8 and 16 Oct requests) — those are content, not styling.
 */
function buildPagesSection(plan, internal, items) {
  const comparison = plan.sheetFormat === "comparison";
  const font = comparison ? "Comic Sans MS" : "Lexend";
  const header = [...PAGE_HEADER, ...(internal ? ["Cost/Post"] : [])];
  if (comparison) header[5] = "Posts Per Page";
  const L = makeLayout(header.length, [px(7.63), px(25.38), DEFAULT_COL, DEFAULT_COL, DEFAULT_COL, px(16.25), ...(internal ? [px(14)] : [])]);
  const centered = new Set([0, 3, 4, 5, 6]);
  let r = 0;
  if (internal) {
    L.set(r, 0, statusText(plan), statusStyle(plan), header.length);
    r += 1;
  }
  const top = r;
  header.forEach((h, c) => L.set(r, c, h, t({ font, bold: true, fg: WHITE, bg: HEAD_BLUE, align: centered.has(c) ? "CENTER" : "LEFT" })));
  r += 1;

  const cell = (c, over = {}) => t({ font, size: comparison ? 11 : 12, bg: WHITE, align: centered.has(c) ? "CENTER" : "LEFT", ...over });
  items.forEach((item, i) => {
    const handle = item.asset?.handle ?? "—";
    // Bare handle and the profile URL as its own visible text (22 Sep), with
    // the cell itself linked — not a =HYPERLINK() formula: the sheet is written RAW.
    const pageUrl = `https://instagram.com/${handle}`;
    L.set(r, 0, i + 1, cell(0));
    L.set(r, 1, handle, cell(1));
    L.set(r, 2, pageUrl, cell(2, item.asset?.handle ? { link: pageUrl, underline: true, fg: SAMPLE_LINK } : {}));
    L.set(r, 3, compactFollowers(item.asset?.followers ?? 0), cell(3));
    L.set(r, 4, formatLabel(item.format), cell(4));
    L.set(r, 5, item.postsPerProfile, cell(5));
    if (internal) L.set(r, 6, whole(item.cost), cell(6, { numFmt: RUPEE_FORMAT }));
    r += 1;
  });
  L.box(top, 0, r, header.length);

  // The samples leave one empty row, then the followers total on its own in bold.
  r += 1;
  const followers = distinctPages(items).reduce((sum, i) => sum + (i.asset?.followers ?? 0), 0);
  const total = (c, v) => {
    L.set(r, c, v, cell(c, { bold: true, size: 12 }));
    L.box(r, c, r + 1, c + 1);
  };
  total(1, "Total");
  total(3, compactFollowers(followers));
  total(5, posts(items));
  return { rows: L.values, rowSpecs: L };
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

/** How many columns always get their width set, so switching layouts never leaves another layout's widths behind. */
const WIDTH_RESET_COLS = 12;

/** Requests for a cell-addressed layout (the three cloned overviews and the page tabs). */
function layoutRequests(sheetId, layout) {
  const at = ({ r, c, r2, c2 }) => ({ sheetId, startRowIndex: r, endRowIndex: r2, startColumnIndex: c, endColumnIndex: c2 });
  const wholeTab = { sheetId };
  const requests = [
    { unmergeCells: { range: wholeTab } },
    { repeatCell: { range: wholeTab, cell: { userEnteredFormat: {} }, fields: "userEnteredFormat" } },
  ];
  const cols = Math.max(WIDTH_RESET_COLS, layout.colWidths.length);
  for (let c = 0; c < cols; c++) {
    requests.push({
      updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: c, endIndex: c + 1 }, properties: { pixelSize: layout.colWidths[c] ?? DEFAULT_COL }, fields: "pixelSize" },
    });
  }
  for (const m of layout.merges) requests.push({ mergeCells: { range: at(m), mergeType: "MERGE_ALL" } });
  for (const cell of layout.cells) {
    const s = cell.style;
    requests.push({
      repeatCell: {
        range: at(cell),
        cell: {
          userEnteredFormat: {
            ...(s.bg ? { backgroundColor: s.bg } : {}),
            horizontalAlignment: s.align,
            verticalAlignment: "BOTTOM",
            wrapStrategy: s.wrap ? "WRAP" : "OVERFLOW_CELL",
            ...(s.numFmt ? { numberFormat: { type: "NUMBER", pattern: s.numFmt } } : {}),
            textFormat: { fontFamily: s.font, fontSize: s.size, bold: s.bold, italic: false, underline: s.underline ?? false, foregroundColor: s.fg, ...(s.link ? { link: { uri: s.link } } : {}) },
          },
        },
        fields: "userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,wrapStrategy,numberFormat,textFormat)",
      },
    });
  }
  for (const b of layout.boxes) {
    requests.push({ updateBorders: { range: at(b), top: THIN_BLACK, bottom: THIN_BLACK, left: THIN_BLACK, right: THIN_BLACK, innerHorizontal: THIN_BLACK, innerVertical: THIN_BLACK } });
  }
  // The logo is an =IMAGE() formula, set here because the values are written RAW (as text).
  for (const f of layout.formulas) {
    requests.push({ updateCells: { start: { sheetId, rowIndex: f.r, columnIndex: f.c }, rows: [{ values: [{ userEnteredValue: { formulaValue: f.formula } }] }], fields: "userEnteredValue" } });
  }
  return requests;
}

/**
 * `rowSpecs`/`numCols` from buildOverviewSection/buildPagesSection above.
 * Resets formatting first (not just an overwrite) so regenerating a plan
 * whose row count shrank doesn't leave stale styling past the new content
 * — same "clear, don't overwrite-in-place" reasoning writeSheetTab already
 * uses for values.
 */
export function buildFormatRequests(sheetId, rowSpecs, numCols) {
  if (rowSpecs?.kind === "layout") return layoutRequests(sheetId, rowSpecs);
  const numRows = rowSpecs.length;
  if (numRows === 0) return [];
  // Whole tab, not just the new content's area (19 Nov): a regenerated sheet
  // can still hold merges/styling from an earlier, larger version (more
  // pages, the other layout). Google refuses to unmerge a range that only
  // partly covers a merged block, and a partial reset would leave stale
  // styling past the new content. A range with only sheetId is the whole tab.
  const wholeTab = { sheetId };
  const requests = [
    { unmergeCells: { range: wholeTab } },
    { repeatCell: { range: wholeTab, cell: { userEnteredFormat: {} }, fields: "userEnteredFormat" } },
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
