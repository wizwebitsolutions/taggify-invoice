import { Router } from "express";

import { verifyAccessToken } from "../../lib/auth/jwt.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireAccess } from "../../middleware/requireAccess.js";
import {
  buildAuthorizeUrl,
  verifyState,
  exchangeCodeForTokens,
  saveRefreshToken,
  isGoogleDriveConnected,
  isGoogleOAuthConfigured,
  isGoogleConnectionHealthy,
} from "../../lib/googleOAuthClient.js";

/**
 * The one-time "connect a Google account" flow behind per-plan spreadsheet
 * creation (user request, 10 Sep — "1 spreadsheet generation per plan, not
 * just write access"). Both routes are plain browser GETs — an OAuth
 * consent redirect can't carry an Authorization header — so auth here
 * works differently from the rest of the API:
 *  - /authorize takes the access token as a query param (this link is
 *    opened via `window.open`, never fetched), checks it's an ADMIN, and
 *    round-trips that fact through Google via the signed `state` param.
 *  - /callback has no bearer token at all; it trusts the `state` Google
 *    hands back instead, exactly the CSRF protection `state` exists for.
 */
const router = Router();

// `healthy` (22 Sep): connected AND the stored refresh token still works —
// "connected but expired" is what the plan card's Reconnect Google fixes.
// 12 Oct: signed-in only — admins (who connect it) and anyone who can edit
// plans (whose sheet actions depend on it). It was open to anyone before.
router.get("/status", requireAuth, requireAccess("plans.edit", "ADMIN", "PLAN_MAKER"), async (req, res, next) => {
  try {
    const configured = isGoogleOAuthConfigured();
    const connected = configured && (await isGoogleDriveConnected());
    res.json({ configured, connected, healthy: connected && (await isGoogleConnectionHealthy()) });
  } catch (err) {
    next(err);
  }
});

router.get("/authorize", (req, res) => {
  if (!isGoogleOAuthConfigured()) {
    return res.status(503).send("Google OAuth isn't configured yet — set GOOGLE_OAUTH_CLIENT_ID/SECRET/REDIRECT_URI (see server/.env.example).");
  }
  const token = req.query.token;
  if (typeof token !== "string") {
    return res.status(401).send("Missing token");
  }
  try {
    const payload = verifyAccessToken(token);
    if (payload.role !== "ADMIN") {
      return res.status(403).send("Only an ADMIN can connect the Google account used for plan sheets.");
    }
  } catch {
    return res.status(401).send("Invalid or expired session — sign in again and retry.");
  }
  res.redirect(buildAuthorizeUrl());
});

router.get("/callback", async (req, res, next) => {
  try {
    const { code, state, error } = req.query;
    if (error) {
      return res.status(400).send(`Google declined the request: ${error}`);
    }
    if (typeof state !== "string") {
      return res.status(400).send("Missing state");
    }
    try {
      verifyState(state);
    } catch {
      return res.status(400).send("This authorization link expired or is invalid — go back to Taggify and try connecting again.");
    }
    if (typeof code !== "string") {
      return res.status(400).send("Missing code");
    }

    const tokens = await exchangeCodeForTokens(code);
    if (!tokens.refresh_token) {
      // Google only issues a refresh_token on a consent the user hasn't
      // already granted — re-granting requires revoking first.
      return res
        .status(400)
        .send(
          "Google didn't return a refresh token (this app may already have access). Revoke it at https://myaccount.google.com/permissions and try connecting again."
        );
    }
    await saveRefreshToken(tokens.refresh_token);
    res.send("<html><body style=\"font-family:sans-serif;padding:2rem\">Google account connected — you can close this tab and go back to Taggify.</body></html>");
  } catch (err) {
    next(err);
  }
});

export default router;
