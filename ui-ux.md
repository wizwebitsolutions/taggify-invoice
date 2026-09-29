# Taggify — Product UI/UX Requirements (V1)

> **How to read this.** This document describes what the product must do, who
> does it, what information is involved and which rules apply. It deliberately
> says nothing about layout, navigation style, components or visual treatment —
> those are yours to design. Where a section lists "information to show" or
> "actions", treat it as a checklist of *content and capability*, not as a
> layout or an order.

---

## 01. Product overview

**What it is.** Taggify is the operations layer for an influencer-marketing
agency that runs paid campaigns on Instagram meme/content pages.

**Who uses it.** The agency's own team (admins, finance staff, campaign
planners) and the outside page owners it pays (creators, plus people who work
for them).

**What problem it solves.** One campaign involves a pitch to a brand, a list
of pages, dozens of posts going live, proof that each post happened, the
performance numbers, and money flowing two ways: the client pays the agency,
and the agency pays each page owner. Today this runs on spreadsheets and chat.
Taggify tracks each post from first pitch to final payment, and keeps both
sides of the money in step.

**Major modules**

- **Plans:** proposals for a client, built from a catalogue of pages.
- **Campaigns:** what an approved plan becomes, where posts are tracked.
- **Posts (links):** each live post, with its proof and performance.
- **Inventory:** the catalogue of pages, with their prices and audience numbers.
- **Invoices (payables):** bills creators raise to the agency.
- **Receivables:** invoices the agency raises to its client.
- **Payments:** the agency paying creators.
- **People & access:** accounts, roles, permissions, teams.
- **Billing profiles:** creators' tax and bank details.
- **Notifications and background automation.**

**Primary journey (end to end)**

Planner builds a plan for a client → the plan is approved and becomes a
campaign → creators publish posts and submit their links → the agency verifies
the proof and the numbers → the creator invoices the agency (or Finance pays
them directly) → Finance pays the creator with a receipt → the agency invoices
the client and records the client's payment.

---

## 02. User roles & permissions

There are five roles. Access for each role is built from **17 permission
switches** (view / edit / approve / pay per area), so two people with the same
role can have different access. The UI must work for any combination of these
switches, not just the defaults below.

**The permission switches**

| Area | Switches |
|---|---|
| People | `users.view`, `users.edit` |
| Campaigns | `campaigns.view`, `campaigns.edit` |
| Inventory | `inventory.view`, `inventory.edit`, `inventory.approve` |
| Posts | `links.view`, `links.edit`, `links.approve` |
| Finance | `finance.view`, `finance.edit`, `finance.approve`, `finance.pay` |
| Plans | `plans.view`, `plans.edit`, `plans.approve` |

There are two kinds of access:

- **Global access** (Admin, Finance) covers every record in an area.
- **Own-content access** (Creator, Team member, Planner) only ever covers the
  person's own records: their own pages, their own plans, their own invoices.
  An admin can switch individual areas off for a specific person.
  `finance.pay` is never own-content: paying someone else is always a global
  permission.

**Role summary (defaults)**

| Role | Can view | Can create | Can edit / act | Can approve | Notes |
|---|---|---|---|---|---|
| **Admin** | Everything | Everything, including accounts | Everything | Everything | A *sub-admin* is an Admin whose switches have been restricted. Only a full (unrestricted) Admin can create another Admin. Every permission change is audit-logged. |
| **Finance** | All finance, all campaigns, all pages, all posts | — | Invoice GST / payment status | Creator invoices | Pays creators (`finance.pay`). Settles client invoices. |
| **Planner** (Plan Maker) | Their own plans; the campaigns created from them; posts and invoices on those campaigns; the **full page catalogue** | Plans, plan variants, new pages for a vendor (these always start *pending* and never carry a price), plain creator accounts | Their own plans and campaigns (for example, adding phases) | Their own plans | Can attach the client invoice file to their plans. Cannot give anyone extra permissions. |
| **Creator** | Only campaigns their pages are booked on; their own pages, posts, invoices, payouts, billing profiles | Their own pages (start *pending*), post submissions and proof, invoices on their own posts, billing profiles, team members | Their own team | — | Never sees a campaign's total budget, spend or remaining amount, only their own earnings. |
| **Team member** | What their creator allows | Post submissions and proof on their creator's pages | — | — | Whether they can see money amounts is set per team member. |

