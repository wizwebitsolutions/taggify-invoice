# Editing the app's appearance

Start with **tokens.css**. It is the source of visual values for both themes.
Tailwind reads those CSS variables, so existing components update together.

| Change | Edit in tokens.css |
| --- | --- |
| App colours | Semantic variables under light / dark |
| Typography | `--text-*`, `--leading-*`, `--tracking-*`, `--weight-*` |
| Overall spacing density | `--space-unit` (default 4px) |
| Button / input heights | `--control-height`, `--control-height-sm`, `--control-height-lg` |
| Corners | `--radius-*` |
| Navigation and content widths | `--sidebar-width`, `--sidebar-rail`, `--content-max` |
| Shadows / transitions | `--shadow-*`, `--duration-*` |
| Chart palette and plot height | `--chart-primary`, `--chart-muted`, `--chart-height` |
| Budget meter thickness | `--meter-height` |

For example, changing `--radius-md` updates shared controls; changing
`--text-body` updates body text and `--text-small` updates default button text. Keep status colours
semantic and check both themes after editing colours.

**pages.css** controls repeated arrangements (navigation, headers, dashboard,
KPI cards, ledgers, filters, and forms) using these tokens. Use its semantic
classes for new screens instead of copying long styling lists into pages.
Component behaviour and variants belong in `components/ui` and
`components/taggify`. Screen-specific content layouts remain in route files.

Dashboard and Reports share `components/taggify/payout-chart.tsx` for payout
bars, tooltips, totals and period callouts. Its `geometry` object owns bar
widths, rounding and plot margins. `listing-*`, `analytics-*`, `decision-tile`
and `metric-tile` in pages.css own the stronger listing and analytics layouts.

Use `/tokens` to inspect both colour themes and `/kitchen-sink` to inspect shared
controls. After changing a token, manually check desktop, mobile, long labels,
and the roles that use the affected screens. Browser tests are run only when
explicitly requested by the user.

The semantic scales are centralized. Legacy arbitrary values in individual
screens are still local overrides; migrate those into named tokens when changing
those screens rather than adding global CSS overrides to force them into place.
