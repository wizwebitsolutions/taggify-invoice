import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Filter chip row from the mockup: pill chips with a muted count, ink when on. */
export function Chips({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-wrap gap-1.5", className)}>{children}</div>;
}

export function Chip({
  on,
  count,
  onClick,
  children,
  testId,
}: {
  on?: boolean;
  count?: number | string;
  onClick?: () => void;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      data-testid={testId}
      className={cn(
        "inline-flex h-[30px] items-center gap-1.5 rounded-full border border-border bg-surface px-[11px] text-[0.78rem] font-medium text-text-2 shadow-card transition-colors hover:border-ink",
        on && "border-ink bg-ink text-ink-fg hover:border-ink"
      )}
    >
      {children}
      {count !== undefined && <span className={cn("font-medium text-text-faint", on && "text-[#a1a1aa]")}>{count}</span>}
    </button>
  );
}

/** Segmented control (Table / Cards, Ranked / Compare). */
export function Segmented<T extends string>({ value, options, onChange, ariaLabel }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; ariaLabel?: string }) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="inline-flex gap-0.5 rounded-md border border-border bg-surface-2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-[6px] px-[11px] py-[5px] text-[0.78rem] font-medium text-text-muted transition-colors",
            value === o.value && "bg-surface font-semibold text-text shadow-card"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Underlined tab row (Posts · Pages · Phases …). */
export function Tabs<T extends string>({ value, tabs, onChange }: { value: T; tabs: { value: T; label: string; count?: number }[]; onChange: (v: T) => void }) {
  return (
    <div role="tablist" className="no-scrollbar flex gap-0.5 overflow-x-auto border-b border-border">
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={cn(
            "-mb-px whitespace-nowrap border-b-2 border-transparent px-3 py-[9px] text-[0.8125rem] font-medium text-text-muted transition-colors hover:text-text",
            value === t.value && "border-ink font-semibold text-text"
          )}
        >
          {t.label}
          {t.count !== undefined && <span className="ml-1.5 text-text-faint">· {t.count}</span>}
        </button>
      ))}
    </div>
  );
}
