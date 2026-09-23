# System Design — invoice-taggify (Backend)

Design only — nothing implemented yet. Backend scope only (no frontend design here). Based on `research.md` (observed WLDD workflow), `recommend.md` (chosen stack + constraints), and the 4-role model agreed on.

## 0. Constraints recap
- Auth: phone number + **auto-generated password** (no OTP)
- No Redis / no BullMQ — `node-cron` + DB-backed job state instead
- Screenshots/assets → **Cloudinary**
- Instagram data → **Apify actor** (scrape), not Meta Graph API
- Payments are **manual** (admin/finance marks an invoice as paid) — no payment gateway
- Roles: **Creator**, **Team Member** (limited), **Admin/Ops**, **Finance**

---

## 1. High-Level Design (HLD)

### 1.1 Architecture diagram

```
                        ┌─────────────────────┐
                        │   Web Client (SPA)   │
                        └──────────┬───────────┘
                                   │ HTTPS (REST, JWT)
                                   ▼
                   ┌───────────────────────────────┐
                   │        API Server (Node)       │
                   │  Express/NestJS, TypeScript     │
                   │  ┌───────────┬────────────────┐│
                   │  │ Auth       │ Campaigns      ││
                   │  │ Works/Link │ Screenshots    ││
                   │  │ Invoices   │ Assets/Rates   ││
                   │  │ Notify     │ Admin/RBAC     ││
                   │  └───────────┴────────────────┘│
                   └──────┬─────────────┬───────────┘
                          │             │
             ┌────────────┘             └────────────┐
             ▼                                        ▼
   ┌───────────────────┐                   ┌────────────────────┐
   │   PostgreSQL       │                   │  Cloudinary          │
   │ (Prisma ORM)        │                   │ (screenshots/assets) │
   └───────────────────┘                   └────────────────────┘
             ▲
             │ reads job rows / writes results
             │
   ┌───────────────────────────┐
   │  In-process Scheduler       │
   │  (node-cron)                 │
   │  - Instagram re-scrape job   │
   │  - Invoice/GST reminder job  │
   └──────────────┬───────────────┘
                  │ calls
                  ▼
        ┌────────────────────┐
        │   Apify actors       │
        │ (Instagram scraping) │
        └────────────────────┘
```

### 1.2 Components

| Component | Responsibility |
|---|---|
| **API Server** | Single Node.js service (modular monolith) exposing REST endpoints for auth, campaigns, works/links, screenshots, invoices, assets/rate cards, notifications, admin. |
| **PostgreSQL** | System of record — users, roles, campaigns, links/posts, screenshots metadata, invoices, payments, rate cards, notifications, job run log. |
| **Cloudinary** | Object storage for screenshot uploads and any post-proof assets. API server issues signed upload params; client uploads directly to Cloudinary. |
| **node-cron scheduler** | Runs inside the API process (or a small dedicated worker process sharing the same codebase) on fixed intervals: re-scrape Instagram metrics for active links, sweep for overdue invoices, send digest notifications. |
| **Apify client** | Wrapper module around `apify-client` SDK calling two actors — profile scraper and post/reel scraper — following the pattern reviewed in the reference repo. |
| **Notification module** | Writes in-app notification rows; optionally pushes via WhatsApp/SMS provider (future, not required day 1). |

### 1.3 Why a modular monolith (not microservices)
Scale observed (thousands of links/invoices, not millions) doesn't justify service-per-domain complexity. A single Node service with clear internal module boundaries (auth/campaigns/works/invoices/assets) keeps deployment and operations simple, while still being split into services later if needed.

### 1.4 Core workflows (sequence, high level)

**A. Link submission → invoice**
```
Creator submits post link
   → API creates Link (status: submitted)
   → Creator uploads screenshot to Cloudinary (signed upload)
   → API stores screenshot reference, status: pending_screenshot_review
   → Admin approves screenshot → status: screenshot_approved
   → node-cron / on-demand job calls Apify to fetch post metrics
   → Admin approves insights → status: insights_approved
   → Any submitted, not-yet-invoiced link is eligible for invoicing (screenshot/insights are optional proof, not gates — newTask.md #3)
   → Creator generates invoice from eligible links (bulk, POST /invoices/bulk); Admin or Finance approves
   → Invoice status: raised → approved → Finance marks paid manually → paid; GST status tracked separately
```

