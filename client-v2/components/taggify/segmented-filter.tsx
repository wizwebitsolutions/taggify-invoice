"use client";

import { useRef } from "react";

import { cn } from "@/lib/utils";

/**
 * Single-choice filter row (radiogroup) with proper keyboard behaviour: one
 * tab stop, arrow keys / Home / End move and select. `variant="track"` is the
 * grey segmented track (campaign posts); `"pills"` the rounded chips (Approvals).
 */
export type SegmentOption<T extends string> = { value: T; label: string; count?: number };

export function SegmentedFilter<T extends string>({
  label,
  value,
  options,
  onChange,
  variant = "track",
  className,
}: {
  label: string;
  value: T;
  options: SegmentOption<T>[];
  onChange: (v: T) => void;
  variant?: "track" | "pills";
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const idx = Math.max(0, options.findIndex((o) => o.value === value));

  function move(to: number) {
    const n = (to + options.length) % options.length;
    onChange(options[n].value);
    refs.current[n]?.focus();
  }

  return (
    <div role="radiogroup" aria-label={label} className={cn("flex flex-wrap gap-1", variant === "track" ? "rounded-md bg-muted p-1" : "gap-2", className)}>
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={i === idx ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowDown") (e.preventDefault(), move(i + 1));
              else if (e.key === "ArrowLeft" || e.key === "ArrowUp") (e.preventDefault(), move(i - 1));
              else if (e.key === "Home") (e.preventDefault(), move(0));
              else if (e.key === "End") (e.preventDefault(), move(options.length - 1));
            }}
            className={cn(
              "text-small font-semibold transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring-soft",
              variant === "track"
                ? cn("h-control-sm rounded-sm px-3 text-fg-strong", on && "bg-card text-foreground shadow-1")
                : cn("h-control-sm rounded-pill border px-4", on ? "border-brand bg-brand-soft text-brand-ink" : "border-input bg-card text-fg-strong hover:bg-muted")
            )}
          >
            {o.label}
            {o.count !== undefined && <span className={cn("num ml-1", variant === "track" && "text-fg-muted")}>{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
