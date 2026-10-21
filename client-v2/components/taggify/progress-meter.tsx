"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";
import { Money } from "@/components/taggify/money";

type Tone = "auto" | "brand" | "success";

/** Spend against a budget: brand while there's room, amber from 90%, red once over. */
const autoTone = (value: number, max: number) => (value > max ? "danger" : value >= max * 0.9 ? "warning" : "brand");

const FILL = {
  brand: "from-brand/60 to-brand",
  success: "from-success/60 to-success",
  warning: "from-warning/60 to-warning",
  danger: "from-danger/60 to-danger",
} as const;

/**
 * The one progress bar used across client-v2 (spend bar redesign, 13 Oct,
 * option A "compact meter"): a thin rounded track with a soft gradient fill
 * that grows in on first paint.
 */
export function ProgressBar({ value, max, tone = "auto", label, className }: { value: number; max: number; tone?: Tone; label?: string; className?: string }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const key = tone === "auto" ? autoTone(value, max) : tone;
  // Start empty and grow to the value, so the bar reads as a measurement rather than a static block.
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(pct));
    return () => cancelAnimationFrame(id);
  }, [pct]);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className={cn("h-1.5 w-full overflow-hidden rounded-pill bg-muted ring-1 ring-inset ring-border", className)}
    >
      <div
        className={cn("h-full rounded-pill bg-gradient-to-r transition-[width] duration-drawer ease-out motion-reduce:transition-none", FILL[key])}
        style={{ width: `${shown}%` }}
      />
    </div>
  );
}

/**
 * Amount spent "of" the budget on one line with the % (or the overspend) on
 * the right, and the bar underneath. Nothing spent reads "Not started".
 */
export function SpendMeter({ spent, cap, label, className }: { spent: number; cap: number; label?: string; className?: string }) {
  const over = spent > cap;
  const pct = cap > 0 ? Math.round((spent / cap) * 100) : 0;
  const key = autoTone(spent, cap);
  return (
    <div className={cn("flex min-w-44 flex-col gap-2", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate">
          <Money value={spent} className="text-body-strong text-foreground" />
          <span className="text-caption text-fg-muted">
            {" "}
            of <Money value={cap} />
          </span>
        </span>
        {spent === 0 ? (
          <span className="shrink-0 text-caption text-fg-muted">Not started</span>
        ) : over ? (
          <span className="shrink-0 text-caption font-semibold text-danger-fg">
            Over by <Money value={spent - cap} />
          </span>
        ) : (
          <span className={cn("num shrink-0 text-caption font-semibold", key === "warning" ? "text-warning-fg" : "text-fg-muted")}>{pct}%</span>
        )}
      </div>
      <ProgressBar value={spent} max={cap} label={label ?? "Spend against budget"} />
    </div>
  );
}
