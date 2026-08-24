import type { ComponentType } from "react";

import { cn } from "@/lib/utils";

export function KpiCard({
  icon: Icon,
  label,
  value,
  foot,
  tone,
}: {
  icon?: ComponentType<{ className?: string }>;
  label: string;
  value: string;
  foot?: string;
  /** Highlights the card as needing attention — omit for the neutral look. */
  tone?: "gold" | "rose";
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3.5 rounded-lg border border-border bg-surface p-5 shadow-card",
        tone === "gold" && "border-accent-2/35 bg-gradient-to-b from-accent-2-soft to-transparent",
        tone === "rose" && "border-rose/35 bg-gradient-to-b from-rose-soft to-transparent"
      )}
    >
      {Icon && (
        <div
          className={cn(
            "flex h-[34px] w-[34px] items-center justify-center rounded-[9px] bg-surface-2",
            tone === "gold" && "bg-accent-2-soft"
          )}
        >
          <Icon className={cn("h-4 w-4 text-text-muted", tone === "gold" && "text-accent-2")} />
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
    </div>
  );
}
