"use client";

import { SlidersHorizontal, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type FilterChoice = { value: string; label: string };
/** One filter in the menu: its options, the current value ("all" = off) and how to change it. */
export type FilterDef = { key: string; label: string; value: string; options: FilterChoice[]; onChange: (v: string) => void };

/** One filter inside the Filters menu: "Platform · All ›" opening its choices (Inventory, 8 Oct; shared 23 Nov). */
export function FilterSub({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: FilterChoice[] }) {
  const current = options.find((o) => o.value === value)?.label ?? value;
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        {label}
        <span className={cn("ml-auto pl-4 text-small", value === "all" ? "text-fg-muted" : "font-semibold text-brand-ink")}>{current}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="max-h-80 overflow-y-auto">
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          {options.map((o) => (
            <DropdownMenuRadioItem key={o.value} value={o.value}>
              {o.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

/**
 * A "Filters" button whose menu holds every filter, plus a removable chip per
 * active one (23 Nov — "make clean nice ui/ux, it looks messy unstructured").
 * The chips render where `chips` is placed by the caller via FilterChips.
 */
export function FilterMenu({ filters, align = "start" }: { filters: FilterDef[]; align?: "start" | "end" }) {
  const active = filters.filter((f) => f.value !== "all");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">
          <SlidersHorizontal />
          Filters
          {active.length > 0 && <span className="floating-action-count">{active.length}</span>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-60">
        {filters.map((f) => (
          <FilterSub key={f.key} label={f.label} value={f.value} onChange={f.onChange} options={f.options} />
        ))}
        {active.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => active.forEach((f) => f.onChange("all"))}>Clear filters</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A removable chip per active filter: "Vendor: Asha ×". Renders nothing when no filter is on. */
export function FilterChips({ filters }: { filters: FilterDef[] }) {
  const active = filters.filter((f) => f.value !== "all");
  if (active.length === 0) return null;
  return (
    <>
      {active.map((f) => {
        const label = `${f.label}: ${f.options.find((o) => o.value === f.value)?.label ?? f.value}`;
        return (
          <span key={f.key} className="filter-chip">
            {label}
            <button type="button" aria-label={`Remove filter ${label}`} onClick={() => f.onChange("all")}>
              <X className="h-3 w-3" aria-hidden />
            </button>
          </span>
        );
      })}
    </>
  );
}
