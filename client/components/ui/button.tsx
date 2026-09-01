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
  // relative/isolate/overflow-hidden + the before: pseudo-element is the
  // hover "sweep" — a diagonal highlight band that slides from fully
  // off-canvas right to fully off-canvas left (before:translate-x-full at
  // rest, hover:before:-translate-x-full), clipped to the button's own pill
  // shape. -z-10 (inside `isolate`, so it's scoped to this button, not the
  // page) keeps it under the label/icon and over the button's own fill.
  // Replaces the old hover:-translate-y-px lift — the button no longer
  // moves on hover, only the sweep does.
  "relative isolate inline-flex items-center justify-center gap-2 overflow-hidden whitespace-nowrap font-ui font-bold transition-[background-color,border-color,transform] duration-200 before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:translate-x-full before:bg-[linear-gradient(115deg,transparent_35%,oklch(100%_0_0/.35)_50%,transparent_65%)] before:transition-transform before:duration-500 before:ease-out before:content-[''] hover:before:-translate-x-full disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg active:scale-[0.98]",
  {
    variants: {
      variant: {
        // Glass: translucent accent fill (--btn-primary-bg) + backdrop blur
        // + a contained glow (a thin accent-tinted ring + inset top sheen,
        // both from styles/tokens.css) — used to also blur outward well
        // past the button's own edges on hover; now a fixed, contained
        // amount at rest, so the hover sweep above is the only thing that
        // moves or changes.
        primary: "bg-[var(--btn-primary-bg)] backdrop-blur-glass text-accent-ink border border-[var(--btn-primary-border)] shadow-glow",
        secondary: "bg-[var(--btn-secondary-bg)] backdrop-blur-glass text-text border border-border-strong hover:bg-surface-hover",
        ghost: "bg-transparent text-text-muted border border-border hover:bg-surface hover:text-text",
        danger: "bg-[var(--btn-danger-bg)] backdrop-blur-glass text-rose border border-[var(--btn-danger-border)] shadow-glow-rose",
      },
      size: {
        // Pill/circle throughout — the X/Spotify shape language: every
        // button is a full pill, every icon-only button a true circle,
        // never the old 12px-radius rectangle.
        sm: "h-8 rounded-full px-3 text-xs [&_svg]:size-3.5",
        default: "h-10 rounded-full px-5 text-sm [&_svg]:size-4",
        lg: "h-12 rounded-full px-7 text-[0.9375rem] [&_svg]:size-4",
        icon: "h-10 w-10 rounded-full [&_svg]:size-4",
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
