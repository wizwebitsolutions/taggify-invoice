"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Bulk actions for ticked rows (Inventory declutter, 3 Nov): a small bar that
 * slides up at the bottom of the screen only while something is selected, so
 * the list itself stays quiet. Children are the actions; use
 * <ActionBarDivider /> to set a destructive one apart.
 */
export function FloatingActionBar({ count, total, onClear, children, className }: { count: number; total: number; onClear: () => void; children?: ReactNode; className?: string }) {
  if (count === 0) return null;
  return (
    <div role="region" aria-label="Selected pages" data-testid="selection-bar" className={cn("floating-action-bar", className)}>
      <span className="flex items-center gap-2 pl-2 text-body-strong">
        <span className="floating-action-count">{count}</span> of {total} selected
        <button type="button" className="floating-action-clear" aria-label="Clear selection" onClick={onClear}>
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </span>
      <ActionBarDivider />
      {children}
    </div>
  );
}

export function ActionBarDivider() {
  return <span aria-hidden className="h-6 w-px shrink-0 bg-border" />;
}
