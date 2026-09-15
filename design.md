# UI/UX skill audit — where to spend polish effort

Evaluated 2026-09-07 against the actual codebase (`client/components/**`,
`styles/tokens.css`, `tailwind.config.ts`, `app/page.tsx`), not just the repo
READMEs. Repos considered:

- Emil Kowalski — https://github.com/emilkowalski/skills
- garden-skills (ConardLi) — https://github.com/ConardLi/garden-skills
- landing-page-design (elayadesign) — https://github.com/elayadesign/ai-design-skills
- Meng To — https://github.com/MengTo/Skills
- Jakub Krehel — https://github.com/jakubkrehel/skills
- tastemaker (codeswithroh) — https://github.com/codeswithroh/tastemaker
- designer-skills (Owl-Listener) — https://github.com/Owl-Listener/designer-skills

## Baseline findings that drove the ranking

- We already have a real token system (`styles/tokens.css` →
  `tailwind.config.ts`: semantic colors/radii/shadows, dark mode via class).
  Skills that mainly offer "design tokens / color scales" are solving a
  problem we don't have anymore.
- `components/ui/sheet.tsx` — the primitive behind every modal (upload-links,
  resolve-pending-assignments, add-user, more-sheet) — has **zero enter/exit
  animation**. It's a binary `{open && <Sheet/>}` conditional; no transition
  classes, no framer-motion in `package.json`.
- **No toast library anywhere** (`grep -r toast` across `client/` → 0 hits).
  Form feedback is whatever inline `ErrorNotice` exists, nothing more.
- `app/page.tsx` is a bare `redirect("/login")` — there is no landing/marketing
  page in this product, so landing-page-builder skills have nothing to attach to.
- `components/layout/ambient-glow.tsx` shows an existing bar for restraint
  (pauses on tab-hidden, respects `prefers-reduced-motion`) — any new motion
  work needs to clear that bar, not go flashy/WebGL.

## Fit score per repo (for this app specifically)

| Repo | What it actually is (verified) | Fit |
|---|---|---|
| **Emil Kowalski** | `animate`, `review-animations`, `find-animation-opportunities`, `ask-sonner`, `apple-design`, `animate-expo` (RN — n/a), `write-swift` (iOS — n/a), `pick-ui-library`, `prototype` | **85%** — our biggest concrete gap (zero-motion modals, no toast) is exactly what this pack solves |
| **Jakub Krehel** | 11 "better-*" skills: `better-ui` (optical alignment, hit areas, contextual icons), `better-typography`, `better-colors`, `better-accessibility`, `better-layout`, `better-writing`, `interface-review`, `break` (render every component state for stress-testing), `variant` | **70%** — built for polishing an existing hand-rolled component library, which is what `components/ui/*` is |
| **tastemaker (codeswithroh)** | Reference-grounded palette lock + contrast checker + anti-AI-slop scan + persistent taste profile | **30%** — useful guardrail for *new* screens (e.g. the just-shipped campaign detail page); redundant where `tokens.css` already locks the palette |
| **designer-skills (Owl-Listener)** | 111 skills; ~90 are UX-research/design-ops/portfolio process (personas, journey maps, sprint planning, stakeholder decks) with zero code impact | **15%** — only the Interaction Design slice (form validation, error messaging, empty/loading states) touches real files |
| **Meng To** | 81 web-design skills, mostly WebGL/3D/cinematic-scroll/marquees/glass-neon, built for landing pages, portfolios, and games | **8%** — a few CSS-detail ideas echo our existing glass/glow tokens; the bulk would fight the app's restrained B2B look and cost bundle size |
| **garden-skills (ConardLi)** | AI-artifact polishing, image generation, article/video authoring, KB retrieval | **5%** — none of these product surfaces exist here |
| **landing-page-design (elayadesign)** | Full landing-page builder: intake → copy → visual system | **0%** — no landing page exists to build |

## Skill → component mapping, in priority order

| # | Skill | Exact target | Why |
|---|---|---|---|
| 1 | Emil's `animate` + `find-animation-opportunities` | `components/ui/sheet.tsx` → every modal (`components/links/upload-links-modal.tsx`, `components/campaigns/resolve-pending-assignments-modal.tsx`, `components/layout/more-sheet.tsx`, admin add-user form) | Instant show/hide today. Add backdrop fade + slide-up spring + drag-to-dismiss on mobile — the highest-visibility fix since every core action (upload, approve, add user) routes through it |
| 2 | Emil's `ask-sonner` | Wherever inline `ErrorNotice` currently sits — CSV upload result, phone-validation errors, assignment resolution, invoice approve/reject | Straight gap: no toast system exists at all |
| 3 | Jakub's `better-ui` | `components/dashboard/kpi-card.tsx`, `components/ui/button.tsx`, `components/layout/bottom-nav.tsx` | Optical alignment/contextual icons already half-done on KpiCard; also checks tap-target sizing, relevant to the 4-tab mobile nav |
| 4 | Jakub's `break` + `variant` | `components/ui/category-picker.tsx`, `status-pill.tsx`, `status-timeline.tsx` | Renders every state (empty, error, long text, RTL) on one page — fastest way to catch the "crashes on real data shape" failure mode `CLAUDE.md` calls out by name |
| 5 | Emil's `review-animations` + `apple-design` | Sweep of existing `transition-`/`duration-` classes in `kpi-card.tsx`, `button.tsx`, `status-pill.tsx`, `table-parts.tsx` | These already animate on hover with ad-hoc durations/easings — a consistency pass, not new work |
| 6 | tastemaker (lighter touch) | `app/campaigns/[id]/page.tsx` (newest page) | Anti-slop + reference grounding as a guardrail for what gets built next |
| 7 | Owl-Listener's Form Design / Validation / Error Messaging | `components/links/upload-links-modal.tsx`, admin add-user form (phone validation) | Validation logic exists; the error-state *presentation* around it is untouched |

**Skip entirely:** `landing-page-design` (no landing page exists), garden-skills'
image/video/article tools (no such product surface), Meng To's WebGL/3D/game-dev
skills (would clash with the app and cost bundle size on a dashboard people use
to move money), Owl-Listener's research/ops/portfolio categories (~90 of its
111 skills — no code to apply them to).

## Recommended execution order

Per this project's "small, single-purpose changes" workflow rule (see
`CLAUDE.md`): one skill, one component, ship + test before the next.

1. Animate `Sheet` alone (backdrop fade + slide-up + drag-to-dismiss).
2. Add `ask-sonner`, wire it into one flow first (upload-links).
3. `better-ui` pass on `KpiCard` + `Button`.
4. `break` stress-test pass on the components touched by the recent
   stacking-context bug fix (same bug class it's designed to catch).
5. Continue down the priority table above.

Each step still goes through the full definition-of-done loop in `test.md`:
tests added/run, real click-through (Playwright and/or claude-in-chrome),
connectivity audit, and review tier appropriate to the change's blast radius.
