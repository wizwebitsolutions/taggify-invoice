import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * The one Button in the app. Every screen imports this — never a
 * hand-rolled <button className="...">.
 *
 * Premium system: 8px-radius rectangles (no pills), black primary with a
 * 1px inset top highlight, white secondary with a hairline border and a
 * 1px shadow. Hover is a 1px lift + brightness; no sweep, no glow.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-ui font-semibold transition-[transform,box-shadow,background-color,border-color,filter] duration-150 ease-premium hover:-translate-y-px active:translate-y-0 active:scale-[0.99] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-30 focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
  {
    variants: {
      variant: {
        primary: "bg-ink text-ink-fg border border-transparent shadow-glow hover:brightness-110",
        secondary: "bg-surface text-text border border-border-strong shadow-card hover:bg-surface-2",
        ghost: "bg-transparent text-text-2 border border-transparent hover:bg-surface-2 hover:text-text",
        danger: "bg-surface text-rose border border-border-strong shadow-card hover:bg-rose-soft hover:border-rose-line",
      },
      size: {
        sm: "h-[30px] rounded-[7px] px-2.5 text-[0.78rem] [&_svg]:size-3.5",
        default: "h-9 rounded-md px-3.5 text-[0.8125rem] [&_svg]:size-4",
        lg: "h-[46px] rounded-[10px] px-5 text-[0.9rem] [&_svg]:size-4",
        icon: "h-9 w-9 rounded-md [&_svg]:size-4",
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
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
