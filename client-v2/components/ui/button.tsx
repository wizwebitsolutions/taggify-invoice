import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

// shadcn Button, restyled to the approved reference (ux/design-ref/...FINAL.png):
// radius 10, 600 weight. `default` is the black CTA ("Process Payout"),
// `brand` the orange one, `success` the green "Submit payout", `outline` the
// white bordered button. Every button presses down to 98% with CSS only.
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md font-semibold transition-[color,background-color,border-color,transform] duration-hover ease-out active:scale-[0.98] focus-visible:outline-none focus-visible:ring-focus focus-visible:ring-ring-soft disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "shadow-1 bg-primary text-primary-foreground hover:bg-primary-hover",
        brand: "shadow-1 bg-brand text-brand-foreground hover:bg-brand-hover",
        success: "bg-success-strong text-white hover:brightness-95",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive-hover",
        outline: "border border-input bg-secondary text-secondary-foreground hover:bg-muted",
        secondary: "border border-input bg-secondary text-secondary-foreground hover:bg-muted",
        ghost: "text-fg-strong hover:bg-muted hover:text-foreground",
        link: "h-auto px-0 text-link underline-offset-4 hover:text-link-hover hover:underline active:scale-100",
      },
      size: {
        default: "h-control px-4 text-small",
        sm: "h-control-sm px-3 text-label",
        lg: "h-control-lg px-6 text-body [&_svg]:size-[18px]",
        icon: "h-control w-control text-body",
        "icon-lg": "h-control-lg w-control-lg text-body [&_svg]:size-5",
        "icon-sm": "h-8 w-8 text-small",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, type, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        // Plain buttons default to type="button" so they never submit a form by accident.
        type={asChild ? undefined : (type ?? "button")}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
