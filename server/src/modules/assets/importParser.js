import ExcelJS from "exceljs";

/**
 * Inventory "Import pages" (user request, 14 Sep): turns an uploaded
 * .xlsx / .csv into normalized page rows. Pure — no DB, no HTTP — so the
 * edge cases (handles pasted as profile URLs, "@" prefixes, "1.2M"
 * follower counts, quoted CSV cells, blank rows, a missing header row) are
 * all unit-testable without a database. Owner/handle *resolution* against
 * real accounts happens in service.js's previewImport.
 *
 * Header names are matched case-insensitively and mirror the conventions
 * the client's parseAssignmentSheet.ts already uses for the campaign and
 * plan sheets, so one sheet format works everywhere in the app.
 */

export const MAX_IMPORT_ROWS = 500;
// How many leading rows to scan for the header (a title/blank row or two above it is common in hand-made sheets).
const HEADER_SEARCH_ROWS = 10;

const HANDLE_HEADERS = ["handle", "page", "page handle", "instagram", "instagram handle", "username"];
// Template columns since 22 Sep: Page Name, Page Link, Followers, Reel Rate,
// Story Rate. The page is identified (and fetched) by its link; the name is
// only the display name saved on the page until Instagram's own name
// replaces it. A link column wins over a handle column when a sheet has
// both, so older handle-based sheets keep working unchanged.
const PAGE_LINK_HEADERS = ["page link", "page url", "profile link", "profile url", "instagram link", "instagram url", "link", "url"];
// Not a bare "name": in older sheets that column is usually the owner's name.
const PAGE_NAME_HEADERS = ["page name", "display name"];
// Phone-ish headers first: when a sheet carries both an "owner name" and a
// "phone" column, the phone (the unique login key) is the one to match on.
const OWNER_PHONE_HEADERS = ["owner phone", "account phone", "phone", "phone number", "creator phone", "mobile", "mobile number"];
const OWNER_OTHER_HEADERS = ["owner", "account", "creator", "user", "owner name", "owner email", "email"];
const CATEGORY_HEADERS = ["category", "page type", "type", "niche"];
// Vendor columns (14 Oct): who owns the page, so the preview can match an
// existing vendor (creator account) or flag a NEW one for the admin to
// approve and create. Kept apart from the owner lists above — a plain
// "phone" column still means the owner's phone, exactly as before.
const VENDOR_NAME_HEADERS = ["vendor", "vendor name", "vendor's name"];
// One cell holding a phone number OR an email — classified per row.
const VENDOR_CONTACT_HEADERS = ["contact", "vendor contact", "contact number", "contact no", "contact details"];
const VENDOR_PHONE_HEADERS = ["vendor phone", "vendor mobile", "contact phone"];
const VENDOR_EMAIL_HEADERS = ["vendor email", "contact email"];
const MAX_VENDOR_NAME_LENGTH = 100;
const MAX_EMAIL_LENGTH = 254;
const MAX_PHONE_LENGTH = 20;
const EMAIL_PATTERN = /[^\s@,;<>()]+@[^\s@,;<>()]+\.[^\s@,;<>()]+/;
const FOLLOWERS_HEADERS = ["followers", "follower count", "audience"];
// Formats a rate column can name outright ("reel") or with a suffix ("reel
// rate", "story cost"). reel/story only (14 Sep) — any other column, e.g.
// "video price", is ignored rather than creating a rate card the app
// can't use.
import { FORMATS as STANDARD_FORMATS } from "../../lib/formats.js";
const RATE_SUFFIX = /^(.+?)\s+(rate|cost|price|amount)$/;
// Mirrors assets/schemas.js's rateCardEntrySchema / importAssetRowSchema so a
// row the preview shows as "will be created" can't then fail the confirm schema.
const MAX_FORMAT_LENGTH = 40;
const MAX_RATE_COLUMNS = 20;
// Postgres Int — Asset.followers is a plain Int, so "3000M" must not overflow it.
const MAX_INT32 = 2_147_483_647;

/** Instagram's own rules: letters, digits, "." and "_", up to 30 chars. */
const HANDLE_PATTERN = /^[a-z0-9._]{1,30}$/i;

/**
 * "@handle", " handle ", "https://www.instagram.com/handle/?hl=en" and
 * "instagram.com/handle" all normalize to "handle". Returns null when
 * nothing usable is left (blank cell, or a URL that isn't an Instagram
 * profile link).
 */
