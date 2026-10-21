import * as React from "react";
import { Search } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Reference search: `bordered` (white, 40px, in filter rows) or `soft`
 * (filled grey, 42px, the top bar) with an optional shortcut hint ("⌘ K").
 */
export const SearchField = React.forwardRef<
  HTMLInputElement,
  Omit<React.ComponentProps<"input">, "type"> & { variant?: "bordered" | "soft"; shortcut?: string; label: string }
>(({ variant = "bordered", shortcut, label, className, ...props }, ref) => (
  <label
    className={cn(
      "flex min-w-0 items-center gap-3 rounded-md text-fg-muted transition-[border-color,box-shadow] duration-hover focus-within:border-ring focus-within:shadow-focus",
      variant === "soft" ? "h-control bg-muted pl-4 pr-3" : "h-control border border-input bg-card px-3",
      className
    )}
  >
    <Search className="h-[18px] w-[18px] shrink-0" strokeWidth={1.8} aria-hidden />
    <input
      ref={ref}
      type="search"
      aria-label={label}
      className="min-w-0 flex-1 bg-transparent text-body text-foreground outline-none placeholder:text-fg-placeholder [&::-webkit-search-cancel-button]:hidden"
      {...props}
    />
    {shortcut && <kbd className="rounded-xs bg-kbd px-2 py-1 font-sans text-caption text-fg-strong">{shortcut}</kbd>}
  </label>
));
SearchField.displayName = "SearchField";
