# Google Sheets setup — daily finance export (Phase 6)

Manual, one-time steps to get finance data flowing into a live Google
Sheet, alongside the existing Excel-to-GitHub export. Do these once; after
that the app writes to the sheet on its own every day (and on demand from
Job runs → "Run Google Sheet export now").

The whole flow: create a **service account** (a robot identity Google
Cloud manages) → download its key → share your Sheet with that robot's
email address, exactly like sharing a doc with a person → give the app the
robot's credentials.

## 1. Create or pick a Google Cloud project

1. Go to https://console.cloud.google.com/
2. Top-left, next to "Google Cloud", click the project dropdown → **New Project**.
3. Name it anything (e.g. "Taggify Finance") → **Create**.
4. Wait for the notification that it's created, then make sure it's selected in that same dropdown.

If you already have a Google Cloud project you use for other things, you can reuse it — skip to step 2.

## 2. Enable the Google Sheets API

1. In the search bar at the top, type **Google Sheets API** and open it.
2. Click **Enable**.

## 3. Create a service account

1. Left sidebar (or search bar) → **APIs & Services → Credentials**.
2. Click **+ Create Credentials → Service account**.
3. Name it (e.g. "taggify-finance-export") → **Create and continue**.
4. On the "Grant this service account access" step, you can just click **Continue** (no project-level role is needed — access is granted per-sheet in step 5, not here).
5. Click **Done**.

## 4. Create a key for the service account

1. Still in **Credentials**, find the service account you just made under "Service Accounts" and click into it.
2. Go to the **Keys** tab → **Add key → Create new key**.
3. Choose **JSON** → **Create**.
4. A `.json` file downloads automatically. **Keep this file safe — it's a password, not a document.** Don't email it, don't commit it to git, don't paste its raw contents in chat.
5. Open that file in a text editor. You need two fields from it:
   - `"client_email"` — looks like `taggify-finance-export@your-project.iam.gserviceaccount.com`
   - `"private_key"` — a long block starting with `-----BEGIN PRIVATE KEY-----`

## 5. Create the finance spreadsheet and share it with the service account

1. Go to https://sheets.google.com and create a new blank spreadsheet (name it e.g. "Taggify Finance Export"). You don't need to add any tabs or columns yourself — the app creates the "Invoices"/"Links"/"Summary" tabs automatically the first time it runs.
2. Click **Share** (top right).
3. Paste in the service account's email from step 4 (the `client_email` value).
4. Set its role to **Editor** (not Viewer — the app needs to write).
5. Uncheck "Notify people" (it's a robot, not a person) → **Share**.
6. Copy the spreadsheet's ID from its URL:
   `https://docs.google.com/spreadsheets/d/`**`THIS-LONG-ID-HERE`**`/edit`

## 6. Give the app the credentials

You need to set three values as environment variables on the server (locally in `server/.env`, and on Render/wherever it's deployed — under that service's **Environment** tab):

| Variable | Value |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | the `client_email` from step 4 |
| `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | the `private_key` from step 4 — see note below |
| `GOOGLE_FINANCE_SPREADSHEET_ID` | the ID from step 5 |

**About the private key:** it's a multi-line block, but environment variables are usually one line. Copy the whole `private_key` value from the JSON file (it will already have `\n` in it, not real line breaks, when copied from inside the JSON file's quoted string) and paste it as-is into the env var — don't try to reformat it into real line breaks. The app converts the `\n` sequences back into real line breaks on its own.

## 7. Verify it worked

1. Restart the server (so it picks up the new env vars).
2. Log in as an Admin → **Job runs** page → click **Run Google Sheet export now**.
3. It should say "success" and give you a link back to the spreadsheet.
4. Open the spreadsheet — you should see three tabs (Invoices, Links, Summary) with today's data.

If it fails instead, the error message on that page (and in the Job runs table) will say exactly which of the three values is missing or wrong — most common mistakes are the sheet not being shared with the service account's email, or the private key's `\n` sequences getting mangled when copy-pasting.

## What this does *not* replace

This runs **alongside** the existing daily Excel export to GitHub — nothing about that changes. You'll have both: a `.xlsx` file committed to a branch in the repo, and a live Google Sheet, updated daily from the same data.
