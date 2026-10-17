import Papa from "papaparse";

import { isCombo, formatFromText } from "./formats";

/**
 * A sheet row that can't be sent as-is — thrown by the campaign / work-import
 * parsers so the screen can show the reason instead of "couldn't read that
 * file". Today: a "Reel + Story" or "Repost + Story" row (14 Oct) — a
 * campaign sheet row is one post, and a combo is two.
 */
export class SheetRowError extends Error {}

/** The server's message for each combo on a campaign sheet row (campaigns/schemas.js). */
export const COMBO_ROW_MESSAGES: Record<string, string> = {
  reel_story: "Reel + Story is two posts: use one row per post (Reel and Story)",
  repost_story: "Repost + Story is two posts: use one row per post (Repost and Story)",
};

/**
 * A sheet's format cell → a format key via the shared alias list ("Static",
 * "Reels", "Reel + Story", "combo"…). Unrecognised text passes through in
 * lower case so the server answers with its own "unknown format" message.
 */
function sheetFormat(raw: string | undefined): string {
  const text = raw?.trim() ?? "";
  if (!text) return "";
  return formatFromText(text) ?? text.toLowerCase();
}

/** Campaign/work-import rows take bookable formats only — a combo row is rejected with the server's own wording. */
function bookableSheetFormat(raw: string | undefined, rowNumber: number): string {
  const format = sheetFormat(raw);
  if (isCombo(format)) throw new SheetRowError(`Row ${rowNumber}: ${COMBO_ROW_MESSAGES[format]}`);
  return format;
}

/**
 * Parses an uploaded page/creator sheet (newTask.md #8) into rows the
 * campaign-creation API understands. CSV only — not because "Excel sheet"
 * wasn't the ask, but because XLSX-parsing libraries currently available on
 * npm carry known, unpatched advisories (prototype pollution / ReDoS); CSV
 * covers the same need (any spreadsheet tool exports to it) without that
 * risk. Assumes the first row is a header row.
 */
export interface ParsedAssignmentRow {
  handle: string;
  phone?: string;
  /** newTask.md, 8 Sep — a row can also already name a posted link; when
   *  it does (and carries a format), that post gets attached directly to
   *  the matched creator instead of waiting for them to submit it. */
  postUrl?: string;
  format?: string;
  cost?: number;
}

const HANDLE_HEADERS = ["handle", "page", "page handle", "instagram", "instagram handle", "username"];
const PHONE_HEADERS = ["phone", "phone number", "creator phone", "creator", "owner"];
// Shared with parseWorkImportSheet below — the same column names mean the
// same thing whichever of the two sheets they show up on.
const URL_HEADERS = ["url", "link", "post url", "post link"];
const FORMAT_HEADERS = ["format", "type", "post type"];
const COST_HEADERS = ["cost", "amount", "rate", "price", "finance"];

/** A File (from an <input type="file">) or raw CSV text (fetched
 * server-side from a pasted Google Sheet link — see campaigns.importSheetUrl
 * and bugs.md #6) — either way, from here on it's just CSV text. */
type CsvSource = File | string;

async function readText(source: CsvSource): Promise<string> {
  return typeof source === "string" ? source : source.text();
}

export async function parseAssignmentSheet(source: CsvSource): Promise<ParsedAssignmentRow[]> {
  const text = await readText(source);
  const { data } = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });

  const rows: ParsedAssignmentRow[] = [];
  for (const [index, row] of data.entries()) {
    const keys = Object.keys(row);
    const find = (headers: string[]) => keys.find((k) => headers.includes(k.trim().toLowerCase()));
    const handleKey = find(HANDLE_HEADERS) ?? keys[0];
    const phoneKey = find(PHONE_HEADERS);
    const handle = handleKey ? row[handleKey]?.trim() : "";
    if (!handle) continue;
    const phone = phoneKey ? row[phoneKey]?.trim() : undefined;

    // Optional (newTask.md, 8 Sep) — a row can also already name a posted
    // link. format is required alongside it (same rule the server
    // validates) since a URL with no format has nothing to price against.
    const urlKey = find(URL_HEADERS);
    const formatKey = find(FORMAT_HEADERS);
    const costKey = find(COST_HEADERS);
    const postUrl = urlKey ? row[urlKey]?.trim() : "";
    // Only a row that names a post sends its format, so only then can a combo be wrong. Row numbers count the header as row 1.
    const format = postUrl ? bookableSheetFormat(formatKey ? row[formatKey] : undefined, index + 2) : sheetFormat(formatKey ? row[formatKey] : undefined);
    const rawCost = costKey ? row[costKey]?.trim() : "";
    const cost = rawCost ? Number(rawCost.replace(/[^\d.]/g, "")) : undefined;

    rows.push({
      handle,
      phone: phone || undefined,
      postUrl: postUrl && format ? postUrl : undefined,
      format: postUrl && format ? format : undefined,
      cost: postUrl && format && cost && !Number.isNaN(cost) ? cost : undefined,
    });
  }
  return rows;
}

