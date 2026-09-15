import jwt from "jsonwebtoken";

import { prisma } from "./prisma.js";

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

export function verifyState(state) {
  jwt.verify(state, process.env.JWT_ACCESS_SECRET);
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
    throw new Error(`Google OAuth token refresh failed: ${res.status} ${await res.text()}`);
  }
  const { access_token } = await res.json();
  return access_token;
}
