# invoice-taggify — Technical Overview

Ops layer for creator campaigns: link submission → screenshot approval → insight
verification → invoicing → payout, plus a pitch-deck ("Plans") and page-inventory
layer on top. This document reflects the **current implementation**, not the
original design doc (`system design.md` — kept for historical context; several
things below have since diverged from it, e.g. a 5th role and a Plans module
were added after that doc was written).

## 1. Stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend | Next.js 14 (App Router), React 18, TypeScript | Built as a **static export** (`output: "export"`), not server-rendered |
| Styling | Tailwind CSS, `class-variance-authority` | Design tokens as CSS custom properties (`client/styles/tokens.css`); Tailwind config just names them — no literal colors in components |
| Data fetching | TanStack Query (React Query) v5 | One hand-written client function per backend route in `client/lib/api-client.ts` — no generated client, no raw `fetch()` in components |
| Auth (client) | Plain `localStorage` (`taggify_auth`) | No middleware-based route protection — a `<RequireAuth>` wrapper checks client-side |
| Backend | Node.js + Express, ESM | Modular monolith — one Express app, `src/modules/<name>/` per domain |
| ORM / DB | Prisma + PostgreSQL | Single Postgres instance, no read replicas/sharding |
| Validation | Zod | Per-route input schemas, one `validateBody`/`validateQuery` middleware |
| Auth (server) | `jsonwebtoken` + `bcryptjs`, hand-rolled | Short-lived access JWT + longer-lived refresh JWT; refresh tokens hashed and stored in Postgres (no Redis) |
| Scheduled jobs | `node-cron`, in-process | No queue (no BullMQ/Redis) — see §6 |
| File storage | Cloudinary | Screenshots only; client uploads directly via signed params, server never proxies the binary |
| Instagram data | Apify actors, via `apify-client` | Not the Meta Graph API |
| Google Sheets / Drive / OAuth | Hand-rolled REST clients (`server/src/lib/google*.js`) | **No `googleapis` SDK dependency** — a service account JWT is signed with `jsonwebtoken` (already a dependency for our own auth) and calls Sheets/Drive v4 REST directly; same "just fetch" approach used for the GitHub Contents API client |
| GitHub export | Raw GitHub Contents API via `fetch` | Daily finance `.xlsx` pushed to a non-`main` branch |
| Testing | Vitest (server, mocked Prisma), Playwright (client, e2e) | No client unit-test runner — see §8 |
| Deployment | **Single Render service** | Backend serves the frontend's static export directly — see §7 |

## 2. Repository layout

```
client/
  app/<route>/page.tsx        # one folder per top-level page (App Router)
  components/                  # ui/, layout/, dashboard/, charts/, plans/, auth/
  lib/api-client.ts             # every backend call — one function per route
  lib/auth-context.tsx           # localStorage-backed auth, <RequireAuth>
  styles/tokens.css              # design tokens (single source of truth for color/spacing/radius)
  tailwind.config.ts              # maps Tailwind utilities to tokens.css vars only
  tests/e2e/*.spec.ts              # Playwright specs

server/
  src/modules/<name>/            # schemas.js (zod) + service.js (logic) + routes.js (Express router)
  src/lib/                        # external-service clients (Apify, Cloudinary, Google*, GitHub), password/JWT helpers
  src/middleware/                 # requireAuth, requireRole, requirePermission, validate, errorHandler
  src/modules/jobs/                # node-cron registrations + JobRun logging
  prisma/schema.prisma              # data model
  prisma/seed.js                    # ADMIN/FINANCE/CREATOR + demo asset seed
```

Both apps build independently but ship as **one deployable**: `server/src/app.js`
serves `client/out` (the static export) for every non-`/api` path, so there is
one Render service, one URL, one process. This is a deliberate simplification
made mid-project (see commit "Merge frontend+backend into one Render service") —
originally frontend and backend were separate deploys.

## 3. Roles & permissions

