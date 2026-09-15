/** Small date-bucketing helpers shared across dashboards. */

/** The last `n` calendar months (oldest first), each as a `{key, label}`
 * pair — `key` for grouping records into buckets (`"2026-8"`), `label` for
 * display ("Aug"). Extracted out of admin-dashboard.tsx so any other
 * page building the same kind of month-over-month series (e.g. a KPI
 * card's sparkline) buckets months exactly the same way instead of
 * re-deriving it. */
export function lastNMonths(n: number) {
  const now = new Date();
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (n - 1 - i), 1);
    return { key: `${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleDateString(undefined, { month: "short" }) };
  });
}
