import { cn } from "@/lib/utils";
import { Money } from "@/components/taggify/money";
import { ProgressBar } from "@/components/taggify/progress-meter";

/** "Budget left" bar (v1 BudgetLeft): the internal budget against what the picked pages cost us. */
export function BudgetMeter({ budget, used, className }: { budget: number | null; used: number; className?: string }) {
  if (budget == null || !(budget > 0)) return null;
  const left = budget - used;
  const over = left < 0;
  return (
    <div className={cn("flex flex-col gap-2", className)} data-testid="budget-meter">
      <p className="flex items-baseline justify-between gap-2 text-small">
        <span className="text-muted-foreground">{over ? "Over budget by" : "Budget left"}</span>
        <span className={cn("whitespace-nowrap text-body-strong", over ? "text-danger-fg" : "text-foreground")}>
          <Money value={Math.abs(left)} />
        </span>
      </p>
      <ProgressBar value={used} max={budget} label="Budget used" />
      <p className="text-caption text-muted-foreground">
        <Money value={used} /> of <Money value={budget} /> used
      </p>
    </div>
  );
}