Five roles (`server/prisma/schema.prisma`'s `Role` enum):

| Role | Can do |
|---|---|
| `CREATOR` | Own pages/links/invoices only |
| `TEAM_MEMBER` | Scoped under a Creator via `TeamMembership` (`canSeeMoney` flag gates $-visible routes) |
| `ADMIN` | Everything — campaigns, link review, Users/Finance management, approve any Plan |
| `FINANCE` | Invoices, GST status, billing profiles, finance exports |
| `PLAN_MAKER` | Added later (phase 4) — builds/approves their **own** Plans and reads Inventory, but can't touch Campaigns, review Links, or manage Users/Finance |

Permission checks are layered: `requireRole` (coarse, role-in-list) +
`requirePermission` (finer-grained, e.g. `inventory.manage`) + service-level
ownership checks (e.g. a Plan Maker can only approve/delete their **own** plan;
an Admin can act on any). `server/src/lib/permissions.js` is the single source
of truth for the fine-grained matrix — the frontend mirrors these checks
client-side purely for UI (hiding buttons a role can't use), never as the
actual authorization boundary.

The dashboard is not one shared view: `ADMIN`/`FINANCE` render `AdminDashboard`;
everyone else renders `CreatorDashboard`/role-specific variants — content
genuinely branches by role, not just visibility toggles on one layout.

## 4. Core domain & data model

Full model list in `prisma/schema.prisma`. The load-bearing ones:

- **User** → owns `Asset`s (pages), `Invoice`s, has `TeamMembership`s
- **Asset** — an Instagram page/handle. Has `RateCard`s (per-format pricing:
  reel/story/carousel/collaboration/video, custom formats allowed),
  `AccountSnapshot`s (follower history from Apify), and — via
  `CampaignAssignment` — the campaigns it's been booked on
- **Campaign** → has `Link`s (submitted posts) and `CampaignAssignment`s (which
  pages/creators a campaign is visible to, from an attached sheet); can have
  **phases** (`parentCampaignId`/`phaseNumber` — a campaign can be phase 1 of a
  multi-phase series)
- **Link** — one submitted post. State machine (`LinkStatus`):
  `SUBMITTED → PENDING_SCREENSHOT_REVIEW → SCREENSHOT_APPROVED → INSIGHTS_PENDING
  → INSIGHTS_APPROVED → INVOICED` (or `SCREENSHOT_REJECTED` / terminal `INVALID`
  for a confirmed-dead post). Every transition is recorded in
  `LinkStatusEvent` for an audit timeline. `LinkCostRevision` logs any manual
  cost override, blocked once a link is already invoiced.
- **Invoice** → `InvoiceItem`s (one per link). `InvoiceStatus`:
  `DRAFT → RAISED → APPROVED/REJECTED → PAID`. GST tracked as an independent
  `GstStatus` field (`PENDING/SCHEDULED/COMPLETED`) — payment and GST are
  separate concerns, not conflated into one status.
- **Plan** (added phase 4) → `PlanItem`s (pages + expected cost/engagement for
  a pitch). `PlanStatus`: `DRAFT → PENDING_APPROVAL → APPROVED/REJECTED`. A
  Plan can generate a client-facing **and** an internal Google Sheet
  (`generatePlanSheet`), and on approval can spin up a real `Campaign`.
- **JobRun** — one row per cron execution (status/error/timing), the
  replacement for a job queue's built-in observability; surfaced on
  `/job-runs`.

## 5. Key workflows

**A. Link → Invoice** (the core loop):
Creator submits a link → uploads screenshot to Cloudinary (client uploads
directly using signed params from the server; the binary never touches our
API) → Admin approves the screenshot → Apify scrapes post metrics (on-demand
or via cron) → Admin approves insights → link becomes invoice-eligible →
Creator bulk-generates an invoice from eligible links → Admin approves → Finance manually
marks it paid (no payment gateway — a deliberate constraint) and separately
tracks GST status.

**B. Plans → Campaign**: pages selected on Inventory → "Create plan" carries
the selection into a new Plan (`?assetIds=` route param, consumed once) → Plan
Maker fills in client/budget/pages → submits → Plan Maker (own plan) or Admin
(any plan) approves → approval can create a real Campaign, making those pages'
assignments visible under it.

**C. Auth**: phone number + system-generated password, **no OTP**. An admin
(or self-signup) submits a phone number; the server generates a random
password, hashes it (bcrypt), and returns the plaintext **once** in the
response — it is never stored or logged in plaintext, and never re-displayed
(a forgotten password is reset, not recovered). Login exchanges phone+password
for an access JWT (short-lived) + refresh JWT (longer-lived, hashed and stored
in Postgres so it's revocable without Redis).

**D. Instagram metrics**: `server/src/lib/apifyClient.js` wraps two Apify
actors (profile scraper, post/reel scraper). Triggered on-demand (screenshot
approval, the Inventory card's manual "refresh" button) and periodically via
cron (`asset_profile_rescrape`, every 24h; `instagram_rescrape` for
in-progress links, every 6h). A scraped `-1` ("unknown") engagement value is
never coerced to `0` — it's excluded from sums, not counted as zero.

## 6. Scheduled jobs (no queue)

All cron jobs run **in-process** via `node-cron`, gated behind
`ENABLE_CRON=true`, each schedule independently overridable via env var:

| Job | Default schedule | Purpose |
|---|---|---|
| `instagram_rescrape` | every 6h | Re-scrape post metrics for in-flight links |
| `asset_profile_rescrape` | every 24h | Refresh follower count/bio/**profile picture** for approved pages |
| `invoice_aging_sweep` | daily 09:00 | Flag overdue invoices |
| `screenshot_reminder` | daily 10:00 | Nudge on pending screenshot reviews |
| `finance_export` | daily 02:00 | Build the day's finance `.xlsx`, push to GitHub |
| `finance_google_sheet_export` | daily 02:00 | Same finance data, also written live to a Google Sheet |

Every run is logged to `JobRun` (start/finish/status/error) — this is the
explicit substitute for a job queue's built-in observability, and it's why a
misconfigured job (e.g. `GITHUB_TOKEN` unset) fails loudly on `/job-runs`
instead of silently never running.

**Known, documented scaling gap**: if this API is ever horizontally scaled,
these jobs would run once per instance with no coordination. Fix is noted but
intentionally not built yet: a `pg_advisory_lock` (or a "leader" flag) around
each job's body — not needed at current single-instance scale.

## 7. Deployment

One Render service (`render.yaml`) runs `server/`, which serves `client/`'s
static export directly (`app.use(express.static(CLIENT_DIST))` + SPA-style
fallback to `index.html`). API and frontend deliberately share no path
prefixes — everything backend lives under `/api` — because the frontend has
its own top-level routes with the same names (`/campaigns`, `/assets`,
`/invoices`, `/users`), so they'd collide on the same origin otherwise.

Security headers (`helmet()`, including CSP) are scoped to `/api/*` only, not
applied globally — Next's static export ships inline hydration/theme-init
`<script>` tags it can't hash or nonce per-request, so a global CSP would
silently break the frontend while only being needed to protect JSON responses.

## 8. Testing

No client unit-test runner (per project convention, documented in `test.md`)
— client coverage is entirely Playwright end-to-end specs
(`client/tests/e2e/`), driving the real app against a mocked API. Server
coverage is Vitest with Prisma mocked (no DB needed to run the suite).

The project runs on an explicit **verify-and-fix loop** (documented in
`CLAUDE.md`/`test.md`): a change isn't "done" until (1) a test exists that
would have caught the bug/covers the new behavior, (2) it's actually been
driven in the real app (Playwright and/or live browser), (3) every reference
to a moved/renamed route or export has been grepped across both `client/` and
`server/`, and (4) — for multi-file/UI/flow changes — an independent review
pass. This exists specifically because the recurring failure mode on this
project was changes that "looked done" (clean diff, dev server boots) but
broke something in actual use.

## 9. Notable engineering points worth flagging to a tech lead

- **No `googleapis` SDK** anywhere — every Google integration (OAuth, Sheets,
  Drive) is a hand-rolled REST client signing its own service-account JWT.
  Deliberate: avoids a large dependency for what's a handful of REST calls,
  consistent with the GitHub client's same "just fetch" approach.
- **Cross-Origin-Resource-Policy bug, found and fixed 11 Sep**: `helmet()`'s
  default `Cross-Origin-Resource-Policy: same-origin` silently blocked
  `<img>` tags (a "no-cors" embed) from loading a proxied image cross-origin
  in dev (client and API on different ports), even though `fetch()` calls to
  the identical URL always succeeded — CORP and CORS are enforced
  differently by the browser. Fixed by explicitly setting
  `Cross-Origin-Resource-Policy: cross-origin` on that one route only, not
  globally. A good example of a bug that looks like third-party flakiness
  (Instagram) until isolated with a controlled `fetch()` vs `<img>`
  comparison.
- **Instagram CDN images are proxied, not hotlinked**: `assets/service.js`'s
  `fetchProfilePic` fetches a page's Instagram profile picture server-side
  (with retry + backoff, since Instagram's edge does occasionally 503 an
  otherwise-valid signed URL), caches it in-memory for 24h, de-dupes
  concurrent requests for the same asset, and is proactively pre-warmed right
  after every scrape — so a real viewer's `<img>` is almost always served
  from cache rather than racing Instagram live.
- **No payment gateway, no OTP, no Redis/queue** — all three are deliberate
  scope constraints from the original design, still true today: payments are
  manually marked by Finance, auth is phone+generated-password, and
  everything a queue would normally back (cron jobs, notifications) uses
  Postgres directly instead.
- **Static export, not SSR** — the frontend has no server runtime of its own;
  this is why route protection is a client-side `<RequireAuth>` check rather
  than middleware, and why the topbar search is currently decorative (no
  server to hit for global search without one page's own local state).
