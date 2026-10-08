/**
 * Follower counts the way creators quote them (8 Oct — "followers should show
 * in million or in k"): 8,700,000 → "8.7M", 850,000 → "850K", 950 → "950".
 * Same rule as the app's own label (client-v2 components/finance/identity.tsx
 * audienceLabel), so a sheet, the PDF and the screens all read the same.
 * importParser.js parseFollowerCount reads these back, so a filled-in
 * execution sheet still parses.
 */
export function compactFollowers(n) {
  const v = Number(n) || 0;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (v >= 1000) return `${Math.round(v / 1000)}K`;
  return String(v);
}