export function normalizeHandle(raw) {
  let value = String(raw ?? "").trim();
  if (!value) return null;
  const urlMatch = value.match(/^(?:https?:\/\/)?(?:www\.|m\.)?instagram\.com\/([^/?#\s]+)(?:\/([^/?#\s]+))?/i);
  if (urlMatch) {
    const [, first, second] = urlMatch;
    const lower = first.toLowerCase();
    // instagram.com/stories/<handle>/… and instagram.com/_u/<handle> still name a profile…
    if (lower === "stories" || lower === "_u") value = second ?? "";
    // …but a post / reel / explore link doesn't name one at all (22 Sep — links are the main input now).
    else if (NON_PROFILE_PATHS.includes(lower)) return null;
    else value = first;
  } else if (/^(?:https?:\/\/|www\.)/i.test(value)) return null;
  value = value.replace(/^@+/, "").trim();
  return value || null;
}

const NON_PROFILE_PATHS = ["p", "reel", "reels", "tv", "explore", "accounts", "direct"];

export function isValidHandle(handle) {
  return typeof handle === "string" && HANDLE_PATTERN.test(handle);
}

/** "1.2M" / "850K" / "1.5L" / "2Cr" / "12,500" / 12500 → an integer, else null. */
export function parseFollowerCount(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number") return Number.isFinite(raw) && raw >= 0 ? Math.min(Math.round(raw), MAX_INT32) : null;
  const match = String(raw).trim().match(/^([\d,]*\.?\d+)\s*(k|m|l|cr)?$/i);
  if (!match) return null;
  const base = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(base)) return null;
  const multiplier = { k: 1_000, m: 1_000_000, l: 100_000, cr: 10_000_000 }[match[2]?.toLowerCase() ?? ""] ?? 1;
  return Math.min(Math.round(base * multiplier), MAX_INT32);
}

/** "₹12,000" / "12000" / 12000 → a positive number, else null. */
export function parseAmount(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number") return Number.isFinite(raw) && raw > 0 ? raw : null;
  const digits = String(raw).replace(/[^\d.]/g, "");
  if (!digits) return null;
  const amount = Number(digits);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

/** A plausible email inside the cell (lowercased, trimmed, ≤254), else null. */
export function parseContactEmail(raw) {
  const value = String(raw ?? "").trim();
  if (!value.includes("@")) return null;
  const match = value.match(EMAIL_PATTERN);
  if (!match) return null;
  const email = match[0].replace(/^mailto:/i, "").replace(/[.]+$/, "").toLowerCase();
  return email.length <= MAX_EMAIL_LENGTH ? email : null;
}

/**
 * The cell's first phone-shaped run ("Mob: +91 98765-43210", "98765 43210 / 91234 56789")
 * as "+"/digits only ("+919876543210"), 10–15 digits, else null. Digits only, so what's
 * offered for a new login is a number the signup schema and phone matching both accept,
 * never the label or punctuation around it (14 Oct review).
 */
export function parseContactPhone(raw) {
  const run = String(raw ?? "").match(/\+?\d[\d\s().-]*\d/);
  if (!run) return null;
  const digits = run[0].replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) return null;
  const phone = `${run[0].startsWith("+") ? "+" : ""}${digits}`;
  return phone.length <= MAX_PHONE_LENGTH ? phone : null;
}

/** A "Vendor Contact" cell: its email (if it has a plausible one) and its phone (≥10 digits outside the email), either or both. */
export function classifyContact(raw) {
  const value = String(raw ?? "").trim();
  if (!value) return { phone: null, email: null };
  const email = parseContactEmail(value);
  const rest = email ? value.replace(EMAIL_PATTERN, " ") : value;
  return { phone: parseContactPhone(rest), email };
}

/** Cell text with ExcelJS's richer cell values (rich text, formulas, hyperlinks) flattened to a string. */
function cellText(value) {
  if (value == null) return "";
  if (typeof value === "object") {
    if (Array.isArray(value.richText)) return value.richText.map((r) => r.text).join("");
    if (value.text != null) return cellText(value.text);
    if (value.result != null) return cellText(value.result);
    if (value instanceof Date) return value.toISOString();
    return "";
  }
  return String(value);
}

/** UTF-8 by default; Excel's "Unicode Text" export is UTF-16LE with a FF FE BOM. */
function decodeText(buffer) {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.subarray(2).toString("utf16le");
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.from(buffer.subarray(2));
    swapped.swap16();
    return swapped.toString("utf16le");
  }
  return buffer.toString("utf8");
}

/** Minimal RFC-4180 CSV reader (quoted cells, doubled quotes, CR/LF line ends). */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** The first worksheet of an .xlsx as a 2D array of cell strings/numbers. */
async function readXlsx(buffer) {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    throw new ImportParseError("Couldn't read that file — make sure it's a valid .xlsx workbook or a .csv export.");
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new ImportParseError("That workbook has no sheets.");
  const grid = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const cells = [];
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const v = cell.value;
      cells[colNumber - 1] = typeof v === "number" ? v : cellText(v);
    });
    grid[rowNumber - 1] = cells;
  });
  return grid;
}

