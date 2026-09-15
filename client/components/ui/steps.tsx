import { CheckIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

/**
 * Wizard stepper from the premium mockup: numbered 22px circles joined by
 * hairlines, done = ink-filled with a tick, current = ink ring, upcoming =
 * faint. Every long form in the app is a ≤4-step wizard with a review step.
 */
export function Steps({ steps, current, className }: { steps: string[]; current: number; className?: string }) {
  return (
    <ol className={cn("no-scrollbar flex shrink-0 items-center overflow-x-auto", className)} aria-label="Steps">
      {steps.map((label, i) => {
        const done = i < current;
        const cur = i === current;
        return (
          <li key={label} className="flex items-center">
            <div className={cn("flex items-center gap-2 whitespace-nowrap text-[0.8125rem] font-medium text-text-faint", done && "text-text-2", cur && "font-semibold text-text")} aria-current={cur ? "step" : undefined}>
              <span
                className={cn(
                  "flex h-[22px] w-[22px] items-center justify-center rounded-full border border-border-strong bg-surface text-[0.72rem] tabular-nums",
                  done && "border-ink bg-ink text-ink-fg",
                  cur && "border-ink text-text shadow-[0_0_0_3px_var(--surface-2)]"
                )}
              >
                {done ? <CheckIcon className="h-3 w-3" /> : i + 1}
              </span>
              {label}
            </div>
            {i < steps.length - 1 && <span className="mx-3 h-px w-8 shrink-0 bg-border-strong md:w-12" />}
          </li>
        );
      })}
    </ol>
  );
}