/**
 * Admin bulk-import of already-done work (newTask.md #8's second sheet:
 * "which page posted it, their finance part") — one row per post: which
 * campaign, which page, the post URL, its format, and optionally what it's
 * billed at (falls back to the page's rate card server-side if left blank).
 */
export interface ParsedWorkImportRow {
  campaignTitle: string;
  pageHandle: string;
  url: string;
  format: string;
  cost?: number;
}

const CAMPAIGN_HEADERS = ["campaign", "campaign title", "campaign name"];

export async function parseWorkImportSheet(source: CsvSource): Promise<ParsedWorkImportRow[]> {
  const text = await readText(source);
  const { data } = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });

  const rows: ParsedWorkImportRow[] = [];
  for (const [index, row] of data.entries()) {
    const keys = Object.keys(row);
    const find = (headers: string[]) => keys.find((k) => headers.includes(k.trim().toLowerCase()));
    const campaignKey = find(CAMPAIGN_HEADERS);
    const handleKey = find(HANDLE_HEADERS);
    const urlKey = find(URL_HEADERS);
    const formatKey = find(FORMAT_HEADERS);
    const costKey = find(COST_HEADERS);

    const campaignTitle = campaignKey ? row[campaignKey]?.trim() : "";
    const pageHandle = handleKey ? row[handleKey]?.trim() : "";
    const url = urlKey ? row[urlKey]?.trim() : "";
    const format = url && campaignTitle && pageHandle ? bookableSheetFormat(formatKey ? row[formatKey] : undefined, index + 2) : "";
    if (!campaignTitle || !pageHandle || !url || !format) continue;

    const rawCost = costKey ? row[costKey]?.trim() : "";
    const cost = rawCost ? Number(rawCost.replace(/[^\d.]/g, "")) : undefined;

    rows.push({ campaignTitle, pageHandle, url, format, cost: cost && !Number.isNaN(cost) ? cost : undefined });
  }
  return rows;
}

/**
 * "Attach a Google Sheet of pages" at the plan wizard's Pages step (user
 * request, 10 Sep). Reuses the same header-name conventions as the sheets
 * above — same shared HANDLE/FORMAT/COST headers — plus a followers column,
 * since a brand-new page has no scrape history yet to show a follower count
 * from.
 */
export interface ParsedPlanPageRow {
  handle: string;
  pageUrl?: string;
  category?: string;
  followers?: number;
  format?: string;
  cost?: number;
  clientCost?: number;
  postsPerProfile?: number;
}

const FOLLOWERS_HEADERS = ["followers", "follower count", "audience"];
const CATEGORY_HEADERS = ["category", "type", "page type"];
const POSTS_HEADERS = ["post per profile", "posts per profile", "posts", "post count"];

/**
 * A raw follower count as it actually shows up in analytics-tool exports —
 * "1.2M", "850K", or (India-specific, same abbreviations the app's own
 * `count()`/`compactNumber()` formatters produce) "1.5L"/"2Cr" — not just
 * plain digits (code review, 10 Sep: the previous `.replace(/[^\d]/g, "")`
 * silently stripped the '.' and letter, turning "1.2M" into 12).
 */
function parseFollowerCount(raw: string | undefined): number | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  const match = trimmed.match(/^([\d,]*\.?\d+)\s*(k|m|l|cr)?$/i);
  if (!match) return undefined;
  const base = Number(match[1].replace(/,/g, ""));
  if (Number.isNaN(base)) return undefined;
  const multiplier = { k: 1_000, m: 1_000_000, l: 100_000, cr: 10_000_000 }[match[2]?.toLowerCase() ?? ""] ?? 1;
  return Math.round(base * multiplier);
}

const CLIENT_COST_HEADERS = ["client cost", "client price", "client rate", "quoted", "quote"];

const parseMoney = (raw: string | undefined): number | undefined => {
  const digits = raw?.trim().replace(/[^\d.]/g, "") ?? "";
  return digits && !Number.isNaN(Number(digits)) ? Number(digits) : undefined;
};

