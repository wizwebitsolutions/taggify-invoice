# Taggify — Designer's Brief

**Purpose of this document.** This is the complete content and flow specification for Taggify — the operations layer for creator campaigns (link submission → screenshot approval → insight verification → invoicing → payout). It is written for a UI/UX designer who will design the app's visual system and every screen from scratch. Every page, every role's view, every modal/wizard, every button label, every status, and every piece of real copy below is quoted or described exactly as it exists in the current product — nothing here is invented. Where the current implementation is visually plain or has a rough edge, that's noted so it doesn't get mistaken for an intentional pattern worth preserving.

**How to use this doc.** Treat this as content + information architecture, not visual direction — there's no prescribed look here (colors, type, spacing are all open). Section 5 (status enums) is the one place where meaning, not just label, matters: get those right, since they drive the whole approval workflow's logic. Section 6 is a field glossary for designing inputs/tables. Section 3 (nav) and Section 1 (roles) are the skeleton everything else hangs off of — read those first.

---

## Table of contents

1. [Roles & permissions](#1-roles--permissions)
2. [Auth & session](#2-auth--session)
3. [Global navigation & shell](#3-global-navigation--shell)
4. [Every page](#4-every-page)
   - 4.1 [Dashboard](#41-dashboard-dashboard--role-branches-to-4-different-components) (4 role variants + shared Link Detail panel)
   - 4.2 [Campaigns](#42-campaigns-campaigns)
   - 4.3 [Inventory](#43-inventory-inventory)
   - 4.4 [Plans](#44-plans-plans) (incl. the 5-step Plan Wizard)
   - 4.5 [Invoices](#45-invoices-invoices) (incl. the New Invoice wizard)
   - 4.6 [Users](#46-users-users--admin-only)
   - 4.7 [Team](#47-team-team--creator-only)
   - 4.8 [Job runs](#48-job-runs-job-runs--admin-only)
   - 4.9 [Profile](#49-profile-profile)
5. [Status enums & meaning](#5-status-enums--meaning)
6. [Data model glossary](#6-data-model-glossary)
7. [Notifications / feedback patterns](#7-notifications--feedback-patterns)

---

## 1. Roles & permissions

### Roles (exact set)
```
Role = "CREATOR" | "TEAM_MEMBER" | "ADMIN" | "FINANCE" | "PLAN_MAKER"
```
Displayed label: capitalizes first letter, lowercases the rest, replaces `_` with a space — e.g. `TEAM_MEMBER` → "Team member", `PLAN_MAKER` → "Plan maker".

- **CREATOR** — owns Instagram pages, submits links, tracks "My Works", manages a Team, holds Billing Profiles, raises invoices.
- **TEAM_MEMBER** — works under a Creator (submits links; sees money only if `canSeeMoney` is set true on their membership).
- **ADMIN** — full access to everything: campaigns, inventory approval, link review, invoices, users, job runs, plans.
- **FINANCE** — money-only slice: invoices, billing-profile approvals; read-only campaigns/inventory; no link-review permission.
- **PLAN_MAKER** — "Planner (POC)": Dashboard + Inventory (read/select) + Plans (create/edit/submit own plans); no Campaigns, no link review, no Users/Finance.

### Sub-admin permission overlay
An ADMIN account can be restricted via a permission overlay. Absent = full access; an explicit `false` on a key hides that key's feature. Keys:

| Key | Covers |
|---|---|
| `users.manage` | Users — create accounts, change roles, reset passwords |
| `campaigns.manage` | Campaigns — create/edit, phases, sheet import |
| `inventory.manage` | Inventory — add pages, approve, rate cards |
| `links.review` | Link review — screenshots, insights, cost revisions |
| `finance.manage` | Finance — invoices, billing approvals, finance export |
| `plans.manage` | Plans — create/edit/approve any plan |

A restricted admin gets a **"Sub-admin"** pill next to their role selector on the Users page. Only ADMIN accounts can carry an overlay — every other role's access is role-only.

### Role × nav-item visibility

| Nav item | CREATOR | TEAM_MEMBER | ADMIN | FINANCE | PLAN_MAKER |
|---|:---:|:---:|:---:|:---:|:---:|
| Dashboard | ✅ | ✅ | ✅ | ✅ | ✅ |
| Campaigns | ✅ | ✅ | ✅ | ✅ | ❌ |
| Inventory | ✅ | ✅ | ✅ | ✅ | ✅ |
| Plans | ❌ | ❌ | ✅ | ❌ | ✅ |
| Invoices | ✅ | ✅ | ✅ | ✅ | ❌ |
| Users | ❌ | ❌ | ✅ (needs `users.manage`) | ❌ | ❌ |
| Team | ✅ | ❌ | ❌ | ❌ | ❌ |
| Job runs | ❌ | ❌ | ✅ | ❌ | ❌ |
| Profile | ✅ | ✅ | ✅ | ✅ | ✅ |

Nav groups (exact labels): **Overview** (Dashboard) · **Work** (Campaigns, Inventory, Plans) · **Finance** (Invoices) · **Admin** (Users, Team, Job runs).

---

## 2. Auth & session

### Login page
Split-screen: left editorial panel (hidden on small screens), right form.

**Left panel:**
- Wordmark: "T" mark + "Taggify"
- Headline: *"Track every post."* / *"Get paid on time."*
- Subhead: "The operations layer for creator campaigns — link submission, screenshot approval, insight verification, and payout in one continuous thread."
- Footer pipeline dots: "Links" · "Screenshots" · "Invoices" · "Payouts"

**Form:**
- Heading "Welcome back", subtitle "Sign in with the phone number on your account."
- Field "Phone number" — fixed "+91" prefix + input, placeholder "98765 43210"
- Field "Password" — show/hide toggle
- Helper text: "Password was issued by your account admin — contact them if you've lost it."
- Error state: red-bordered box with the server's error message, or fallback "Something went wrong — try again."
- Submit: "Sign in" / "Signing in…"
- Footer: "New creators are added by an admin — no self-signup."
- **There is no signup and no forgot-password flow anywhere in the app.**

### Session
- Stored client-side (`localStorage`); access token short-lived (~15 min), silently refreshed on expiry.
- Cross-tab sync keeps every open tab's session state consistent.
- Every protected page shows **"Checking your session…"** while auth is resolving, then redirects to `/login` if there's no user.

### Logout
- Desktop: "Log out" danger button, always visible in the topbar.
- Mobile: "Log out" row in the More sheet, and a full-width "Log out" button at the bottom of Profile.
- No confirmation dialog on logout.

---

## 3. Global navigation & shell

### Sidebar (desktop only)
Logo + wordmark top; nav groups per the matrix above, each with an uppercase group label and icon+label items. Footer: a profile card (avatar initials, name, humanized role, chevron) linking to Profile.

### Bottom nav (mobile only, 5 slots)
Fixed: **Home** (Dashboard) · **Campaigns** · **Invoices** · **Inventory** · **More** (opens a sheet).

### "More" sheet (mobile overflow)
Two views:
- **Menu**: profile row → Notifications (with unread badge) → role-gated rows (Plans / Team / Users / Job runs, only what's visible to the signed-in role) → Dark mode toggle → Log out.
- **Notifications**: back chevron, title, "Mark all read" (if any unread), list or empty state **"No notifications yet."**

### Topbar
Search bar (decorative, page-specific placeholder) · theme toggle · notifications bell (dropdown: "Notifications" title, "Mark all as read", list or empty state) · page-specific action slot (e.g. "Upload links", "New campaign") · profile avatar → Profile · "Log out" (desktop only).

### Modal/sheet pattern
One shared component renders every modal in the app: a bottom sheet on mobile (slide-up, rounded top, drag handle), a centered dialog on desktop. This is the single modal primitive to design once and reuse everywhere.

No breadcrumbs exist except a manual "← Back to campaigns" on the campaign detail page and "‹ Back to filters" inside the New Invoice wizard.

---

## 4. Every page

### 4.1 Dashboard (`/dashboard`) — role-branches to 4 different components

**Shared header pattern:** eyebrow, title (part of it accent-colored), subtitle, and a stat block on the right.

#### A. "My Works" — CREATOR & TEAM_MEMBER
- Eyebrow **"Overview"**, title **"My Works"**, subtitle **"Every submitted link, tracked from post to payout."**, hero stat = total links tracked.
- Action button (CREATOR/TEAM_MEMBER): **"Upload links"** → opens the Upload Links modal.
- 5 clickable KPI tiles (each filters the table): **Links added · Pending screenshots · Links approved · Links invoiced · Uninvoiced links**.
- Filters: Status dropdown (All statuses / Submitted / Pending review / Screenshot approved / Insights pending / Insights approved / Invoiced / Approved (all stages) / Broken), Page dropdown (All pages + every `@handle`), From/To date range.
- Bulk action (CREATOR/ADMIN, when rows selected): **"Bulk invoice · N selected"** / "Raising invoice…".
- Table: checkbox · Post (campaign title + URL) · Page · Format · Cost · Engagement (likes/comments, or "No metrics yet") · Status pill.
- Empty: **"No links match this filter yet."**
- Row click opens the shared **Link Detail panel** (§4.1e below).

**Upload Links modal** (shared with Campaigns):
- Title **"Upload links"**; subtitle names the pinned campaign if opened from one.
- Fields: Campaign (select, or locked if pinned), Page (`@handle` select), Format (select — standard formats plus any custom ones from that page's rate card; unpriced ones show "(no rate set)"), Post URLs (textarea, one per line, live count in the label).
- Result: "N link(s) submitted." + optional "N skipped:" with reasons.
- Buttons: Cancel/Close, "Submit N links"/"Submit link"/"Submitting…" → "Done".

#### B. Admin Overview — ADMIN & FINANCE (two distinct components — see note)
> **Code note:** ADMIN and FINANCE currently render *different* components (`AdminDashboard` vs. `FinanceDashboard`), not the same one with hidden sections. Design them as two related but separate dashboards.

**AdminDashboard (ADMIN, and FINANCE sees a reduced version of the same component):**
- Eyebrow **"Admin"**, title **"Overview"**, subtitle **"Finance, pipeline health, and pages — across every creator."**, hero stat = campaigns live.
- 4 finance KPI tiles: **Total raised** (with a sparkline) · **Pending payment** · **Overdue** (rose tone if >0) · **Collected** — each links into a filtered Invoices view.
- 4 ops KPI tiles: **Active pages** · **Pending approvals** ("Pages + billing profiles") · **Campaigns** · **Links in pipeline** ("Not yet invoiced").
- Panel **"Expenditure trend"** — area chart, last 6 months.
- Panel **"Link pipeline"** ("Where every submitted link sits right now — click a stage to inspect it.") — ranked bars of every link status.
- Panel: top pages by followers (compare mode available).
- Panel **"Invoice status"** ("Every invoice ever raised, by current status — click one to open it filtered.") — stacked bar.
- Section **"Needs your review"** (or **"Links · {status}"** when filtered, with a "← Back to needs review" link) — subtitle "Screenshot approvals and insight approvals waiting on you." Table: Post/Page/Cost/Status; row click opens Link Detail panel with full review actions. Empty: **"Nothing waiting on you — all caught up."**
- Section **"Pending approvals"**, two side-by-side panels:
  - **"Pages awaiting approval"** — `@handle` + follower count + **Approve**/**Reject**. Empty: **"No pages waiting on approval."**
  - **"Billing profiles awaiting approval"** — name + "PAN {pan}" + Approve/Reject. Empty: **"No billing profiles waiting on approval."**
- ADMIN-only: **"Recent job runs"** panel (empty: **"No cron runs recorded yet."**) and **"Team"** panel (role-count breakdown).
- No confirm dialogs anywhere on this page — Approve/Reject act immediately on click.

**FinanceDashboard (FINANCE):**
- Eyebrow **"Finance"**, title **"Overview"**, subtitle **"Money given, money taken, and what's still waiting on an approval."**, hero stat = invoices pending count.
- Same 4 finance KPI tiles as Admin's.
- Panel **"Invoice status"** — stacked bar.
- Panel **"Pending post-for-cost"** — big number + "links awaiting invoicing" + "View invoices" button (read-only — Finance can't review links).
- Panel **"Campaigns"** (read-only, "Read-only — campaign management is Admin's.") — top 5 campaigns. Empty: **"No campaigns yet."**
- Panel **"Page-wise dues"** — ranked bars of invoiced-amount per page. Empty: **"No invoiced links yet."**
- Panel **"Billing profiles awaiting approval"** — same as Admin's.
- Footer line: "{N} pages in inventory · {N} campaigns".

#### C. "Your plans" — PLAN_MAKER
- Eyebrow **"Plan Maker"**, title **"Your plans"**, subtitle **"Every pitch you've built, its approval status, and what it's worth."**, hero stat = plans total.
- Action: **"New plan"**.
- 4 KPI tiles: **Draft** ("Still being built") · **Pending approval** ("Awaiting sign-off") · **Approved** ("Ready to send") · **Pitched value** ("Client-facing total, all plans").
- Panel **"Your plans"** ("Build and edit these from the Plans tab — actions here are just submit/approve/reject.") Empty: **"No plans yet — create one from the Plans tab."**
- Each row: name + status pill + "{client} · N page(s) · ♥{likes} 👁{views} · {total}" + action button (**Submit for approval** on Draft, or **Approve**/**Reject** on Pending) — no confirm dialogs.

#### D. Shared: Link Detail panel
Opens as a persistent side panel (desktop) or bottom sheet (mobile) whenever a link is selected — from My Works, the Admin review queue, or a campaign's link table.
- Screenshot thumbnail (or placeholder), campaign title, `@handle · url`, cost.
- **Cost revision** (admin only): "Revise cost" opens an inline number+reason editor; "History" shows prior revisions. Locked once invoiced ("Reject the invoice to revise this link's cost.").
- **Status timeline** — a vertical history of every status change with actor/date.
- **Screenshot upload** (creator, only while Submitted or Rejected): "Upload proof screenshot" / "Re-upload proof screenshot".
- **Admin review actions**: Approve/Reject on a pending screenshot; "Approve insights" + "Refresh metrics" once metrics exist; a "Mark as broken" flow (reason required, irreversible from this panel, excludes the link from campaign spend).

---

### 4.2 Campaigns (`/campaigns`)
- Header: eyebrow **"Work"**, title **"Campaigns"**, subtitle **"Brand deals assigned to your pages."**
- Visible to CREATOR/TEAM_MEMBER/ADMIN/FINANCE. Creating campaigns is ADMIN-only; "Upload Links" on a card is for CREATOR/TEAM_MEMBER.
- Actions (ADMIN): **"Import work"** (secondary) + **"New campaign"** (primary).
- Grid of campaign cards. Empty: **"No campaigns yet."**

**Campaign card:** representative post thumbnail; brand name (eyebrow) + campaign title; "Over" badge if over budget; caption; ♥ likes + post count + phase-count chip if >1; budget bar "{spent} / {cap}" + %; pending-assignments warning ("N page(s) from the sheet still need(s) creating"); "Created {date}" / "Deadline {date}" (rose if past); "Upload Links" button. Click → campaign detail page.

**New Campaign modal** (ADMIN): Fields — Brand name*, Campaign title*, Deadline (optional), Total cost cap (optional). Optional bulk-page-import section: a Google Sheet link + "Fetch rows", or a CSV upload — any handle not already in Taggify becomes "pending" with an option to create it right there. Buttons: Cancel / "Create campaign" ("Creating…").

**Import Work modal** (ADMIN): paste a sheet link or upload a CSV of posts that already went out (campaign, page, url, format, optional cost — falls back to rate card). Result: "N link(s) created." + skipped rows with reasons. Buttons: Cancel/Close, "Import N row(s)".

**Resolve Pending Assignments modal**: lists sheet rows that didn't match an existing page; each can be turned into a new page right there (phone, name, category, rate card) — on success shows the generated password once ("share it now, it can't be shown again"). Empty: "All rows are matched." Footer: "Done for now".

**Campaign detail page**: header card (brand, title, dates, likes, post count) + "Edit campaign" (ADMIN); phase chips + "+ Add phase" (ADMIN); "Attached sheet" panel (handle, creator phone for privileged viewers, post-attachment status, Matched/Pending pill); "Budget" panel (spent/cap/bar); "Links" panel (table, empty: "No links submitted for this campaign yet.") — row click opens Link Detail panel.

---

### 4.3 Inventory (`/inventory`)
- Header: eyebrow **"Work"**, title **"Inventory"**, subtitle **"Pages and their rate cards."**
- Everyone can view; "Add page" is CREATOR-only; selection checkboxes + "Create plan" bar are for ADMIN/PLAN_MAKER.
- Controls: search ("Search by page or category…"), category tabs (only if >1 category), owner filter (only if >1 owner), sort (Newest first / Followers high→low / Followers low→high).
- Empty states: "No pages registered yet." / "No pages match "{search}"." / "No pages in this category."

**Page card:** optional selection checkbox; avatar, `@handle`, follower count + category; approval-status pill (approved/pending/rejected) + Approve/Reject if editable and pending; **"Performance metrics"** section (Avg. likes / Avg. comments / Avg. views, or "N/A", footnote "Across {N} scraped post(s)"); **"Rate card"** section (format→amount list, or "No rates set yet."; editable: per-format inputs + "Add custom format" + Save/Cancel).

**Sticky selection bar** (once ≥1 selected): "N page(s) selected" + Clear + **"Create plan"** (jumps into the Plan Wizard pre-seeded with those pages).

**Add a page modal** (CREATOR): Instagram handle* ("e.g. demo.page, without @"), Category (optional, picker). Buttons: Cancel / "Add page".

---

### 4.4 Plans (`/plans`)
- Header: eyebrow **"Work"**, title **"Plans"**, subtitle **"Pitch decks built from Inventory's pages, with client-facing totals and GST."**
- ADMIN and PLAN_MAKER only; everyone else sees: **"Plans are available to Admin and Plan Maker accounts."**
- Action: **"New plan"**. Search ("Search by plan or client…"). Status tabs: All / Draft / Needs approval / Active / Rejected (with counts).
- Empty: "No plans yet." / "No plans match "{search}"." / "No plans in this status."

**Plan card:** status pill; client name (small) + plan name (bold); completeness bar ("Details filled {N}%" + "Missing: {list}", or "✓ All details filled" — checks Client contact, Budget, Pages, Rates on every page); ♥ likes, 👁 views, page count; Total cost + Budget variance ("{amount} over"/"{amount} under"); workflow buttons (Submit for approval / Approve / Reject, no confirm); footer: Edit / PDF / delete (✕).

**Delete plan modal:** "Delete plan" — "This permanently removes **{name}**. This can't be undone." Cancel / "Delete plan".

#### The Plan Wizard — 5 steps
A large sheet/dialog, with a Plan A / Plan B tab switcher once a sibling variant exists, and a 1–5 step indicator (Basics / Pages / Overview / Preview / Build).

1. **Basics** — Plan name*, Client name*, Client contact (optional), Budget (optional); "Add 18% GST on top of the client cost" checkbox; Brief/note (optional). "Next: Pages" creates the plan as a real Draft on the server.
2. **Pages** — pick pages by category ("Add top N pages in "{category}" by followers"), or a manual checklist sorted by followers; each selected page gets Format, Cost, Posts-per-profile, and an optional override "Client cost" (with "Reset cost"). Optional: attach a Google Sheet or CSV of pages — unmatched handles become new pending pages. Running total shown live. "Next: Overview".
3. **Overview** — a "client-facing overview" box (Total followers / Total posts / Expected impressions / Cost — each defaults to a computed value, overridable) and an "internal, not shown to client" box (internal cost, expected engagement, budget variance). "Next: Preview".
4. **Preview & Plan B** — a read-only preview of exactly what the client-facing Google Sheet will show (header numbers + category-grouped page tables). A dashed prompt offers "Add Plan B" to start a competing package from the same client shell. "Next: Build".
5. **Build** — per-variant card: totals, page count, Company name/GST number/Address (all optional), "Generate Google Sheet" / "Regenerate Google Sheet" + "Open sheet ↗" once generated; a collapsible "Secondary export — PDF" with Client PDF / Internal PDF buttons (and a combined-PDF button if ≥2 variants). Final: Back / "Done".

---

### 4.5 Invoices (`/invoices`)
- Header: eyebrow **"Finance"**, title **"Invoices"**, subtitle **"Raised, paid, and GST status — tracked independently, settled manually."**
- Visible to CREATOR/TEAM_MEMBER/ADMIN/FINANCE. Manage actions = ADMIN/FINANCE. Raising an invoice = CREATOR/ADMIN.
- 3 KPI tiles: **Total raised · Pending payment · Overdue** (rose if >0).
- Filters: search ("Search invoice number…"), Invoice status (Draft/Raised/Approved/Rejected/Paid), Payment status (Pending/Completed/Cancelled). Actions: "Export CSV", "New invoice".
- Table: Invoice # · Creator · Amount · Status pill (+ rejection remark if any) · Payment pill · GST pill · Due (date, or "Overdue · {N}d" in rose, or "Settled {date}") · row actions. Empty: **"No invoices raised yet — bulk-invoice approved links from My Works."**
- Row actions: **"Mark paid"** button + a "⋯" menu with **Download PDF**, **Download links**, **Reject invoice**.
- Detail panel: invoice number, amount, status/payment/GST pills, "GST invoice" badge, rejection remark if rejected, line items (first 4 + "+N more"), subtotal/GST/total; action buttons as above plus **"Advance GST to {scheduled|completed}"**.

**Reject Invoice modal:** "Reject invoice" — "Its links go back to whatever status they were in before this invoice, eligible to be re-invoiced once the issue is fixed." Field: Reason*. Cancel / "Reject invoice".

**New Invoice wizard — 2 steps:**
1. **Filters** — From/To dates (optional), Campaign (optional, search-as-you-type with a clearable chip). Cancel / "Continue".
2. **Preview** — info banner "Only links with an approved screenshot are shown — insights aren't required to invoice."; links grouped by campaign, all eligible ones pre-selected, individually deselectable; "Select all · N link(s)"; GST toggle ("Non-GST invoice" / "GST invoice · +18%"); totals (Subtotal / GST / Total). "Raise invoice · {total}" → success screen: "Invoice raised" — "{invoiceNumber} for {amount} has been sent to your admin for approval." Empty state: "No links matched these filters — try widening the date range or clearing the campaign."

---

### 4.6 Users (`/users`) — ADMIN only
- Header: eyebrow **"Admin"**, title **"Users"**, subtitle **"Every account on Taggify, and who can create new ones."** Non-admin fallback: "User management is available to Admin accounts."
- Action: **"Add user"**.
- Table: Name · Phone · Role (inline dropdown; self-edit disabled with a tooltip; "Sub-admin" badge if restricted) · Joined · "Reset password" / "Edit access" (Edit access only shows for other admins). Empty: "No users yet."

**Add a user modal:** Phone* (blur-validated), Name (optional), Role (select). If Admin: a 6-item permission checklist ("uncheck a section to create a Sub-admin"). If Creator: a "Pages" section requiring at least one page (handle, category, rate card — repeatable via "Add another page"). On success: a one-time password reveal + per-page creation summary. Cancel / "Create user" → "Done".

**Reset Password modal:** confirm copy ("signs them out of every device… current password stops working immediately") → Cancel / "Reset password" (danger) → one-time password reveal → "Done".

**Edit Access modal:** "What **{name}** can see and do." — the same 6-checkbox permission list, pre-filled. Cancel / "Save access".

---

### 4.7 Team (`/team`) — CREATOR only
- Header: title **"Team"**, subtitle **"People helping manage your pages and links."** Non-creator fallback: "Team management is available to Creator accounts."
- Action: **"Add member"**. Table: User ID · Can see money (Yes/No) · Added. Empty: "No team members added yet."

**Add a team member modal:** "Team member's user ID"* (their account must already exist as role Team Member), checkbox "Can see invoices and payment amounts". Cancel / "Add member".

---

### 4.8 Job runs (`/job-runs`) — ADMIN only
- Header: title **"Job runs"**, subtitle **"node-cron execution history — the substitute for a job queue's built-in observability."** Non-admin fallback: "Job run history is available to Admin accounts."
- Actions: **"Run finance export now"**, **"Run Sheet export now"** — manual triggers, no confirm dialog. Success banners link out to the pushed GitHub commit / Google Sheet.
- Table: Job · Status pill (success/failed/running) · Started · Finished · Error. Empty: "No job runs recorded yet."

---

### 4.9 Profile (`/profile`)
- Header: title **"Profile"**, subtitle **"Your details, contact info, and billing identity."** Tabs: **Profile** / **Billing profiles**.

**Profile tab:**
- "Contact details" card — Name, Phone (registered, read-only), Email, Secondary phone ("For WhatsApp invoice alerts"), Address (line 1/2, State, Pincode). "Save changes" → "Saved."
- "Change password" card — Current password, New password, a live rule checklist (8+ characters / one uppercase / one lowercase / one number / one special character). "Change password" (disabled until all rules pass) → "Password changed."

**Billing profiles tab:**
- Subtitle differs: reviewers (Admin/Finance) see "Every creator's billing profile, for approval."; everyone else sees "Add at least one approved billing profile to receive payments and raise invoices. Each PAN can only be registered once."
- "Add billing profile" action (non-reviewers). Empty: "No billing profiles yet."
- Card per profile: "{PAN} — {name}" + approval pill; GSTIN / MSME / Bank account number / IFSC code; Approve/Reject for reviewers on pending ones.

**Add Billing Profile modal:** PAN* (forced uppercase, 10 chars), Name on PAN*, GSTIN (optional), MSME number (optional), Bank account number*, IFSC code* (forced uppercase). Cancel / "Add profile".

Mobile only: a full-width "Log out" button at the bottom of this page.

---

## 5. Status enums & meaning

Every status renders as a colored pill; a "live" status additionally gets a pulsing dot — meaning it's still awaiting someone's action.

### Link status
| Status | Label | Color | Live? | What it means |
|---|---|---|:---:|---|
| `SUBMITTED` | Submitted | slate | | Creator posted a link; no proof screenshot yet. |
| `PENDING_SCREENSHOT_REVIEW` | Pending review | violet | ● | Screenshot uploaded, waiting on admin approve/reject. |
| `SCREENSHOT_REJECTED` | Rejected | rose | | Admin rejected the screenshot; creator must re-upload. |
| `SCREENSHOT_APPROVED` | Approved | emerald | | Proof accepted — link becomes invoiceable. |
| `INSIGHTS_PENDING` | Insights pending | blue | ● | Engagement metrics scraped, not yet admin-approved; still invoiceable. |
| `INSIGHTS_APPROVED` | Insights approved | emerald | | Metrics reviewed and approved. |
| `INVOICED` | Invoiced | violet | | On a raised invoice — cost locked unless that invoice is rejected. |
| `INVALID` | Broken | rose | | Admin confirmed the post is dead/broken — soft flag, excluded from campaign spend. |

**A link is invoiceable at `SCREENSHOT_APPROVED`, `INSIGHTS_PENDING`, or `INSIGHTS_APPROVED`** — the screenshot is the real gate; insight approval is *not* required to invoice.

### Invoice status
| Status | Label | Color | Live? | Meaning |
|---|---|---|:---:|---|
| `DRAFT` | Draft | slate | | Not yet raised. |
| `RAISED` | Raised | blue | ● | Submitted, awaiting approve / reject / mark-paid. |
| `APPROVED` | Approved | emerald | | Confirmed correct, awaiting payment. |
| `REJECTED` | Rejected | rose | | Kicked back with a reason — its links revert and become re-invoiceable. |
| `PAID` | Paid | emerald | | Settled — terminal. |

### Payment status
`PENDING` (slate, ●) → `COMPLETED` (emerald) / `CANCELLED` (rose).

### GST status
One-way progression: `PENDING` (slate, ●) → `SCHEDULED` (violet, ●) → `COMPLETED` (emerald), advanced manually via "Advance GST to…".

### Plan status
`DRAFT` (being assembled) → `PENDING_APPROVAL` (submitted, awaiting sign-off — visually borrows the "Scheduled" look) → `APPROVED` (ready to send) or `REJECTED`.

### Derived/other statuses
- **Overdue** (rose, ●) — computed client-side from an invoice's due date, not a stored field.
- **Job run**: `running` (blue) / `success` (emerald) / `failed` (rose).
- **Asset / billing-profile approval**: plain `pending` → `approved` / `rejected` (not the shared pill component, but same color logic).

---

## 6. Data model glossary

Core entities and the fields a designer will encounter in the UI (tables, forms, detail panels):

- **User** — phone number, name, email, secondary phone, address (line 1/2, state, pincode), role, permission overlay (admins only).
- **BillingProfile** — PAN (unique), name on PAN, GSTIN, MSME number, bank account number, IFSC code, approval status.
- **TeamMembership** — a team member's link to their creator, plus whether they can see money.
- **Asset ("Page")** — platform (Instagram), handle, followers, category, approval status, rate cards, performance snapshots.
- **RateCard** — one page's per-format price (format is free text, conventionally reel/story/carousel/collaboration/video).
- **Campaign** — brand name, title, deadline, cost cap, sheet link, phase number/grouping; derived: post count, representative post, total likes, spent, remaining budget, pending-assignment count.
- **CampaignAssignment** — one row from an imported sheet/CSV: page handle, creator phone, post URL, format, cost, matched/pending status.
- **Link ("Post")** — campaign, page, submitter, URL, format, cost (+ "custom rate" flag), status, posted date; relations: screenshot, engagement snapshots, invoice item, status history, cost-revision history.
- **LinkCostRevision** — previous/new cost, note, who changed it, when.
- **Screenshot** — the uploaded proof image, reviewer, approved true/false/null.
- **PostSnapshot** — likes, comments, video views/plays, saves, shares, reposts, thumbnail, caption, capture time.
- **Invoice** — invoice number, amount, subtotal, GST flag/amount, status, payment status, GST status, rejection remarks, due date, paid date; derived: overdue days.
- **InvoiceItem** — one link's amount on one invoice.
- **Notification** — type, payload, read/unread, created time.
- **JobRun** — job name, status, started/finished, error.
- **Plan** — name, client name/contact/company/GST/address, notes, budget, GST flag, status, creator, pitch-group id + variant label (Plan A/B), client-facing overrides (followers/posts/impressions/cost), generated client sheet URL; derived: total cost, budget variance, expected engagement, computed overview numbers.
- **PlanItem** — one page's inclusion in a plan: format, internal cost, optional client-facing cost override, posts per profile.

---

## 7. Notifications / feedback patterns

**There is no toast/snackbar system in the current app** — no ephemeral pop-up confirmations anywhere. This is worth deciding on deliberately for the redesign (the current patterns below are what exists today, not necessarily what should ship):

1. **Persistent inline error banner** — a small colored banner directly under the form/action that failed, with either the server's error message or a fallback in the pattern "Couldn't {verb} {noun}." (e.g. "Couldn't create the campaign.", "Couldn't save your profile.").
2. **Inline success text** — small confirmation text left in place after a successful save, e.g. "Saved.", "Password changed.", "Metrics updated."
3. **The real "notification" surface** is the bell icon / More-sheet list, polled roughly every 30 seconds — a persistent, dismissible feed rather than a toast. Empty state everywhere: **"No notifications yet."**
4. **In-modal success screens** — several flows (New Invoice, Reset Password, Create User, Resolve Pending Assignments) end in a dedicated success screen inside the same modal rather than closing and toasting, especially anywhere a one-time secret (a generated password) has to be shown.
