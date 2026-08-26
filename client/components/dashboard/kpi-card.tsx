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
}: {
  icon?: ComponentType<{ className?: string }>;
  label: string;
  value: string;
  foot?: string;
  /** Highlights the card as needing attention — omit for the neutral look. */
  tone?: "indigo" | "rose";
  /** Makes the card a filter toggle — clicking it drills the table below into this KPI's slice. */
  onClick?: () => void;
  /** Whether this KPI's filter is the one currently applied — draws the accent ring. */
  active?: boolean;
}) {
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "flex flex-col gap-3.5 rounded-lg border border-border bg-surface p-5 text-left shadow-card transition-colors",
        tone === "indigo" && "border-accent-2/35 bg-gradient-to-b from-accent-2-soft to-transparent",
        tone === "rose" && "border-rose/35 bg-gradient-to-b from-rose-soft to-transparent",
        onClick && "cursor-pointer hover:border-accent/50 hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        active && "border-accent ring-1 ring-accent"
      )}
    >
      {Icon && (
        <div
          className={cn(
            "flex h-[34px] w-[34px] items-center justify-center rounded-[9px] bg-surface-2",
            tone === "indigo" && "bg-accent-2-soft",
            active && "bg-accent-soft"
          )}
        >
          <Icon className={cn("h-4 w-4 text-text-muted", tone === "indigo" && "text-accent-2", active && "text-accent")} />
        </div>
      )}
      <div>
        <p className="text-xs font-semibold text-text-faint">{label}</p>
        <p
          className={cn(
            "text-[1.625rem] font-extrabold tracking-tight tabular-nums",
            tone === "rose" && "text-rose"
          )}
        >
          {value}
        </p>
        {foot && <p className="mt-1 text-[0.8125rem] text-text-faint">{foot}</p>}
      </div>
    </Comp>
  );
}
