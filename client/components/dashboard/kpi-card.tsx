import type { ComponentType } from "react";

import { cn } from "@/lib/utils";
import { SparkLine } from "@/components/charts/spark-line";

/**
 * Premium KPI tile: 12px radius, hairline border, 1px shadow, a 12.5px
 * muted label over a 28px/600 tabular number. Tone only colours the
 * number and foot — never the card chrome. Pops in on mount; lifts on
 * hover when clickable.
 */
export function KpiCard({
  icon: Icon,
  label,
  value,
  foot,
  tone,
  onClick,
  active,
  className,
  sparkline,
}: {
  icon?: ComponentType<{ className?: string }>;
  label: string;
  value: string;
  foot?: string;
  /** Highlights the number as needing attention — omit for the neutral look. */
  tone?: "violet" | "rose";
  /** Makes the card a filter toggle — clicking it drills the table below into this KPI's slice. */
  onClick?: () => void;
  /** Whether this KPI's filter is the one currently applied — draws the ink ring. */
  active?: boolean;
  className?: string;
  /** Chronological values — renders a compact trend line under the value. */
  sparkline?: number[];
}) {
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 text-left shadow-card transition-[transform,box-shadow,border-color] duration-200 ease-premium motion-safe:animate-reveal-pop md:p-5",
        onClick && "cursor-pointer hover:-translate-y-0.5 hover:border-border-strong hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-30",
        active && "border-ink ring-1 ring-ink",
        className
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-[0.78rem] font-medium text-text-muted">{label}</p>
        {Icon && (
          <div
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-[7px] border border-border bg-surface-2 text-text-muted",
              tone === "violet" && "border-accent-2-line bg-accent-2-soft text-accent-2",
              tone === "rose" && "border-rose-line bg-rose-soft text-rose",
              active && "border-ink bg-ink text-ink-fg"
            )}
          >
            <Icon className="h-3.5 w-3.5" />
          </div>
        )}
      </div>
      <div>
        <p
          className={cn(
            "text-[1.75rem] font-semibold leading-none tracking-[-0.035em] tabular-nums",
            tone === "rose" && "text-rose",
            tone === "violet" && "text-accent-2"
          )}
        >
          {value}
        </p>
        {sparkline && sparkline.length >= 2 && (
          <div className="mt-3">
            <SparkLine values={sparkline} color={tone === "rose" ? "var(--rose)" : tone === "violet" ? "var(--accent-2)" : "var(--ink)"} />
          </div>
        )}
        {foot && (
          <p className={cn("mt-1.5 text-[0.75rem] text-text-muted", tone === "rose" && "text-rose", tone === "violet" && "text-accent-2")}>
            {foot}
          </p>
        )}
      </div>
    </Comp>
  );
}
