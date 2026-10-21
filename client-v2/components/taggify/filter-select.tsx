"use client";

import type { ReactNode } from "react";
import { ChevronDown, type LucideIcon } from "lucide-react";
import * as SelectPrimitive from "@radix-ui/react-select";

import { SelectContent, SelectItem } from "@/components/ui/select";
import { cn } from "@/lib/utils";

/**
 * Reference filter chip: a white bordered 40px control reading "Label: Value"
 * ("Month: Oct 2026", "Page: All"), optional leading icon. A shadcn Select
 * underneath, so keyboard and screen readers get a real listbox. An option's
 * `leading` (e.g. a page's profile photo) shows before its label in the list.
 */
export type FilterOption = { value: string; label: string; leading?: ReactNode };

export function FilterSelect({
  label,
  value,
  options,
  onValueChange,
  icon: Icon,
  className,
}: {
  label: string;
  value: string;
  options: FilterOption[];
  onValueChange: (value: string) => void;
  icon?: LucideIcon;
  className?: string;
}) {
  const current = options.find((o) => o.value === value)?.label ?? value;
  return (
    <SelectPrimitive.Root value={value} onValueChange={onValueChange}>
      <SelectPrimitive.Trigger
        aria-label={`${label}: ${current}`}
        className={cn(
          "inline-flex h-control shrink-0 items-center gap-2 whitespace-nowrap rounded-md border border-input bg-card pl-3 pr-3 text-small text-fg-strong transition-[border-color,box-shadow] duration-hover hover:border-control-line focus:outline-none focus-visible:border-ring focus-visible:shadow-focus",
          className
        )}
      >
        {Icon && <Icon className="h-4 w-4 text-fg-strong" strokeWidth={1.8} aria-hidden />}
        <span>{label}:</span>
        <span className="font-semibold text-foreground">{current}</span>
        <ChevronDown className="ml-1 h-3.5 w-3.5 text-fg-strong" strokeWidth={2.4} aria-hidden />
      </SelectPrimitive.Trigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.leading ? (
              <span className="flex items-center gap-2">
                {o.leading}
                {o.label}
              </span>
            ) : (
              o.label
            )}
          </SelectItem>
        ))}
      </SelectContent>
    </SelectPrimitive.Root>
  );
}
