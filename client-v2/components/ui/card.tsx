import * as React from "react"

import { cn } from "@/lib/utils"

// shadcn Card, restyled to the reference: radius 16, warm 1px border and a
// very soft shadow. `premium` = radius 20, for hero moments only.
const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & { premium?: boolean }>(
  ({ className, premium, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "border bg-card text-card-foreground shadow-2",
        premium ? "rounded-modal" : "rounded-card",
        className
      )}
      {...props}
    />
  )
)
Card.displayName = "Card"

/** Title block + optional action on the right (canvas section header). */
const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & { action?: React.ReactNode }>(
  ({ className, action, children, ...props }, ref) => (
    <div ref={ref} className={cn("flex items-start justify-between gap-4 p-6 pb-4", className)} {...props}>
      <div className="flex min-w-0 flex-col gap-1">{children}</div>
      {action}
    </div>
  )
)
CardHeader.displayName = "CardHeader"

const CardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => <h2 ref={ref} className={cn("text-h3 text-foreground", className)} {...props} />
)
CardTitle.displayName = "CardTitle"

const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => <p ref={ref} className={cn("text-small text-muted-foreground", className)} {...props} />
)
CardDescription.displayName = "CardDescription"

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
)
CardContent.displayName = "CardContent"

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex items-center gap-2 border-t border-divider px-6 py-4", className)} {...props} />
  )
)
CardFooter.displayName = "CardFooter"

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent }
