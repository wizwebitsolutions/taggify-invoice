/** Small display-formatting helpers shared across every screen. */

/** Plain (non-currency) counts — followers, likes, views, comments — grouped
 * the Indian way (1,00,000 not 100,000). A bare `n.toLocaleString()` falls
 * back to the browser's own locale, which isn't necessarily "en-IN" even
 * though every screen in this app otherwise assumes it — see bugs.md #5.
 * money() and compactNumber() both delegate here rather than each calling
 * toLocaleString("en-IN") themselves, so the locale choice lives in one
 * place. */
export function count(v: string | number) {
  return Number(v).toLocaleString("en-IN");
}

export function money(v: string | number) {
  return `₹${count(v)}`;
}

/** "10644" -> "10.6K", "51652" -> "51.7K" — for a stat headline where the
 * exact count matters less than its scale (campaign cards' likes total).
 * Leaves anything under 1,000 as an exact number. */
export function compactNumber(v: number) {
  if (v < 1000) return count(v);
  // Branch on the *rounded* K value, not the raw one — a value like 99,980
  // is under 100,000 (so a raw-value check would take the K branch), but
  // (99980/1000).toFixed(1) rounds up to "100.0", which should read as
  // "1L", not "100K".
  const kValue = (v / 1000).toFixed(1).replace(/\.0$/, "");
  if (v < 100_000 && kValue !== "100") return `${kValue}K`;
  return `${(v / 100_000).toFixed(1).replace(/\.0$/, "")}L`; // lakh — matches en-IN grouping past 5 digits
}

export function initialsOf(name?: string | null) {
  if (!name) return "—";
  return name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function roleLabel(role?: string) {
  if (!role) return "";
  return role.charAt(0) + role.slice(1).toLowerCase().replace("_", " ");
}