const PAGE_URL_HEADERS = ["page link", "page url", "profile link", "profile url", "instagram link", "link", "url"];

/** "https://www.instagram.com/ghantaa/?hl=en" → "ghantaa"; anything else → undefined. */
export function handleFromInstagramUrl(url: string | undefined): string | undefined {
  const m = url?.trim().match(/^https?:\/\/(?:www\.)?instagram\.com\/([A-Za-z0-9._]+)\/?(?:[?#].*)?$/i);
  const h = m?.[1];
  return h && !["p", "reel", "reels", "stories", "explore"].includes(h.toLowerCase()) ? h : undefined;
}

/** One page row (keyed by its header names) → the shape the plans API takes. */
function mapPageRow(row: Record<string, string>): ParsedPlanPageRow | null {
  const keys = Object.keys(row);
  const find = (headers: string[]) => keys.find((k) => headers.includes(k.trim().toLowerCase()));
  const urlKey = find(PAGE_URL_HEADERS);
  const pageUrl = (urlKey ? row[urlKey]?.trim() : "") || undefined;
  const handleKey = find(HANDLE_HEADERS) ?? (urlKey ? undefined : keys[0]);
  // Handles are stored without the "@" (22 Sep); a row with only a page
  // link gets its handle from the link.
  const handle = ((handleKey ? row[handleKey]?.trim() : "") || handleFromInstagramUrl(pageUrl) || "").replace(/^@+/, "");
  if (!handle) return null;

  const categoryKey = find(CATEGORY_HEADERS);
  const followersKey = find(FOLLOWERS_HEADERS);
  const formatKey = find(FORMAT_HEADERS);
  const costKey = find(COST_HEADERS);
  const clientCostKey = find(CLIENT_COST_HEADERS);
  const postsKey = find(POSTS_HEADERS);
  const rawPosts = postsKey ? row[postsKey]?.trim().replace(/[^\d]/g, "") : "";

  return {
    handle,
    pageUrl: pageUrl && /^https?:\/\//i.test(pageUrl) ? pageUrl : undefined,
    category: (categoryKey ? row[categoryKey]?.trim() : "") || undefined,
    followers: parseFollowerCount(followersKey ? row[followersKey] : undefined),
    // Plan lines take all ten formats, both combos included (14 Oct).
    format: sheetFormat(formatKey ? row[formatKey] : undefined) || undefined,
    cost: parseMoney(costKey ? row[costKey] : undefined),
    clientCost: parseMoney(clientCostKey ? row[clientCostKey] : undefined),
    postsPerProfile: rawPosts ? Number(rawPosts) : undefined,
  };
}

export async function parsePlanPageSheet(source: CsvSource): Promise<ParsedPlanPageRow[]> {
  const text = await readText(source);
  const { data } = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
  return data.map(mapPageRow).filter((r): r is ParsedPlanPageRow => r !== null);
}

/**
 * "Upload plan" (user request, 22 Sep — "plan maker can upload their own
 * made excel sheet plan ... 2 tabs in sheet, 1 for detail of client budget,
 * another tab will be of pages"). Takes every tab's CSV in tab order:
 *  - the Details tab is `Field | Value` rows (plan name, client, budget,
 *    GST %, brief, …);
 *  - the Pages tab is a table whose header row names a handle / page-link
 *    column, read exactly like parsePlanPageSheet.
 * Tabs are told apart by content, not position or title — a tab whose
 * first cell is a page-table header is the Pages tab — so a single tab
 * holding both (details on top, the table below) still works. Anything the
 * sheet doesn't carry is simply absent from `fields`; `warnings` names
 * cells that were there but unreadable (e.g. a budget of "TBD").
 */
export interface ParsedPlanSheet {
  fields: {
    name?: string;
    clientName?: string;
    clientContact?: string;
    clientCompany?: string;
    clientGstNumber?: string;
    clientAddress?: string;
    notes?: string;
    budget?: number;
    gstPercent?: number;
  };
  rows: ParsedPlanPageRow[];
  warnings: string[];
}

export const PLAN_SHEET_FIELD_ALIASES: Record<keyof ParsedPlanSheet["fields"], string[]> = {
  name: ["plan name", "plan", "name", "title", "campaign", "campaign name"],
  clientName: ["client name", "client", "brand", "brand name"],
  clientContact: ["client contact", "contact", "contact person", "poc"],
  clientCompany: ["company", "company name", "client company"],
  clientGstNumber: ["gst number", "gst no", "gst no.", "gstin", "gst"],
  clientAddress: ["address", "billing address", "company address"],
  notes: ["brief", "notes", "note", "description", "objective"],
  budget: ["budget", "total budget", "budget (inr)", "budget (₹)"],
  gstPercent: ["gst %", "gst%", "gst percent", "gst percentage", "gst rate"],
};

const isPageTableHeader = (row: string[] | undefined) => {
  const first = (row?.[0] ?? "").trim().toLowerCase();
  return HANDLE_HEADERS.includes(first) || PAGE_URL_HEADERS.includes(first);
};

export async function parsePlanSheet(tabs: CsvSource | CsvSource[]): Promise<ParsedPlanSheet> {
  const texts = await Promise.all((Array.isArray(tabs) ? tabs : [tabs]).map(readText));
  const fields: ParsedPlanSheet["fields"] = {};
  const warnings: string[] = [];
  let rows: ParsedPlanPageRow[] = [];
  let pagesSeen = false;

  for (const text of texts) {
    const { data } = Papa.parse<string[]>(text, { header: false, skipEmptyLines: true });
    const headerIndex = data.findIndex(isPageTableHeader);
    const topRows = headerIndex === -1 ? data : data.slice(0, headerIndex);
    readDetailRows(topRows, fields, warnings);
    // The first page table wins — a second one is almost certainly a copy.
    if (headerIndex !== -1 && !pagesSeen) {
      pagesSeen = true;
      const headers = data[headerIndex].map((h) => h.trim());
      rows = data
        .slice(headerIndex + 1)
        .map((r) => mapPageRow(Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""]))))
        .filter((r): r is ParsedPlanPageRow => r !== null && !/^total$/i.test(r.handle));
    }
  }
  return { fields, rows, warnings };
}

