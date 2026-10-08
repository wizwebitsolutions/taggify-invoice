1. campaign should show photo thumnail of the reel, caption, engagment if single reel is there on campaign or in multiple pick any 1, any show photo of reel, caption, and total likes of all posts
2. all finance data should be stored in excel sheet every day, to be modified and push in github repo daily automatically
3. snapshot or insights should not be mandatory for creators or team to generate invoice
4. in invoice generation 
    -option pick date ratnge and searching campaign 
    -after it preview of how invoice will look like and total billing amount, option of attaching 2 invoice generation, 1 is gst invoice, on attaching it will automatically add 18%gst to amount, 2. non gst
5. on admin side, it's not revenue graph, it's expenditure change the name only 
6. on users page, on creation there will be 1 minimum page mandatory while creating for user 
7. can add multiple pages from there only as well, and rate card accordingly set, 
8. in campaigns while creating total cost cap, option of attaching google sheet link or excel sheet of all pages or users to whom this campaign will be visible, if creator or page not availaible in our database, in next step show them as pending and option to create all these users and alongside password view toggle option for admin, admin will have password of all creators
admin can also add google sheet or excel of work likes campagins and which page posted it, their finance part, so accordingly it will reflect in app and update in database, 
9. data of money remaining for campaign  
10. campaigns can have cost revise as well for individual pages as well 
11. link and users if not matched approval from admin for creation and campaign 
12. when creating page option for marking them in category like meme page, news page, etc then category in multiple page creation option of selecting them under category 
13. inventory section in which we'll generate plan that could be sent to client in pdf format, it's working is:- 
    -client details budget, plan name, category selection of pages, cost calculation, expected engagement cost calculation extra cost or less cost 

8 sept, 2026

i'm listing some changes in app, u've to categories and understand all the changes first, what u understood, ur plan and what this app goal is delievering, improvements features that might require according to u 

Went through both handwritten photo sets (WhatsApp zips, 11:07 AM and 12:09 PM) —
the 12:09 PM one is a cleaner second pass over the same ground, so it's the
primary source below; the 11:07 AM set only adds a couple of things not repeated
in the second pass (called out at the end).

WHAT I UNDERSTOOD, CATEGORIZED

Bugs
- Scroll on the invoice page doesn't work.
- A posted link shows as "not working" — need a way to see/remove such links,
  their cost, and anything tied to them, not just a silent broken state.
- Duplicate users showing up under a page (inventory asset) — separately, one
  user legitimately having multiple pages is intentional, not the bug; the bug
  is duplication, not multiplicity.

Campaigns — phases
- A campaign should support multiple phases: e.g. if a 2nd batch of posts needs
  adding to the same brand deal later, that becomes "Phase 2" of the existing
  campaign rather than a brand-new campaign.

Plan vs Inventory — confirmed as two deliberately separate things
- Inventory = the registry of pages/assets, with types/categories (meme, news,
  etc.) — matches what's already built (assets module + /inventory page).
- Plan = a pitch document built from inventory pages for a client — also
  already built (plans module). The note explicitly says "both are diff" —
  so the /assets vs /inventory pair in the client is intentional, not the
  leftover duplicate I'd flagged before.
- there'll be inventory tab->  all pages, listed category wise, etc, selection of pages, option of create a plan , assets tab will be removed

Roles & permissions (the biggest change being asked for)
- New role: Plan Maker / "Planner (POC)". Makes multiple plans; dashboard =
  Dashboard + Inventory + Plan-create; approves attach-sheets, approves plans he created as well; can attach
  pages/sheets. seperate dashboard for plan maker, which plan worked their analysis, etc
- Admin: add/delete inventory, set cost, sees everything; gets a *toggle*
  for permissions — i.e. admin-configurable access per role/user, not just
  the 4 fixed roles branching in code today., will see everything, and have power of changing everything, even approving plans
- Finance role: only sees the finance slice — pending-post-for-cost, money
  given/taken, approvals; campaigns + inventory, page-wise total dues/paid. seperate dashboard for finance 
- Cost visibility splits in two: the actual/internal cost, and a separate
  cost shown on the client side — admin can revise the client-facing number
  independently of the real one (i.e. markup/margin control).
