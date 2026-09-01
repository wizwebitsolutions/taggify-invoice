import type { ComponentType } from "react";

import { cn } from "@/lib/utils";

export function KpiCard({
  icon: Icon,
  label,
  value,
  foot,
  tone,
  onClick,
  active,
  className,
}: {
  icon?: ComponentType<{ className?: string }>;
  label: string;
  value: string;
  foot?: string;
  /** Highlights the card as needing attention — omit for the neutral look. */
  tone?: "violet" | "rose";
  /** Makes the card a filter toggle — clicking it drills the table below into this KPI's slice. */
  onClick?: () => void;
  /** Whether this KPI's filter is the one currently applied — draws the accent ring. */
  active?: boolean;
  /** Lets the KPI row switch this card between a horizontal-scroll strip (mobile) and a grid cell (desktop) without rendering it twice. */
  className?: string;
}) {
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "flex flex-col gap-3.5 rounded-lg border border-border bg-surface p-5 text-left shadow-card transition-all duration-200",
        tone === "violet" && "border-accent-2/35 bg-gradient-to-b from-accent-2-soft to-transparent",
        tone === "rose" && "border-rose/35 bg-gradient-to-b from-rose-soft to-transparent",
        // Lift + a tone-matched glow on hover (--shadow-accent-glow /
        // --shadow-glow-rose already existed in tokens.css for exactly this
        // kind of moment but had no consumer yet) — signals "pressable" the
        // way the color-only hover before it didn't.
        onClick &&
          cn(
            "cursor-pointer hover:-translate-y-0.5 hover:border-accent/50 hover:bg-surface-hover hover:shadow-accent-glow focus:outline-none focus-visible:ring-2 focus-visible:ring-accent",
            tone === "rose" && "hover:border-rose/50 hover:shadow-glow-rose"
          ),
        active && "border-accent shadow-accent-glow ring-1 ring-accent",
        className
      )}
    >
      {Icon && (
        <div
          className={cn(
            "flex h-[38px] w-[38px] items-center justify-center rounded-[11px] bg-surface-2 ring-1 ring-inset ring-border-strong transition-colors",
            tone === "violet" && "bg-accent-2-soft",
            tone === "rose" && "bg-rose-soft",
            active && "bg-accent-soft"
          )}
        >
          <Icon
            className={cn(
              "h-4 w-4 text-text-muted",
              tone === "violet" && "text-accent-2",
              tone === "rose" && "text-rose",
              active && "text-accent"
            )}
          />
        </div>
      )}
      <div>
        {/* Same eyebrow treatment as the page-header labels ("ADMIN" etc.)
            — was a plain small-caps-less label, now one consistent
            "eyebrow" language across the app instead of two. */}
        <p className="text-[0.6875rem] font-bold uppercase tracking-[0.08em] text-text-faint">{label}</p>
        <p
          className={cn(
            "text-[1.625rem] font-extrabold tracking-tight tabular-nums",
            tone === "rose" && "text-rose",
            tone === "violet" && "text-accent-2"
          )}
        >
          {value}
        </p>
        {foot && (
          <p
            className={cn(
              "mt-1 text-[0.8125rem] text-text-faint",
              tone === "rose" && "text-rose/80",
              tone === "violet" && "text-accent-2/80"
            )}
          >
            {foot}
          </p>
        )}
      </div>
    </Comp>
  );
}
