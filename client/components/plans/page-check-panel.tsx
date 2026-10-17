"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { Note } from "@/components/ui/note";
import { Tag } from "@/components/ui/tag";
import { RefreshIcon, SearchIcon } from "@/components/icons";
import { plans as plansApi, ApiError, type Asset, type PageCheckResult } from "@/lib/api-client";
import { followersLabel, money } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Why a picked page can't be used right now. */
type Problem = { asset: Asset; reason: "broken" | "inactive" | "rejected"; detail: string };

const reasonLabel: Record<Problem["reason"], string> = { broken: "Not on Instagram", inactive: "Inactive", rejected: "Rejected" };

/**
 * "Are these pages still up?" (17 Oct). Runs once when the pages step opens
 * with pages picked, and on demand. Only pages not confirmed in the last 24h
 * cost an Instagram lookup (the server keeps the cache). A page that's gone,
 * inactive or rejected gets a Replace button: pages of the same category
 * closest in followers first, else the whole inventory.
 */
export function PageCheckPanel({ token, assets, pickedIds, onReplace }: { token: string; assets: Asset[]; pickedIds: string[]; onReplace: (oldAssetId: string, replacement: Asset) => void }) {
  const queryClient = useQueryClient();
  const byId = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]);
  const [results, setResults] = useState<Map<string, PageCheckResult>>(new Map());
  const [replacing, setReplacing] = useState<Asset | null>(null);
  const key = [...pickedIds].sort().join(",");
  const checkedFor = useRef<string>("");
  const check = useMutation({
    mutationFn: ({ ids, force }: { ids: string[]; force: boolean }) => plansApi.checkPages(token, ids, force),
    onSuccess: (r) => {
      setResults((prev) => new Map([...prev, ...(r.results ?? []).map((x) => [x.assetId, x] as const)]));
      // The check refreshes followers / flags broken pages on the assets themselves.
      queryClient.invalidateQueries({ queryKey: ["assets"] });
    },
  });
  // One automatic check per set of picked pages. A page picked while a check is
  // in flight is checked once that settles (results merge by page, so nothing is lost).
  useEffect(() => {
    if (!key || key === checkedFor.current || check.isPending) return;
    checkedFor.current = key;
    check.mutate({ ids: pickedIds, force: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, check.isPending]);

  const problems: Problem[] = pickedIds.flatMap((id): Problem[] => {
    const a = byId.get(id);
    if (!a) return [];
    const r = results.get(id);
    if (a.isActive === false) return [{ asset: a, reason: "inactive", detail: "Switched off in Inventory." }];
    if (a.approvalStatus === "rejected") return [{ asset: a, reason: "rejected", detail: "Rejected in Inventory." }];
    if (r?.broken || (!r && a.profileBroken)) return [{ asset: a, reason: "broken", detail: r?.reason ?? a.lastScrapeError ?? "Not found on Instagram." }];
    return [];
  });
  // Only the pages still on the plan count (a replaced page's result would otherwise linger).
  const current = pickedIds.flatMap((id) => results.get(id) ?? []);
  const lastChecked = current.filter((r) => r.checkedAt).map((r) => new Date(r.checkedAt!).getTime());
  const unknown = current.filter((r) => r.unknown).length;

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-2" data-testid="page-check-panel">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[0.75rem] font-medium text-text-2">Pages on Instagram</span>
        <button type="button" onClick={() => check.mutate({ ids: pickedIds, force: true })} disabled={check.isPending} className="inline-flex items-center gap-1 text-[0.72rem] font-medium text-blue hover:text-text disabled:opacity-50" data-testid="check-pages">
          <RefreshIcon className={cn("h-3 w-3", check.isPending && "animate-spin")} />
          {check.isPending ? "Checking…" : "Check again"}
        </button>
      </div>
      {check.isError && <p className="text-[0.72rem] text-rose">{check.error instanceof ApiError ? check.error.message : "Couldn't check the pages."}</p>}
      {check.data?.error && <p className="text-[0.72rem] text-rose">{check.data.error}</p>}
      {problems.length === 0 ? (
        <p className="text-[0.72rem] text-text-muted" data-testid="page-check-ok">
          {check.isPending && current.length === 0
            ? "Checking the picked pages on Instagram…"
            : current.length > 0
              ? `All ${pickedIds.length} picked page${pickedIds.length === 1 ? "" : "s"} found.${unknown > 0 ? ` ${unknown} couldn't be checked right now.` : ""}${lastChecked.length ? ` Checked ${new Date(Math.max(...lastChecked)).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}.` : ""}`
              : "Pages are checked on Instagram when you pick them."}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5" data-testid="page-check-problems">
          {problems.map((p) => (
            <li key={p.asset.id} className="flex items-center gap-2 rounded-md border border-rose bg-rose-soft px-2 py-1.5" data-testid={`page-problem-${p.asset.id}`}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[0.78rem] font-semibold">@{p.asset.handle}</p>
                <p className="truncate text-[0.68rem] text-text-muted" title={p.detail}>
                  {reasonLabel[p.reason]} · {p.detail}
                </p>
              </div>
              <Button size="sm" variant="secondary" onClick={() => setReplacing(p.asset)} data-testid={`replace-page-${p.asset.id}`}>
                Replace
              </Button>
            </li>
          ))}
        </ul>
      )}
      {replacing && (
        <ReplacePagePicker
          broken={replacing}
          assets={assets}
          excludeIds={pickedIds}
          onClose={() => setReplacing(null)}
          onPick={(a) => {
            onReplace(replacing.id, a);
            setReplacing(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * Replacement candidates: the pages that can go on a plan (approved, active, not broken, not already picked),
 * in two views — "similar" (same category, closest in followers first) and "all" (whole inventory, same sort).
 */
export function replacementCandidates(broken: Asset, assets: Asset[], excludeIds: string[]): { similar: Asset[]; all: Asset[] } {
  const usable = assets.filter((a) => a.id !== broken.id && !excludeIds.includes(a.id) && a.approvalStatus === "approved" && a.isActive !== false && !a.profileBroken);
  const cat = (broken.category ?? "").trim().toLowerCase();
  const byDistance = (a: Asset, b: Asset) => Math.abs(a.followers - broken.followers) - Math.abs(b.followers - broken.followers);
  const similar = cat ? usable.filter((a) => (a.category ?? "").trim().toLowerCase() === cat).sort(byDistance) : [];
  return { similar, all: [...usable].sort(byDistance) };
}

function ReplacePagePicker({ broken, assets, excludeIds, onClose, onPick }: { broken: Asset; assets: Asset[]; excludeIds: string[]; onClose: () => void; onPick: (a: Asset) => void }) {
  const [q, setQ] = useState("");
  const { similar, all } = useMemo(() => replacementCandidates(broken, assets, excludeIds), [broken, assets, excludeIds]);
  // Similar pages first when there are any; "Show all pages" (or a search) opens up the whole inventory.
  const [scope, setScope] = useState<"similar" | "all">(similar.length > 0 ? "similar" : "all");
  const needle = q.trim().toLowerCase();
  const pool = scope === "similar" && !needle ? similar : all;
  const shown = (needle ? pool.filter((a) => `${a.handle} ${a.category ?? ""}`.toLowerCase().includes(needle)) : pool).slice(0, 80);
  const reelRate = (a: Asset) => Number(a.rateCards.find((rc) => rc.format === "reel")?.amount ?? 0);
  return (
    <Sheet onClose={onClose} panelClassName="md:max-w-[520px]">
      <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-6 pt-1" data-testid="replace-page-picker">
        <div className="flex flex-col gap-1">
          <h2 className="text-[1.125rem] font-semibold tracking-[-0.02em]">Replace @{broken.handle}</h2>
          <p className="text-[0.8125rem] text-text-muted">Its formats and posts move to the page you pick; costs reset to that page&apos;s rates.</p>
        </div>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-faint" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search the whole inventory by handle or category…"
            aria-label="Search replacement pages"
            className="h-9 w-full rounded-md border border-border bg-surface pl-8 pr-3 text-[0.8125rem] text-text shadow-card placeholder:text-text-faint focus:border-ink focus:outline-none focus:ring-[3px] focus:ring-ink-10"
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-[0.78rem]">
          <span className="text-text-muted" data-testid="replacement-scope">
            {needle
              ? `${shown.length} match${shown.length === 1 ? "" : "es"} in the whole inventory`
              : scope === "similar"
                ? <>Pages in <span className="font-medium text-text">{broken.category}</span>, closest to {followersLabel(broken.followers)} followers first</>
                : similar.length > 0
                  ? "Whole inventory, closest in followers first"
                  : `No other ${broken.category ? `${broken.category} ` : ""}pages are free — whole inventory, closest in followers first`}
          </span>
          {!needle && similar.length > 0 && (
            <button type="button" onClick={() => setScope(scope === "similar" ? "all" : "similar")} className="font-medium text-blue hover:text-text" data-testid="replacement-toggle-scope">
              {scope === "similar" ? `Show all pages (${all.length})` : `Show similar pages (${similar.length})`}
            </button>
          )}
        </div>
        {shown.length === 0 ? (
          <p className="text-[0.8125rem] text-text-muted">{needle ? "No pages match." : "No pages are free to use."}</p>
        ) : (
          <ul className="min-h-0 divide-y divide-border overflow-y-auto rounded-md border border-border" data-testid="replacement-list">
            {shown.map((a) => (
              <li key={a.id}>
                <button type="button" onClick={() => onPick(a)} className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-surface-2" data-testid={`replacement-${a.id}`}>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-1.5 text-[0.8125rem] font-semibold">
                      @{a.handle}
                      {a.grade && (
                        <Tag tone="neutral" dot={false}>
                          Grade {a.grade}
                        </Tag>
                      )}
                    </p>
                    <p className="text-[0.72rem] text-text-muted">
                      {followersLabel(a.followers)} followers{a.category ? ` · ${a.category}` : ""}
                    </p>
                  </div>
                  <span className="whitespace-nowrap text-[0.78rem] tabular-nums text-text-muted">{reelRate(a) > 0 ? `Reel ${money(reelRate(a))}` : "No reel rate"}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <Button type="button" variant="ghost" className="shrink-0 self-start" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </Sheet>
  );
}
