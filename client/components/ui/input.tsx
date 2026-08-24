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
          "flex h-11 w-full rounded-md border border-border-strong bg-surface-2 px-3.5 font-ui text-[0.9375rem] text-text placeholder:text-text-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50",
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