**What this means for the design**

- Each role, and each switch combination, needs its own home view and a set
  of sections limited to what it can reach.
- An action a user isn't allowed to take should not be presented as available.
- The same record, for example a campaign, shows **different information to
  different roles**: budget for staff, "your earnings" for a creator.

---

## 03. Information architecture (functional areas)

These are the product's capability areas and what belongs in each. How they
are grouped, named and navigated is a design decision.

```
Taggify
├── Home: a different overview per role
├── Plans
│   ├── All plans (filter by planner, status)
│   ├── Plan (create / edit / preview / variants)
│   ├── Client & internal Google Sheet outputs
│   ├── Execution tracking (posted-links sheet)
│   └── Client invoice for the plan
├── Campaigns
│   ├── All campaigns
│   ├── Campaign (overview, phases, booked pages, posts, invoices)
│   └── Phase / extra-post management
├── Posts (links)
│   ├── All posts (by status, page, campaign, date)
│   ├── Post (proof, performance, history, cost)
│   ├── Submit posts
│   └── Bulk import of completed work (admin)
├── Inventory
│   ├── Page catalogue (filter by category, owner, audience size)
│   ├── Page (profile, audience, engagement, prices, campaigns)
│   ├── Add a page
│   └── Import pages from a spreadsheet
├── Money
│   ├── Payables: creator invoices
│   ├── Receivables: client invoices
│   ├── Payments: pay creators, payment history
│   └── Dues overview
├── People
│   ├── All users
│   ├── User (role, permissions, email, password reset)
│   ├── Create user / sub-admin
│   └── My team (for creators)
├── Billing profiles (tax & bank details)
├── Notifications
└── Settings & integrations
    ├── Google account connection (Sheets)
    ├── Client invoice numbering
    └── Finance exports
```

---

## 04. User flows (business workflows)

These are the real sequences of work. The screens exist to support them.

### Flow A: Pitch to approved plan (Planner / Admin)

```
Client brief arrives
      ↓
Planner creates a plan: client details, optional budget, GST choice
      ↓
Adds pages from the catalogue (or uploads a spreadsheet of pages)
   · per page: content format (reel / story) and number of posts
   · each page has an internal cost; a separate client price is optional
      ↓
System totals followers, posts, expected impressions, cost, GST
   · planner may override the client-facing totals
      ↓
(Optional) creates Plan B / Plan C variants for the same client
      ↓
Generates a client Google Sheet (public link) and/or an internal one
   · the sheet stays in sync with every later edit
   · each variant shows as Active (approved) or Not active
      ↓
Client picks a variant → planner or admin APPROVES it
      ↓
A campaign is created automatically with every page booked
   (a page booked for 3 posts becomes 3 post slots)
```

### Flow B: Campaign execution (Creator ↔ Admin)

```
Creator sees a campaign only once one of their pages is booked on it
      ↓
Creator sees how many posts each page owes ("1 of 2 posts up")
      ↓
Posts on Instagram, submits the post URL(s) for that campaign + page + format
      ↓
(Optional proof) uploads a screenshot → admin approves or rejects it
      ↓
System scrapes the post's performance (views, likes, comments)
      ↓
Admin approves the insights
      ↓
Post is ready to bill
```

The screenshot and insights steps are optional: a post can be invoiced as soon
as it is submitted. Only an admin's explicit rejection, or marking a post
invalid, blocks billing.

### Flow C: Creator invoices the agency (Creator → Finance)

```
Creator selects their billable posts (all must be their own pages)
      ↓
Chooses GST invoice (18% added) or non-GST, and a due date
      ↓
Invoice RAISED → Finance APPROVES (or REJECTS with a reason)
   · rejecting releases the posts so they can be invoiced again
      ↓
Finance pays it (Flow D) → invoice becomes PAID
```

### Flow D: Finance pays a creator

