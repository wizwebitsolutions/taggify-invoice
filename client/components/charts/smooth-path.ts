/** Catmull-Rom -> cubic-Bezier through every point — a true smooth curve
 * (the browser draws the actual bezier, not a polyline standing in for
 * one), not straight segments. Flat runs (several equal-value points) stay
 * flat: matching neighbors give a ~0 tangent, so there's no wobble on the
 * baseline.
 *
 * Extracted out of trend-area-chart.tsx so spark-line.tsx's compact
 * sparklines draw with the exact same curve math instead of a
 * hand-rolled approximation — one smoothing algorithm for every line
 * chart in the app, not two that can drift apart.
 */
export function smoothPath(points: { x: number; y: number }[]) {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}
