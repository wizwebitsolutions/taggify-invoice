"use client";

import { useEffect, useId, useRef, useState } from "react";

const W = 600;
const H = 190;
const PAD_X = 4;
const PAD_TOP = 34;
const PAD_BOTTOM = 26;
const BASELINE_Y = H - PAD_BOTTOM;
const GRIDLINES = 3; // evenly spaced horizontal dotted rules across the plot area

/** Catmull-Rom -> cubic-Bezier through every point — a true smooth curve
 * (the browser draws the actual bezier, not a polyline standing in for
 * one), not straight segments. Flat runs (several equal-value points, the
 * common case here since most months are 0) stay flat: matching neighbors
 * give a ~0 tangent, so there's no wobble on the baseline. */
function smoothPath(points: { x: number; y: number }[]) {
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

/**
 * Single-series change-over-time as a smooth curve + soft area wash, in the
 * "hero stat card" shape: bold label, big total, muted period, then the
 * chart — a trend's headline is the total and its shape, not a per-month
 * bar height. Draws itself in on mount and skips all of it under
 * prefers-reduced-motion. Hover still gets a crosshair + tooltip per the
 * dataviz skill's interaction spec — the curve drops static point markers
 * (cleaner read at rest) but nothing is hidden, hover reaches every value.
 */
export function TrendAreaChart({
  data,
  label,
  subtitle,
  formatValue = (v) => String(v),
  color = "var(--accent)",
}: {
  data: { label: string; value: number }[];
  /** e.g. "Expenditure trend" */
  label: string;
  /** e.g. "Last 6 months" */
  subtitle: string;
  formatValue?: (v: number) => string;
  color?: string;
}) {
  const gradientId = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  const [revealed, setRevealed] = useState(false);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  // Two-phase mount: render the pre-animation state first, then flip on the
  // next frame so the browser has something to transition *from* — setting
  // the end state directly on first paint would just skip the animation.
  // (Effect, not a render-time side effect — StrictMode-safe, runs once.)
  useEffect(() => {
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setRevealed(true));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, []);

  const n = data.length;
  const total = data.reduce((sum, d) => sum + d.value, 0);
  const max = Math.max(1, ...data.map((d) => d.value));
  const innerW = W - PAD_X * 2;
  const step = n > 1 ? innerW / (n - 1) : 0;
  const points = data.map((d, i) => ({
    ...d,
    x: PAD_X + step * i,
    y: PAD_TOP + (BASELINE_Y - PAD_TOP) * (1 - d.value / max),
  }));

  const curvePath = smoothPath(points);
  const areaPath = `${curvePath} L ${points[n - 1]?.x ?? 0} ${BASELINE_Y} L ${points[0]?.x ?? 0} ${BASELINE_Y} Z`;
  const hovered = hoverIndex !== null ? points[hoverIndex] : null;

  function handleMove(e: React.PointerEvent<SVGRectElement>) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || n < 2) return;
    const svgX = ((e.clientX - rect.left) / rect.width) * W;
    const idx = Math.round((svgX - PAD_X) / step);
    setHoverIndex(Math.min(n - 1, Math.max(0, idx)));
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-[0.9375rem] font-bold">{label}</p>
        <p className="mt-1 text-[1.625rem] font-extrabold tracking-tight" style={{ color }}>
          {formatValue(total)}
        </p>
        <p className="text-[0.8125rem] text-text-faint">{subtitle}</p>
      </div>

      <div className="relative" style={{ height: H }}>
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-full w-full overflow-visible">
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.28" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Dotted reference rules — texture, not read as exact values (no y-axis numbers; the header owns the number) */}
          {Array.from({ length: GRIDLINES }, (_, i) => {
            const y = PAD_TOP + ((BASELINE_Y - PAD_TOP) * (i + 1)) / (GRIDLINES + 1);
            return (
              <line
                key={i}
                x1={PAD_X}
                y1={y}
                x2={W - PAD_X}
                y2={y}
                stroke="var(--border-strong)"
                strokeWidth={1}
                strokeDasharray="1 5"
                strokeLinecap="round"
              />
            );
          })}

          <path
            d={areaPath}
            fill={`url(#${gradientId})`}
            opacity={revealed ? 1 : 0}
            className="transition-opacity duration-[900ms] ease-out motion-reduce:transition-none"
            style={{ transitionDelay: revealed ? "450ms" : "0ms" }}
          />
          <path
            d={curvePath}
            fill="none"
            stroke={color}
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            pathLength={1}
            strokeDasharray={1}
            strokeDashoffset={revealed ? 0 : 1}
            className="transition-[stroke-dashoffset] duration-[1300ms] ease-out motion-reduce:transition-none"
          />

          {/* Crosshair — snaps to the nearest month, never a bare 2px line to aim at */}
          {hovered && (
            <line x1={hovered.x} y1={PAD_TOP} x2={hovered.x} y2={BASELINE_Y} stroke="var(--border-strong)" strokeWidth={1} />
          )}
          {hovered && <circle cx={hovered.x} cy={hovered.y} r={5} fill="var(--surface)" stroke={color} strokeWidth={2} />}

          {points.map((p) => (
            <text key={p.label} x={p.x} y={H - 6} textAnchor="middle" className="fill-[var(--text-faint)] text-[10px]">
              {p.label}
            </text>
          ))}

          {/* Hit target spans the full plot height, not just the line, per the interaction spec */}
          <rect x={PAD_X} y={0} width={innerW} height={H} fill="transparent" onPointerMove={handleMove} onPointerLeave={() => setHoverIndex(null)} />
        </svg>

        {hovered && (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[calc(100%+10px)] rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-[0.75rem] shadow-card"
            style={{ left: `${(hovered.x / W) * 100}%`, top: `${(hovered.y / H) * 100}%` }}
          >
            <div className="font-semibold text-text-faint">{hovered.label}</div>
            <div className="font-bold tabular-nums text-text">{formatValue(hovered.value)}</div>
          </div>
        )}
      </div>
    </div>
  );
}