```
Finance reviews everything owed, across all creators
      ↓
Picks ONE creator: any mix of un-invoiced posts and approved invoices
      ↓
Sets GST (applies to un-invoiced posts only) and TDS withheld (none / 1% / 2% / 10%)
      ↓
Reviews the net payable
      ↓
Enters paid-on date and bank reference (UTR), attaches the payment RECEIPT (required)
      ↓
Payment recorded as PAID
   · un-invoiced posts get an invoice created for the creator automatically, already PAID
   · selected invoices are marked PAID
   · the creator is notified
```

If the receipt step is not finished, the payment stays as a **draft** that
holds those posts. It can be finished later or cancelled, and cancelling
releases the posts.

### Flow E: Agency invoices the client (Receivables)

```
Plan approved and work delivered
      ↓
Staff generate a client invoice from the plan (auto-numbered; HSN/SAC; description)
      ↓
Attach the final invoice document
      ↓
Client pays → Finance records it as PAID (amount received + remarks)
   or CANCELS it (with a reason)
```

### Flow F: Page onboarding

```
Admin adds a page (or imports many from a spreadsheet) under a creator account
   · followers, profile picture, name and bio are fetched from Instagram automatically
   · admin sets a category and prices (reel / story); admin-added pages are approved at once
Creator or Planner adds a page → it starts PENDING → admin approves or rejects
```

### Flow G: Account access

```
Admin creates an account with an email (phone optional)
   → a one-time password is shown once, to be passed to the person
      ↓
Person signs in with email + password → receives a one-time code by email
      ↓
Enters the code → signed in (their email counts as verified from then on)
   · can choose to remember the device for 7 days (no code on that device during that time)
```

---

## 05. Screen inventory (checklist of needs)

These are the places where each piece of work has to happen. They are not a
prescription for separate pages: the designer decides what gets combined.

**Access**
- Sign in (email + password)
- Enter one-time code, and resend it
- Verify email address
- Change password
- Session expired / sign in again

**Home (per role)**
- Admin overview
- Finance overview
- Planner overview
- Creator overview
- Team member overview

**Plans**
- Plan list
- Create / edit a plan (client details, pages, pricing, preview)
- Create a plan from an uploaded spreadsheet (with unresolved rows)
- Plan variants (A / B / C) for one client
- Plan preview (client view vs internal view)
- Google Sheet generation and links
- Execution sheet: connect it and sync posted links
- Approve / reject a plan
- Client invoice: generate, attach the document, view

**Campaigns**
- Campaign list
- Campaign (summary, phases, booked pages, posts, invoices)
- Add / delete a phase
- Resolve an unmatched booked page

**Posts**
- Post list (filters)
- Post (proof, performance, status history, cost history)
- Submit post links (one or many)
- Upload screenshot proof
- Review screenshot (admin)
- Approve insights (admin)
- Revise cost (admin)
- Mark invalid (admin)
- Bulk import completed work (admin)

**Inventory**
- Page catalogue
- Page (profile, engagement, prices, campaigns, owner)
- Add a page
- Import pages (upload, preview and resolve rows, confirm)
- Edit category, engagement and prices
- Approve / reject a pending page
- Refresh a page's profile from Instagram

**Money**
- Creator invoices list
- Creator invoice (detail, PDF, post list)
- Raise an invoice (creator)
- Approve / reject an invoice
- Client invoices (receivables) list
- Record client payment / cancel a client invoice
- Payments: what's owed (by creator)
- Pay a creator (with receipt)
- Payment history
- Unfinished (draft) payments
- Attach a missing receipt to an older paid invoice
- Dues overview (totals)
- Creator's own payments view

**People**
- User list
- User (role, permission switches, email, password reset)
- Create user / sub-admin
- Creator's team (add or remove members, money visibility)

**Other**
- Billing profiles (create, edit, approve)
- Notifications
- Settings: Google connection, invoice numbering, finance export

---

## 06. Screen requirements (content and actions)

For each area: the information it must show and what the user must be able to
do.

### Plan

**Information**
- Plan name and variant (Plan A / B / C)
- Status
- Who created it, and when
- Who approved it, and when
- Client: name, contact, phone, company, GST number, address
- Notes (these appear on the client sheet)
- Budget, and how far over or under it the plan is
- GST percentage
- Pages in the plan. For each page:
  - handle, category, followers
  - format
  - posts per page
  - internal cost per post
  - client price per post, if different
  - average views
