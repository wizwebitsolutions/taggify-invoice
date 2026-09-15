# Database

PostgreSQL, accessed via Prisma. Schema source of truth:
`server/prisma/schema.prisma`. Migrations live in
`server/prisma/migrations/` (20 applied as of this doc).

This doc explains *what's in the database and why it's shaped that way* —
for the feature-level rationale behind specific columns, the schema file's
inline comments cite the request/date that drove them; read the schema
directly for that level of detail.

## Domain model at a glance

```
User ──< TeamMembership >── (creator's team)
User ──< BillingProfile          (payout/tax identity, admin-approved)
User ──< Asset                   (a page/handle the user owns)
User ──< RefreshToken            (auth sessions)
User ──< PermissionAuditLog      (sub-admin grant/edit history)

Asset ──< RateCard                (per-format price list)
Asset ──< Link                    (posts submitted against a campaign)
Asset ──< AccountSnapshot         (follower/media count over time)
Asset ──< CampaignAssignment      (sheet-driven visibility)
Asset ──< PlanItem                (line in a pitch)

Campaign ──< Link
Campaign ──< CampaignAssignment
Campaign ──self (parentCampaignId)  phases of one deal
Campaign ──1:1 Plan                 (if the campaign came from an approved plan)

Link ──1:1 Screenshot
Link ──< PostSnapshot             (engagement over time)
Link ──1:1 InvoiceItem
Link ──< LinkStatusEvent          (status history / audit)
Link ──< LinkCostRevision         (cost-change history / audit)
Link ──1:1 CampaignAssignment     (back-reference, if auto-attached)

Invoice ──< InvoiceItem >── Link

Plan ──< PlanItem >── Asset
Plan ──1:1 Campaign               (created on approval)
Plan ──self (pitchGroupId, no FK)   Plan A/B/C variants
```

## Enums

| Enum | Values | Used by |
|---|---|---|
| `Role` | `CREATOR`, `TEAM_MEMBER`, `ADMIN`, `FINANCE`, `PLAN_MAKER` | `User.role` |
| `PlanStatus` | `DRAFT` → `PENDING_APPROVAL` → `APPROVED` \| `REJECTED` | `Plan.status` |
| `LinkStatus` | `SUBMITTED` → `PENDING_SCREENSHOT_REVIEW` → `SCREENSHOT_REJECTED` \| `SCREENSHOT_APPROVED` → `INSIGHTS_PENDING` → `INSIGHTS_APPROVED` → `INVOICED`; also `INVALID` (terminal, reachable from most non-INVOICED states) | `Link.status` |
| `InvoiceStatus` | `DRAFT` → `RAISED` → `APPROVED` \| `REJECTED` → `PAID` | `Invoice.status` |
| `GstStatus` | `PENDING`, `SCHEDULED`, `COMPLETED` | `Invoice.gstStatus` |
| `PaymentStatus` | `PENDING`, `COMPLETED`, `CANCELLED` | `Invoice.paymentStatus` |

`Link.status` and `Invoice.status` are the two workflow state machines in
the app: **Link** covers link submission → screenshot approval → insight
verification → invoicing (the "ops layer" from the README); **Invoice**
covers invoice raising → approval → payout.

## Tables

### User
Central identity table. One row per person; `role` picks which
dashboard/permission set applies (`ADMIN`/`FINANCE` → `AdminDashboard`,
others → `CreatorDashboard`; `PLAN_MAKER` gets its own dashboard per
`lib/permissions.js`).

- Auth: `phoneNumber` (unique) + `passwordHash`; `email` also unique but
  optional.
- `permissions` (JSON, nullable): a **sub-admin override**. It's not a
  separate role — a "sub-admin" is just an `ADMIN`-role row with this set
  to something narrower than the default admin grant. Null = full
  role-default access. See `lib/permissions.js` for keys/defaults and
  `getEffectivePermissions()` for the merge logic.
- `createdByAdminId` (self-FK, relation `AdminCreatedSubAdmins`): which
  admin created this account, when created via the sub-admin flow. Null
  otherwise.
- Every permission grant/edit on a `User` is logged to
  `PermissionAuditLog`, not just tracked by this one FK.

### PermissionAuditLog
Append-only audit trail for sub-admin permission changes. `before`/`after`
are JSON snapshots of the `permissions` field; `target` is the account
being changed, `actor` is who changed it. Never updated or deleted.

### BillingProfile
A creator's payout/tax identity (PAN, GSTIN, bank details) — separate
from `User` because one user can register several (e.g. one per PAN), and
each goes through its own admin approval (`approvalStatus`:
pending/approved/rejected, plain string not an enum). Cascades on user
delete.

### TeamMembership
Links a `TEAM_MEMBER`-role user to the creator account they work under.
`canSeeMoney` gates whether that member sees financial figures. Unique on
`(userId, creatorId)` — a member can't be added twice under the same
creator (nothing stops one member belonging to multiple creators, though).

