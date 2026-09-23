# Testing & the verify-and-fix loop

Why this file exists: the recurring problem on this project was tasks that looked
finished but weren't — broken/misdirected links, flows that didn't actually work,
regressions in things adjacent to what changed — caught only by manual click-through
after the fact, then re-prompting, then re-testing. This file documents the process
that replaces most of that manual pass with automated verification, what it actually
costs, and the conventions for extending it. The short policy version lives in
`CLAUDE.md` — this is the detail behind it.

## Current coverage

- **`server/`** — `vitest`, mocked-Prisma unit tests (no DB needed to run these; see
  `npm test`):
  - `src/modules/invoices/service.test.js` — invoice eligibility (a bare SUBMITTED
    link is enough — screenshot and insights are both optional proof; only
    SCREENSHOT_REJECTED/INVALID/already-invoiced are excluded), GST math (exactly 18%
    on the subtotal, `amount = subtotal + gstAmount`), and that rejecting an invoice
    restores each link to its *actual* prior status (falling back to `SUBMITTED`).
  - `src/modules/campaigns/service.test.js` — the campaign-card preview picks the most
    recently posted link with a thumbnail, falls back gracefully when none has one yet,
    and excludes Apify's `-1` "unknown" sentinel from the total-likes sum.
  - `src/modules/assets/service.test.js` — only an admin can register a page on
    someone else's behalf (the "create a user with their first page(s)" flow); a
    creator can still only ever create their own.
  - `src/modules/assets/importParser.test.js` — Inventory "Import pages" (14
    Sep): the .xlsx/.csv parser, pure. Handles pasted as "@handle" or a profile
    URL, "1.2M"/"1.5L" follower counts, quoted CSV cells + BOM, a title row
    above the header, no handle column, the 500-row cap, unsupported/legacy
    file types, and a *real* exceljs round-trip for the xlsx path.
  - `src/modules/assets/importAssets.test.js` — the preview/confirm half:
    owner cell → creator account (phone in any formatting, then email, then
    exact name; two creators with the same name is "ambiguous", not a guess),
    per-row status (ready / duplicate-in-sheet / exists under same account /
    conflict under another account / owner missing or unknown / invalid), and
    that confirm re-validates and skips-not-fails bad rows; a pasted Google
    Sheet link goes through the same fetch helper as campaigns/plans and the
    same parser/preview. `fetchImportFollowers` batches the previewed
    handles into ONE Apify run (null per private/missing profile, a 502 on
    outage that the modal shows without blocking), and a confirmed import
    stores that scrape directly instead of re-scraping. `src/lib/
    apifyClientBatch.test.js` (mocked apify-client) pins that a run still
    RUNNING after the wait is aborted and thrown (never read as "not
    found"), batches go out in chunks of 25, and one failed chunk only
    leaves its own handles unknown. Also (14 Sep,
    follow-up): an ADMIN-created page is approved on creation and can carry
    its reel/story rates in the same insert; a creator's own page still
    starts pending; `getAvgEngagement` falls back to the profile scrape's
    averages (`source: "profile"`) until the page has link snapshots.
  - `src/lib/apifyClient.test.js` + `src/modules/scraping/service.test.js` —
    the profile scrape now averages the profile's `latestPosts` into
    avg views/likes/comments (views over video posts only, hidden counts
    skipped, nulls not zeros), stores them plus `lastScrapedAt`, keeps an
    earlier sample when a scrape sees no posts, and records
    `lastScrapeError` on failure so Inventory can say why.
  - `src/modules/campaigns/service.test.js` also covers: remaining-budget math
    (costCap - spent, rejected-screenshot links excluded from spend), a sheet
    row matching an existing page by handle vs. staying pending, and resolving
    a pending row to a page.
  - `src/modules/links/service.test.js` — revising a link's cost logs the
    previous value, and is blocked once the link is already invoiced. Also
    covers the admin work-import: resolving campaign/page by name, falling
    back to the rate card when the sheet gives no cost, and skipping (not
    failing the batch on) an unmatched campaign/page or an already-submitted URL.
  - `src/modules/admin/service.test.js` — resetting a user's password returns
    a fresh one (never the old hash) and revokes every active refresh token.
    Also (23 Sep permission audit): role changes go through `updateUserRole`
    — self-change 403s, promoting to ADMIN / touching an ADMIN row / resetting
    any FINANCE-or-PLAN_MAKER password / editing an ADMIN's overlay all need a
    *full* (unrestricted) ADMIN actor, the overlay is nulled and sessions
    revoked on a role change, every one of these writes a
    `PermissionAuditLog` row with `action`, and `passwordHash` is never
    echoed. Grants on CREATOR/TEAM_MEMBER are a 400 `ROLE_NOT_GRANTABLE`
    (`auth/service.test.js` pins the same for signup, plus that a non-full
    admin can't create an ADMIN account; `lib/permissions.test.js` covers
    `isFullAdmin` / `assertGrantableRole`).
  - `src/lib/permissions.test.js` also covers the 23 Sep key split: the six
    section-wide keys (`users.manage`, …) became 17 per-action keys
    (`<section>.view/edit/approve/pay`); `edit`/`approve`/`pay` each imply
    that section's `view`; `expandLegacyOverlay` maps any six-key value still
    stored on an old row onto the new keys so nothing needed a data
    migration; `ROLE_DEFAULTS` per role (ADMIN all, FINANCE
    view/edit/approve/pay on finance plus read campaigns/inventory/links,
    PLAN_MAKER inventory.view only); `computeNewAccountOverlay` /
    `clampPatchToActor` updated for the wider key set.
  - Step 3 (23 Sep, "permission-scoped reads") — every list/detail endpoint
    that used to decide "sees everything vs. own rows only" with a bare
    `["ADMIN","FINANCE",...].includes(role)` check now reads the caller's
    effective permissions fresh from the DB via the new
    `lib/effectivePermissions.js` (`server/src/lib/effectivePermissions.test.js`
    isn't a separate file — it's exercised through each call site below), so
    restricting or granting a `*.view` key actually changes what comes back,
    not just whether a write route accepts a request:
    - `src/modules/invoices/viewScoping.test.js` — `listInvoices` /
      `getInvoiceDetail` scope by `finance.view`, not role; a Plan Maker's
      own-plans scope is unaffected by the overlay.
    - `src/modules/links/service.test.js` — `listLinks` scopes by `links.view`.
    - `src/modules/campaigns/service.test.js` — `listAssignments` (the
      attached sheet's per-creator rows) scopes by `campaigns.view`.
    - `src/modules/assets/service.test.js` — `listAssets` scopes by
      `inventory.view`; Plan Maker's full-catalogue access stays role-based.
    - `src/modules/billing/routes.test.js` — `GET /billing` (bank/PAN
      details) scopes by `finance.view` instead of a bare ADMIN/FINANCE
      check.
    - `src/modules/jobs/invoiceAgingSweep.test.js` — the overdue-invoice
      notification sweep notifies everyone with effective `finance.view`,
      not everyone with role ADMIN/FINANCE.
  - `src/lib/mailer.test.js` — OTP emails go out via Resend from
    `Taggify <noreply@taggify.in>` by default (tasks.md 23 Sep #2),
    `EMAIL_FROM` overrides, a Resend error is a 502, and no key means
    console-print in dev / 503 in production.
  - `src/modules/plans/service.test.js` — "Inventory" (newTask.md #13): item
    cost falls back to the page's rate card unless overridden, budget
    variance is positive/negative/null correctly, and a page picked under
    two formats only counts once toward expected engagement. Also the
    client invoice (13 Sep): details from the popup are saved onto the plan,
    the CINV number is minted once and kept on regeneration, a GST plan
    requires the client's GST number, and only an approved plan with a
    client-facing cost can be invoiced.
  - `src/lib/clientInvoicePdf.test.js` — the Taggify → client invoice mapping
    (Billed-to block from the plan's client details, one line per page × posts
    that adds up to the subtotal, a single consolidated line once the client
    cost is overridden, Taggify's own bank block) plus PDF smoke renders.
  - `src/modules/invoices/service.test.js` also pins that only a CREATOR can
    raise an invoice (13 Sep — Admin/Plan Maker generation removed).
  - `src/lib/financeWorkbook.test.js` — the daily finance export (newTask.md
    #2): a *real round-trip* test (build the workbook, re-load the actual
    bytes with the same library) proving the generated file is a genuinely
    valid `.xlsx` with the right data, not just that generation didn't throw.
  - `src/lib/githubClient.test.js` — the GitHub Contents API integration
    (mocked `fetch`): creates vs. updates a file correctly (sha only sent on
    update), auto-creates the export branch off the repo's default branch
    when it doesn't exist yet, and surfaces GitHub's own error text on failure.
  - `src/modules/jobs/financeExport.test.js` — the export is skipped with a
    specific, readable error (not a silent no-op, not a generic crash) when
    GitHub isn't configured, and pushes to a branch that is never `main`.
- **`client/tests/e2e/`** — Playwright. What's covered so far:
  - `fixtures.ts` — shared test helpers, see below.
  - `sub-admin-creation.spec.ts` — the People page's access editor
    (`components/users/access-editor.tsx`, 23 Sep): checking a section
    expands its per-action checkboxes beneath it with a live "View · Edit …"
    summary chip, unchecking the section collapses it and clears every
    action; leaving Admin's editor fully checked sends no `permissions`
    field at all; the editor is hidden entirely for Creator/Team member and
    pre-checked at role baseline for Finance/Planner; a restricted
    sub-admin's role dropdown locks ADMIN rows and disables the Admin option
    for everyone else, and offers neither "Edit access" on an ADMIN row nor
    on a Creator row (non-grantable), only "Reset password" on the Creator.
  - `login.spec.ts` — the login form renders, a failed login shows the server's error
    message, an already-signed-in visitor is redirected off `/login`.
  - `plan-client-invoice.spec.ts` — Plans → "Generate invoice" popup: prefilled
    from the plan, posts the details then fetches the PDF, inline validation
    (GST number on a GST plan, company/address), Regenerate + download chip
    once generated, hidden on unapproved plans and on other Plan Makers' plans.
  - `campaign-invoices.spec.ts` / `invoice-raise-creator-only.spec.ts` — no
    invoice generator on the campaign page for any role, and no "New invoice"
    on /invoices for anyone but a CREATOR (13 Sep).
  - `inventory-import-pages.spec.ts` — Inventory "Create page" / "Import pages"
    (14 Sep): both buttons for ADMIN only (CREATOR keeps "Add page"), the
    create form's inline validation (account required, handle rules, a pasted
    profile link is normalized) and the exact POST body; the import modal's
    client-side file-type rejection, the server's parse error surfaced, and
    the full preview → pick accounts → confirm → result flow against a mocked
    preview (asserts the exact rows/ownerIds sent and that Inventory refetches).
    Also the searchable account picker (type-to-filter, option pick), the
    optional reel/story rate fields in the POST body, the "Fetching from
    Instagram…" indicator that polls until followers/avg views land, and
    the "Couldn't fetch from Instagram" note when the first scrape failed, and
    the Google Sheet link path (non-Sheets URL rejected client-side; a valid
    link posts to the preview-url route and renders the same preview), live
    followers/avg views filling in after the preview (only placeable handles
    requested; "Not found on Instagram" per missing profile), and "Category
    for all" + per-row category overrides landing in the confirm body. Also
    (14 Sep, UI pass): the handle links to the page's Instagram profile
    (new tab), a selection's "Refresh from Instagram" posts the selected ids
    to the bulk-refresh route, and "Fetching…" is driven by the server's
    `scrapeQueuedAt` marker (set on create/import/bulk refresh, cleared when
    the scrape finishes either way) rather than a createdAt guess.
  - `nav-links.spec.ts` — every desktop sidebar item, every mobile bottom-nav tab, and
    every "More" sheet row navigates to the right place and renders without an
    uncaught error. Two roles matter here (see "What this does and doesn't catch").

Run everything:

```bash
cd server && npm test           # vitest
cd client && npm run test:e2e   # playwright (auto-starts `next dev`; no backend/DB needed — see below)
```

## How the client e2e tests work (no backend required)

`client/tests/e2e/fixtures.ts` exports two helpers used by every test:

- **`signIn(page, role)`** — seeds `localStorage`'s `taggify_auth` key via
  `page.addInitScript` *before* any app code runs, so `RequireAuth` sees a logged-in
  user on first paint. No real login request happens.
- **`mockApi(page)`** — intercepts every `server/` API call (`page.route`) and returns
  empty-but-valid shapes (`[]`, or `{items: [], total: 0, ...}` for paginated
  endpoints). This means the whole suite runs against `next dev` alone — no Postgres,
  no `server/` process, no seed data. That's deliberate: these are connectivity/
  rendering smoke tests ("does this link go to the right place and render without
  crashing"), not data-correctness tests. Data correctness belongs in `server/` vitest
  tests (assert the actual business logic) and in a small number of client tests that
  override specific routes with real fixture data where the behavior under test is
  about what's displayed, not just that navigation works.

To add a test for a new page/flow: call `signIn()` + `mockApi()` in the test (or a
`beforeEach`), then override any endpoint your flow needs a specific response from by
calling `page.route()` again *after* `mockApi()` — Playwright uses the most recently
registered matching handler, so your override wins.

## Schema migrations while `server/` is running locally (Windows)

Hit repeatedly building this out — worth getting right every time, not rediscovering:

- **`prisma migrate dev` can fail with a misleading `[exited with code 0]`.** Against
  this project's Render-hosted Postgres, the shadow-database step it uses to compute
  a safe diff can fail with a Postgres permission error
  (`permission denied to terminate process` — our DB role isn't a superuser) while the
  command still exits 0. A background task reporting "completed" is not proof the
  migration applied — **always read the actual output**, and if in doubt, verify
  independently (`prisma migrate status`, or query `information_schema.columns` /
  `_prisma_migrations` directly) rather than trusting the exit code alone.
- **The reliable path**: `prisma migrate dev --create-only --name X` to generate the
  SQL without applying (this step doesn't hit the same shadow-DB permission issue),
  review/hand-edit the generated `migration.sql` if it touches existing rows (see the
  GST-fields migration's backfill for an example), then `prisma migrate deploy` to
  apply it. Verify the column actually exists afterward — don't just trust the
  "successfully applied" message either, given the above.
- **`prisma generate` fails with `EPERM` on Windows while the server is running** — the
  running Node process holds the native query-engine `.dll` open, so `generate` can't
  overwrite it. Fully stop the server (kill the actual listening process, not just the
  task wrapper — `nodemon` can leave a child alive; check
  `netstat -ano | findstr :4000` / `taskkill //PID <pid> //F` if a restart doesn't
  free the port) **before** running `prisma generate`, and only start the server again
  **after** generation succeeds. Doing this out of order doesn't error loudly — the
  server just silently keeps using the stale client and every query touching the new
  column 500s with "Unknown argument" until you notice and restart correctly.
- Avoid creating/deleting scratch scripts inside `server/` while the dev server is
  running — `nodemon` watches that whole tree broadly and will auto-restart on them,
  which is exactly how a stale-client window gets reopened right after you thought
  you'd fixed it. Use the scratchpad directory, or `server/` only when the server is
  stopped.

## The verify-and-fix loop

```
implement → automated tests (+ drive it for real) → independent review (tiered) → clean? → report
                    ↑________________________ fix ________________________________|
```

Not a multi-agent graph framework — a bounded loop with one role split (implementer
vs. independent reviewer), capped at a few iterations. See the conversation that
produced this file for why a full LangGraph/CrewAI-style orchestrator was
deliberately *not* chosen: this workflow is a straight line, not a branching
multi-specialist workflow, and Claude Code's existing primitives (the `Agent` tool for
a fresh-context subagent, `/code-review`, the test suites themselves) already cover
it without new infrastructure.

### Tiering (full policy in `CLAUDE.md`)

| Change type | Tests | Drive it for real | Independent reviewer subagent |
|---|---|---|---|
| Small, single-file, single-purpose | Yes | Yes | Skippable |
| Multi-file / UI / flow / routing | Yes | Yes | Required |
| Pre-release / milestone | Full existing suite, not just new tests | Broader critical-path walkthrough | `/code-review` at high effort (+ `/security-review` if auth/payments touched) |

### Project phase

Applying the loop at full weight makes sense once there's working functionality to
regress — not while still scaffolding throwaway architecture. This project is past
that point (real auth/dashboard/invoice/campaign flows already in use), so the full
tiered loop is the default now. If a genuinely greenfield effort starts later
(rewrite, new module from scratch), scale back to manual/visual verification until
that surface stabilizes, then lock it in with a smoke test immediately rather than
retrofitting coverage after it's drifted.

### What it costs

Measured against "implement and hand back unverified," per non-trivial task, once the
scaffold already exists (it now does — this was the expensive one-time part):

- Writing/extending a test for the change: +15–30% tokens, +20–40% time.
- Actually running it (suite + browser drive): +5–10% tokens, +10–20% time.
- Independent reviewer subagent (when tiered in): +20–40% tokens, +15–30% time — the
  single biggest line item, since a fresh subagent reconstructs context from scratch.
- A fix round-trip when something's caught: +10–25%, only when triggered — and this
  part is replacing manual QA time, not adding new work.

Net: roughly **1.5–2x** on a task that gets the full loop; **+25–50%** when the
reviewer subagent is skipped for a small change. Trivial one-line fixes are hit worst
proportionally, which is exactly why the tiering exists.

### What this does and doesn't catch

Worth being honest about, since it came up building this suite:

- **A link that resolves but goes to the wrong place is not caught by "no 404, no
  crash."** `nav-links.spec.ts`'s "More sheet Notifications row" test is the concrete
  example: the row's `href="/profile"` was a completely valid, crash-free navigation —
  a pure connectivity crawl would have called it fine. It was wrong because it didn't
  match what "Notifications" should do. Catching that needed an assertion about
  *intent* ("shows notification content"), not just "arrives somewhere real." Write
  tests against what a control is supposed to do, not just that it doesn't error.
- **The nav tests sign in as `ADMIN`** so every sidebar/sheet destination has content
  to render regardless of role gating. This means role-specific behavior (what a
  `CREATOR` sees vs. what's gated to `ADMIN`/`FINANCE`) isn't verified by this suite
  yet — only that the pages don't crash. A role-matrix pass is a reasonable next
  addition if role-gating bugs start showing up.
- **Negated Playwright web-assertions can pass before an async action finishes.** An
  early draft of the Notifications regression test used
  `await expect(page).not.toHaveURL(/\/profile$/)` right after a click, which
  resolved as soon as the URL momentarily *wasn't* `/profile` — i.e., before the
  click's navigation had even started — reporting "not on the profile page" as true
  regardless of whether the bug was fixed. It looked like a passing test either way.
  Rewritten as a positive assertion of the *correct* final state instead. Lesson: when
  testing "X should not happen," prefer asserting the actual expected end state over a
  bare negation, and always run a new test against the *un-fixed* code once to confirm
  it can fail — a test that can't fail isn't proving anything.

## Regression log

Bugs this suite (or driving the app for real) has caught, with the fix/test that now
guards them:

| Bug | Where | Caught by |
|---|---|---|
| Mobile "More" sheet's "Notifications" row navigated to `/profile` instead of showing notifications (copy/paste leftover) | `client/components/layout/more-sheet.tsx` | `nav-links.spec.ts` → "More sheet 'Notifications' row shows notifications, not the profile page" |
| Login page's password `<input>` and its "Show password" toggle button both matched an accessible-name lookup for "Password" (ambiguous label) | `client/app/login/page.tsx` (test-side fix: match label text exactly) | `login.spec.ts` → "renders the sign-in form" |
| "New invoice" preview step's scrollable link list got squeezed to near-zero visible height on a short viewport — GST toggle + totals card were added below it without reserving the list any minimum space | `client/app/invoices/page.tsx` (`NewInvoiceModal`) | Driving the real flow in an actual (short) browser window — the DOM/data was correct, only the layout was broken, which no unit test would have caught. Fixed with a `min-h-[160px]` on the list container. |
