"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";

/**
 * Table-header selection control (Inventory declutter, 3 Nov): a checkbox for
 * the rows on screen, split with a menu for "first 25 / 50", "all N", a typed
 * number, and clear. Replaces the always-visible "Select first …" strip.
 */
export function SelectMenu({
  total,
  shown,
  shownSelected,
  selectedCount,
  onToggleShown,
  onSelectFirst,
  onClear,
}: {
  /** Rows across every pager page of the current filter. */
  total: number;
  /** Rows on the current pager page. */
  shown: number;
  shownSelected: number;
  selectedCount: number;
  onToggleShown: (on: boolean) => void;
  onSelectFirst: (n: number) => void;
  onClear: () => void;
}) {
  const [n, setN] = useState("");
  const [open, setOpen] = useState(false);
  const apply = () => {
    const v = Number.parseInt(n, 10);
    if (!Number.isFinite(v) || v <= 0) return;
    onSelectFirst(v);
    setN("");
    setOpen(false);
  };
  const quick = [25, 50].filter((x) => x < total && x > shown);
  return (
    <span className="select-menu">
      <Checkbox
        aria-label="Select all pages on this page"
        checked={shownSelected === 0 ? false : shownSelected === shown ? true : "indeterminate"}
        onCheckedChange={(v) => onToggleShown(v === true)}
      />
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <button type="button" className="select-menu-trigger" aria-label="Selection options">
            <ChevronDown className="h-3.5 w-3.5" aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>Select</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => onToggleShown(true)}>
            This page<span className="ml-auto text-fg-muted">{shown}</span>
          </DropdownMenuItem>
          {quick.map((x) => (
            <DropdownMenuItem key={x} onSelect={() => onSelectFirst(x)}>
              First {x}
              <span className="ml-auto text-fg-muted">{x}</span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem onSelect={() => onSelectFirst(total)}>
            All pages<span className="ml-auto text-fg-muted">{total}</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <div className="flex items-center gap-2 px-2 py-1.5">
            <span className="flex-1 text-small text-fg-strong">First</span>
            <Input
              aria-label={`Number of pages to select (out of ${total})`}
              inputMode="numeric"
              placeholder="e.g. 5"
              className="h-control-sm w-20"
              value={n}
              onChange={(e) => setN(e.target.value.replace(/\D/g, "").slice(0, 5))}
              // The menu's type-ahead would otherwise swallow the digits.
              onKeyDown={(e) => {
                if (e.key !== "Escape" && e.key !== "Tab") e.stopPropagation();
                if (e.key === "Enter") {
                  e.preventDefault();
                  apply();
                }
              }}
            />
            <Button size="sm" variant="outline" disabled={!n} onClick={apply}>
              Select
            </Button>
          </div>
          {selectedCount > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onClear}>Clear selection</DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}
