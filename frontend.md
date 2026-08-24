# Frontend — Taggify

UI design + implementation plan for the frontend, built against the backend already implemented in `server/` (see `system design.md`). First deliverable is the visual direction — a mockup canvas, not code yet.

## 0. Design preview

**[Taggify UI Design →](https://claude.ai/code/artifact/2bbfe150-a40a-402f-98d2-2291a94d5952)** — a 4-artboard canvas: Login, Dashboard ("My Works"), Invoices, and a Foundations/style-guide sheet. Static high-fidelity mockups (not a clickable prototype — confirmed with you as the right fidelity for this first pass).

Built from your five reference screenshots in `snapshot/` (a light trading dashboard, a purple admin template, a dark glass-morphic finance dashboard shown twice, and an editorial dark product hero) — used as a mood signal, not copied wholesale. The direction synthesized from them, and deliberately **not** a copy of the earlier WLDD product's look (plain light-mode utilitarian SaaS UI, black top-nav, no dark mode): Taggify goes dark-first, editorial-fintech, with one signature accent family instead of WLDD's flat black/green scheme.

## 1. Aesthetic direction

**Tone**: premium, dark, quietly confident fintech — closer to a well-funded Series-B product than a template. Restraint over decoration: one accent family, generous negative space, tabular numerals doing the "expensive" work rather than gradients or busywork.

**Product identity**: named **Taggify** (matches the project) with a simple square wordmark, not "WLDD" or any variant — a clean break from the reference product's branding.

## 2. Design tokens

### Color (all `oklch()`, dark-first — no light theme planned for v1)

| Token | Value | Use |
|---|---|---|
| `--bg` | `oklch(15% 0.006 255)` | Canvas |
| `--sidebar` | `oklch(13% 0.006 255)` | Sidebar (one step darker than canvas) |
| `--surface` | `oklch(19% 0.007 255)` | Cards, panels |
| `--surface-2` | `oklch(22% 0.008 255)` | Inputs, nested surfaces |
| `--surface-hover` | `oklch(25% 0.009 255)` | Row/element hover |
| `--border` / `--border-strong` | `oklch(100% 0 0 / .08)` / `/ .16` | Hairlines |
| `--text` / `--text-muted` / `--text-faint` | `oklch(97% .003 255)` / `72% .01 255` / `50% .01 255` | Text hierarchy |
| `--accent` (emerald) | `oklch(78% 0.14 164)` | Primary CTA, "approved/paid" |
| `--accent-2` (gold) | `oklch(78% 0.14 70)` | Secondary accent, "invoiced/attention" |
| `--blue` | `oklch(75% 0.13 230)` | "In review" status |
| `--rose` | `oklch(70% 0.16 15)` | "Rejected/overdue" |
| `--slate` | `oklch(65% 0.01 255)` | "Submitted/neutral" |

Accent and status hues deliberately share lightness (~75–78%) and chroma (~0.13–0.16), varying only hue — a harmonious family rather than arbitrary colors per status.

### Typography — two Google Fonts only

- **Manrope** (400/500/600/700/800) — all UI text, labels, tables, and every number (KPI figures set at 800 weight with `font-variant-numeric: tabular-nums` so columns of ₹ amounts align).
- **Instrument Serif** (italic) — used once per screen, sparingly, for editorial headline moments only (the login screen's headline). Never used in dense UI/tables.

Deliberately not Inter/Roboto/Arial or Fraunces — common defaults that read as generic/AI-templated.

Type scale: display 48px (serif italic) · H1 28px/700 · H2 22px/600 · H3 17px/600 · KPI number 34px/800 tabular · body 15px/400 · small/label 13px/500 · micro/eyebrow 11px/700 uppercase, 0.08em tracking.

### Spacing, radius, elevation

- Spacing scale (4px base): 4, 8, 12, 16, 20, 24, 32, 40, 48, 64px.
- Radius: cards/panels 20px, inputs/buttons 12px, small chips 8px, pills 999px (full).
- Shadow: one soft ambient card shadow (`0 24px 60px -24px oklch(0% 0 0 / .6)`); primary buttons get a tinted glow in the accent color instead of a generic dark shadow.
- Layout: fixed 260px sidebar, 72px topbar, 32px content padding, 1440px design width (responsive breakpoints defined in §5).

### Iconography
Inline SVG only, stroke-based, 24×24 viewBox, 1.6–1.8px stroke, rounded caps/joins, `currentColor` — no emoji, no icon font. One consistent line-icon vocabulary across the whole app (see any artboard for the drawn set: grid, link, camera, receipt, users, bell, search, chevrons, check-circle, filter, arrows).

## 3. Single source of truth — every token lives in exactly one place

Direct answer to "which font, and can it change in one place": **Manrope** (UI/body/numbers) + **Instrument Serif italic** (editorial headlines only) — and yes, fonts, colors, spacing, buttons, icons, and every other repeated value each get exactly one home. Nothing is hand-typed a second time anywhere else in the app:

| What | Single home | Change it by |
|---|---|---|
| Every color/spacing/radius/shadow value | `styles/tokens.css` — one `:root{ --bg:...; --accent:...; --radius-lg:...; }` block | Editing this file only. The only place a literal `oklch()`/px value is ever typed. |
| Fonts | `lib/fonts.ts` — loads Manrope + Instrument Serif once via `next/font/google`, exposes them as CSS variables applied on `<html>` in `app/layout.tsx` | Editing this one file (swap the import, `tokens.css`'s `--font-ui`/`--font-display` just point at the variable name and don't change). |
| Tailwind utilities (`bg-surface`, `text-accent`, `rounded-lg`, …) | `tailwind.config.ts` — `theme.extend` maps every utility to `var(--token-name)` from `tokens.css`, never a literal value | Editing `tokens.css`; Tailwind classes and raw CSS both read the same variable, so they can't drift apart. |
| Buttons (primary/secondary/ghost/danger, all sizes) | `components/ui/button.tsx` — one `cva()` definition; every button in the app is `<Button variant="primary">`, never a hand-rolled `<button className="...">` | Editing this one component file — every instance app-wide updates. |
| Status pills, KPI cards, table rows, the detail/timeline panel | `components/ui/status-pill.tsx`, `components/dashboard/kpi-card.tsx`, etc. — one component per repeated pattern | Editing that one component file. |
| Icons | `components/icons/*.tsx` — one SVG React component per icon, sharing a common stroke-width/viewBox wrapper | Editing the shared wrapper (weight/size for all icons) or one icon file (a single glyph). |

Rule for the whole build: **if a value or a piece of markup appears more than once, it lives in exactly one file — never copy-pasted into every screen that uses it.**

(The mockup `.dc.html` artboards you just reviewed *do* repeat their CSS block in each file — that's a constraint of the design-canvas format, where every artboard is an isolated sandboxed preview with no shared imports between files, not the pattern the real Next.js app will follow. The table above is what actually ships.)

## 4. Tech stack (unchanged from `recommend.md`, confirmed here for the frontend)

- **Next.js (App Router) + TypeScript**, Tailwind CSS configured with the tokens above as the theme (not default Tailwind palette/spacing — extend `tailwind.config` with these exact values).
- **shadcn/ui** primitives (dialog, dropdown, tabs, toast) restyled to the token set — not used at default shadcn appearance.
- **TanStack Query** for all server data (matches the backend's REST API 1:1 — one hook per endpoint in `system design.md` §2.3).
- **TanStack Table** for the My Works and Invoices grids (sorting, filtering, pagination against the backend's existing `page`/`pageSize`/`status` query params).
- **React Hook Form + zod** for forms — reuse the same zod schemas shape as the backend's `schemas.js` files so validation rules stay in sync conceptually.

## 5. Screen → backend mapping

| Screen | Backend routes it drives |
|---|---|
| Login | `POST /auth/login`, `POST /auth/refresh` |
| Dashboard / My Works | `GET /links` (filters), `POST /links`, `GET /links/:id/timeline`, `POST /links/bulk-invoice` |
| Link detail panel (timeline) | `GET /links/:id/timeline`, `POST /links/:id/review-screenshot`, `POST /links/:id/approve-insights` |
| Invoices | `GET /invoices`, `POST /invoices/:id/mark-paid`, `PUT /invoices/:id/gst-status` |
| Assets *(not yet mocked)* | `GET/POST /assets`, `PUT /assets/:id/rate-card` |
| Campaigns *(not yet mocked)* | `GET/POST /campaigns` |
| Team *(not yet mocked)* | `GET/POST /users/me/team` |
| Job runs *(not yet mocked)* | `GET /admin/job-runs` |

The four mocked screens cover the core loop end-to-end (login → track links → get paid); Assets/Campaigns/Team/Job-runs reuse the same table + detail-panel pattern established here, so they're straightforward once the direction is approved — not designed yet to avoid mocking screens that might change shape after feedback on the core four.

## 6. Build plan

1. **Tokens & primitives** — `tokens.css` + `tailwind.config.ts` + `lib/fonts.ts` from §3, base shadcn primitives restyled through them, icon set extracted as React components from the mockup SVGs.
2. **App shell** — sidebar + topbar + content frame (from Dashboard/Invoices artboards), auth guard, route structure mirroring the table above.
3. **Core loop screens** — Login, Dashboard/My Works (table + filters + bulk-invoice + detail/timeline panel), Invoices (table + aging + detail panel) — built to pixel-match the approved mockups.
4. **Remaining screens** — Assets/rate-cards, Campaigns, Team, Job runs — same component vocabulary, new tables.
5. **Data wiring** — TanStack Query hooks per endpoint, optimistic updates for approve/reject/mark-paid actions, toast feedback.
6. **States & polish** — loading skeletons (shaped like the real content, not spinners), empty states, error states, responsive pass down to ~1024px (tablet: sidebar collapses to icon rail) and a documented decision to keep the dense tables desktop-first below that.
7. **Accessibility pass** — focus states on every interactive element, color contrast check on status pills against `--surface`, keyboard navigation through the table and detail panel.

## 7. What's next
Once you've reviewed the mockup canvas: confirm the direction (or flag specific artboards to rework), then I'll scaffold the actual Next.js app starting with step 1 above.
