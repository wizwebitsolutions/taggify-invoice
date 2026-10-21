import Papa from "papaparse";

import { BOOKABLE_FORMATS, COMBO_ROW_MESSAGE, formatFromText, isBookableFormat, isCombo, joinLabels } from "@/lib/formats";

/**
 * "Attach a Google Sheet of pages" on the plan form's Pages step. Ported from
 * client/lib/parseAssignmentSheet.ts (parsePlanPageSheet) so both apps read a
 * sheet the same way: CSV only (any spreadsheet exports it; XLSX libraries
 * carry unpatched advisories), first row is the header, columns matched by name.
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

/** A File from an <input type="file">, or CSV text the server fetched from a pasted Google Sheet link. */
export type CsvSource = File | string;

export const HANDLE_HEADERS = ["handle", "page", "page handle", "instagram", "instagram handle", "username"];
const FORMAT_HEADERS = ["format", "type", "post type"];
const COST_HEADERS = ["cost", "amount", "rate", "price", "finance"];
const FOLLOWERS_HEADERS = ["followers", "follower count", "audience"];
const CATEGORY_HEADERS = ["category", "type", "page type"];
const POSTS_HEADERS = ["post per profile", "posts per profile", "posts", "post count"];
const CLIENT_COST_HEADERS = ["client cost", "client price", "client rate", "quoted", "quote"];
export const PAGE_URL_HEADERS = ["page link", "page url", "profile link", "profile url", "instagram link", "link", "url"];

export const readText = (source: CsvSource) => (typeof source === "string" ? Promise.resolve(source) : source.text());

/** Follower counts as analytics exports write them: "1.2M", "850K", "1.5L", "2Cr" or plain digits. */
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

export const parseMoney = (raw: string | undefined): number | undefined => {
  const digits = raw?.trim().replace(/[^\d.]/g, "") ?? "";
  return digits && !Number.isNaN(Number(digits)) ? Number(digits) : undefined;
};