### RefreshToken
JWT refresh-token store for auth sessions. `tokenHash` (never the raw
token), `expiresAt`, `revoked`. Cascades on user delete.

### Asset
A page/handle a user owns (currently Instagram-only, `platform` defaults
to `"instagram"`). Profile fields (`fullName`, `biography`,
`profilePicUrl`, `followers`) are synced from Apify roughly every 24h (see
`modules/jobs/assetProfileRescrape.js`). `approvalStatus` gates whether
the page counts in inventory / can be used for links. Unique on
`(ownerId, platform, handle)` — one owner can't register the same handle
twice.

### RateCard
Per-format price list for an `Asset` — one row per `format` (reel, story,
carousel, collaboration, video), unique on `(assetId, format)`.
`effectiveFrom` timestamps when a rate took effect (no explicit history
table; a new rate presumably replaces via update, not insert — check
`assets/service.js` if you need the exact update semantics).

### Campaign
A brand deal actually in progress (as opposed to `Plan`, which is a pitch
that may never happen). Can grow **phases**: `parentCampaignId` self-FK
lets a phase-2+ campaign point back at phase 1, and budget/spend roll up
across all phases under one parent (computed in `campaigns/service.js`'s
`annotateCampaign`, not stored). `costCap` is the only stored budget
figure — "remaining budget" is always derived (`costCap - Σ links.cost`).
`sheetLink` is a plain reference URL, not live-fetched; the actual
page/creator list comes in via `CampaignAssignment` rows from an uploaded
sheet.

### CampaignAssignment
One row per page/creator listed in a sheet attached to a campaign — i.e.
"which pages is this campaign visible to." `pageHandle`/`creatorPhone`
are the raw sheet values, kept even after matching. `assetId` fills in
once matched to an existing (or admin-created) `Asset`. `postUrl` /
`format` / `cost` are optional sheet columns that, when present, get
auto-attached as a real `Link` — `linkId` (unique) records that attach and
makes it idempotent (only ever happens once per row, however many times
the row itself is touched later).

### Link
A submitted post against a campaign+asset. `cost` is the current
per-post cost (`customRate` flags an override from the asset's rate
card); `status` drives the ops pipeline (see `LinkStatus` above).
Indexed on `status`, `assetId`, `campaignId` — the three things
dashboards filter/group by. Has a full audit trail via two child tables:

- **LinkStatusEvent** — one row per status transition, who did it
  (`actedById`, nullable for system-driven transitions), optional note.
- **LinkCostRevision** — one row per admin cost edit, `previousCost` →
  `newCost` + note + who (`revisedById`). `Link.cost` always holds the
  *current* value; this table is history only.

Also has 1:1 `Screenshot` (proof-of-post upload, Cloudinary-hosted,
admin-reviewed) and 1:many `PostSnapshot` (engagement metrics captured
over time from Apify — likes/comments/views/saves/shares/reposts +
caption/thumbnail for the campaign card preview).

### AccountSnapshot
Time series of an `Asset`'s follower/media count, captured on each
re-scrape. Purely additive — no update-in-place, so it doubles as
historical trend data.

### Invoice / InvoiceItem
`Invoice` is the billing document raised against a creator (`creatorId`).
`amount = subtotal + gstAmount`; `gstAmount` is 18% of subtotal when
`isGstInvoice`, else 0. `paymentStatus` and `gstStatus` track two
independent side-processes (money received vs. GST filing) alongside the
main `status` workflow. `InvoiceItem` is the join between an `Invoice`
and the `Link`s it bills — 1:1 with `Link` (a link can only ever be
invoiced once; `linkId` is unique), `amount` frozen at invoice time (not
recomputed if `Link.cost` changes later, since a `LinkCostRevision` would
have run first anyway).

### Notification
Generic per-user notification, `type` + free-form `payload` JSON,
`readAt` nullable (unread = null). Indexed on `(userId, readAt)` for the
"unread count" query.

### AppSetting
Generic key/value store for app-wide state that isn't tied to any one
row — currently: the Google OAuth refresh token (plan-generated Sheets
need a real Drive-quota account, hence user OAuth, not a service
account) and the reusable execution-sheet template's spreadsheet id.

### JobRun
Log of background cron job executions (`jobName`, `status`:
running/success/failed, timestamps, `error`). Powers the "Job runs" admin
page. Indexed on `(jobName, startedAt)`.

### Plan / PlanItem
A **pitch** an admin/plan-maker builds to propose a set of pages to a
brand client — distinct from `Campaign` (which is work actually
happening; a plan may never convert). Cost/impressions are computed at
read time from selected `PlanItem`s, same convention as `Campaign`'s
budget fields, *unless* overridden:

- `override{Followers,Posts,Impressions,Cost}` — client-facing numbers an
  admin can hand-edit; null falls back to the computed value.