function readDetailRows(topRows: string[][], fields: ParsedPlanSheet["fields"], warnings: string[]) {
  for (const r of topRows) {
    const label = (r[0] ?? "").trim().toLowerCase().replace(/[:*]+$/, "").trim();
    const value = (r[1] ?? "").trim();
    if (!label || !value) continue;
    const key = (Object.keys(PLAN_SHEET_FIELD_ALIASES) as (keyof ParsedPlanSheet["fields"])[]).find((k) => PLAN_SHEET_FIELD_ALIASES[k].includes(label));
    if (!key) continue;
    if (key === "budget") {
      const n = parseMoney(value);
      if (n && n > 0) fields.budget = n;
      else warnings.push(`Budget "${value}" isn't a number.`);
    } else if (key === "gstPercent") {
      const n = Number(value.replace(/[^\d.]/g, ""));
      if (value.replace(/[^\d.]/g, "") && Number.isInteger(n) && n >= 0 && n <= 100) fields.gstPercent = n;
      else warnings.push(`GST % "${value}" isn't a whole number between 0 and 100.`);
    } else if (key === "clientGstNumber") {
      fields.clientGstNumber = value.toUpperCase();
    } else {
      fields[key] = value;
    }
  }
}

/** The downloadable sample for the Upload plan popup — one file per tab, same layout parsePlanSheet reads. */
export const PLAN_SHEET_TEMPLATE_DETAILS: string[][] = [
  ["Plan name", "Q1 Meme Push"],
  ["Client name", "Acme Foods"],
  ["Client contact", "Rohit Sharma"],
  ["Company", "Acme Foods Pvt Ltd"],
  ["GST number", "27ABCDE1234F1Z5"],
  ["Address", "12 MG Road, Pune 411001"],
  ["Budget", "150000"],
  ["GST %", "18"],
  ["Brief", "Launch reels across meme pages in the first two weeks of October"],
];
export const PLAN_SHEET_TEMPLATE_PAGES: string[][] = [
  ["Handle", "Page link", "Category", "Followers", "Format", "Posts per profile", "Cost", "Client cost"],
  ["ghantaa", "https://www.instagram.com/ghantaa/", "Meme page", "8.7M", "Reel", "2", "45000", "60000"],
  ["laughter.colours", "https://www.instagram.com/laughter.colours/", "Meme page", "4.3M", "Story", "1", "12000", "15000"],
  ["memes.daily", "https://www.instagram.com/memes.daily/", "Meme page", "2.1M", "Static & Carousel", "1", "9000", "12000"],
  ["sarcastic.us", "https://www.instagram.com/sarcastic.us/", "Meme page", "3.4M", "Reel + Story", "1", "30000", "40000"],
];
