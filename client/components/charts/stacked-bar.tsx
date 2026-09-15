"use client";

import { cn } from "@/lib/utils";

/**
 * Part-to-whole composition as one thin stacked bar + a legend. Segments
 * are typically too narrow for an inline value (dataviz mark spec: an
 * interior stacked segment with no free end skips the inline label and
 * lets the legend carry it) — so the count/percent lives in the legend
 * row, never crammed into the fill. 2px surface gap between segments.
 */
export function StackedBar({
  segments,
  onSelect,
}: {
  segments: { key: string; label: string; value: number; color: string; active?: boolean }[];
  onSelect?: (key: string) => void;
}) {
  const total = segments.reduce((sum, s) => sum + s.value, 0) || 1;
  const nonZero = segments.filter((s) => s.value > 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex h-4 w-full gap-[2px] overflow-hidden rounded-full bg-surface-2">
        {nonZero.map((s) => (
          <div
            key={s.key}
            title={`${s.label}: ${s.value}`}
            className="h-full first:rounded-l-full last:rounded-r-full"
            style={{ width: `${(s.value / total) * 100}%`, backgroundColor: s.color }}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {segments.map((s) => {
          const Comp = onSelect ? "button" : "div";
          const pct = Math.round((s.value / total) * 100);
          return (
            <Comp
              key={s.key}
              type={onSelect ? "button" : undefined}
              onClick={onSelect ? () => onSelect(s.key) : undefined}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[0.8125rem]",
                onSelect && "cursor-pointer hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-30",
                s.active && "bg-accent-soft"
              )}
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
              <span className="text-text-muted">{s.label}</span>
              <span className="font-semibold tabular-nums text-text">{s.value}</span>
              <span className="text-text-faint">({pct}%)</span>
            </Comp>
          );
        })}
      </div>
    </div>
  );
}
