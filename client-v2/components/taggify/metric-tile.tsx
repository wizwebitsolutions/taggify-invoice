import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Reference metric tile (Total Dues / Dues This Month / Paid This Month):
 * a tinted card, a tinted 52px icon square, then label → big value → one meta
 * line. Tone picks the tint; it never carries meaning on its own.
 */
export type TileTone = "coral" | "amber" | "mint";

const TONE: Record<TileTone, { card: string; icon: string }> = {
  coral: { card: "bg-tile-coral", icon: "bg-tile-coral-icon text-tile-coral-fg" },
  amber: { card: "bg-tile-amber", icon: "bg-tile-amber-icon text-tile-amber-fg" },
  mint: { card: "bg-tile-mint", icon: "bg-tile-mint-icon text-tile-mint-fg" },
};

export function MetricTile({
  tone,
  icon: Icon,
  label,
  value,
  meta,
  loading,
  className,
}: {
  tone: TileTone;
  icon: LucideIcon;
  label: string;
  value: React.ReactNode;
  meta?: React.ReactNode;
  /** Shows a placeholder bar instead of a value, so a loading ₹0 is never read as "nothing owed". */
  loading?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("metric-tile flex items-start gap-4 rounded-card border p-5", TONE[tone].card, className)}>
      <span className={cn("grid h-12 w-12 shrink-0 place-items-center rounded-lg", TONE[tone].icon)}>
        <Icon className="h-6 w-6" strokeWidth={1.8} aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="text-body font-medium text-fg-strong">{label}</p>
        {loading ? (
          <span className="mt-2 block h-7 w-32 animate-pulse rounded-sm bg-foreground/10" aria-label="Loading" />
        ) : (
          <p className="num mt-1 text-display text-foreground">{value}</p>
        )}
        {meta && <p className="mt-2 text-small text-muted-foreground">{meta}</p>}
      </div>
    </div>
  );
}
