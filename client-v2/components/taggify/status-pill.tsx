import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

/**
 * Reference status pill ("Verified", "Pending", "Due", "Paid"): the word on the
 * tone's soft background, no dot. Status never relies on colour alone; the
 * word always says it.
 */
export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";

export function StatusPill({ tone = "neutral", children, className }: { tone?: StatusTone; children: React.ReactNode; className?: string }) {
  return (
    <Badge variant={tone} className={cn("status-pill", className)}>
      {children}
    </Badge>
  );
}

/** Marker for elements that are visible but not wired to the backend yet. */
export function SoonBadge({ className, children = "Soon" }: { className?: string; children?: React.ReactNode }) {
  return (
    <Badge variant="soon" className={className}>
      {children}
    </Badge>
  );
}
