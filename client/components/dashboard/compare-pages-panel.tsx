"use client";

import { useEffect, useState } from "react";

import { Panel } from "@/components/ui/panel";
import { RankedBarList } from "@/components/charts/ranked-bar-list";
import { CompareBarList } from "@/components/charts/compare-bar-list";
import { TableSkeleton, EmptyState } from "@/components/ui/table-parts";
import { cn } from "@/lib/utils";
import { money, count } from "@/lib/format";

export interface PageMetrics {
  id: string;
  handle: string;
  followers: number;
  linksCount: number;
  totalInvoiced: number;
}

const METRICS = [
  { key: "followers", label: "Followers", formatValue: (v: number) => count(v) },
  { key: "linksCount", label: "Links posted", formatValue: (v: number) => count(v) },
  { key: "totalInvoiced", label: "Total invoiced", formatValue: (v: number) => money(v) },
];

/** CompareBarList takes a plain {metricKey: number} map — strips id/handle
 * off a PageMetrics so its shape actually satisfies that (an index
 * signature of `number` can't include the string fields). */
function toMetricValues(p: PageMetrics): Record<string, number> {
  return { followers: p.followers, linksCount: p.linksCount, totalInvoiced: p.totalInvoiced };
}

/**
 * "Top pages" panel — its default is still the plain follower ranking
 * (RankedBarList, unchanged), with an opt-in "Compare" mode that puts two
 * chosen pages side by side across followers/links/invoiced instead of
 * just ranking everyone by one number. Picking two pages here answers "how
 * do these two actually compare", which a single ranked list can't.
 */
export function ComparePagesPanel({
  pages,
  loading,
  onSelectPage,
}: {
  /** Sorted highest-followers-first; only the top slice is rendered in ranked mode. */
  pages: PageMetrics[];
  loading: boolean;
  onSelectPage: () => void;
}) {
  const [mode, setMode] = useState<"ranked" | "compare">("ranked");
  const [pageAId, setPageAId] = useState<string | null>(null);
  const [pageBId, setPageBId] = useState<string | null>(null);

  // Default the two comparison slots to the top 2 by followers once data
  // arrives — still freely reassignable from either dropdown afterward.
  useEffect(() => {
    if (pages.length === 0) return;
    setPageAId((cur) => cur ?? pages[0]?.id ?? null);
    setPageBId((cur) => cur ?? pages[1]?.id ?? pages[0]?.id ?? null);
  }, [pages]);

  const canCompare = pages.length >= 2;
  const pageA = pages.find((p) => p.id === pageAId);
  const pageB = pages.find((p) => p.id === pageBId);

  return (
    <Panel
      title="Top pages"
      subtitle={mode === "ranked" ? "Ranked by follower count." : "Two pages, side by side."}
      action={
        <div className="flex gap-1 rounded-full border border-border bg-surface-2 p-1">
          <button
            type="button"
            onClick={() => setMode("ranked")}
            className={cn("rounded-full px-3 py-1 text-[0.75rem] font-semibold", mode === "ranked" ? "bg-surface shadow-card text-text" : "text-text-faint")}
          >
            Ranked
          </button>
          <button
            type="button"
            onClick={() => canCompare && setMode("compare")}
            disabled={!canCompare}
            title={canCompare ? undefined : "Needs at least 2 pages to compare"}
            className={cn(
              "rounded-full px-3 py-1 text-[0.75rem] font-semibold disabled:cursor-not-allowed disabled:opacity-40",
              mode === "compare" ? "bg-surface shadow-card text-text" : "text-text-faint"
            )}
          >
            Compare
          </button>
        </div>
      }
    >
      {loading ? (
        <TableSkeleton />
      ) : pages.length === 0 ? (
        <EmptyState label="No pages registered yet." />
      ) : mode === "ranked" ? (
        <RankedBarList
          items={pages.slice(0, 6).map((p) => ({ key: p.id, label: `@${p.handle}`, value: p.followers }))}
          formatValue={(v) => count(v)}
          onSelect={onSelectPage}
        />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <select
              aria-label="Compare page A"
              value={pageAId ?? ""}
              onChange={(e) => setPageAId(e.target.value)}
              className="h-9 rounded-full border border-border bg-surface px-3.5 text-[0.8125rem] text-text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-30"
            >
              {pages.map((p) => (
                <option key={p.id} value={p.id}>
                  @{p.handle}
                </option>
              ))}
            </select>
            <select
              aria-label="Compare page B"
              value={pageBId ?? ""}
              onChange={(e) => setPageBId(e.target.value)}
              className="h-9 rounded-full border border-border bg-surface px-3.5 text-[0.8125rem] text-text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-30"
            >
              {pages.map((p) => (
                <option key={p.id} value={p.id}>
                  @{p.handle}
                </option>
              ))}
            </select>
          </div>
          {pageA && pageB && (
            <CompareBarList
              metrics={METRICS}
              seriesA={{ label: `@${pageA.handle}`, color: "var(--accent)", values: toMetricValues(pageA) }}
              seriesB={{ label: `@${pageB.handle}`, color: "var(--accent-2)", values: toMetricValues(pageB) }}
            />
          )}
        </div>
      )}
    </Panel>
  );
}