- Totals:
  - followers, posts, expected impressions
  - subtotal, GST, total
  - both the calculated and the overridden client-facing figures
- Links to the client sheet and the internal sheet, and whether each is up to
  date with the latest edit
- Execution sheet: its link, when it was last read, and rows it could not use
  (with reasons)
- Linked campaign (once approved)
- Client invoice (once generated)

**Actions**
- Edit client details, pages, pricing and notes
- Add pages from the catalogue or a spreadsheet
- Remove a page
- Change format or posts per page
- Override the client-facing totals
- Create a variant
- Generate or open the client / internal sheet
- Download PDF
- Approve / reject
- Connect / refresh the execution sheet
- Generate the client invoice
- Attach the client invoice document

**Rules that affect this screen**
- An edit that pushes the plan over its budget is refused.
- The client never sees internal cost. Only the client price (or internal cost
  where no client price is set) and client-facing totals are client-safe.
- Variants are independent copies; editing Plan A never changes Plan B.

### Campaign

**Information**
- Brand and title
- Deadline
- Budget cap, spent and remaining (staff only). Creators see **their own
  earnings** instead.
- Phases (Phase 1, 2, ...), and extra posts within a phase ("Post 2" of a page)
- Booked pages. For each:
  - handle
  - creator contact (staff only)
  - whether it is matched to a real page or still pending
  - whether a post has been attached
- Per page: posts booked vs posts submitted
- Posts on the campaign, with their status
- Invoices containing posts from this campaign
- Total likes across posts
- Number of posts (only posts within the booking count)

**Actions**
- Add a phase
- Delete a phase (only when it has no posts)
- Resolve a pending booked page to a real page
- Submit posts (creator)
- Open invoices
- Approve or pay invoices (per permission)

**Creator-specific**
- A creator sees each post row as its own numbered phase ("Phase 1", "Phase 2",
  "Phase 3"), not the staff grouping.
- A creator never sees other creators' contact details or bookings.

### Post (link)

**Information**
- URL, page, campaign / phase, format
- Cost (and whether it was a custom negotiated rate)
- Status, and the full status history with who did what and when
- Screenshot proof and its review result
- Performance: views, plays, likes, comments, saves, shares, reposts,
  thumbnail, caption