- Dashboard content should vary by role AND by this new accessibility/
  permission layer, not just by role name.

Cost / approvals
- Plan → Approve campaigns (an approval step between plan and live campaign).
- Admin can revise the cost that's visible to the client.
- Admin-side view: total profit / campaign analysis.

Campaign ↔ creator visibility
- Attached sheet/links for a campaign should be visible to *all creators
  listed in that sheet*, not just admin/finance (this matches what the first
  note set also said).
- If a post link is already mentioned in the attached sheet, it should get
  added directly to that creator's posts — and an invoice should be
  generatable straight from that.
- creator can't create plans

Inventory scale, import, refresh
- Should scale to ~1000 pages, organized name-wise, categories tabs and category selection ; supports Google Sheet
  link upload (not just CSV).
- Under one user account: can attach a sheet of up to 100 pages; user detail
  fields = name, company, contact.
- Two distinct refresh cadences, previously ambiguous to me — now clear:
  - Inventory stats (follower/engagement via Apify) refresh every 30 days.
  - An attached sheet's own refresh (re-pull latest rows) every ~2 hours.

Not repeated in the 12:09 PM set, but present in the 11:07 AM set (still open)
- A "Taggify" vs "Inventory Manager" role distinction was sketched but the
  note itself asked "[Creator] → kya karega" (what will Creator do?) — i.e.
  this wasn't decided even by the person writing it. Needs a direct answer
  before I build any role/permission changes around it.
- "Improve UI" next to an illegible name — couldn't recover a concrete ask.

WHAT THIS APP'S GOAL IS DELIVERING (as I read it from the code + these notes)

Taggify is the ops layer for an influencer/creator marketing agency: it
replaces spreadsheet-tracking of sponsored posts across many pages/campaigns
with one system that carries a post from campaign assignment → link
submission → screenshot/insight verification → invoicing → payout, backed by
an inventory of the pages being monetized (with rate cards) and a plan/pitch
tool to quote new client work off that inventory. This round of notes is
mostly about *who gets to see and touch which part of that pipeline* — a
real role/permission system, and a real internal-vs-client cost split —
rather than new pipeline stages. The pipeline itself isn't changing; the
access model around it is.

MY PLAN (suggested order — smallest/safest first, per this repo's own
"several small single-purpose changes" rule in CLAUDE.md)

1. Bugs first, independently, one PR each: scroll-invoice, posted-link
   not-working (+ show/remove), duplicate-user-under-page. Each gets its own
   regression test per test.md before being called done.
2. Campaign phases: additive data-model change (a phase concept on/under
   Campaign) — doesn't touch existing single-phase campaigns' behavior.
3. Plan cost split: add a second, client-facing cost field alongside the
   existing internal cost on plan line items; PDF export must only ever
   render the client-facing one (see risk note below).
4. Attach-sheet refresh (2h cron) and inventory-stats refresh alignment
   (confirm ASSET_PROFILE_RESCRAPE_CRON, currently daily, should move to the
   30-day cadence described here — or if daily was already a deliberate
   choice, keep it and treat "30 days" as about something else).
5. Campaign-sheet visibility to listed creators + auto-attach a mentioned
   post link to that creator's posts.
6. Roles/permissions overhaul last, and only after a scoping conversation —
   this is the one genuinely architectural piece (new Role enum value(s)
   and/or a move from fixed-role branching to a real permission-table model,
   touching auth, every role check in both client and server, and existing
   data). Doing this last means the smaller items above land and get used
   before the biggest, riskiest change goes in.

SUGGESTED IMPROVEMENTS (my own additions, not in the notes)

- Once a client-facing cost exists alongside the real cost, add an explicit
  safeguard (not just "remember to use the right field") so the internal
  number can never render in a client-sent PDF or the sheet a creator sees —
  two adjacent cost fields in one form is exactly how that leaks by accident.
- If admin permissions become toggleable per role/user, log who changed
  whose access and when — this app gates who can see money figures, so that
  audit trail matters the first time someone asks "who gave X visibility
  into Y."
