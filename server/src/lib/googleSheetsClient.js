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

/** Sheet (tab) titles that already exist in the spreadsheet. */
async function getExistingSheetTitles({ accessToken, spreadsheetId }) {
  const res = await fetch(`${SHEETS_API}/${spreadsheetId}?fields=sheets.properties.title`, { headers: headers(accessToken) });
  if (!res.ok) {
    throw new Error(`Google Sheets API error reading spreadsheet: ${res.status} ${await res.text()}`);
  }
  const { sheets } = await res.json();
  return (sheets ?? []).map((s) => s.properties.title);
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
export async function writeSheetTab({ accessToken, spreadsheetId, title, rows }) {
  const range = `'${title}'`;
  const clearRes = await fetch(`${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(range)}:clear`, {
    method: "POST",
    headers: headers(accessToken),
  });
  if (!clearRes.ok) {
    throw new Error(`Google Sheets API error clearing tab "${title}": ${clearRes.status} ${await clearRes.text()}`);
  }

  const updateRes = await fetch(
    `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
    { method: "PUT", headers: headers(accessToken), body: JSON.stringify({ values: rows }) }
  );
  if (!updateRes.ok) {
    throw new Error(`Google Sheets API error writing tab "${title}": ${updateRes.status} ${await updateRes.text()}`);
  }
}
