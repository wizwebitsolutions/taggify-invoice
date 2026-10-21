# Taggify illustration kit

Cut from `ux/assets/Taggify Illustration Kit Asset Sheet.png` (and three pieces from `ux/assets/Taggify Creator Illustration Kit.png`), transparent background. Use them through `<Illustration name="…" />` / `<EmptyState name="…" />` in `components/taggify/illustration.tsx`. Each one has one job:

| File | Use it for |
|---|---|
| `sidebar-illustration` | Sidebar card "Creators create. We make it scalable." |
| `header-ribbon` | Decorative ribbon behind a vendor/creator header (wide screens only) |
| `team-01` | Login screen, team/people screens (Settings → People) |
| `login-team-premium` | Large login hero; optimized transparent WebP with a `-dark` companion |
| `admin-01` | Admin Home greeting |
| `finance-01` | Finance Home / Finance overview greeting |
| `planner-01` | Planner Home greeting |
| `creator-01` | Creator app home greeting |
| `onboarding-01` | Creator first-run: connect page → campaigns → track → get paid |
| `analytics-01` | Reports (header / no data yet) |
| `partnership-01` | Plan approved → campaign created |
| `page-food` / `page-travel` / `page-lifestyle` | Creator app: "add your page" prompts by niche (never as a stand-in for a real page photo) |
| `empty-plans` | No plans yet |
| `empty-campaigns` | No campaigns yet |
| `empty-content` | No posts yet |
| `empty-dues` | Nothing owed |
| `empty-search` | Filters/search match nothing |
| `payout-processing` | Payout being submitted |
| `payout-success` | Payout submitted |
| `error-state` | Something failed to load |

Every file has a `<name>-dark.png` twin for the dark theme (slate backdrop, mint shirts and accents, blue-grey leaves; skin kept). They're generated, not hand-drawn: after changing a light PNG, run `python scripts/recolor-illustrations.py public/illustrations public/illustrations` from `client-v2/` (needs Pillow). `sidebar-illustration` has hand-marked regions in that script so it matches the dark reference exactly.

Not cut (deliberately): the avatar set and platform icons (real page photos and `PlatformIcon` are used instead), the abstract shapes/doodles, and the extended sheet's login and payout-success mockups (they show a Google/Apple login that doesn't exist and baked-in sample text).