Money moves in two directions and the app models them separately:
- **Creator invoice (payable)** — creator bills Taggify for their posts: the `Invoice` table above, `/invoices` page, RAISED → APPROVED → PAID.
- **Client invoice (receivable)** — Taggify bills the plan's client: a Proforma Invoice minted from an APPROVED Plan (`POST /plans/:id/client-invoice`, PDF at `GET /plans/:id/client-invoice.pdf`, `PI-0001…` numbering). It is a ledger row (`ClientInvoice`, ISSUED → PAID) listed under the Receivables view of `/invoices` for Admin/Finance.

**B. Auth**
```
User submits phone number (signup, admin-initiated or self-service)
   → API generates a random password, hashes with bcrypt, stores hash
   → Plaintext password shown once / sent via configured channel (WhatsApp/SMS) — delivery channel TBD
   → Login: phone + password → API verifies hash → issues JWT access + refresh token pair
   → Refresh token stored in DB (RefreshToken table) for revocation, not Redis
```

**C. Instagram metrics refresh**
```
node-cron job (interval, e.g. every N hours) 
   → selects Links/Assets due for refresh from DB
   → calls Apify provider (profile or post actor)
   → writes PostSnapshot / AccountSnapshot row
   → marks job run in JobRun log table (for observability, replacing a queue's built-in tracking)
```

---

## 2. Low-Level Design (LLD)

### 2.1 Data model (Postgres, Prisma-style)