- The existing Google Sheet importer (campaigns/service.js, bugs.md #6) is
  CSV-export-only and capped at 5MB, built for campaign page-assignment
  rows — scaling inventory to 1000 pages via sheet upload is a different
  shape of import (page/rate-card data, not campaign assignments) and
  probably needs its own importer in the assets module rather than reusing
  this one as-is.
- Campaign phases raise a billing-granularity question the notes don't
  answer: does an invoice bill per-phase or roll up the whole campaign?
  Worth deciding before the data model is built, since retrofitting it after
  invoices exist is much harder than deciding it up front.

UPDATE — same day, after inline edits above + sub-admin/finance-sheet message

Read your inline edits above (assets tab being removed into Inventory,
Plan Maker approving his own plans + a separate dashboard with his plans'
analysis, Admin able to override/approve any plan, Finance getting its own
dashboard, creator can't create plans, inventory category tabs). Folding
those into "MY PLAN": the roles work (step 6) now also covers retiring
/assets into /inventory, and building 3 separate dashboards (Admin,
Finance, Plan Maker) instead of just gating one dashboard by role — bigger
than originally scoped, still last in the order for the same reason
(smaller pieces land first).

Sub-admin
- Admin can create Sub-admins, each with a hand-picked selection of what
  they can see/access — so the "permission toggle" isn't just per fixed
  role, it's a genuine per-account permission set admin assigns at
  creation. Open question I can't resolve from the notes: is Sub-admin a
  new Role enum value, or an ADMIN account with a restricted permission
  set layered on top? The latter is the less invasive migration — flagging
  for a decision before schema work starts here.

Finance data → Google Sheets (supersedes item #2's "Excel pushed to
GitHub" — that part is already built: financeExport.js, FINANCE_EXPORT_CRON)
- Finance data should be saved into a Google Sheet daily, not (or not only)
  an Excel file pushed to GitHub. This is the live "connect + modify a
  Google Sheet" capability discussed earlier today, now confirmed as a
  real target: the existing sheet integration (campaigns/service.js) is a
  read-only public-CSV-export trick and can't write, so this needs the
  real Sheets API with a service account (steps for that are in this
  conversation, not repeated here). Whether this *replaces* the GitHub
  export or runs alongside it is worth confirming rather than assuming.

Example Plan Google Sheet (link shared) — confirms Plan's real shape
Opened https://docs.google.com/spreadsheets/d/1Pm6H1djQxTPoaI5ria51-Sbk1C7ldbAROonerQGBwjE
("ICCPL <> Taggify"). Structure found:
- One pitch = a pair of tabs per option — "Overview of Plan A" + "Plan A",
  "Overview of Plan B" + "Plan B" (two competing packages sent in one doc).
- "Overview of Plan X": Taggify-branded header, then a summary table —
  Total Followers Targeted Overall, Total Posts, Expected Impressions,
  Cost, GST (18%), Total Cost — plus a Notes block: prices exclusive of
  GST, valid for 20 days, and an availability disclaimer ("accounts
  subject to availability... suitable and equivalent replacements will be
  provided" if one drops out before execution).
- "Plan X": the actual page selection, grouped into named category
  sections — this example has "Amplification Pages" (70 pages),
  "Coverage Handles", and "Podcast Pages" (20 pages) — each section its
  own mini-table: S No, Page Name, Page Link, Followers, Post Per Profile.
- Important mismatch with what's already built: cost here is NOT per-page
  — it's one total for the whole plan (Overview tab), and each page
  carries a "Post Per Profile" count instead of a per-item cost. The
  current Plan schema (planItemSchema: assetId + format + cost per line)
  is priced per-item. Needs a decision: does the new Plan feature adopt
  this sheet's category-grouped/aggregate-cost-with-GST shape, or keep
  per-item costing and only change how it's grouped/displayed?


22 sept
bugs:-

1.creators are able to see team?, and top of it's written admin, why it's written md, also a user can see see their creator's pages or their team memeber they've added or can add

8 oct
bugs-
1.on sheet generation there should be edit access to that email as well who's generating sheet
2. followers should show in million or in k
3. option of selecting both story and reel for selected page
4. connected google sheet expire is showing after every 7 days on sheet generation, how to make it permanent, write solution in md file or if by code do it yourself

the changes should be implemented in nice ui/ux nothing messed, easy to use 