/** "https://www.instagram.com/ghantaa/?hl=en" → "ghantaa"; anything else → undefined. */
export function handleFromInstagramUrl(url: string | undefined): string | undefined {
  const m = url?.trim().match(/^https?:\/\/(?:www\.)?instagram\.com\/([A-Za-z0-9._]+)\/?(?:[?#].*)?$/i);
  const h = m?.[1];
  return h && !["p", "reel", "reels", "stories", "explore"].includes(h.toLowerCase()) ? h : undefined;
}

export function mapPageRow(row: Record<string, string>): ParsedPlanPageRow | null {
  const keys = Object.keys(row);
  const find = (headers: string[]) => keys.find((k) => headers.includes(k.trim().toLowerCase()));
  const urlKey = find(PAGE_URL_HEADERS);
  const pageUrl = (urlKey ? row[urlKey]?.trim() : "") || undefined;
  const handleKey = find(HANDLE_HEADERS) ?? (urlKey ? undefined : keys[0]);
  // Handles are stored without the "@"; a row with only a page link gets its handle from the link.
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
    // "Static", "Reels", "Reel + Story"… read as the app's format keys; anything else goes as typed for the server to judge.
    format: formatText(formatKey ? row[formatKey] : undefined),
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

// ── Past posts ("Import posts" on Content) ─────────────────────────

/** One row of a past-posts sheet, ready for POST /links/bulk-import, or the reason it can't be sent. */
export type WorkSheetRow = {
  line: number;
  campaignTitle: string;
  pageHandle: string;
  url: string;
  format: string;
  cost?: number;
  problem: string | null;
};

const CAMPAIGN_HEADERS = ["campaign", "campaign title", "campaign name"];
const POST_URL_HEADERS = ["post url", "post link", "url", "link"];
const formatText = (raw: string | undefined) => {
  const t = raw?.trim().toLowerCase();
  return t ? (formatFromText(t) ?? t) : undefined;
};
/** Server cap per request (links schemas bulkImportLinksSchema). */
export const WORK_IMPORT_MAX = 500;
export const WORK_SHEET_TEMPLATE = "Campaign,Page,Post URL,Format,Cost\nDiwali Food Stories,riya.eats,https://www.instagram.com/reel/ABC123/,Reel,18000\n";

/**
 * Past posts sheet: campaign name, page handle, post URL, format (Reel, Story, Static / Carousel or Political reel),
 * optional cost (blank = the page's rate card). Same header names as v1
 * (client/lib/parseAssignmentSheet.ts parseWorkImportSheet), but a bad row is
 * kept with its reason instead of silently dropped, so the preview can show it.
 */
export async function parseWorkSheet(source: CsvSource): Promise<WorkSheetRow[]> {
  const text = await readText(source);
  // Arrays, not header objects, and blank rows kept: a row's index is then its spreadsheet row
  // number (row 1 = the header), so "Row 7" in the preview is row 7 in the sheet.
  const { data } = Papa.parse<string[]>(text, { header: false, skipEmptyLines: false });
  const [header = [], ...body] = data;
  const columns = header.map((h) => h.trim().toLowerCase());
  const col = (names: string[]) => names.map((n) => columns.indexOf(n)).find((i) => i >= 0) ?? -1;
  const at = { campaign: col(CAMPAIGN_HEADERS), handle: col(HANDLE_HEADERS), pageUrl: col(PAGE_URL_HEADERS.filter((h) => h !== "link" && h !== "url" && h !== "instagram link")), url: col(POST_URL_HEADERS), format: col(FORMAT_HEADERS), cost: col(COST_HEADERS) };
  const seen = new Set<string>();
  const rows: WorkSheetRow[] = [];
  body.forEach((cells, i) => {
    if (cells.every((c) => !c?.trim())) return;
    const get = (index: number) => (index >= 0 ? (cells[index] ?? "").trim() : "");
    const campaignTitle = get(at.campaign);
    // A pasted profile link in the Page column ("https://www.instagram.com/riya.eats/?igsh=…") counts as its handle.
    const rawHandle = get(at.handle);
    const pageHandle = (handleFromInstagramUrl(rawHandle) ?? rawHandle.replace(/^@+/, "")) || handleFromInstagramUrl(get(at.pageUrl)) || "";
    const url = get(at.url);
    const rawFormat = get(at.format).toLowerCase();
    const format = formatFromText(rawFormat) ?? rawFormat;
    const rawCost = get(at.cost);
    // Whole rupees only ("₹18,000", "18000.00", "Rs 18000"), so no float ever reaches the money column.
    const costDigits = rawCost.replace(/₹|rs\.?|inr|,|\s/gi, "").replace(/\.0+$/, "");
    const cost = /^\d{1,10}$/.test(costDigits) ? Number(costDigits) : undefined;

    // Mirrors the server's row schema (bulkImportRowSchema), so a row marked Ready can't fail
    // validation there: one bad row would make the server refuse the whole import.
    let problem: string | null = null;
    if (!campaignTitle) problem = "No campaign name";
    else if (campaignTitle.length > 150) problem = "Campaign name is longer than 150 characters";
    else if (!pageHandle) problem = "No page handle";
    else if (pageHandle.length > 60 || /\s|\//.test(pageHandle)) problem = `"${rawHandle}" isn't an Instagram handle`;
    else if (!url) problem = "No post link";
    else if (!isWebAddress(url)) problem = "Post link isn't a web address";
    else if (!rawFormat) problem = "No format";
    else if (isCombo(format)) problem = COMBO_ROW_MESSAGE;
    else if (!isBookableFormat(format)) problem = `Format "${rawFormat}" isn't ${joinLabels(BOOKABLE_FORMATS, "or")}`;
    else if (rawCost && !(cost && cost > 0)) problem = `Cost "${rawCost}" isn't a whole rupee amount`;
    else if (seen.has(`${pageHandle.toLowerCase()} ${url}`)) problem = "Same page and link as an earlier row";
    if (!problem) seen.add(`${pageHandle.toLowerCase()} ${url}`);

    rows.push({ line: i + 2, campaignTitle, pageHandle, url, format, cost: problem ? undefined : cost, problem });
  });
  return rows;
}

function isWebAddress(value: string) {
  if (/\s/.test(value)) return false;
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}
