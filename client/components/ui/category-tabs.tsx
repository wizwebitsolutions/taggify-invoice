"use client";

import { cn } from "@/lib/utils";

/**
 * Horizontal, scrollable strip of pill filters with a per-tab count —
 * factored out of Inventory's category filter (user request, 9 Sep — "add
 * category filter in inventory section, that will be horizontally like
 * memes, news, research") so the plan wizard's Pages step (10 Sep) can
 * reuse the exact same markup instead of a second copy.
 */
export function CategoryTabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { key: T; label: string; count: number }[];
  value: T;
  onChange: (key: T) => void;
}) {
  return (
    <div className="relative -mx-4 px-4 md:mx-0 md:px-0">
      <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => onChange(t.key)}
            className={cn(
              "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-[0.8125rem] font-semibold transition-colors",
              value === t.key
                ? "border-accent bg-accent text-accent-ink shadow-glow"
                : "border-border bg-surface text-text-muted hover:border-border-strong hover:bg-surface-2"
            )}
          >
            {t.label}{" "}
            <span className={cn("rounded-full px-1.5 py-px text-[0.6875rem] font-semibold tabular-nums", value === t.key ? "bg-black/10" : "bg-surface-2 text-text-faint")}>
              {t.count}
            </span>
          </button>
        ))}
      </div>
      {/* Fade hint that the row scrolls, without a visible scrollbar. */}
      <div className="pointer-events-none absolute right-0 top-0 h-full w-8 bg-gradient-to-l from-bg to-transparent md:hidden" />
    </div>
  );
}
