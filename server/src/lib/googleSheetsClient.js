import jwt from "jsonwebtoken";

/**
 * Minimal Google Sheets v4 REST client for the daily finance export
 * (newTask.md, 8 Sep — "finance data will be saved in google sheets each
 * day"). No googleapis SDK dependency, same "just fetch" philosophy as
 * githubClient.js — a service account's OAuth2 flow is a handful of plain
 * HTTP calls once you can sign a JWT, and `jsonwebtoken` (already a
 * dependency, used for our own access/refresh tokens) signs RS256 as
 * easily as the HS256 it's used for elsewhere in this codebase.
 * https://developers.google.com/identity/protocols/oauth2/service-account#jwt-auth
 * https://developers.google.com/sheets/api/reference/rest
 */
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";

/**
 * Exchanges a service account's key pair for a short-lived (1h) OAuth2
 * access token. `privateKey` is expected exactly as it comes out of the
 * downloaded JSON key file — including literal `\n` escapes if it was
 * passed through an env var (see financeGoogleSheetExport.js, which
 * un-escapes it before calling this).
 */
export async function getAccessToken({ clientEmail, privateKey }) {
  const now = Math.floor(Date.now() / 1000);
  const assertion = jwt.sign(
    { iss: clientEmail, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 },
    privateKey,
    { algorithm: "RS256" }
  );

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  if (!res.ok) {
    throw new Error(`Google OAuth token exchange failed: ${res.status} ${await res.text()}`);
  }
  const { access_token } = await res.json();
  return access_token;
}

function headers(accessToken) {
  return { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };
}

/**
 * Creates a brand-new spreadsheet, owned by whoever `accessToken` belongs
 * to — user request, 10 Sep, "1 spreadsheet generation per plan, not just
 * write access". Only viable with a real user's OAuth access token (see
 * googleOAuthClient.js): a service account has no Drive storage quota of
 * its own and gets a 403 on this exact call (verified directly against the
 * live API), which is why every plan used to share tabs in one
 * admin-owned spreadsheet instead. Returns the new file's id and the
 * default "Sheet1" tab's sheetId so the caller can remove that placeholder
 * tab once its own tabs are in place.
 */
export async function createSpreadsheet({ accessToken, title }) {
  const res = await fetch(SHEETS_API, {
    method: "POST",
    headers: headers(accessToken),
    body: JSON.stringify({ properties: { title } }),
  });
  if (!res.ok) {
    throw new Error(`Google Sheets API error creating spreadsheet: ${res.status} ${await res.text()}`);
  }
  const { spreadsheetId, sheets } = await res.json();
  return { spreadsheetId, defaultSheetId: sheets?.[0]?.properties?.sheetId };
}

/** Removes a tab by its numeric sheetId — used to drop the blank default
 *  "Sheet1" a freshly created spreadsheet always starts with, once the
 *  real tabs have been written. No-op (rather than an error) if it's the
 *  spreadsheet's only remaining tab, since Sheets refuses to delete the
 *  last sheet in a file. */
export async function deleteSheetTab({ accessToken, spreadsheetId, sheetId }) {
  if (sheetId == null) return;
  const res = await fetch(`${SHEETS_API}/${spreadsheetId}:batchUpdate`, {
    method: "POST",
    headers: headers(accessToken),
    body: JSON.stringify({ requests: [{ deleteSheet: { sheetId } }] }),
  });
  if (!res.ok) {
    const body = await res.text();
    if (res.status === 400 && /last visible sheet/i.test(body)) return;
    throw new Error(`Google Sheets API error deleting tab: ${res.status} ${body}`);
  }
}

/** Every tab's title + sheetId ("gid" — the number a deep link like
 *  `.../edit#gid=123` points at) already in the spreadsheet. */
async function getExistingSheetTabs({ accessToken, spreadsheetId }) {
  const res = await fetch(`${SHEETS_API}/${spreadsheetId}?fields=sheets.properties`, { headers: headers(accessToken) });
  if (!res.ok) {
    throw new Error(`Google Sheets API error reading spreadsheet: ${res.status} ${await res.text()}`);
  }
  const { sheets } = await res.json();
  return (sheets ?? []).map((s) => ({ title: s.properties.title, sheetId: s.properties.sheetId }));
}