- `clientSheetUrl` / `internalSheetUrl` — generated Google Sheets,
  cached here so re-visiting the plan doesn't spin up new spreadsheets
  each time; "Regenerate" overwrites in place.
- `executionSheetUrl` — a plain pasted reference link (not parsed) to
  wherever the actual posting activity gets logged.
- `pitchGroupId` (no FK, just a shared string) + `variantLabel` — Plan
  A/B/C variants that started from one shared client-details/budget
  shell and are then fully independent (deliberately not kept in sync).
- `campaignId` (unique FK) — set exactly once, on approval: a real
  `Campaign` is created from the plan's pages, with one
  `CampaignAssignment` per distinct page (already "matched"), so each
  page owner sees it the same way any other campaign becomes visible to
  them.

`PlanItem` mirrors `Link`'s format convention (reel/story/carousel/
collaboration/video). `cost` is an internal snapshot of the asset's rate
at add-time; `clientCost` is an optional client-facing markup (null =
show `cost` as-is — always resolved via `plans/service.js`'s
`forClientPdf()`, never read raw on anything client-facing).
`postsPerProfile` multiplies the per-post cost into a line total.

## Key relations / FK summary

| Table | FK → | On delete |
|---|---|---|
| `User.createdByAdminId` | `User.id` | (none set — restrict by default) |
| `BillingProfile.userId` | `User.id` | Cascade |
| `TeamMembership.userId` | `User.id` | Cascade |
| `RefreshToken.userId` | `User.id` | Cascade |
| `Asset.ownerId` | `User.id` | (default) |
| `RateCard.assetId` | `Asset.id` | Cascade |
| `Campaign.parentCampaignId` | `Campaign.id` | (default) |
| `CampaignAssignment.campaignId` | `Campaign.id` | Cascade |
| `CampaignAssignment.assetId` | `Asset.id` | (default, nullable) |
| `CampaignAssignment.linkId` | `Link.id` (unique) | (default, nullable) |
| `Link.campaignId` | `Campaign.id` | (default) |
| `Link.assetId` | `Asset.id` | (default) |
| `Link.submittedById` | `User.id` | (default) |
| `LinkCostRevision.linkId` | `Link.id` | Cascade |
| `LinkStatusEvent.linkId` | `Link.id` | Cascade |
| `Screenshot.linkId` | `Link.id` (unique) | Cascade |
| `PostSnapshot.linkId` | `Link.id` | Cascade |
| `AccountSnapshot.assetId` | `Asset.id` | Cascade |
| `Invoice.creatorId` | `User.id` | (default) |
| `InvoiceItem.invoiceId` | `Invoice.id` | Cascade |
| `InvoiceItem.linkId` | `Link.id` (unique) | (default) |
| `Notification.userId` | `User.id` | Cascade |
| `Plan.createdById` | `User.id` | (default) |
| `Plan.approvedById` | `User.id` | (default, nullable) |
| `Plan.campaignId` | `Campaign.id` (unique) | (default, nullable) |
| `PlanItem.planId` | `Plan.id` | Cascade |
| `PlanItem.assetId` | `Asset.id` | (default) |
| `PermissionAuditLog.targetId` / `actorId` | `User.id` | (default) |

"(default)" = Prisma/Postgres default (`RESTRICT`/`NO ACTION` depending
on driver) — no `onDelete` explicitly set in the schema, so deleting a
referenced row will fail if dependents exist.

## Money/decimal convention

All currency fields are `Decimal @db.Decimal(12, 2)` (₹ with 2 decimal
places) — never `Float`, avoiding rounding drift on invoice totals.

## Notable non-obvious design choices

- **Nothing is really deleted for audit-relevant data.** `LinkStatus`
  and `InvoiceStatus` both use *soft terminal states* (`INVALID`,
  `REJECTED`) rather than row deletion, so `LinkStatusEvent`/
  `LinkCostRevision` history stays intact.
- **Computed, not stored, aggregates.** Campaign "remaining budget," Plan
  cost/impressions, and phase roll-ups are all derived at read time in
  the relevant `service.js`, not persisted columns — search for
  `annotateCampaign` / `annotatePlan` if a number looks wrong; it's not
  coming from the DB directly.
- **JSON columns are the two "flexible" escape hatches**: `User.permissions`
  (sub-admin overlay) and `Notification.payload` (per-notification-type
  shape). Everything else is a normal typed column.
- **Two independent audit logs** exist for different concerns:
  `PermissionAuditLog` (who changed whose access) and
  `LinkCostRevision`/`LinkStatusEvent` (what happened to a specific
  link). There's no generic/unified audit table.

## Migrations

20 migrations applied, most recent: `20260910062551_plan_wizard_fields`
(adds the Plan wizard's client-details/override/sheet-URL columns above).
Run `npx prisma migrate deploy` (server/) to bring a fresh DB up to date,
or `npx prisma studio` to browse data interactively.
