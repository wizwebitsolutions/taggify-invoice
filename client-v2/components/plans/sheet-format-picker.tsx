"use client";

import { Check } from "lucide-react";

import type { SheetFormat } from "@/lib/api-client";
import { SHEET_FORMAT_INFO } from "@/lib/plans";
import { cn } from "@/lib/utils";

/**
 * Picks the plan's Google Sheet layout (8 Oct — "give 2 types of format …
 * user will select 1 and that will be format for that plan only"). Two radio
 * cards, each with a small schematic of its Overview tab so the choice is
 * visual, not just a name. Pages go in one tab per category either way.
 */
export function SheetFormatPicker({ value, onChange, disabled }: { value: SheetFormat; onChange: (v: SheetFormat) => void; disabled?: boolean }) {
  return (
    <div role="radiogroup" aria-label="Google Sheet format" className="grid gap-3 sm:grid-cols-2">
      {(Object.keys(SHEET_FORMAT_INFO) as SheetFormat[]).map((key) => {
        const on = value === key;
        const info = SHEET_FORMAT_INFO[key];
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onChange(key)}
            className={cn(
              "relative flex flex-col gap-3 rounded-card border bg-card p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring-soft disabled:opacity-60",
              on ? "border-brand ring-1 ring-brand" : "hover:border-input"
            )}
          >
            <span className={cn("absolute right-3 top-3 grid h-5 w-5 place-items-center rounded-full border", on ? "border-brand bg-brand text-brand-foreground" : "border-input bg-card")} aria-hidden>
              {on && <Check className="h-3 w-3" strokeWidth={3} />}
            </span>
            {key === "breakdown" ? <BreakdownPreview /> : <SummaryPreview />}
            <span>
              <span className="block text-body-strong">{info.label}</span>
              <span className="block text-small text-muted-foreground">{info.description}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** A table: header, a row per category, a total row. */
function BreakdownPreview() {
  return (
    <span className="flex h-24 flex-col gap-1 rounded-md bg-muted p-2.5" aria-hidden>
      <span className="h-2 w-1/2 rounded-pill bg-fg-muted/40" />
      <span className="mt-1 grid grid-cols-5 gap-1">
        {Array.from({ length: 5 }, (_, i) => (
          <span key={i} className="h-2 rounded-pill bg-brand/60" />
        ))}
      </span>
      {[0, 1].map((r) => (
        <span key={r} className="grid grid-cols-5 gap-1">
          {Array.from({ length: 5 }, (_, i) => (
            <span key={i} className="h-2 rounded-pill bg-fg-muted/25" />
          ))}
        </span>
      ))}
      <span className="grid grid-cols-5 gap-1">
        {Array.from({ length: 5 }, (_, i) => (
          <span key={i} className="h-2 rounded-pill bg-fg-muted/50" />
        ))}
      </span>
    </span>
  );
}

/** A label/value block. */
function SummaryPreview() {
  return (
    <span className="flex h-24 flex-col gap-1.5 rounded-md bg-muted p-2.5" aria-hidden>
      <span className="h-2 w-1/2 rounded-pill bg-brand/60" />
      {[0, 1, 2, 3].map((r) => (
        <span key={r} className="grid grid-cols-[3fr_2fr] gap-1.5">
          <span className="h-2 rounded-pill bg-fg-muted/40" />
          <span className="h-2 rounded-pill bg-fg-muted/25" />
        </span>
      ))}
    </span>
  );
}
