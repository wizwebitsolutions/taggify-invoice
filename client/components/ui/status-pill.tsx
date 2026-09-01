import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * The one status pill in the app — every table row, filter chip, and
 * detail panel renders status through this component, never a
 * hand-styled <span>. Tone colors resolve through Tailwind utilities to
 * styles/tokens.css, same as Button. See frontend.md §3.
 */
const statusPillVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-1 text-[0.6875rem] font-bold font-ui leading-none",
  {
    variants: {
      tone: {
        slate: "bg-slate-soft text-slate",
        // Was "indigo" — --accent-2 is now a violet hue (palette v2, see
        // styles/tokens.css), renamed so the tone name matches what it
        // actually renders.
        violet: "bg-accent-2-soft text-accent-2",
        rose: "bg-rose-soft text-rose",
        blue: "bg-blue-soft text-blue",
        emerald: "bg-accent-soft text-accent",
      },
    },
    defaultVariants: { tone: "slate" },
  }
);

export type Tone = VariantProps<typeof statusPillVariants>["tone"];

// Mirrors the backend's Prisma enums exactly (server/prisma/schema.prisma)
// plus one UI-only status ("OVERDUE") derived from an invoice's dueDate
// rather than stored directly.
export type LinkStatus =
  | "SUBMITTED"
  | "PENDING_SCREENSHOT_REVIEW"
  | "SCREENSHOT_REJECTED"
  | "SCREENSHOT_APPROVED"
  | "INSIGHTS_PENDING"
  | "INSIGHTS_APPROVED"
  | "INVOICED";

export type InvoiceStatus = "DRAFT" | "RAISED" | "APPROVED" | "REJECTED" | "PAID";
export type GstStatus = "PENDING" | "SCHEDULED" | "COMPLETED";
export type PaymentStatus = "PENDING" | "COMPLETED" | "CANCELLED";
export type PillStatus = LinkStatus | InvoiceStatus | GstStatus | PaymentStatus | "OVERDUE";

// Exported so charts (admin dashboard) can color a status bar/segment with
// exactly the same tone a pill for that status would use — one source of
// truth for "what color is this status" instead of a second lookup drifting
// from this one.
//
// `live: true` marks a status that's genuinely still in flight — waiting on
// someone else's imminent action — and gets the pulsing dot below. Terminal/
// resting states (rejected, approved, paid, draft, ...) don't pulse: motion
// here is meant to mean something, not decorate every pill equally.
export const STATUS_CONFIG: Record<PillStatus, { label: string; tone: Tone; live?: boolean }> = {
  SUBMITTED: { label: "Submitted", tone: "slate" },
  PENDING_SCREENSHOT_REVIEW: { label: "Pending review", tone: "violet", live: true },
  SCREENSHOT_REJECTED: { label: "Rejected", tone: "rose" },
  SCREENSHOT_APPROVED: { label: "Approved", tone: "emerald" },
  INSIGHTS_PENDING: { label: "Insights pending", tone: "blue", live: true },
  INSIGHTS_APPROVED: { label: "Insights approved", tone: "emerald" },
  INVOICED: { label: "Invoiced", tone: "violet" },
  DRAFT: { label: "Draft", tone: "slate" },
  RAISED: { label: "Raised", tone: "blue", live: true },
  APPROVED: { label: "Approved", tone: "emerald" },
  REJECTED: { label: "Rejected", tone: "rose" },
  PAID: { label: "Paid", tone: "emerald" },
  PENDING: { label: "Pending", tone: "slate", live: true },
  SCHEDULED: { label: "Scheduled", tone: "violet", live: true },
  COMPLETED: { label: "Completed", tone: "emerald" },
  CANCELLED: { label: "Cancelled", tone: "rose" },
  OVERDUE: { label: "Overdue", tone: "rose", live: true },
};

export interface StatusPillProps {
  status: PillStatus;
  /** Appended after "·", e.g. detail="12d" on OVERDUE -> "Overdue · 12d" */
  detail?: string;
  className?: string;
}

export function StatusPill({ status, detail, className }: StatusPillProps) {
  const config = STATUS_CONFIG[status];
  return (
    <span className={cn(statusPillVariants({ tone: config.tone }), className)}>
      {config.live && (
        <span
          aria-hidden="true"
          data-testid="status-pill-live-dot"
          className="mr-1.5 inline-block h-[5px] w-[5px] shrink-0 rounded-full bg-current motion-safe:animate-pulse"
        />
      )}
      {detail ? `${config.label} · ${detail}` : config.label}
    </span>
  );
}
