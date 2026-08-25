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

Server starts on `http://localhost:4000`. `GET /health` for a liveness check.

## Auth model
No OTP. `POST /auth/signup` takes only a phone number (+ optional name/role); the server generates a random password and returns it once in the response — that's the only place it's ever visible in plaintext. Login is `POST /auth/login` with phone + password, returning a short-lived access JWT and a longer-lived refresh JWT (refresh tokens are hashed and stored in Postgres for revocation — no Redis).

## Roles
`CREATOR`, `TEAM_MEMBER`, `ADMIN`, `FINANCE` — see `system design.md` §0 and the roles discussion in `recommend.md`.

## Modules
Each folder under `src/modules/` is `schemas.js` (zod validation) + `service.js` (business logic) + `routes.js` (Express router), matching the LLD's module breakdown:

- `auth` — signup/login/refresh/logout
- `users` — profile, team membership (Creator ↔ Team Member)
- `assets` — social profile registry + rate cards
- `campaigns` — brand campaigns
- `links` — post link submission, status machine, timeline
- `screenshots` — Cloudinary signed upload flow, mounted at `/links/:linkId/screenshot`
- `invoices` — bulk invoice generation, manual mark-paid, GST status
- `notifications` — in-app notification rows (polled, no pub/sub)
- `scraping` — Apify Instagram provider wrapper
- `jobs` — node-cron registrations + `JobRun` tracking table (substitute for queue observability)
- `admin` — user/role management, job run log

## Link status machine
`SUBMITTED → PENDING_SCREENSHOT_REVIEW → SCREENSHOT_APPROVED → INSIGHTS_PENDING → INSIGHTS_APPROVED → INVOICED`
(or `SCREENSHOT_REJECTED` if an admin rejects the proof). Every transition is recorded in `LinkStatusEvent`, exposed via `GET /links/:id/timeline`.

## Not implemented (by design, see recommend.md / system design.md)
- No payment gateway — `POST /invoices/:id/mark-paid` is a manual admin/finance action.
- No OTP — password is system-generated.
- No Redis/queue — cron runs in-process; add a `pg_advisory_lock` if this ever scales to multiple instances (noted in `system design.md` §2.11).
