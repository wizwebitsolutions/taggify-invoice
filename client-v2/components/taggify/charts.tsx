"use client";

import { Area, AreaChart, Bar, BarChart as RBarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { compactNumber } from "@/lib/format";

/**
 * Quiet charts (§19), coloured from CSS variables so they follow light/dark:
 * one brand series, faint gridlines, no axis lines. Recharts animates the
 * series in; reduced motion is handled by the global CSS rule.
 */
const COLOR = {
  primary: "rgb(var(--chart-primary))",
  muted: "rgb(var(--chart-muted))",
  grid: "rgb(var(--chart-grid))",
  axis: "rgb(var(--chart-axis))",
  text: "rgb(var(--fg-strong))",
};

const tooltipStyle = {
  borderRadius: 10,
  border: "1px solid rgb(var(--border))",
  background: "rgb(var(--popover))",
  color: "rgb(var(--popover-foreground))",
  boxShadow: "var(--shadow-2)",
  fontSize: 13,
};

export const rupeesCompact = (v: number) => `₹${compactNumber(v)}`;

export type Point = { label: string; value: number };

/** Area trend: one violet line with a faint fill. */
export function TrendChart({ data, height = 220, format = rupeesCompact, label }: { data: Point[]; height?: number; format?: (v: number) => string; label: string }) {
  return (
    <div style={{ height }} role="img" aria-label={label}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={COLOR.primary} stopOpacity={0.16} />
              <stop offset="100%" stopColor={COLOR.primary} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke={COLOR.grid} />
          <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: COLOR.axis }} />
          <YAxis axisLine={false} tickLine={false} width={52} tick={{ fontSize: 12, fill: COLOR.axis }} tickFormatter={(v: number) => format(v)} />
          <Tooltip cursor={{ stroke: COLOR.grid }} contentStyle={tooltipStyle} formatter={(v) => [format(Number(v)), ""]} separator="" />
          <Area type="monotone" dataKey="value" stroke={COLOR.primary} strokeWidth={2} fill="url(#trend-fill)" animationDuration={600} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Canvas "Paid to creators" bars: soft lavender bars with the value printed on
 * top, the latest period in full violet. No axes; month names underneath.
 */
export function BarChart({ data, height = 220, format = rupeesCompact, label }: { data: Point[]; height?: number; format?: (v: number) => string; label: string }) {
  const last = data.length - 1;
  return (
    <div style={{ height }} role="img" aria-label={label}>
      <ResponsiveContainer width="100%" height="100%">
        <RBarChart data={data} margin={{ top: 22, right: 8, bottom: 0, left: 8 }} barCategoryGap="28%">
          <CartesianGrid vertical={false} stroke={COLOR.grid} />
          <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: COLOR.axis }} />
          <Tooltip cursor={{ fill: "rgb(var(--accent))" }} contentStyle={tooltipStyle} formatter={(v) => [format(Number(v)), ""]} separator="" />
          <Bar dataKey="value" radius={[8, 8, 2, 2]} maxBarSize={44} animationDuration={600}>
            {data.map((d, i) => (
              <Cell key={d.label} fill={i === last ? COLOR.primary : COLOR.muted} />
            ))}
            <LabelList dataKey="value" position="top" formatter={(v: unknown) => format(Number(v))} style={{ fontSize: 12, fontWeight: 500, fill: COLOR.text }} />
          </Bar>
        </RBarChart>
      </ResponsiveContainer>
    </div>
  );
}
