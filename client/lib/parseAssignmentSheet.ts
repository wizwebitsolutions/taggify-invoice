import Papa from "papaparse";

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
  for (const row of data) {
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
    const format = (formatKey ? row[formatKey]?.trim() : "")?.toLowerCase();
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
  for (const row of data) {
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
    const format = (formatKey ? row[formatKey]?.trim() : "")?.toLowerCase();
    if (!campaignTitle || !pageHandle || !url || !format) continue;

    const rawCost = costKey ? row[costKey]?.trim() : "";
    const cost = rawCost ? Number(rawCost.replace(/[^\d.]/g, "")) : undefined;

    rows.push({ campaignTitle, pageHandle, url, format, cost: cost && !Number.isNaN(cost) ? cost : undefined });
  }
  return rows;
}
