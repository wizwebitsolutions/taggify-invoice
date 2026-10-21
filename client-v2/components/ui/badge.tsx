import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

// shadcn Badge, restyled to the reference: status pills are 26px, radius 7,
// 12.5px 600 ("Verified", "Pending", "Due"); `chip` is the peach category pill
// (Food / Travel); `tag` the soft grey pill on page cards.
const badgeVariants = cva(
  "inline-flex h-pill items-center gap-2 whitespace-nowrap rounded-sm px-3 text-label font-semibold transition-colors duration-hover",
  {
    variants: {
      variant: {
        default: "bg-brand-soft text-brand-ink",
        chip: "h-7 rounded-pill bg-chip px-4 text-small font-medium text-chip-foreground",
        tag: "h-6 rounded-pill bg-muted px-3 text-small font-normal text-fg-strong",
        secondary: "bg-muted text-muted-foreground",
        outline: "border border-input text-fg-strong",
        destructive: "bg-danger-soft text-danger-fg",
        success: "bg-success-soft text-success-fg",
        warning: "bg-warning-soft text-warning-fg",
        danger: "bg-danger-soft text-danger-fg",
        info: "bg-info-soft text-info-fg",
        neutral: "bg-status-neutral-soft text-status-neutral-fg",
        // Canvas "needs backend" marker: dashed violet outline.
        soon: "h-auto border border-dashed border-brand-300 bg-brand-soft px-2 py-1 text-micro text-brand-ink",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
