# invoice-taggify

Ops layer for creator campaigns: link submission → screenshot approval → insight
verification → invoicing → payout. See `system design.md` for the full design and
`server/README.md` for backend module/route details.

- `client/` — Next.js 14 (App Router) + React Query + Tailwind. Talks to the API via
  `client/lib/api-client.ts` (one function per backend route — never a raw `fetch()`
  inline in a component). Auth session lives in `localStorage` under `taggify_auth`
  (see `client/lib/auth-context.tsx`); routes are protected client-side via
  `<RequireAuth>`, not middleware.
- `server/` — Express + Prisma/Postgres. Each `src/modules/<name>/` is
  `schemas.js` (zod) + `service.js` + `routes.js`.

## Dev commands

```bash
docker compose up -d                 # local Postgres
cd server && npm run dev             # http://localhost:4000
cd client && npm run dev             # http://localhost:3000

cd server && npm test                # vitest — server-side unit/integration tests
cd client && npm run test:e2e        # playwright — client flows (see client/tests/e2e)
cd client && npm run lint && cd ../server && npm run lint
```

## Workflow: definition of done

This project's biggest recurring problem has been tasks that *look* finished (diff
reads clean, dev server boots) but break something in actual use — a bug the user
then has to find by hand: a broken/misdirected link, a flow that doesn't work
end-to-end, a page that crashes on real data shape, a regression in something
adjacent to what was touched. The point of everything below is to make manual
click-through testing the exception, not the primary way bugs get found.

Full policy, the loop's cost/when-to-use-it-at-full-weight breakdown, and testing
conventions (fixtures, how to add a test, current coverage) live in **`test.md`** —
read it before adding or changing tests. Summary:

**Project phase: mid** — this app already has working, in-use flows (auth, dashboard,
invoices, campaigns, the nav/mobile redesign); new work mostly means changing things
that already work, not greenfield scaffolding. That's the phase where a verify loop
pays for itself most, so it's the default here, not something to phase in later.

Treat a task as done only once **all** of these hold — don't report back before then:

1. **Automated tests cover the change.** Add/update a vitest test (`server/`) or a
   Playwright test (`client/tests/e2e/`) for the behavior you changed. While iterating,
   run just the targeted file(s) for the change (fast feedback loop) — run the *full*
   suite once, at the end, before reporting the task done; it must pass. If a bug
   report is what triggered the task, the fix isn't done until there's a regression
   test that would have caught it; that test is what prevents the same bug from
   silently coming back later.
2. **Drive it for real, don't just read the diff.** For anything touching UI or a
   user-facing flow, actually exercise it — Playwright test run and/or
   `claude-in-chrome` browser automation clicking the real flow in the real app — before
   claiming it works. "The code looks right" and "I ran the type-checker" are not
   "tested."
3. **Connectivity audit.** Whenever a route, component, nav entry, or exported name is
   added/renamed/moved, `grep` the whole repo (both `client/` and `server/`) for every
   reference to it — not just the files you intended to touch. This is how a stray
   link keeps pointing at the old target, or a nav entry ends up pointing somewhere
   technically valid but semantically wrong (a link *not 404ing* is not the same as a
   link being *correct* — check where it actually goes and what should be there, not
   just that it resolves).
4. **Independent review pass, tiered by risk** (see `test.md` for the full criteria):
   - Multi-file, UI/flow, or nav/routing changes → full loop: steps 1–3 above, plus an
     independent reviewer — a fresh subagent (`Agent` tool) or `/code-review` — on the
     diff before it's reported done.
   - Small, single-purpose, single-file changes → steps 1–3 still apply, but the
     separate reviewer subagent can be skipped; self-review is enough.
   - Pre-release / shipping a milestone → heavier than either: run the *entire*
     existing suite (not just new tests), a broader browser-driven walkthrough of the
     critical paths end-to-end (login → core flow → anything touching money), and
     `/code-review` at high effort (`/security-review` too if auth/payments were
     touched).
5. **Report against an explicit checklist**, not a vague "should be working now" —
   state what you verified (tests added/run, flows exercised, refs audited, which tier
   applied and why), not just that you believe it's fixed. If something wasn't
   verified, say so plainly instead of implying it was.

Other standing preferences:

- **Prefer several small, single-purpose changes over one large bundled change.**
  Smaller diffs are easier to fully verify and easier to pin down when something in
  them breaks.
- **State assumptions before implementing** when a task is ambiguous or touches a flow
  with edge cases not spelled out in the request — confirm rather than guess, since a
  wrong guess produces exactly this "worked but not what I meant" failure mode.
- Roles: `CREATOR`, `TEAM_MEMBER`, `ADMIN`, `FINANCE`. Dashboard content branches by
  role (`ADMIN`/`FINANCE` → `AdminDashboard`, others → `CreatorDashboard`) — when
  testing a flow, check it under the role(s) it actually applies to, not just whichever
  account happens to be logged in.