/** Sheet (tab) titles that already exist in the spreadsheet. */
async function getExistingSheetTitles({ accessToken, spreadsheetId }) {
  return (await getExistingSheetTabs({ accessToken, spreadsheetId })).map((t) => t.title);
}

/**
 * The sheetId ("gid") for each of `titles` — for building a deep link
 * straight to one tab (`.../edit?gid=<id>#gid=<id>`), the shape plans
 * (user request, 10 Sep — "plan will be of google sheet ... generate
 * google sheet and provide link") deep-link to their own Overview tab
 * with. Titles not found in the spreadsheet are simply omitted.
 */
export async function getSheetTabIds({ accessToken, spreadsheetId, titles }) {
  const tabs = await getExistingSheetTabs({ accessToken, spreadsheetId });
  const byTitle = new Map(tabs.map((t) => [t.title, t.sheetId]));
  return Object.fromEntries(titles.filter((t) => byTitle.has(t)).map((t) => [t, byTitle.get(t)]));
}

/**
 * Creates any of `titles` that don't already exist as a tab in the
 * spreadsheet — so the export can point at a brand-new, blank spreadsheet
 * (just shared with the service account) without a human first creating
 * "Invoices"/"Links"/"Summary" tabs by hand, same "runs automatically, no
 * one-time manual step" spirit as githubClient.js's ensureBranchExists.
 */
export async function ensureSheetTabsExist({ accessToken, spreadsheetId, titles }) {
  const existing = await getExistingSheetTitles({ accessToken, spreadsheetId });
  const missing = titles.filter((t) => !existing.includes(t));
  if (missing.length === 0) return;

  const res = await fetch(`${SHEETS_API}/${spreadsheetId}:batchUpdate`, {
    method: "POST",
    headers: headers(accessToken),
    body: JSON.stringify({ requests: missing.map((title) => ({ addSheet: { properties: { title } } })) }),
  });
  if (!res.ok) {
    throw new Error(`Google Sheets API error creating tab(s) ${missing.join(", ")}: ${res.status} ${await res.text()}`);
  }
}

/**
 * Replaces a tab's entire content with `rows` (a 2D array, first row is
 * the header). Clears first, not just an overwrite-in-place — otherwise a
 * day where the data shrinks (fewer invoices somehow, or a column removed
 * later) would leave stale cells from the previous day's longer sheet
 * sitting past the end of the new data.
 */
export async function writeSheetTab({ accessToken, spreadsheetId, title, rows, valueInputOption = "RAW" }) {
  const range = `'${title}'`;
  const clearRes = await fetch(`${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(range)}:clear`, {
    method: "POST",
    headers: headers(accessToken),
  });
  if (!clearRes.ok) {
    throw new Error(`Google Sheets API error clearing tab "${title}": ${clearRes.status} ${await clearRes.text()}`);
  }

  // RAW writes every cell as literal text/number; USER_ENTERED would let a
  // cell starting with "=" evaluate as a formula. Plan sheets write plain
  // text only (22 Sep), so callers leave this at the default.
  const updateRes = await fetch(
    `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=${valueInputOption}`,
    { method: "PUT", headers: headers(accessToken), body: JSON.stringify({ values: rows }) }
  );
  if (!updateRes.ok) {
    throw new Error(`Google Sheets API error writing tab "${title}": ${updateRes.status} ${await updateRes.text()}`);
  }
}

/**
 * Sends arbitrary Sheets API batchUpdate `requests` (mergeCells, repeatCell,
 * updateBorders, etc.) — the styling primitive planSheet.js's format
 * builder uses to make a generated tab actually look like the reference
 * sheet (user request, 10 Sep — "google sheet format should be like this,
 * same styling") instead of the plain, unstyled cell values written so far.
 */
export async function batchUpdateSpreadsheet({ accessToken, spreadsheetId, requests }) {
  if (!requests || requests.length === 0) return;
  const res = await fetch(`${SHEETS_API}/${spreadsheetId}:batchUpdate`, {
    method: "POST",
    headers: headers(accessToken),
    body: JSON.stringify({ requests }),
  });
  if (!res.ok) {
    throw new Error(`Google Sheets API error applying formatting: ${res.status} ${await res.text()}`);
  }
}
