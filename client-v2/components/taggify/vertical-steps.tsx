import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Reference rail stepper: numbered circles (01 … 04) joined by a dashed line.
 * Current step = solid orange circle + orange label; done = soft orange circle
 * with a tick. Rendered as an ordered list with aria-current on the active step.
 */
export function VerticalSteps({ steps, current, allDone, className }: { steps: string[]; current: number; allDone?: boolean; className?: string }) {
  return (
    <ol className={cn("flex flex-col gap-4 px-3", className)}>
      {steps.map((label, i) => {
        const done = allDone || i < current;
        const active = !allDone && i === current;
        return (
          <li
            key={label}
            aria-current={active ? "step" : undefined}
            className={cn(
              "relative flex items-center gap-4 text-body text-step-fg",
              i > 0 && "before:absolute before:-top-4 before:left-4 before:-ml-px before:h-4 before:border-l-2 before:border-dashed before:border-step-line",
              active && "font-semibold text-brand-ink",
              done && "text-fg-strong"
            )}
          >
            <span
              className={cn(
                "relative z-[1] grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 border-step-ring bg-card text-caption font-semibold text-step-num",
                active && "border-brand bg-brand text-brand-foreground",
                done && "border-brand-soft bg-step-done text-brand-ink"
              )}
            >
              {done ? <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden /> : String(i + 1).padStart(2, "0")}
            </span>
            {label}
            {done && <span className="sr-only">(done)</span>}
          </li>
        );
      })}
    </ol>
  );
}
