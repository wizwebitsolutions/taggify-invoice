import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * The one Button in the app. Every screen imports this — never a
 * hand-rolled <button className="..."> — so a variant/size change here
 * updates every instance app-wide. Values match the Foundations mockup
 * (frontend-design/Foundations.dc.html) and read colors/radii only
 * through Tailwind utilities that resolve to styles/tokens.css. See
 * frontend.md §3.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-ui font-bold transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
  {
    variants: {
      variant: {
        primary: "bg-accent text-accent-ink shadow-accent-glow hover:brightness-110",
        secondary: "bg-surface-2 text-text border border-border-strong hover:bg-surface-hover",
        ghost: "bg-transparent text-text-muted border border-border hover:bg-surface hover:text-text",
        danger: "bg-rose-soft text-rose hover:brightness-110",
      },
      size: {
        sm: "h-8 rounded-full px-3 text-xs [&_svg]:size-3.5",
        default: "h-10 rounded-md px-[18px] text-sm [&_svg]:size-4",
        lg: "h-12 rounded-md px-6 text-[0.9375rem] [&_svg]:size-4",
        icon: "h-10 w-10 rounded-md [&_svg]:size-4",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
