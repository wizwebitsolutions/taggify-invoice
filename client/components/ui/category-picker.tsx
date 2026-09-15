"use client";

import { useState } from "react";

import { PAGE_CATEGORIES } from "@/lib/api-client";
import { cn } from "@/lib/utils";

/**
 * Page category chips (newTask.md #12) — "Meme page", "News page", etc.
 * Free-form server-side (Asset.category), so this is suggestions + a
 * custom-text fallback, not a fixed enum picker. Shared between
 * assets/page.tsx's "Add page" and users/page.tsx's multi-page "Add user"
 * flow so both stay in sync with the same suggested list.
 */
export function CategoryPicker({ value, onChange, className }: { value: string; onChange: (v: string) => void; className?: string }) {
  const [showCustom, setShowCustom] = useState(Boolean(value) && !PAGE_CATEGORIES.includes(value));

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex flex-wrap gap-1.5">
        {PAGE_CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => {
              onChange(c);
              setShowCustom(false);
            }}
            className={cn(
              "rounded-full border px-2.5 py-1 text-[0.75rem] font-semibold transition-colors",
              value === c ? "border-ink bg-surface-2 text-text" : "border-border text-text-muted hover:bg-surface-2"
            )}
          >
            {c}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setShowCustom(true)}
          className={cn(
            "rounded-full border px-2.5 py-1 text-[0.75rem] font-semibold transition-colors",
            showCustom ? "border-ink bg-surface-2 text-text" : "border-border text-text-muted hover:bg-surface-2"
          )}
        >
          Custom…
        </button>
      </div>
      {showCustom && (
        <input
          autoFocus
          value={PAGE_CATEGORIES.includes(value) ? "" : value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Category name…"
          className="h-8 w-full rounded-md border border-border-strong bg-surface-2 px-2.5 text-[0.8125rem] text-text placeholder:text-text-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-30"
        />
      )}
    </div>
  );
}
