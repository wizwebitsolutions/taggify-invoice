import { ArrowLeft, ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";

export const PER_PAGE = 10;

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

/** Reference pagination: "Showing 1–5 of 8 items" + square page buttons, current one solid orange. Client-side over the loaded rows. */
export function Pager({ total, page, pages, noun, onPage, children }: { total: number; page: number; pages: number; noun: string; onPage: (p: number) => void; children?: React.ReactNode }) {
  const from = total ? (page - 1) * PER_PAGE + 1 : 0;
  const to = Math.min(total, page * PER_PAGE);
  return (
    <div className="flex flex-wrap items-center gap-3 border-t px-5 py-4">
      <span className="text-small text-muted-foreground">{total ? `Showing ${from}–${to} of ${total} ${noun}` : `No ${noun}`}</span>
      {pages > 1 && (
        <nav aria-label="Pages" className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="icon" className="h-control-sm w-control-sm" aria-label="Previous page" disabled={page === 1} onClick={() => onPage(page - 1)}>
            <ArrowLeft />
          </Button>
          {pageItems(page, pages).map((p, i) =>
            p === "gap" ? (
              <span key={`gap-${i}`} className="inline-flex h-control-sm w-control-sm items-center justify-center text-small text-muted-foreground" aria-hidden>
                …
              </span>
            ) : (
            <Button key={p} variant={p === page ? "brand" : "outline"} size="icon" className="h-control-sm w-control-sm text-small" aria-current={p === page ? "page" : undefined} onClick={() => onPage(p)}>
              {p}
            </Button>
            ),
          )}
          <Button variant="outline" size="icon" className="h-control-sm w-control-sm" aria-label="Next page" disabled={page === pages} onClick={() => onPage(page + 1)}>
            <ArrowRight />
          </Button>
        </nav>
      )}
      {children}
    </div>
  );
}
