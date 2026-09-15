"use client";

import { useId } from "react";

import { smoothPath } from "./smooth-path";

const W = 120;
const H = 30;
const PAD_Y = 3;

/**
 * A compact, static trend line for embedding inside a KPI tile — same
 * drawing language as TrendAreaChart (smooth curve, gradient area wash,
 * one emphasized endpoint) at a fraction of the size, so a KPI card can
 * show its shape without becoming its own chart. No axis, no gridlines,
 * no hover: at ~30px tall those would be noise, not signal — the point is
 * a glanceable "up, down, or flat", not a value lookup.
 */
export function SparkLine({ values, color = "var(--accent)" }: { values: number[]; color?: string }) {
  const gradientId = useId();
  if (values.length < 2) return null;

  const max = Math.max(...values);
  const min = Math.min(...values);
  // Flat series (all-equal values, e.g. no history yet) draws a flat line
  // at mid-height rather than dividing by zero.
  const span = max - min || 1;
  const step = W / (values.length - 1);
  const points = values.map((v, i) => ({
    x: i * step,
    y: PAD_Y + (H - PAD_Y * 2) * (1 - (v - min) / span),
  }));

  const curve = smoothPath(points);
  const last = points[points.length - 1];
  const area = `${curve} L ${last.x} ${H} L ${points[0].x} ${H} Z`;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="h-[30px] w-full overflow-visible"
      role="img"
      aria-label="Trend over the last 6 months"
      data-testid="kpi-sparkline"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradientId})`} />
      <path d={curve} fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last.x} cy={last.y} r={2.5} fill="var(--surface)" stroke={color} strokeWidth={1.75} />
    </svg>
  );
}
