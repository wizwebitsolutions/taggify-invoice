import { cn } from "@/lib/utils";
import type { Link } from "@/lib/api-client";

/**
 * The five-segment post status line from the premium mockup — Submitted →
 * Proof → Verified → Approved → Invoiced. Every list, card and detail shows
 * it identically so a creator and an admin read the same thing.
 * Filled = done, amber = the step currently waiting, red = blocked there.
 */
const STEP_INDEX: Record<Link["status"], { done: number; cur: number; bad?: boolean }> = {
  SUBMITTED: { done: 1, cur: 2 },
  PENDING_SCREENSHOT_REVIEW: { done: 1, cur: 2 },
  SCREENSHOT_REJECTED: { done: 1, cur: 2, bad: true },
  SCREENSHOT_APPROVED: { done: 2, cur: 3 },
  INSIGHTS_PENDING: { done: 3, cur: 4 },
  INSIGHTS_APPROVED: { done: 4, cur: 5 },
  INVOICED: { done: 5, cur: 0 },
  INVALID: { done: 1, cur: 2, bad: true },
};

export const STEP_LABELS = ["Submitted", "Proof", "Verified", "Approved", "Invoiced"] as const;

export function StatusSteps({ status, className, animate = true }: { status: Link["status"]; className?: string; animate?: boolean }) {
  const s = STEP_INDEX[status];
  return (
    <div className={cn("flex items-center gap-[3px]", className)} data-testid="status-steps" aria-label={`Status: ${status}`}>
      {[1, 2, 3, 4, 5].map((i) => {
        const on = i <= s.done;
        const cur = i === s.cur;
        return (
          <i
            key={i}
            className={cn(
              "block h-[3px] w-[18px] rounded-full bg-border",
              on && "bg-ink",
              cur && !s.bad && "bg-accent-2",
              cur && s.bad && "bg-rose",
              animate && (on || cur) && "origin-left motion-safe:animate-grow-x"
            )}
            style={animate ? { animationDelay: `${0.35 + i * 0.05}s` } : undefined}
          />
        );
      })}
    </div>
  );
}

/** Human line under a status line: what the post is waiting for, and on whom. */
export function statusHint(status: Link["status"]): { text: string; tone: "ok" | "wait" | "bad" | "neutral" } {
  switch (status) {
    case "SUBMITTED":
      return { text: "Add screenshot proof", tone: "wait" };
    case "PENDING_SCREENSHOT_REVIEW":
      return { text: "Proof under review", tone: "wait" };
    case "SCREENSHOT_REJECTED":
      return { text: "Proof rejected · re-upload", tone: "bad" };
    case "SCREENSHOT_APPROVED":
      return { text: "Proof approved · fetching insights", tone: "wait" };
    case "INSIGHTS_PENDING":
      return { text: "Insights pending", tone: "wait" };
    case "INSIGHTS_APPROVED":
      return { text: "Ready to invoice", tone: "ok" };
    case "INVOICED":
      return { text: "Invoiced", tone: "neutral" };
    case "INVALID":
      return { text: "Link not working", tone: "bad" };
  }
}
