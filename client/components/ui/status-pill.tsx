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
        gold: "bg-accent-2-soft text-accent-2",
        rose: "bg-rose-soft text-rose",
        blue: "bg-blue-soft text-blue",
        emerald: "bg-accent-soft text-accent",
      },
    },
    defaultVariants: { tone: "slate" },
  }
);

type Tone = VariantProps<typeof statusPillVariants>["tone"];

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

export type InvoiceStatus = "DRAFT" | "RAISED" | "APPROVED" | "PAID";
export type GstStatus = "PENDING" | "SCHEDULED" | "COMPLETED";
export type PillStatus = LinkStatus | InvoiceStatus | GstStatus | "OVERDUE";

const STATUS_CONFIG: Record<PillStatus, { label: string; tone: Tone }> = {
  SUBMITTED: { label: "Submitted", tone: "slate" },
  PENDING_SCREENSHOT_REVIEW: { label: "Pending review", tone: "gold" },
  SCREENSHOT_REJECTED: { label: "Rejected", tone: "rose" },
  SCREENSHOT_APPROVED: { label: "Approved", tone: "emerald" },
  INSIGHTS_PENDING: { label: "Insights pending", tone: "blue" },
  INSIGHTS_APPROVED: { label: "Insights approved", tone: "emerald" },
  INVOICED: { label: "Invoiced", tone: "gold" },
  DRAFT: { label: "Draft", tone: "slate" },
  RAISED: { label: "Raised", tone: "blue" },
  APPROVED: { label: "Approved", tone: "emerald" },
  PAID: { label: "Paid", tone: "emerald" },
  PENDING: { label: "Pending", tone: "slate" },
  SCHEDULED: { label: "Scheduled", tone: "gold" },
  COMPLETED: { label: "Completed", tone: "emerald" },
  OVERDUE: { label: "Overdue", tone: "rose" },
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
      {detail ? `${config.label} · ${detail}` : config.label}
    </span>
  );
}