```prisma
enum Role {
  CREATOR
  TEAM_MEMBER
  ADMIN
  FINANCE
}

enum LinkStatus {
  SUBMITTED
  PENDING_SCREENSHOT_REVIEW
  SCREENSHOT_REJECTED
  SCREENSHOT_APPROVED
  INSIGHTS_PENDING
  INSIGHTS_APPROVED
  INVOICED
}

enum InvoiceStatus {
  DRAFT
  RAISED
  APPROVED
  PAID
}

enum GstStatus {
  PENDING
  SCHEDULED
  COMPLETED
}

model User {
  id            String   @id @default(cuid())
  phoneNumber   String   @unique
  passwordHash  String
  role          Role
  name          String?
  whatsappVerified Boolean @default(false)
  createdAt     DateTime @default(now())

  teamMemberships TeamMembership[] // when role = TEAM_MEMBER, links to owning Creator
  refreshTokens   RefreshToken[]
  assets          Asset[]          // pages owned by this creator
  invoices        Invoice[]
  notifications   Notification[]
}

model TeamMembership {
  id         String  @id @default(cuid())
  userId     String  // the team member
  creatorId  String  // the owning creator (User.id)
  canSeeMoney Boolean @default(false)
  createdAt  DateTime @default(now())

  user    User @relation(fields: [userId], references: [id])
  @@unique([userId, creatorId])
}

model RefreshToken {
  id        String   @id @default(cuid())
  userId    String
  tokenHash String
  expiresAt DateTime
  revoked   Boolean  @default(false)
  createdAt DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model Asset {
  id            String   @id @default(cuid())
  ownerId       String   // User.id (creator)
  platform      String   // "instagram"
  handle        String
  followers     Int      @default(0)
  approvalStatus String  @default("pending") // pending | approved | rejected
  createdAt     DateTime @default(now())

  owner     User       @relation(fields: [ownerId], references: [id])
  rateCards RateCard[]
  links     Link[]
  snapshots AccountSnapshot[]
}

model RateCard {
  id         String  @id @default(cuid())
  assetId    String
  format     String  // reel | story | carousel | collaboration | video
  amount     Decimal
  effectiveFrom DateTime @default(now())

  asset Asset @relation(fields: [assetId], references: [id])
}

model Campaign {
  id          String   @id @default(cuid())
  brandName   String
  title       String
  createdAt   DateTime @default(now())

  links Link[]
}

model Link {
  id            String     @id @default(cuid())
  campaignId    String
  assetId       String
  submittedById String     // User.id
  url           String
  cost          Decimal
  customRate    Boolean    @default(false) // overrides RateCard if true
  status        LinkStatus @default(SUBMITTED)
  postedAt      DateTime?
  createdAt     DateTime   @default(now())

  campaign Campaign @relation(fields: [campaignId], references: [id])
  asset    Asset    @relation(fields: [assetId], references: [id])
  screenshot   Screenshot?
  postSnapshots PostSnapshot[]
  invoiceItem   InvoiceItem?
  statusEvents  LinkStatusEvent[]
}

// explicit status history — powers the "status timeline" feature from recommend.md
model LinkStatusEvent {
  id        String   @id @default(cuid())
  linkId    String
  status    LinkStatus
  actedById String?
  note      String?
  createdAt DateTime @default(now())

  link Link @relation(fields: [linkId], references: [id])
}

model Screenshot {
  id         String   @id @default(cuid())
  linkId     String   @unique
  publicId   String   // Cloudinary public_id
  reviewedById String?
  approved   Boolean?
  createdAt  DateTime @default(now())

  link Link @relation(fields: [linkId], references: [id])
}

model PostSnapshot {
  id             String   @id @default(cuid())
  linkId         String
  likeCount      Int
  commentsCount  Int
  videoViews     Int
  videoPlayCount Int
  saves          Int
  shares         Int
  reposts        Int
  source         String   // "apify"
  capturedAt     DateTime @default(now())

  link Link @relation(fields: [linkId], references: [id])
}

model AccountSnapshot {
  id          String   @id @default(cuid())
  assetId     String
  followers   Int
  mediaCount  Int
  source      String
  capturedAt  DateTime @default(now())

  asset Asset @relation(fields: [assetId], references: [id])
}

model Invoice {
  id            String        @id @default(cuid())
  creatorId     String        // User.id
  invoiceNumber String        @unique
  amount        Decimal
  status        InvoiceStatus @default(DRAFT)
  gstStatus     GstStatus     @default(PENDING)
  dueDate       DateTime?
  paidAt        DateTime?
  createdAt     DateTime      @default(now())

  creator User @relation(fields: [creatorId], references: [id])
  items   InvoiceItem[]
}

model InvoiceItem {
  id        String  @id @default(cuid())
  invoiceId String
  linkId    String  @unique
  amount    Decimal

  invoice Invoice @relation(fields: [invoiceId], references: [id])
  link    Link    @relation(fields: [linkId], references: [id])
}

model Notification {
  id        String   @id @default(cuid())
  userId    String
  type      String   // screenshot_rejected | insights_approved | invoice_paid | ...
  payload   Json
  readAt    DateTime?
  createdAt DateTime @default(now())

  user User @relation(fields: [userId], references: [id])
}

// Replaces queue-based job tracking (no BullMQ) — simple DB log for cron runs
model JobRun {
  id        String   @id @default(cuid())
  jobName   String   // "instagram_rescrape" | "invoice_aging_sweep"
  status    String   // running | success | failed
  startedAt DateTime @default(now())
  finishedAt DateTime?
  error     String?
}
```

### 2.2 Module / folder structure

```
server/
  src/
    modules/
      auth/          # signup (admin-creates or self phone-only), login, refresh, password reset
      users/          # profile, team membership management
      assets/         # social profile registry, rate cards
      campaigns/       # campaign CRUD (admin)
      links/           # link submission, status transitions, timeline
      screenshots/     # Cloudinary signed upload issuance, review endpoints
      invoices/        # invoice generation (bulk), status/GST updates, manual "mark paid"
      notifications/   # in-app notification CRUD
      scraping/        # Apify provider wrapper (profile + post actors), scheduled refresh job
      jobs/            # node-cron job registrations + JobRun logging
      admin/           # RBAC-gated cross-cutting admin endpoints
    lib/
      cloudinaryClient.js # Cloudinary client, signed upload helper
      apifyClient.js     # ApifyInstagramProvider (profile + post scraping)
      auth/
        passwordGenerator.js  # secure random password generation
        jwt.js
    middleware/
      requireAuth.js
      requireRole.js    # RBAC guard, e.g. requireRole('ADMIN','FINANCE')
      validate.js        # zod schema validation
    app.js
```

