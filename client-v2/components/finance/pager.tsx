"use client";

import { useId } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const PER_PAGE = 10;
export const PER_PAGE_OPTIONS = [10, 25, 50] as const;

/**
 * Which page buttons to show: all of them up to 7, otherwise a window of 5
 * around the current page with the first/last page and "…" for the gaps
 * (page 1 of 15 → 1 2 3 4 5 … 15; page 8 → 1 … 6 7 8 9 10 … 15).
 */
export function pageItems(page: number, pages: number): (number | "gap")[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const start = Math.max(1, Math.min(page - 2, pages - 4));
  const end = start + 4;
  const out: (number | "gap")[] = [];
  if (start > 1) out.push(1);
  if (start > 2) out.push("gap");
  for (let p = start; p <= end; p++) out.push(p);
  if (end < pages - 1) out.push("gap");
  if (end < pages) out.push(pages);
  return out;
}

/**
 * List footer: "Showing 1–10 of 210 pages" (with an optional Rows picker) on
 * the left, and one joined pager bar on the right: Prev · 1 2 3 4 5 … 21 · Next,
 * the current page filled (Inventory declutter, 3 Nov). Client-side over the
 * loaded rows. `perPage`/`onPerPage` are optional; without them it's 10 a page.
 */
export function Pager({
  total,
  page,
  pages,
  noun,
  onPage,
  perPage = PER_PAGE,
  onPerPage,
  children,
}: {
  total: number;
  page: number;
  pages: number;
  noun: string;
  onPage: (p: number) => void;
  perPage?: number;
  onPerPage?: (n: number) => void;
  children?: React.ReactNode;
}) {
  const rowsId = useId();
  const from = total ? (page - 1) * perPage + 1 : 0;
  const to = Math.min(total, page * perPage);
  return (
    <div className="pager-footer">
      <div className="flex flex-wrap items-center gap-4 text-small text-muted-foreground">
        {onPerPage && total > PER_PAGE_OPTIONS[0] && (
          <span className="flex items-center gap-2">
            <span id={rowsId}>Rows</span>
            <Select value={String(perPage)} onValueChange={(v) => onPerPage(Number(v))}>
              <SelectTrigger aria-labelledby={rowsId} className="h-control-sm w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PER_PAGE_OPTIONS.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </span>
        )}
        <span>{total ? `Showing ${from}–${to} of ${total} ${noun}` : `No ${noun}`}</span>
      </div>
      {pages > 1 && (
        <nav aria-label="Pages" className="pager-group">
          <Button variant="ghost" size="sm" className="pager-step" aria-label="Previous page" disabled={page === 1} onClick={() => onPage(page - 1)}>
            <ArrowLeft />
            Prev
          </Button>
          {pageItems(page, pages).map((p, i) =>
            p === "gap" ? (
              <span key={`gap-${i}`} className="pager-gap" aria-hidden>
                …
              </span>
            ) : (
              <button key={p} type="button" className={cn("pager-num", p === page && "pager-num-current")} aria-current={p === page ? "page" : undefined} onClick={() => onPage(p)}>
                {p}
              </button>
            ),
          )}
          <Button variant="ghost" size="sm" className="pager-step" aria-label="Next page" disabled={page === pages} onClick={() => onPage(page + 1)}>
            Next
            <ArrowRight />
          </Button>
        </nav>
      )}
      {children}
    </div>
  );
}
