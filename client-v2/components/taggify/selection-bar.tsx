"use client";

import { useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";

/**
 * v1 Inventory's selection row: tick every page in view or the first N of them
 * in the current sort, then act on the selection (`children`). Inventory and
 * Approvals both use it.
 */
export function SelectionBar({ total, selectedCount, onToggleAll, onSelectFirst, className, children }: { total: number; selectedCount: number; onToggleAll: () => void; onSelectFirst: (n: number) => void; className?: string; children?: ReactNode }) {
  const [n, setN] = useState("");
  const all = selectedCount === total;
  const apply = () => {
    const v = Number.parseInt(n, 10);
    if (!Number.isFinite(v) || v <= 0) return;
    onSelectFirst(v);
    setN("");
  };
  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 border-t px-5 py-3", selectedCount > 0 && "bg-brand-50", className)} data-testid="selection-bar">
      <label className="flex cursor-pointer select-none items-center gap-2 text-body-strong">
        <Checkbox checked={selectedCount === 0 ? false : all ? true : "indeterminate"} onCheckedChange={onToggleAll} aria-label={all ? `Deselect all ${total} pages` : `Select all ${total} pages`} />
        {selectedCount > 0 ? `${selectedCount} of ${total} selected` : `Select all ${total}`}
      </label>
      <span className="flex flex-wrap items-center gap-2 text-small text-muted-foreground">
        Select first
        {[10, 25, 50]
          .filter((x) => x < total)
          .map((x) => (
            <Button key={x} size="sm" variant="outline" onClick={() => onSelectFirst(x)}>
              {x}
            </Button>
          ))}
        <Input
          aria-label={`Number of pages to select (out of ${total})`}
          inputMode="numeric"
          placeholder="e.g. 5"
          className="h-control-sm w-20"
          value={n}
          onChange={(e) => setN(e.target.value.replace(/\D/g, "").slice(0, 5))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              apply();
            }
          }}
        />
        <Button size="sm" variant="outline" disabled={!n} onClick={apply}>
          Select
        </Button>
      </span>
      {children}
    </div>
  );
}
