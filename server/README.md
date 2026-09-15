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
No OTP. `POST /api/auth/signup` takes only a phone number (+ optional name/role); the server generates a random password and returns it once in the response — that's the only place it's ever visible in plaintext. Login is `POST /api/auth/login` with phone + password, returning a short-lived access JWT and a longer-lived refresh JWT (refresh tokens are hashed and stored in Postgres for revocation — no Redis).

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
  Instagram; cached 30 min so the confirm stores them instead of re-scraping) and `POST /assets/import` (creates the
  confirmed rows; re-validated server-side, skipped rows come back with reasons).
  A page an ADMIN creates or imports is `approved` immediately (the approval
  queue is for creator-added pages); `POST /assets` also accepts an optional
  `rateCards` array. Every profile scrape stores `profileAvg*` engagement from
  the profile's latest posts plus `lastScrapedAt` / `lastScrapeError`;
  `scrapeQueuedAt` is set while a scrape is queued/running (create, import,
  `POST /assets/refresh-profiles { assetIds }` — the bulk "Refresh from
  Instagram" for a selection, background, one page at a time).
- `campaigns` — brand campaigns
- `links` — post link submission, status machine, timeline
- `screenshots` — Cloudinary signed upload flow, mounted at `/links/:linkId/screenshot`
- `invoices` — creator-raised invoices (`POST /invoices/bulk`, CREATOR only), admin approve, manual mark-paid, GST status
- `plans` also owns the Taggify → client invoice: `POST /plans/:id/client-invoice` (client details from the popup) and `GET /plans/:id/client-invoice.pdf`
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