### 2.3 Key API endpoints

| Method & Path | Role(s) | Purpose |
|---|---|---|
| `POST /auth/signup` | Admin (or self, phone-only) | Creates user, auto-generates password |
| `POST /auth/login` | any | email (verified accounts) or phone (not yet verified) + password → `step`: JWT pair, `OTP_REQUIRED`, or `EMAIL_VERIFICATION_REQUIRED` — email 2FA, 21 Sep; see `server/README.md` |
| `POST /auth/login/verify-otp`, `/auth/login/resend-otp` | any (challenge token) | emailed login code → JWT pair / re-send |
| `POST /auth/email/start`, `/auth/email/confirm` | session or challenge token | add + verify the account's login email → JWT pair |
| `POST /auth/refresh` | any (valid refresh token) | rotate access token |
| `POST /auth/logout` | any | revoke refresh token |
| `GET /assets` | Creator/Admin | list social profiles + rate cards |
| `POST /assets` | Creator | register new page ("Add Assets") |
| `PUT /assets/:id/rate-card` | Admin | update format pricing |
| `GET /campaigns` | Creator/Admin | active campaigns list |
| `POST /campaigns` | Admin | create campaign |
| `POST /links` | Creator/Team Member | submit a post link |
| `GET /links` | Creator/Admin | filterable "My Works" grid |
| `POST /links/:id/screenshot-upload-url` | Creator | get signed Cloudinary upload params |
| `POST /links/:id/screenshot` | Creator | confirm upload, attach key |
| `POST /links/:id/review-screenshot` | Admin | approve/reject |
| `POST /links/:id/refresh-metrics` | Admin (or cron) | trigger Apify post scrape |
| `POST /links/:id/approve-insights` | Admin | mark insights approved |
| `POST /invoices/bulk` | Creator | generate invoice from eligible links (creator-only since 13 Sep) |
| `GET /invoices` | Creator/Admin/Finance/Plan Maker | list + filters (Plan Maker: invoices on campaigns from own plans) |
| `POST /invoices/:id/approve` | Admin/Finance | sign-off RAISED → APPROVED (Finance too since 23 Sep) |
| `POST /invoices/:id/mark-paid` | Finance | manual payment confirmation (APPROVED only) |
| `POST /plans/:id/client-invoice`, `GET /plans/:id/client-invoice.pdf` | Admin / Plan Maker (own plan) | Taggify → client Proforma Invoice for an approved plan |
| `GET /invoices/client`, `POST /invoices/client/:id/mark-paid` | Admin/Finance | receivables ledger of client invoices |
| `PUT /invoices/:id/gst-status` | Finance | update GST status |
| `GET /notifications` | any | own notifications |
| `GET /admin/users`, role management | Admin | RBAC management |

### 2.4 Auth & password flow (detail)
1. Admin (or self-signup form) submits `phoneNumber` (+ name optional).
2. Server checks phone not already registered.
3. Server generates a cryptographically random password (e.g. 10-char alphanumeric via `crypto.randomBytes`), hashes with bcrypt (cost 10-12), stores hash only.
4. Plaintext password is returned once in the signup response (for admin-created accounts, shown to admin) and/or dispatched over the delivery channel decided later (WhatsApp/SMS) — never stored in plaintext or logs.
5. Login: verify phone + password via bcrypt compare → issue short-lived JWT access token (~15 min) + longer-lived refresh token (~7-30 days), refresh token hashed and stored in `RefreshToken` table for revocation support without Redis.
6. `requireAuth` middleware verifies JWT signature + expiry on each request; `requireRole` middleware checks `User.role` (and `TeamMembership.canSeeMoney` where relevant) before allowing money-related routes.

### 2.5 Screenshot upload flow (Cloudinary)
1. Client calls `POST /links/:id/screenshot-upload-url`.
2. Server generates a `public_id` (e.g. `screenshots/{linkId}/{uuid}`) and returns signed upload params (`timestamp`, `signature`, `apiKey`, short-lived) for Cloudinary's upload API.
3. Client uploads the file directly to Cloudinary (bypasses API server for the binary).
4. Client calls `POST /links/:id/screenshot` to confirm; server verifies the object exists (`cloudinary.api.resource`) and creates the `Screenshot` row, transitions `Link.status` to `PENDING_SCREENSHOT_REVIEW`.
5. Admin review endpoint sets `approved` true/false, writes a `LinkStatusEvent`, and (if approved) triggers the Apify metrics refresh for that link.