- Posted date
- Cost revision history
- Which invoice or payment it is on
- Whether it is **over the booked limit** (and so won't be paid)

**Actions**
- Upload screenshot (creator)
- Approve / reject screenshot (admin)
- Refresh performance
- Approve insights (admin)
- Revise cost (admin, with a reason kept in history)
- Mark invalid (admin, with a reason)

### Submit posts (creator / team member)

**Information**
- Campaigns (and phases) the person's pages are booked on
- Pages booked on the chosen campaign
- For the chosen page: posts booked, posts already submitted, posts still to
  upload
- A clear warning when over the limit ("5 posted, only 2 booked; the extra 3
  won't be paid")
- Formats, and whether a price is set for each
- The URLs being submitted, with a running count

**Actions**
- Choose campaign, page and format
- Paste one or many URLs
- Submit
- See which URLs were created and which were skipped, with the reason for each

### Page (inventory)

**Information**
- Handle, platform, profile picture, display name, bio
- Category
- Followers
- Engagement: average likes, comments and views. For each figure, show
  whether it was scraped or entered manually, and the sample size it came from.
- Prices per format (reel, story)
- Owner
- Approval status
- Campaigns it has been part of
- Profile fetch status:
  - fetching
  - last fetched
  - failed, with the reason (for example private account or wrong handle)

**Actions**
- Edit category
- Enter or clear engagement figures (a cleared figure goes back to the scraped
  number)
- Edit prices
- Approve / reject (pending pages)
- Refresh from Instagram
- Select pages for a plan

### Import pages

**Information**
- Uploaded rows, each resolved to a result:
  - new page
  - already exists
  - owner found or not found
  - handle invalid
  - price read from the sheet
  - followers fetched live
- Which rows will be created and which skipped, with the reason for each

**Actions**
- Upload a file or paste a Google Sheet link
- Fix or choose the owner per row
- Confirm the import

### Creator invoice (payables)

**Information**
- Invoice number
- Creator (billing name, PAN, GSTIN, bank details from their approved billing
  profile)
- Status, payment status, GST filing status
- Raised date, due date, days overdue, paid date
- Posts on the invoice, each with page, campaign and amount
- Subtotal, GST, total
- The creator's own attached invoice document
- Payment receipt
- Rejection reason
- Whether it contains posts over the booking limit (if so: blocked, must be
  rejected and re-raised)

**Actions**
- Approve
- Reject (reason required)
- Pay (goes through the payment process, Flow D)
- Advance GST filing status
- Download PDF
- Download the post-link list
- Attach / replace / remove the creator's document
- Attach a receipt to an older invoice paid without one

### Raise invoice (creator)

**Information**
- The creator's billable posts:
  - not already invoiced or paid
  - not over the limit
  - on their own pages
- Amounts, GST preview, total, due date

**Actions**
- Select posts
- Choose GST / non-GST
- Set due period
- Preview
- Raise

### Payments (Finance)

**Information**
- Everything owed, grouped by creator:
  - un-invoiced posts
  - approved invoices
  - invoices that can't be paid, with the reason ("already on a payment",
    "over booking")
- Totals:
  - total dues
  - due this calendar month
  - paid this month
  - more than 30 days overdue
- Unfinished (draft) payments that are holding posts
- Payment history. For each payment:
  - date, creator, pages, post count
  - subtotal, GST, TDS, net
  - bank reference (UTR)
  - receipt
  - who paid it
- Older invoices that were paid without a payment record, shown in the
  history with their receipt status

**Actions**
- Filter by creator, page, search and date range
- Select what to pay (one creator at a time)
- Set GST and TDS
- Enter paid-on date and UTR
- Attach receipt
- Confirm
- Finish or cancel a draft
- Attach a missing receipt

### Creator's payments view

**Information**
- Their own dues:
  - total
  - due this month
  - paid this month
  - more than 30 days overdue
- Posts awaiting payment
- Payments received. For each:
  - amount received
  - TDS withheld
  - GST
  - UTR
  - receipt
  - posts covered

### Client invoice (receivables)

**Information**
- Invoice number, plan, client and campaign
- Subtotal, GST %, GST amount, total
- Status (Issued / Paid / Cancelled)
- Issued by, and when
- Amount actually received
- Remarks
- Attached final invoice document

**Actions**
- Record payment (amount and remarks)
- Cancel (reason required)
- Download PDF
- Attach the document

### User / People

**Information**
- Name, email (and whether it is verified), phone
- Role
- Each of the 17 permission switches
- Who created the account
- Audit history of access changes

**Actions**
- Create a user (the one-time password is shown once)
- Change role
- Toggle permissions (including a creator's own-content switches)
- Change email
- Reset password (the new password is shown once)

### Billing profile

**Information**
- Legal name, PAN, GSTIN, MSME number
- Bank account number, IFSC
- Approval status

**Actions**
- Create / edit (creator or admin)
- Approve / reject (Finance / Admin)

### Home overviews (per role)

| Role | Needs to see at a glance |
|---|---|
| Admin | Work waiting on them: screenshots to review, insights to approve, pending pages, raised invoices to approve. Campaign activity. Money owed and paid. |
| Finance | Invoices awaiting approval and payment. Overdue invoices. Dues by page. Paid this month. Pages without a price. Pending billing profiles. Finance export. |
| Planner | Their plans by status. Their campaigns. Pages still pending approval. |
| Creator | Posts added, awaiting proof, approved, invoiced. Amount ready to bill. Money owed and paid. Campaigns booked. |
| Team member | Their creator's posts and proof tasks. Money only if allowed. |

---

## 07. States (apply to every area)

| State | What the user must understand |
|---|---|
| Loading | Data is on its way. The page structure should appear quickly; don't show a blank screen. |
| Empty, never used | Nothing exists yet, plus the one action that starts it (for example "No pages yet. Add a page."). |
| Empty after filtering | Nothing matches the current filters, plus a way to clear them. Must be different from "nothing exists". |
| Error | What failed and a retry. Show the server's own message where it has one: these messages are written for users. |
| Success | Confirmation of what happened, and what changed as a result (for example "3 posts moved to Paid; the creator's invoice was created automatically"). |
| No permission | The person may reach an area their access doesn't cover. Explain why, and who can grant access. |
| Partially successful | Bulk actions (submitting many URLs, importing pages, syncing sheets) can succeed for some rows and skip others. Show each skipped row with its reason. |
| Background work | Some work finishes after the action: page profile fetch, post performance scrape, Google Sheet refresh. The user needs to see "in progress", "done" and "failed". |
| Stale / changed meanwhile | Someone else changed the record, for example an invoice paid or rejected while a payment was being prepared. Explain what changed and what to do next. |
| Blocked by a rule | A record exists but an action is unavailable because of a business rule, for example "over the booking limit" or "needs approval first". Always explain why. |
| Truncated list | Some lists are capped (for example latest 100 or 500). Say when there are more, and how to narrow the list. |

---

## 08. Statuses and business rules

### Post (link) status

```
SUBMITTED ──► PENDING SCREENSHOT REVIEW ──► SCREENSHOT APPROVED ──► INSIGHTS PENDING ──► INSIGHTS APPROVED ──► INVOICED
                        │
                        └──► SCREENSHOT REJECTED ──► (creator uploads new proof)

Any status before INVOICED ──► INVALID   (admin: dead or broken post)
```

- A post can be billed from any status from SUBMITTED to INSIGHTS APPROVED.
  Screenshot and insights are optional proof.
- SCREENSHOT REJECTED and INVALID block billing.
- One URL can be submitted only once per page.
- A creator can submit posts only on campaigns their page is booked on, and
  only for a format that has a price.
- **Post limit:** each page is booked for N posts in a campaign phase. The
  creator may submit more than N, but only the first N (by posted date) count.
  Extra posts are shown but never invoiced, paid, or counted toward spend or
  earnings. A post that has already been paid always keeps its place.

### Plan status

`DRAFT → APPROVED` or `DRAFT → REJECTED`. (`PENDING APPROVAL` exists in the
data, but the planner or admin approves directly.)

- Approving creates exactly one campaign from that plan.
- In a Plan A / B group, the Google Sheet shows the approved plan as **Active**
  and the others as **Not active**.

### Creator invoice status

```
RAISED ──► APPROVED ──► PAID   (via a payment with a receipt)
   │           │
   └───────────┴──► REJECTED   (reason required; posts released to invoice again)
```

- An invoice covers one creator only.
- GST invoice: 18% is added to the subtotal. Non-GST: the subtotal only.
- The due date defaults to 15 days after raising.
- A paid invoice cannot be rejected.
- An invoice sitting on an unfinished payment cannot be rejected until that
  payment is cancelled.
- An invoice with posts over the booking limit cannot be approved or paid. It
  must be rejected and raised again.
- Separate trackers:
  - payment status: Pending / Completed / Cancelled
  - GST filing status: Pending → Scheduled → Completed

### Payment (payout) status

`DRAFT → PAID`, or `DRAFT → cancelled` (the draft is removed and its posts are
released).

- A payment covers one creator only. It is never partial within one invoice,
  but you can pay some items now and the rest later.
- The receipt is required to complete it.
- The paid-on date cannot be in the future.
- Net = subtotal + GST − TDS. TDS is 1%, 2% or 10% of the subtotal, or none.
- GST can be added only on un-invoiced posts. An invoice brings its own GST.
- A post is either on an invoice or on a payment, never both.

### Dues timing

- An un-invoiced post is due 30 days after it was posted (or submitted, if the
  posted date isn't known yet).
- An invoice is due on its own due date.
- "30+ days" means more than 30 days past due.

### Client invoice status

`ISSUED → PAID` (records the amount received) or `ISSUED → CANCELLED` (reason
required). Invoice numbers are generated from a counter that can be
configured.

### Page (inventory) approval

`PENDING → APPROVED / REJECTED`.

- Pages added by an admin are approved immediately.
- Pages added by a creator or planner start as pending, and a planner's pages
  never carry a price.

### Billing profile approval

`PENDING → APPROVED / REJECTED`. Only an approved profile's details appear on
the creator's invoice PDF.

### Engagement numbers

- Scraped automatically:
  - from the page's recent posts
  - or, once the page has posts through campaigns, from those posts
- An admin can enter any figure manually. A manual figure overrides the scraped
  one and survives future scrapes. Clearing it brings back the scraped value.

### Money visibility

- Creators never see a campaign's budget, spend or remaining amount, and never
  see the agency's internal cost.
- Clients (through the shared sheet) never see internal cost.
- A team member sees money only if their creator allows it.

---

## 09. Components & interactions the product needs

These are capabilities, not component designs:

- **Filtering at scale:** by vendor/owner, page (searchable), campaign,
  status, and date range (a month or custom).
- **Multi-select with running totals:** "5 posts selected · ₹42,000".
  - Limited to one creator per invoice or payment.
  - The selection must reset when the user switches to another creator.
- **Money breakdown:** subtotal, GST, TDS, net, recalculated live as options
  change, and matching the server's figures exactly.
- **File upload:**
  - PDF or image
  - drag-and-drop
  - replacing a file keeps the previous one if the new file is the wrong type
  - required vs optional must be clear
- **Spreadsheet import with review:** upload, row-by-row result, fix, confirm.
- **Status history timeline:** who changed what, and when.
- **Confirmation for irreversible or money actions:** pay, reject, delete a
  phase, cancel a payment.
- **One-time secret reveal:** a generated password shown once, with a copy
  action.
- **Background-progress indicators:** fetching, scraping, sheet sync.
- **Notifications:**
  - invoice raised, approved, rejected, paid, overdue
  - payment received
  - screenshot reminder

---

## 10. Empty / loading / error states: key specifics

- **Sign in:**
  - wrong email or password: one generic message (never reveal which was
    wrong)
  - code expired (10 minutes)
  - too many code attempts (5)
  - resending too soon (60-second wait)
  - email delivery not available
- **Google not connected / connection expired:** sheet actions fail. Admins
  need a way to reconnect; other users need to be told to ask an admin.
- **Instagram fetch failed:** private account, wrong handle, or service
  outage. The page stays usable, with a reason shown.
- **Unreadable spreadsheet:** not shared publicly, wrong columns, empty.
- **Nothing to pay / all caught up:** a positive empty state.
- **No billing profile / not approved:** the creator can't be paid properly
  until they have one.

---

## 11. Responsive requirements (assumptions to confirm)

| Width | Priority |
|---|---|
| 1440px desktop | Primary for Admin, Finance, Planner (dense tables, multi-step money work) |
| 1280px laptop | Must be fully usable |
| 768px tablet | Usable for review and approval work |
| 390px mobile | **Must be fully usable for Creators and Team members**: checking bookings and limits, submitting links, uploading proof, raising invoices, viewing payments. Staff need approvals and quick look-ups on mobile. |

Most creators work from their phones, so the creator journey should be treated
as mobile-first even though the staff side is desktop-first.

---

## 12. Design direction & references

*To be filled in by the product owner.* The only guidance here comes from the
nature of the product:

- It's a money and operations tool. Accuracy and scannability of numbers come
  first (aligned figures, clear currency, clear status).
- Staff views are data-dense. Creator views are task-focused.
- Status must be readable at a glance everywhere: posts, invoices, payments,
  plans, pages.
- Currency is **Indian Rupees**, in Indian digit grouping (₹1,00,000).

Reference products and the visual direction are the product owner's call.

---

## 13. Data / API reference

Business workflow comes first; this is for reference only. All endpoints are
under `/api`.

| Area | Key endpoints |
|---|---|
| Auth | `POST /auth/login` · `/auth/login/verify-otp` · `/auth/login/resend-otp` · `/auth/email/start` · `/auth/email/confirm` · `/auth/change-password` · `/auth/refresh` · `/auth/logout` · `/auth/signup` (admin creates an account) |
| Plans | `GET/POST /plans` · `GET/PUT/DELETE /plans/:id` · `POST /plans/:id/approve` · `/reject` · `/variant` · `POST /plans/:id/sheet?variant=client\|internal` · `/execution-sheet/sync` · `/client-invoice` · `POST /plans/from-sheet` · `/:id/import-sheet-pages` |
| Campaigns | `GET/POST /campaigns` · `GET/PUT /campaigns/:id` · `GET /campaigns/:id/assignments` · `PUT /campaigns/:id/assignments/:assignmentId` (resolve) · `POST /campaigns/:id/phases` · `DELETE /campaigns/:id/phase` |
| Posts | `GET/POST /links` · `POST /links/bulk` · `/links/bulk-import` · `/links/:id/review-screenshot` · `/approve-insights` · `/refresh-metrics` · `/mark-invalid` · `PUT /links/:id/cost` · `POST /links/:linkId/screenshot` |
| Inventory | `GET/POST /assets` · `PUT /assets/:id/details` · `PUT /assets/:id/rate-card` · `PUT /assets/:id/approval` · `POST /assets/:id/refresh-profile` · `/assets/import/preview` · `/assets/import` |
| Invoices | `GET /invoices` · `POST /invoices/bulk` · `/invoices/:id/approve` · `/reject` · `PUT /invoices/:id/gst-status` · `/payment-status` · attachment · receipt · `GET /invoices/:id/pdf` · `/links.txt` |
| Receivables | `GET /invoices/client` · `POST /invoices/client/:id/mark-paid` · `/cancel` · `GET /invoices/client/:id/pdf` |
| Payments | `GET /payments/summary` · `/pending` · `/paid` · `POST /payments/payouts` · receipt upload + confirm · `DELETE /payments/payouts/:id` (cancel draft) · creator `GET /payments/me/summary`, `/me/pending`, `/me/paid` |
| People | `GET /admin/users` · `PUT /admin/users/:id/role` · `/permissions` · `/email` · `POST /admin/users/:id/reset-password` · `GET/PUT /users/me` · `GET/POST /users/me/team` |
| Other | `/billing-profiles` (+ `/:id/approval`) · `/notifications` (+ read / read-all) · `/integrations/google` · `/admin/invoice-numbering` · `/admin/finance-export/run-now` |

**Example shapes**

```json
// Post (link)
{ "url": "https://instagram.com/reel/…", "format": "reel", "cost": "5000",
  "status": "INSIGHTS_APPROVED", "postedAt": "2026-09-12", "overQuota": false,
  "asset": { "handle": "memes.daily" }, "campaign": { "title": "Diwali" } }

// Creator's booking for a campaign phase
{ "assetId": "…", "booked": 2, "submitted": 3 }

// Payment totals
{ "subtotal": 20000, "gstAmount": 3600, "tdsAmount": 200, "netAmount": 23400 }

// Dues overview
{ "totalDues": 47000, "dueThisMonth": 12000, "paidThisMonth": 9000, "overdue30": 3000 }
```

---

## Appendix: Edge cases the designer should account for

**Posts**
- The same URL is submitted twice.
- The creator's page isn't booked on the chosen campaign.
- No price is set for that format.
- The creator submits more posts than were booked.
- A post's performance can't be fetched (deleted or private).
- A post is marked invalid after it was expected to be paid.

**Plans**
- An edit pushes the plan over budget.
- A spreadsheet names pages that don't exist in the catalogue.
- The client sheet is shared publicly, and edits must appear in it.
- Several variants exist, and only one gets approved.
- A planner edits a plan they can see but whose sibling variant they can't.

**Campaigns**
- A booked page is still pending (not matched to a real page).
- Deleting a phase that already has posts.
- A campaign has many phases and extra posts per page.

**Money**
- An invoice is paid or rejected by someone else while a payment is being
  prepared.
- The receipt upload fails partway (the payment is left as a draft).
- An older invoice was paid without any receipt.
- A creator has no approved billing profile.
- An invoice contains posts over the booking limit.
- One creator owes many small amounts across many campaigns.
- Very long lists (hundreds of posts) where only the latest are loaded.

**Access**
- An account whose email isn't verified yet.
- The one-time code never arrives.
- Someone's permissions are reduced while they are signed in.
- A sub-admin with only some sections switched on.
- A team member whose money visibility is off.

**Integrations**
- The Google connection expires.
- The Instagram data service is down.
- The email service is not configured.
