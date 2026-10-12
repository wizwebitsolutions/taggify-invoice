import { getAccessToken } from "../../lib/googleSheetsClient.js";

/**
 * Google Sheet reads for the Bulk Tracker's "Connect a Google Sheet" flow
 * (12 Oct, ported from affiliate-creator-tool lib/googleSheet.js). Uses the
 * Sheets API v4 with a service account — GOOGLE_SERVICE_ACCOUNT_KEY like the
 * source repo, or the finance export's email + private key (serviceAccount
 * below). No google-auth-library: the token comes from googleSheetsClient.js's
 * plain-fetch JWT flow.
 *
 * Only works for sheets the service account can read: "Anyone with the link
 * can view", or shared directly with the service account's email.
 */
const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";

// gid is null, not "0", when the URL doesn't carry one — Google doesn't
// guarantee a spreadsheet's first tab has gid=0, so fetchSheetRows resolves
// a null gid to the sheet's actual first tab.
export function parseSheetUrl(sheetUrl) {
  const idMatch = sheetUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (!idMatch) throw new Error("Couldn't find a spreadsheet ID in that URL");
  const gidMatch = sheetUrl.match(/[?&#]gid=([0-9]+)/);
  return { sheetId: idMatch[1], gid: gidMatch ? gidMatch[1] : null };
}

// A short, grep-able id per fetch so a user-reported failure can be tied to its log lines.
function fetchId() {
  return Math.random().toString(36).slice(2, 8);
}

/**
 * Hosting dashboards mangle a pasted JSON env value in predictable ways
 * (wrapping quotes kept literally, outer braces dropped, "\n" double-escaped),
 * so the key is accepted as raw JSON *or* base64-encoded JSON, and the common
 * manglings are repaired — same as affiliate-creator-tool's
 * parseServiceAccountKey. Exported for the unit test.
 */
export function parseServiceAccountKey(raw) {
  let text = String(raw).trim();
  if (!text.startsWith("{") && !text.startsWith('"') && !text.startsWith("'")) {
    text = Buffer.from(text, "base64").toString("utf8").trim();
  }
  if ((text.startsWith("'") && text.endsWith("'")) || (text.startsWith('"{') && text.endsWith('}"'))) {
    text = text.slice(1, -1);
  }
  if (!text.startsWith("{")) text = `{${text}}`;

  let key;
  try {
    key = JSON.parse(text);
  } catch (err) {
    throw new Error(`GOOGLE_SERVICE_ACCOUNT_KEY isn't valid JSON or base64-encoded JSON (${err.message})`);
  }
  if (!key.client_email || !key.private_key) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY is missing client_email/private_key — paste the whole service-account JSON file");
  }
  // A double-escaped paste leaves literal backslash-n in the PEM, which Google rejects.
  return { clientEmail: key.client_email, privateKey: key.private_key.replace(/\\n/g, "\n") };
}

/**
 * The service account to read with. GOOGLE_SERVICE_ACCOUNT_KEY (the whole
 * downloaded JSON key, raw or base64 — the single variable the source repo
 * uses) wins; otherwise the finance export's GOOGLE_SERVICE_ACCOUNT_EMAIL +
 * GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY pair.
 */
export function serviceAccount() {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) return parseServiceAccountKey(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawPrivateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  if (!clientEmail || !rawPrivateKey) {
    throw new Error("Google Sheets import isn't configured on the server — set GOOGLE_SERVICE_ACCOUNT_KEY (the service-account JSON)");
  }
  return { clientEmail, privateKey: rawPrivateKey.replace(/\\n/g, "\n") };
}

async function sheetsApiGet(accessToken, path, id) {
  const res = await fetch(`${SHEETS_API}/${path}`, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15000) });
  if (res.ok) return res.json();
  let message = `${res.status}`;
  try {
    message = (await res.json())?.error?.message ?? message;
  } catch {
    /* non-JSON body */
  }
  console.error(`[GoogleSheet:${id}] Sheets API request failed path=${path} status=${res.status} message=${message}`);
  const err = new Error(message);
  err.status = res.status;
  throw err;
}

/**
 * Fetches and parses a sheet. Returns { headers: string[], rows: Record<string,string>[], gid: string }.
 * `gid` is the real numeric tab id that was read — when the caller didn't
 * pass one (and the URL had none) it resolves to the sheet's true first tab,
 * so callers that persist it (for later "Check now") store the real id.
 */
export async function fetchSheetRows(sheetUrl, gid) {
  const { sheetId, gid: parsedGid } = parseSheetUrl(sheetUrl);
  const resolvedGid = gid ?? parsedGid;
  const id = fetchId();
  const { clientEmail, privateKey } = serviceAccount();
  const accessToken = await getAccessToken({ clientEmail, privateKey });

  let meta;
  try {
    // `index` is needed to find the first tab when no gid was given.
    meta = await sheetsApiGet(accessToken, `${sheetId}?fields=sheets.properties(sheetId,title,index)`, id);
  } catch (err) {
    if (err.status === 404) throw new Error("Sheet not found — check the URL and that the tab (gid) still exists");
    if (err.status === 403 || err.status === 401) {
      throw new Error(`Can't read this sheet — share it as "Anyone with the link can view", or share it directly with ${clientEmail} [ref ${id}]`);
    }
    if (err.status === 429) throw new Error("Google is rate-limiting sheet reads right now — wait a bit and try again");
    throw new Error(`Couldn't fetch the sheet (${err.message}) [ref ${id}]`);
  }

  const sheets = meta.sheets ?? [];
  const sheet =
    resolvedGid == null
      ? (sheets.find((s) => s.properties.index === 0) ?? sheets[0])
      : sheets.find((s) => String(s.properties.sheetId) === String(resolvedGid));
  if (!sheet) throw new Error(`Couldn't find tab gid=${resolvedGid} in this spreadsheet [ref ${id}]`);
  const title = sheet.properties.title;
  const actualGid = String(sheet.properties.sheetId);

  let values;
  try {
    // FORMATTED_VALUE: a date cell as its displayed string ("9/15/2026"), not
    // a serial number — sheet columns are stored/exported as plain strings.
    const res = await sheetsApiGet(accessToken, `${sheetId}/values/${encodeURIComponent(`'${title.replace(/'/g, "''")}'`)}?valueRenderOption=FORMATTED_VALUE`, id);
    values = res.values ?? [];
  } catch (err) {
    throw new Error(`Couldn't read tab "${title}" (${err.message}) [ref ${id}]`);
  }

  if (values.length === 0) return { headers: [], rows: [], gid: actualGid };

  const headers = values[0].map((h) => String(h ?? "").trim());
  const rows = values
    .slice(1)
    .filter((row) => row.some((cell) => String(cell ?? "").trim() !== ""))
    .map((row) => {
      const record = {};
      headers.forEach((header, i) => {
        record[header] = String(row[i] ?? "").trim();
      });
      return record;
    });

  return { headers, rows, gid: actualGid };
}