export class ImportParseError extends Error {}

function findColumn(headers, candidates) {
  const idx = headers.findIndex((h) => candidates.includes(h));
  return idx === -1 ? null : idx;
}

/**
 * @param {Buffer} buffer  the uploaded bytes
 * @param {string} fileName  used only to pick xlsx vs csv by extension
 * @returns {Promise<{ rows: Array<{ rowNumber, handle, rawHandle, pageName, ownerRef, vendorName, vendorPhone, vendorEmail, category, followers, rateCards, problem }>, hasOwnerColumn: boolean, totalRows: number }>}
 */
export async function parseImportSheet(buffer, fileName = "") {
  if (!buffer || buffer.length === 0) throw new ImportParseError("That file is empty.");
  const ext = String(fileName).toLowerCase().split(".").pop();
  let grid;
  if (ext === "xlsx" || ext === "xlsm") grid = await readXlsx(buffer);
  else if (ext === "csv" || ext === "txt" || !ext) grid = parseCsv(decodeText(buffer));
  else if (ext === "xls") throw new ImportParseError("Legacy .xls files aren't supported — save it as .xlsx or .csv and try again.");
  else throw new ImportParseError(`Unsupported file type ".${ext}" — upload an .xlsx or .csv file.`);

  // Skip fully-blank leading rows so a title row above the header doesn't
  // masquerade as the header itself.
  // The header is the first row (within the top few) that names a handle
  // column — so a title row or a blank row above it doesn't get mistaken
  // for the header, and its cells don't get imported as pages.
  const nonEmpty = (cells) => (cells ?? []).some((c) => String(c ?? "").trim() !== "");
  if (!grid.some(nonEmpty)) throw new ImportParseError("That file is empty — it needs a header row (e.g. handle, owner phone) and one row per page.");
  const lowerRow = (cells) => (cells ?? []).map((h) => cellText(h).trim().toLowerCase().replace(/[‘’]/g, "'"));
  const namesAPage = (cells) => [PAGE_LINK_HEADERS, HANDLE_HEADERS, PAGE_NAME_HEADERS].some((h) => findColumn(lowerRow(cells), h) !== null);
  const headerIdx = grid.slice(0, HEADER_SEARCH_ROWS).findIndex(namesAPage);
  if (headerIdx === -1) {
    throw new ImportParseError('Couldn\'t find a "Page Link" column — download the template, or add a header named "Page Link" (or "handle") to the first row.');
  }
  const headers = lowerRow(grid[headerIdx]);
  const linkCol = findColumn(headers, PAGE_LINK_HEADERS);
  const handleOnlyCol = findColumn(headers, HANDLE_HEADERS);
  // The column a row's page is read from; with both present, the link wins
  // row by row (below) and the handle column is the fallback. A sheet with
  // neither but a "Page Name" column is a pre-22-Sep sheet, where that
  // column held the handle — read it as the handle, as before.
  const namedCol = findColumn(headers, PAGE_NAME_HEADERS);
  const handleCol = linkCol ?? handleOnlyCol ?? namedCol;
  const pageNameCol = linkCol === null && handleOnlyCol === null ? null : namedCol;
  const ownerCol = findColumn(headers, OWNER_PHONE_HEADERS) ?? findColumn(headers, OWNER_OTHER_HEADERS);
  const categoryCol = findColumn(headers, CATEGORY_HEADERS);
  const followersCol = findColumn(headers, FOLLOWERS_HEADERS);
  const vendorNameCol = findColumn(headers, VENDOR_NAME_HEADERS);
  const vendorContactCol = findColumn(headers, VENDOR_CONTACT_HEADERS);
  const vendorPhoneCol = findColumn(headers, VENDOR_PHONE_HEADERS);
  const vendorEmailCol = findColumn(headers, VENDOR_EMAIL_HEADERS);
  const vendorCols = [vendorNameCol, vendorContactCol, vendorPhoneCol, vendorEmailCol].filter((c) => c !== null);
  const hasVendorColumn = vendorCols.length > 0;
  // "Vendor | Phone | Email" sheets: plain owner phone/email columns are the vendor's contact too (14 Oct review).
  const ownerPhoneCol = findColumn(headers, OWNER_PHONE_HEADERS);
  const ownerEmailCol = findColumn(headers, ["owner email", "email"]);
  // One column per format (first wins — "reel" and "reel rate" both name
  // the same rate card, which is unique per (asset, format)).
  const rateCols = [];
  const seenFormats = new Set();
  headers.forEach((h, i) => {
    if (i === linkCol || i === handleOnlyCol || i === namedCol || i === ownerCol || i === categoryCol || i === followersCol || vendorCols.includes(i)) return;
    if (rateCols.length >= MAX_RATE_COLUMNS) return;
    let format = null;
    if (STANDARD_FORMATS.includes(h)) format = h;
    else {
      const m = h.match(RATE_SUFFIX);
      if (m) format = m[1].trim().slice(0, MAX_FORMAT_LENGTH);
    }
    if (!format || !STANDARD_FORMATS.includes(format) || seenFormats.has(format)) return;
    seenFormats.add(format);
    rateCols.push({ col: i, format });
  });

  const dataRows = grid.slice(headerIdx + 1).map((cells, i) => ({ cells, rowNumber: headerIdx + 2 + i })).filter(({ cells }) => nonEmpty(cells));
  if (dataRows.length === 0) throw new ImportParseError("No pages found below the header row.");
  if (dataRows.length > MAX_IMPORT_ROWS) {
    throw new ImportParseError(`That sheet has ${dataRows.length} rows — imports are capped at ${MAX_IMPORT_ROWS} pages at a time. Split it up and try again.`);
  }

  const rows = dataRows.map(({ cells, rowNumber }) => {
    let rawHandle = cellText(cells[handleCol]).trim();
    let handle = normalizeHandle(rawHandle);
    // A sheet with both columns: a row whose "link" isn't an Instagram profile
    // (an old sheet's website column, say) falls back to its handle cell.
    if (!handle && linkCol !== null && handleOnlyCol !== null) {
      const fallback = cellText(cells[handleOnlyCol]).trim();
      if (normalizeHandle(fallback)) {
        rawHandle = fallback;
        handle = normalizeHandle(fallback);
      }
    }
    let problem = null;
    if (!handle) problem = rawHandle ? "Link broken or not an Instagram profile link." : "Missing page link.";
    else if (!isValidHandle(handle)) problem = `"${handle}" isn't a valid Instagram handle (letters, digits, dots and underscores only, up to 30 characters).`;

    const rateCards = [];
    for (const { col, format } of rateCols) {
      const amount = parseAmount(cells[col]);
      if (amount !== null) rateCards.push({ format, amount });
    }
    const category = categoryCol === null ? null : cellText(cells[categoryCol]).trim().slice(0, 40) || null;

    // Explicit phone/email columns win; a combined contact cell fills whichever is still missing.
    const contact = vendorContactCol === null ? { phone: null, email: null } : classifyContact(cellText(cells[vendorContactCol]));
    const vendorName = vendorNameCol === null ? null : cellText(cells[vendorNameCol]).trim().slice(0, MAX_VENDOR_NAME_LENGTH) || null;
    const vendorPhone =
      (vendorPhoneCol === null ? null : parseContactPhone(cellText(cells[vendorPhoneCol]))) ?? contact.phone ?? (hasVendorColumn && ownerPhoneCol !== null ? parseContactPhone(cellText(cells[ownerPhoneCol])) : null);
    const vendorEmail =
      (vendorEmailCol === null ? null : parseContactEmail(cellText(cells[vendorEmailCol]))) ?? contact.email ?? (hasVendorColumn && ownerEmailCol !== null ? parseContactEmail(cellText(cells[ownerEmailCol])) : null);
    const legacyOwnerRef = ownerCol === null ? null : cellText(cells[ownerCol]).trim() || null;
    // Vendor data, when the row has any, is what the owner is matched on.
    const ownerRef = hasVendorColumn && (vendorPhone || vendorEmail || vendorName) ? vendorPhone ?? vendorEmail ?? vendorName : legacyOwnerRef;
    return {
      rowNumber,
      rawHandle,
      handle,
      pageName: pageNameCol === null ? null : cellText(cells[pageNameCol]).trim().slice(0, 100) || null,
      ownerRef,
      vendorName,
      vendorPhone,
      vendorEmail,
      category,
      followers: followersCol === null ? null : parseFollowerCount(cells[followersCol]),
      rateCards,
      problem,
    };
  });

  return { rows, hasOwnerColumn: ownerCol !== null || hasVendorColumn, totalRows: rows.length };
}
