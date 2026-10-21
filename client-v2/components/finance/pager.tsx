import { ArrowLeft, ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";

export const PER_PAGE = 10;

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
          {Array.from({ length: pages }, (_, i) => i + 1).map((p) => (
            <Button key={p} variant={p === page ? "brand" : "outline"} size="icon" className="h-control-sm w-control-sm text-small" aria-current={p === page ? "page" : undefined} onClick={() => onPage(p)}>
              {p}
            </Button>
          ))}
          <Button variant="outline" size="icon" className="h-control-sm w-control-sm" aria-label="Next page" disabled={page === pages} onClick={() => onPage(page + 1)}>
            <ArrowRight />
          </Button>
        </nav>
      )}
      {children}
    </div>
  );
}
