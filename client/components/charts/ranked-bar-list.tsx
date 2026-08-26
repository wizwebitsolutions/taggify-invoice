"use client";

import { cn } from "@/lib/utils";

/**
 * Horizontal ranked bars — one row per category, order is meaningful (a
 * pipeline stage, a rank) so it's never re-sorted by magnitude here. Each
 * bar's own color carries its identity (status tone, or a single accent
 * when every row is the same series) — a legend for >=2 colors lives in
 * the caller's section header, not repeated per chart. Value sits at the
 * bar's tip per the dataviz mark spec.
 */
export function RankedBarList({
  items,
  formatValue = (v) => String(v),
  onSelect,
}: {
  items: { key: string; label: string; value: number; color?: string; active?: boolean }[];
  formatValue?: (v: number) => string;
  onSelect?: (key: string) => void;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));

  return (
    <div className="flex flex-col gap-3">
      {items.map((item) => {
        const pct = Math.max(2, Math.round((item.value / max) * 100));
        const Comp = onSelect ? "button" : "div";
        return (
          <Comp
            key={item.key}
            type={onSelect ? "button" : undefined}
            onClick={onSelect ? () => onSelect(item.key) : undefined}
            className={cn(
              "grid w-full grid-cols-[104px_1fr_auto] items-center gap-3 rounded-md py-1 text-left",
              onSelect && "cursor-pointer hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent",
              item.active && "bg-accent-soft"
            )}
          >
            <span className="truncate text-[0.8125rem] text-text-muted">{item.label}</span>
            <span className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
              <span
                className="block h-full rounded-full transition-[width]"
                style={{ width: `${pct}%`, backgroundColor: item.color ?? "var(--accent)" }}
              />
            </span>
            <span className="text-[0.8125rem] font-bold tabular-nums text-text">{formatValue(item.value)}</span>
          </Comp>
        );
      })}
    </div>
  );
}
