import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * The one text input in the app. Same single-source rule as Button: any
 * screen needing a text field imports this, never a raw <input
 * className="...">. See frontend.md §3.
 */
const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full rounded-md border border-border-strong bg-surface px-3 font-ui text-[0.875rem] text-text shadow-card transition-[box-shadow,border-color] duration-150 placeholder:text-text-faint hover:border-text-faint focus-visible:border-ink focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ink-10 disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export { Input };
