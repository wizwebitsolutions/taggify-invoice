import jwt from "jsonwebtoken";

import { prisma } from "./prisma.js";
import { ApiError } from "../middleware/errorHandler.js";

/**
 * OAuth-as-the-admin flow for per-plan Google Sheets (user request, 10 Sep
 * — "1 spreadsheet generation per plan, not just write access, and also
 * public view access of sheet to anyone"). The service account
 * (googleSheetsClient.js) can only ever *edit* a spreadsheet a human
 * already shared with it — it has zero Drive storage quota of its own, so
 * `spreadsheets.create` returns a 403 no matter what (verified directly
 * against the live API). Creating a brand-new file per plan therefore has
 * to happen as a real Google account instead: this module runs the
 * one-time OAuth consent flow (see integrations/googleAuthRoutes.js) and
 * stores the resulting refresh token in `AppSetting`, then exchanges it
 * for a fresh access token on demand.
 */
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const SCOPES = ["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/drive.file"];
const REFRESH_TOKEN_SETTING_KEY = "googleOAuthRefreshToken";

function config() {
  return {
    clientId: process.env.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_OAUTH_REDIRECT_URI,
  };
}

export function isGoogleOAuthConfigured() {
  const { clientId, clientSecret, redirectUri } = config();
  return Boolean(clientId && clientSecret && redirectUri);
}

/**
 * The consent-screen URL an admin visits to grant this app access.
 * `state` is a short-lived signed token (not a session/cookie) so the
 * callback — a plain browser redirect from Google, no auth header — can
 * still be trusted to have come from a link this server itself issued.
 * `access_type=offline` + `prompt=consent` are both required to guarantee
 * Google actually returns a refresh_token (it's otherwise only issued on
 * the very first consent ever, which is easy to lose).
 */
export function buildAuthorizeUrl() {
  const { clientId, redirectUri } = config();
  const state = jwt.sign({ purpose: "google-oauth" }, process.env.JWT_ACCESS_SECRET, { expiresIn: "10m" });
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES.join(" "),
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

// The purpose check matters: other JWTs share this secret (access tokens,
// and since email 2FA the login challenge tokens anyone with just a
// password can obtain) — a bare signature check would accept any of them
// as a valid OAuth state.
export function verifyState(state) {
  const payload = jwt.verify(state, process.env.JWT_ACCESS_SECRET);
  if (payload?.purpose !== "google-oauth") throw new Error("not an OAuth state token");
}

export async function exchangeCodeForTokens(code) {
  const { clientId, clientSecret, redirectUri } = config();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    throw new Error(`Google OAuth code exchange failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

export async function saveRefreshToken(refreshToken) {
  await prisma.appSetting.upsert({
    where: { key: REFRESH_TOKEN_SETTING_KEY },
    create: { key: REFRESH_TOKEN_SETTING_KEY, value: refreshToken },
    update: { value: refreshToken },
  });
}

export async function isGoogleDriveConnected() {
  const row = await prisma.appSetting.findUnique({ where: { key: REFRESH_TOKEN_SETTING_KEY } });
  return Boolean(row);
}

/**
 * A fresh (≤1h) access token for the connected account, or `null` if no
 * admin has completed the authorize flow yet — callers turn that into the
 * same SHEETS_NOT_CONFIGURED-shaped error the old service-account path
 * used, just with a message pointing at /integrations/google/authorize
 * instead of missing env vars.
 */
export async function getUserAccessToken() {
  const row = await prisma.appSetting.findUnique({ where: { key: REFRESH_TOKEN_SETTING_KEY } });
  if (!row) return null;

  const { clientId, clientSecret } = config();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: row.value,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    // "invalid_grant" = Google revoked/expired the stored refresh token (a
    // consent screen still in Testing mode expires them after 7 days; a
    // password change or a manual revoke does too). Not a server fault, so
    // not a 500 "Something went wrong" (user report, 22 Sep) — a 503 that
    // names the fix, which the client turns into a Reconnect Google button.
    // The dead token is left in place; reconnecting overwrites it.
    if (/invalid_grant/.test(text)) {
      throw new ApiError(
        503,
        "GOOGLE_RECONNECT_REQUIRED",
        "The connected Google account's access has expired or been revoked — an admin needs to reconnect it (Plans → Reconnect Google)."
      );
    }
    throw new ApiError(502, "GOOGLE_TOKEN_REFRESH_FAILED", `Google didn't issue an access token (${res.status}) — try again in a moment.`);
  }
  const { access_token } = await res.json();
  return access_token;
}

/** Whether the stored refresh token still works — for the connection status endpoint. */
export async function isGoogleConnectionHealthy() {
  try {
    return Boolean(await getUserAccessToken());
  } catch {
    return false;
  }
}
