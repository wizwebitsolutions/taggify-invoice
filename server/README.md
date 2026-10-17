# invoice-taggify — backend

Implementation of the backend described in `../system design.md`. Node.js + Express + Prisma/PostgreSQL, Cloudinary for screenshots, Apify for Instagram scraping, node-cron for scheduled jobs (no Redis/BullMQ), manual invoice payment (no payment gateway).

## Setup

```bash
# from repo root
docker compose up -d          # local Postgres

cd server
cp .env.example .env          # fill in DATABASE_URL, JWT secrets, Cloudinary + Apify creds
npm install
npm run db:migrate            # creates tables from prisma/schema.prisma
npm run db:seed               # creates an ADMIN, FINANCE and demo CREATOR + asset + rate card
npm run dev
```

Server starts on `http://localhost:4000`. `GET /health` for a liveness check. All other routes are namespaced under `/api` (e.g. `/api/auth/login`) — see `src/app.js` — since in production this same server also hosts `client/`'s static export at the bare paths (`/campaigns`, `/users`, etc.), so the API can't live at those paths too.

## Auth model
`POST /api/auth/signup` (admin-only) takes only a phone number (+ optional name/role); the server generates a random password and returns it once in the response — that's the only place it's ever visible in plaintext.

**Email 2FA (21 Sep).** `POST /api/auth/login` takes `{ phoneNumber | email, password }` and answers with a `step`; only `AUTHENTICATED` carries the access/refresh JWT pair (refresh tokens are hashed and stored in Postgres for revocation — no Redis):

- Account with a verified email → must log in with that **email** (phone number is refused with `USE_EMAIL_LOGIN`). A 6-digit code is emailed and the response is `OTP_REQUIRED` + a 15-minute `challengeToken`; `POST /api/auth/login/verify-otp { challengeToken, code }` returns the session, `POST /api/auth/login/resend-otp { challengeToken }` re-sends.
- Account without one → logs in by phone number. The first `MAX_UNVERIFIED_LOGINS` (2) logins are normal sessions (`user.emailVerified: false`, `unverifiedLoginsLeft`); after that login returns `EMAIL_VERIFICATION_REQUIRED` + a `challengeToken` and no session.
- Verifying: `POST /api/auth/email/start { email }` then `POST /api/auth/email/confirm { code }` — authenticated by either a bearer access token (in-app, during the grace logins) or a body `challengeToken` (locked out). Confirm returns a fresh session. A verified email can't be changed via `PUT /api/users/me` (`EMAIL_LOCKED`).
- Codes (`src/lib/auth/emailOtp.js`): 6 digits, hashed at rest, 10-minute expiry, 5 wrong attempts burns the code, 60s resend cooldown. Sent through Resend (`src/lib/mailer.js`, `RESEND_API_KEY` / `EMAIL_FROM`); with no key set, dev prints the code to the server console and production returns 503.

## Roles
`CREATOR`, `TEAM_MEMBER`, `ADMIN`, `FINANCE` — see `system design.md` §0 and the roles discussion in `recommend.md`.

## Modules
Each folder under `src/modules/` is `schemas.js` (zod validation) + `service.js` (business logic) + `routes.js` (Express router), matching the LLD's module breakdown:

- `auth` — signup/login/refresh/logout
- `users` — profile, team membership (Creator ↔ Team Member)
- `assets` — social profile registry + rate cards. Admin-only Inventory
  onboarding (14 Sep): `GET /assets/owners` (creator accounts a page can sit
  under), `POST /assets/import/preview` (raw .xlsx/.csv bytes in the body,
  original name in `X-File-Name`; returns a per-row preview with the resolved
  account and status — nothing written), `POST /assets/import/preview-url`
  (`{ url }` of a link-shared Google Sheet, fetched server-side as CSV, same
  preview), `POST /assets/import/followers` (`{ handles }` ≤100 — one Apify
  run per 25 handles for live followers/avg views shown in the preview; a
  handle whose run didn't finish is omitted = unknown, `null` = not on
  Instagram; both answers cached 30 min) and `POST /assets/import` (creates the
  confirmed rows; re-validated server-side, skipped rows come back with reasons).
  Since 22 Sep: sheets use the template from `GET /assets/import/template.xlsx`
  (Page Name, Page Link, Followers, Reel Rate, Story Rate — the page comes from
  the link; old `handle`-column sheets still parse). `POST /assets/import` only
  stores pages confirmed on Instagram: not found → skipped "Link broken or page
  not found", unreachable/unchecked (or more than 100 unchecked) → skipped
  "Couldn't verify"; the "already registered" check is repeated right before
  each insert. The account is chosen (or created via `POST /auth/signup`) in
  the popup. Profile pictures are copied to Cloudinary (`profile-pics/<assetId>`)
  after every scrape and saved as `Asset.profilePicStoredUrl`, which
  `GET /assets/:id/profile-pic` serves first.
  A page an ADMIN creates or imports is `approved` immediately (the approval
  queue is for creator-added pages); `POST /assets` also accepts an optional
  `rateCards` array. Every profile scrape stores `profileAvg*` engagement from
  the profile's latest posts plus `lastScrapedAt` / `lastScrapeError`;
  `scrapeQueuedAt` is set while a scrape is queued/running (create, import,
  `POST /assets/refresh-profiles { assetIds }` — the bulk "Refresh from
  Instagram" for a selection, background, one page at a time).
  16 Oct: `Asset.grade` (A/B/C, optional, set by hand) and `Asset.groupLink`
  (optional URL) — accepted by `POST /assets`, `PUT /assets/:id/details`, the
  import rows, and the template's Grade / Group Link columns.
  `DELETE /assets/:id` (ADMIN role + inventory.edit) removes a page and its
  draft-plan lines; 409 `ASSET_IN_USE` when the page has links or sits on an
  APPROVED plan (deactivate instead). Planner edits: `PUT
  /assets/:id/propose-edit` (PLAN_MAKER with its inventory.edit switch on;
  `{ category?, grade?, groupLink?, rateCards? }`) parks the change on
  `Asset.pendingEdit` (+ `pendingEditById/At`) without touching the live row;
  `PUT /assets/:id/edit-decision { decision: "approve" | "reject" }`
  (inventory.approve) applies or discards it. `GET /assets` adds
  `pendingEditBy` for the row.
  17 Oct: the import sheet's required cells are Page Name, Page Link, Vendor
  Name, Vendor Contact (phone), Entertainment / Brand, Reel and Story rates
  (`IMPORT_REQUIRED_HEADERS`, orange in the template); a staff/planner row
  missing Page Name or one of the three rates previews as `incomplete`
  (`missingFields`) and isn't imported. `checkProfiles(assetIds, { force })`
  confirms pages on Instagram, asking Apify only for pages not checked in 24h
  (`Asset.profileCheckedAt`); a page Instagram doesn't know gets
  `profileBroken` + `lastScrapeError`, a found one has its numbers refreshed.
  Exposed as `POST /plans/check-pages { assetIds, force? }` (plans.edit /
  PLAN_MAKER) for the plan wizard, which offers a replacement page.
- `campaigns` — brand campaigns. Phases (22 Sep): every child row hangs off
  the root (`parentCampaignId`). `postNumber` 1 = a real phase (added via
  `POST /campaigns/:id/phases` by Admin or the Plan Maker who owns it; starts
  with Phase 1's pages); `postNumber` 2+ = an extra post of phase
  `phaseNumber` (a page booked for 2+ reels in a plan). Admin/Finance/Plan
  Maker views list real phases only and fold extra posts into their phase;
  creators get every row as its own numbered phase in one running count
  (`lib/campaignPhases.js`, `creatorPhaseNumber` + titles on `GET /campaigns`
  and on their links). `DELETE /campaigns/:id/phase` (admin) removes a phase
  and its extra posts — refused for Phase 1 and while posts/invoices exist;
  later phases renumber.
- `links` — post link submission, status machine, timeline
- `screenshots` — Cloudinary signed upload flow, mounted at `/links/:linkId/screenshot`
- `invoices` — creator-raised invoices (`POST /invoices/bulk`, CREATOR only), Admin/Finance approve (`POST /invoices/:id/approve`), Finance manual mark-paid (APPROVED only), GST status. Also the receivables ledger of client invoices (`GET /invoices/client`, `POST /invoices/client/:id/mark-paid`, `/cancel`) — see `plans` below for where they are minted
- `plans` also owns the Taggify → client invoice: `POST /plans/:id/client-invoice` (client details from the popup) and `GET /plans/:id/client-invoice.pdf`
- `plans`, 16 Oct: (1) the budget is a target, not a cap — `PLAN_OVER_BUDGET` is gone; over budget shows as a negative `budgetVariance` and the pending "budget" sheet entry is no longer produced. (2) `Plan.discount` (flat rupees, before GST): `overview.discount`, `overview.taxable = max(0, subtotal − discount)`, GST on `taxable`, `total = taxable + gstAmount`; mirrored in `internal.computed*`, both sheet formats, the plan PDF, the client invoice PDF and `ClientInvoice.discount`. (3) `inactivePages` on every annotated plan: `[{ assetId, handle, reason: "inactive" | "rejected" | "broken" }]` for pages switched off / rejected / gone from Instagram (17 Oct) since the plan was built. (4) `POST /plans/:id/sheet` takes `{ sheetFormat? }` and saves it on the plan before writing. (5) The client sheet carries no Active/Not active mark (tab names end `· Plan A`; band and tab colour are internal-only); old client tabs titled `· Plan A · Active` are still found and renamed. (6) Generated sheets are shared for editing with the requester and the plan's creator.
- `GET /plans/clients` — saved clients (21 Sep): there's no Client table, so this folds the caller's visible plans (ADMIN: all; otherwise own — same scope as `GET /plans`) into one entry per billing identity (client name + GSTIN, newest plan wins). Feeds the wizard's Client name suggestions and the invoice popup's Company name dropdown / auto-fill
- `plans` also keeps an attached invoice PDF per plan (Admin / Plan Maker, 14 Sep): `POST /plans/:id/invoice-attachment/upload-url` → direct Cloudinary upload → `POST /plans/:id/invoice-attachment` (`{ publicId, fileName }`, `.pdf` names only) / `DELETE /plans/:id/invoice-attachment`; surfaced as `plan.invoiceAttachment`
- `notifications` — in-app notification rows (polled, no pub/sub)
- `scraping` — Apify Instagram provider wrapper
- `jobs` — node-cron registrations + `JobRun` tracking table (substitute for queue observability)
- `admin` — user/role management, job run log

## Link status machine
`SUBMITTED → PENDING_SCREENSHOT_REVIEW → SCREENSHOT_APPROVED → INSIGHTS_PENDING → INSIGHTS_APPROVED → INVOICED`
(or `SCREENSHOT_REJECTED` if an admin rejects the proof). Every transition is recorded in `LinkStatusEvent`, exposed via `GET /api/links/:id/timeline`.

## Not implemented (by design, see recommend.md / system design.md)
- No payment gateway — `POST /api/invoices/:id/mark-paid` is a manual admin/finance action.
- No OTP — password is system-generated.
- No Redis/queue — cron runs in-process; add a `pg_advisory_lock` if this ever scales to multiple instances (noted in `system design.md` §2.11).
