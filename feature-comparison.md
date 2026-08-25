# Feature comparison — creator.wldd.in vs. invoice-taggify

Live-checked by logging into `https://creator.wldd.in` on 2026-08-25 (session from `research.md`'s original pass) and cross-referencing against this repo's current `server/` and `client/` code. Supersedes/extends `research.md`, which only covered navigation-level structure.

## Headline: bulk link upload

**Yes, WLDD has it — and we don't.** On WLDD's `/dashboard`, every campaign card has an **"Upload Links"** button that opens a modal with a multi-line textarea (placeholder shows 4 example URLs, one per line) and a single **Submit** — paste/type any number of post links and submit them together in one action.

Our app's equivalent ("Submit a link" modal on `client/app/dashboard/page.tsx:388`) has a single `<input type="url">` for **one** Post URL, and the server (`createLinkSchema` in `server/src/modules/links/schemas.js`) only accepts one `url` string per request — there is no bulk endpoint or multi-line input anywhere in the stack. Submitting N links today means N separate submissions.

## Full comparison

Legend: ✅ have it · 🟡 partial/different approach · ❌ missing entirely

| Area | WLDD feature | Ours | Notes |
|---|---|---|---|
| **Auth** | Phone + password login | ✅ | Matches |
| | Self-service **Change Password** (with strength rules) | ❌ | We only support admin-generated passwords (`system design.md` §2.4) — by design, but WLDD's live app has since added self-service change |
| | Email as a contact field, with verify/change flow | ❌ | `User` model has no `email` column at all |
| | Secondary phone number (for WhatsApp alerts) | ❌ | No equivalent field or flow |
| | Editable profile (name, phone, address) | ❌ | `GET /users/me` is read-only; no update route, no client profile page |
| **Campaigns** | List with deadline per campaign | 🟡 | We track `Campaign` but there's no `deadline` field in `schema.prisma` |
| | **Bulk link upload** per campaign | ❌ | See above — the headline gap |
| | Single link submission | ✅ | Have this |
| **My Works / Links** | KPI tiles (Links Added, Pending Screenshots, Approved, Invoiced, Uninvoiced) | ✅ | Dashboard shows the same 5 tiles |
| | Filters: date range, Post Approval Stage, Insights Approval Stage, page | 🟡 | We have a single status filter (`All statuses` dropdown); no date-range or split post/insights-stage filters |
| | Per-post engagement (likes/comments/views) | ✅ | `PostSnapshot` model, via Apify scrape |
| | Post proof screenshot + approval | ✅ | `Screenshot` model + review flow |
| | **Separate "Upload Insight Screenshot"** per post (manual proof of performance) | 🟡 **intentional divergence** | WLDD has creators manually screenshot Instagram Insights for each post as a second approval gate. We deliberately replaced this with automated Apify scraping (`recommend.md` line 34) — a real product decision, not an oversight, but worth confirming it still meets the actual need |
| **Assets** | Social profile registry w/ follower count, approval status | ✅ | Matches |
| | Performance metrics (avg. likes/comments/views) shown on the asset card | 🟡 | We store rate cards; unclear if avg. engagement is surfaced on `/assets` — worth checking |
| | Rate card as **free-form named formats** per asset (e.g. "VOXPOP", "Type 4", "Static") | ❌ | Our `format` is a fixed Prisma enum (`reel, story, carousel, collaboration, video`) — can't represent arbitrary/custom format names, and is missing plain `"post"` as a format |
| | "Add Assets" self-service flow | 🟡 | `POST /assets` exists; didn't confirm client form parity |
| | "Asset Commercials" read-only rate-card view (duplicate of Assets tab) | ❌ | Not present — low priority, it's a duplicate view in WLDD itself |
| **Invoices** | List with Inv No, Name, PAN, Date, Amount | 🟡 | We have invoice number/date/amount; no `PAN` or billing "Name" column |
| | **3 independent status tracks**: Invoice Status, Payment Status, GST Payment Status | 🟡 | We only have `status` (DRAFT/RAISED/APPROVED/PAID) + `gstStatus` — no separate Payment Status track |
| | **REJECTED** invoice status + **Remarks** (rejection reason) | ❌ | Our `InvoiceStatus` enum has no `REJECTED`; no remarks/reason field anywhere |
| | Manual **"New Invoice"** creation | 🟡 | Couldn't confirm the exact flow live; ours is bulk-from-eligible-links only (`POST /invoices/bulk`), no ad-hoc manual invoice |
| | Invoice detail view: **"Bill To"** block with registered company name, address, **GSTIN** | ❌ | No company/biller identity block in our PDF or API |
| | Itemized breakdown: Campaign, Page, **Url** (deep link to the actual post), Amount | 🟡 | Our PDF has line items but didn't confirm a per-item post URL |
| | **"Download Links"** action (separate from PDF download — list of just the URLs) | ❌ | Only PDF download exists (`GET /invoices/:id/pdf`) |
| | PDF download of the invoice | ✅ | Just added (`server/src/lib/invoicePdf.js`) — matches |
| | Search by Invoice Number, filter by Invoice/Payment Status | 🟡 | Server supports `status` filter; unclear if client exposes invoice-number search |
| **Billing / Payouts** | **Billing Profiles**: PAN, GSTIN, MSME number, Bank Account Number, IFSC Code, approval status, multiple profiles per user | ❌ | **Completely absent.** Nothing in our schema tracks tax ID or bank payout details — a real gap if payouts are ever meant to reference real bank accounts, even with manual payment |
| **Notifications** | Contextual, actionable notifications (e.g. "Reminder: Upload Insight Screenshot for [link]", "Your screenshot for [link] has been approved — raise an invoice") with deep links | 🟡 | We have a generic `Notification{type, payload}` model + `GET/POST :id/read`, but no automated **reminder** cron for stalled links (only `instagram_rescrape` and `invoice_aging_sweep` jobs exist) |
| | "Mark all as read" | ❌ | Only per-notification `POST /:id/read`, no bulk endpoint |
| **Misc nav** | Help Desk, FAQs | ❌ (both, in WLDD too) | Confirmed these are non-functional/placeholder in WLDD itself (Help Desk 404s directly, FAQs nav does nothing) — **not** a real gap on our side |

## Priority read

If closing gaps, the highest-leverage ones given this app's stated purpose (get creators paid) are:
1. **Bulk link upload** — directly asked about, and a real daily-workflow pain point at volume (WLDD shows "Uninvoiced Links: 629" — this is a high-volume operation).
2. **Billing Profiles (PAN/GSTIN/bank details)** — without this, "mark invoice as paid" has no bank account to actually reference.
3. **Invoice REJECTED status + remarks** — WLDD's real data shows rejections happen regularly (3 of 16 invoices shown were rejected with specific reasons); our workflow has no way to represent that.
4. Everything else in the table is smaller UI/filter polish by comparison.
