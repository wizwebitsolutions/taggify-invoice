# Google Sheets connection: why it expires every 7 days, and how to make it permanent

## What you see
Generating a plan sheet works, then about a week later it fails with
"Reconnect Google" (`GOOGLE_RECONNECT_REQUIRED`). Reconnecting fixes it for
another 7 days.

## Why it happens
Taggify creates each plan sheet as a real Google account. An admin connects
that account once, and the server keeps the **refresh token** Google gives
back (`server/src/lib/googleOAuthClient.js`, saved in the `AppSetting` table).

The 7-day limit is a Google rule, not a bug in Taggify. When a Google Cloud
project's **OAuth consent screen** has the publishing status **"Testing"**,
Google expires every refresh token it issues **after 7 days**. Our code
already does everything else needed for a permanent token
(`access_type=offline` and `prompt=consent`).

## The fix (no code change; about 5 minutes in Google Cloud Console)
1. Open <https://console.cloud.google.com/>. Pick the project that owns the
   OAuth client in `server/.env` (`GOOGLE_OAUTH_CLIENT_ID`).
2. Go to **APIs & Services → OAuth consent screen** (on newer consoles it's
   **Google Auth Platform → Audience**).
3. Under **Publishing status**, click **Publish app**, then confirm. The
   status should now read **In production**.
4. In Taggify, connect Google **once more** as an admin. A token issued
   *before* publishing still expires on its old 7-day clock. A token issued
   *after* publishing doesn't expire.
   - In the old app (`client/`), the plan card shows **Reconnect Google**.
   - Or, signed in as an admin, open
     `<API_URL>/integrations/google/authorize?token=<your access token>`.

That's all. From then on the connection stays until someone revokes it:
- removing Taggify at <https://myaccount.google.com/permissions>;
- changing that Google account's password, which revokes tokens with Gmail scopes (ours aren't);
- 6 months with no sheet generated at all.

## Things you may notice after publishing
- **The "Google hasn't verified this app" screen.** The app asks for the
  `spreadsheets` scope, which Google calls *sensitive*. Until the app is
  verified, the consent screen shows this warning. Click **Advanced → Go to
  Taggify (unsafe)** to continue. That's fine here: only our own admin
  connects, once.
- **The 100-user cap** on unverified apps counts people who grant consent.
  We connect one account, so it doesn't matter.
- **Verification** (optional) removes the warning. It needs a privacy policy
  URL, a homepage on a verified domain, and a short demo video. Only worth
  doing if the warning bothers you.

## Alternatives (only if publishing isn't possible)
- **Google Workspace "Internal" app.** If the connected account belongs to
  a Google Workspace domain, set the consent screen's user type to
  **Internal**. Internal apps aren't subject to the 7-day rule or to
  verification. This isn't available for @gmail.com accounts.
- **Drop the sensitive scope** (code change, not done). The app could ask
  only for `drive.file`, a non-sensitive scope that still lets it create and
  edit the sheets it makes itself. This removes the unverified-app warning.
  It does **not** remove the 7-day rule by itself; that still needs
  "In production".
- **Service account.** Not workable on its own. A service account has no
  Drive storage of its own, so it can't create new spreadsheets (Google
  returns 403; see the note at the top of `googleOAuthClient.js`).
