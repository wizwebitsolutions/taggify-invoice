import { CheckIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

export type TimelineStepState = "done" | "current" | "pending";

export interface TimelineStep {
  title: string;
  time?: string;
  state: TimelineStepState;
}

/**
 * Renders a Link's status history (backend: LinkStatusEvent, exposed via
 * GET /links/:id/timeline) as a vertical stepper.
 */
export function StatusTimeline({ steps }: { steps: TimelineStep[] }) {
  return (
    <div className="flex flex-col">
      {steps.map((step, i) => {
        const isLast = i === steps.length - 1;
        return (
          <div key={step.title} className="flex gap-3.5">
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
                  step.state === "done" && "bg-accent-soft text-accent",
                  step.state === "current" && "bg-accent-2-soft text-accent-2",
                  step.state === "pending" && "border border-border-strong bg-surface-2 text-text-faint"
                )}
              >
                {step.state === "done" && <CheckIcon className="h-[11px] w-[11px]" />}
                {step.state === "current" && <span className="h-2 w-2 rounded-full bg-current" />}
              </div>
              {!isLast && <div className="my-1 w-[1.5px] flex-1 bg-border-strong" />}
            </div>
            <div className={cn("min-w-0", isLast ? "pb-0" : "pb-6")}>
              <div className={cn("text-[0.8438rem] font-semibold", step.state === "pending" && "font-medium text-text-faint")}>
                {step.title}
              </div>
              {step.time && <div className="mt-0.5 text-xs text-text-faint">{step.time}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
