import { parseCsv, normalizeHandle, parseFollowerCount } from "../modules/assets/importParser.js";

/**
 * Reads an attached execution sheet (user decision, 23 Sep — "parse → auto-
 * create links") into one record per published post. The sheet is whatever
 * the person actually posting keeps, based on the sample in planSheet.js
 * (S No, Page Name, Page Link, Followers, Date, Posted Link, Views, Likes,
 * Comments, Shares), so the header row is located by content rather than
 * assumed at row 1, and columns are matched by name, not position — a
 * reordered or trimmed-down copy still reads. Rows before the header (a
 * title band), blank rows and the TOTAL row are skipped.
 *
 * Returns { rows, headerRow } where each row is
 *   { rowNumber, pageName, pageHandle, postUrl, date, followers }
 * with pageHandle resolved from the Page Link when it's an Instagram
 * profile URL, else from the Page Name. Nothing is validated against the
 * database here — that's plans/service.js's syncExecutionSheet.
 */

const HEADER_ALIASES = {
  pageName: ["page name", "page", "creator", "account", "name"],
  pageLink: ["page link", "profile link", "profile", "page url", "handle", "username"],
  followers: ["followers", "page followers"],
  date: ["date", "posted on", "post date", "posted date"],
  postUrl: ["posted link", "post link", "post url", "link", "reel link", "reel", "url", "post"],
};

const norm = (s) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

function matchHeader(cells) {
  const idx = {};
  cells.forEach((cell, i) => {
    const c = norm(cell);
    if (!c) return;
    for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
      if (idx[key] == null && aliases.includes(c)) idx[key] = i;
    }
  });
  return idx;
}

const isUrl = (v) => /^https?:\/\/\S+$/i.test(String(v ?? "").trim());

export function parseExecutionSheet(csvText) {
  const grid = parseCsv(csvText);
  let headerRow = -1;
  let idx = {};
  for (let r = 0; r < Math.min(grid.length, 30); r++) {
    const candidate = matchHeader(grid[r]);
    // A header names at least the post link and something identifying the page.
    if (candidate.postUrl != null && (candidate.pageName != null || candidate.pageLink != null)) {
      headerRow = r;
      idx = candidate;
      break;
    }
  }
  if (headerRow === -1) {
    return { headerRow: -1, rows: [] };
  }

  const rows = [];
  for (let r = headerRow + 1; r < grid.length; r++) {
    const cells = grid[r];
    if (!cells || cells.every((c) => !String(c ?? "").trim())) continue;
    const pageName = String(cells[idx.pageName] ?? "").trim();
    const pageLink = String(cells[idx.pageLink] ?? "").trim();
    const postUrlRaw = String(cells[idx.postUrl] ?? "").trim();
    if (norm(pageName) === "total" || norm(cells[0]) === "total") continue;
    // A row with neither a page nor a post is decoration (a note, a blank line).
    if (!pageName && !pageLink && !postUrlRaw) continue;

    const pageHandle = normalizeHandle(pageLink) ?? normalizeHandle(pageName) ?? null;
    rows.push({
      rowNumber: r + 1,
      pageName: pageName || null,
      pageHandle,
      postUrl: isUrl(postUrlRaw) ? postUrlRaw : null,
      date: idx.date != null ? String(cells[idx.date] ?? "").trim() || null : null,
      followers: idx.followers != null ? parseFollowerCount(cells[idx.followers]) : null,
    });
  }
  return { headerRow, rows };
}