### 2.6 Instagram scraping flow (Apify)
- `lib/apifyClient.js` mirrors the reviewed reference implementation:
  - `getPublicProfile(username)` / `getAccountMetrics(asset)` → `apify~instagram-scraper` actor, called with `directUrls`, never `usernames`.
  - `getPostMetrics(url)` → `data-slayer/instagram-post-details` actor, one call per link.
  - Distinguish `PostNotFoundError` (dead link) from generic scrape failure (retryable).
  - Null engagement fields map to `-1` ("unknown"), never coerced to `0`.
- Triggered two ways: (a) on-demand when Admin approves a screenshot, (b) periodically via `node-cron` for links still awaiting insight approval or for periodic re-snapshotting of account followers.
- Every cron run writes a `JobRun` row (start/finish/status/error) — this is the substitute for a job queue's built-in observability.

### 2.7 Invoicing & payment flow (manual)
1. The creator selects their own submitted, not-yet-invoiced links (any status from `SUBMITTED` to `INSIGHTS_APPROVED`; screenshot/insights optional — newTask.md #3), filtered by date range / campaign, previews the total and picks GST (flat 18%) or non-GST.
2. `POST /invoices/bulk` (CREATOR only, 13 Sep) creates an `Invoice` (status `RAISED`) with `InvoiceItem` rows summing `Link.cost` (respecting `customRate` overrides), and flips each `Link.status` to `INVOICED`. `campaignId` is set when every link belongs to one campaign.
3. `dueDate` is set (+15 days) to support the aging indicator from recommend.md #4.
4. Admin or Finance approves (`POST /invoices/:id/approve`, RAISED → APPROVED). Finance then marks `PAID` via `POST /invoices/:id/mark-paid` once payment is confirmed outside the system (bank transfer, etc.) — no gateway webhook involved. Only an APPROVED invoice can be paid; a rejection releases the links for re-invoicing.
5. GST status tracked as an independent field, updated manually by Finance (`PUT /invoices/:id/gst-status`), matching the distinct GST vs. payment status columns observed on WLDD.

### 2.8 Notifications (no Redis pub/sub)
- Written synchronously as DB rows at the point of the triggering event (screenshot rejected, insights approved, invoice paid, etc.).
- Client polls `GET /notifications` (short interval) or uses simple long-polling; no websocket/pub-sub layer needed at this scale — can be added later without schema changes.

### 2.9 Validation & error handling
- `zod` schemas per route input, enforced via `validate` middleware.
- Centralized error handler returning consistent `{ error: { code, message } }` shape; distinguish 4xx (validation/permission) from 5xx (unexpected), log 5xx with request id.
- Idempotency: bulk-invoice and mark-paid endpoints check current status before transitioning to avoid double-processing on retry/double-click.

### 2.10 Security considerations
- All money-mutating and role-management endpoints gated by `requireRole`.
- Rate limiting on `/auth/login` (`express-rate-limit`, in-memory or DB-counter since no Redis) to blunt brute-force against auto-generated passwords.
- Cloudinary signed upload params short-lived and scoped to a single `public_id`.
- Auto-generated passwords never logged; delivered once and never re-displayed (only reset, not "forgot password → show again").
- Refresh tokens stored hashed, revocable per-user (logout, or admin-forced revoke on role change).

### 2.11 Non-functional notes
- Expected scale (per `research.md`): low thousands of links/invoices per creator account — a single Postgres instance with proper indexes (on `Link.status`, `Invoice.status`, `Link.assetId`) comfortably handles this; no sharding/read-replica needed at this stage.
- `node-cron` jobs run in-process; if the API is horizontally scaled later, add a simple `pg_advisory_lock` or a "leader" flag to prevent duplicate cron execution across instances — noted here so it isn't forgotten when scaling out.
