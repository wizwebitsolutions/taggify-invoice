"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleCheck, RefreshCw, TriangleAlert } from "lucide-react";

import { useAuth } from "@/lib/auth-context";
import { ApiError, plans as plansApi, type Asset, type PageCheckResult } from "@/lib/api-client";
import { plural } from "@/lib/format";
import { rateOf } from "@/lib/creators";
import { invalidatePages } from "@/lib/queries/creators";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Money } from "@/components/taggify/money";
import { SearchField } from "@/components/taggify/search-field";
import { GradeBadge } from "@/components/creators/page-sheet";
import { audienceLabel, displayHandle, PageAvatar } from "@/components/finance/identity";

/** Why a picked page can't be used right now. */
type Problem = { asset: Asset; reason: "broken" | "inactive" | "rejected"; detail: string };

const REASON: Record<Problem["reason"], string> = { broken: "Not on Instagram", inactive: "Inactive", rejected: "Rejected" };

/**
 * "Are these pages still up?" (17 Oct, v1 PageCheckPanel). Runs once per set of
 * picked pages and on demand. Only pages not confirmed in the last 24h cost an
 * Instagram lookup (the server keeps the cache). A page that's gone, inactive or
 * rejected gets Replace: same-category pages closest in followers first, else
 * the whole inventory.
 */
export function PageCheck({ assets, pickedIds, onReplace }: { assets: Asset[]; pickedIds: string[]; onReplace: (oldAssetId: string, replacement: Asset) => void }) {
  const { accessToken } = useAuth();
  const qc = useQueryClient();
  const byId = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]);
  const [results, setResults] = useState<Map<string, PageCheckResult>>(new Map());
  const [replacing, setReplacing] = useState<Asset | null>(null);
  const key = [...pickedIds].sort().join(",");
  const checkedFor = useRef("");
  const check = useMutation({
    mutationFn: ({ ids, force }: { ids: string[]; force: boolean }) => plansApi.checkPages(accessToken!, ids, force),
    onSuccess: async (r) => {
      setResults((prev) => new Map([...prev, ...(r.results ?? []).map((x) => [x.assetId, x] as const)]));
      // The check refreshes followers and flags broken pages on the pages themselves.
      await invalidatePages(qc);
    },
  });
  // One automatic check per set of picked pages. A page picked while a check is in
  // flight is checked once that settles (results merge by page, so nothing is lost).
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
  // Only the pages still picked count (a replaced page's result would otherwise linger).
  const current = pickedIds.flatMap((id) => results.get(id) ?? []);
  const lastChecked = current.filter((r) => r.checkedAt).map((r) => new Date(r.checkedAt!).getTime());
  const unknown = current.filter((r) => r.unknown).length;
  const failure = check.isError ? (check.error instanceof ApiError ? check.error.message : "Couldn't check the pages.") : (check.data?.error ?? "");

  return (
    <Card className="flex flex-col gap-3 p-5" data-testid="page-check">
      <div className="flex items-center gap-2">
        <h2 className="min-w-0 flex-1 text-body-strong">Pages on Instagram</h2>
        <Button variant="ghost" size="sm" disabled={check.isPending} onClick={() => check.mutate({ ids: pickedIds, force: true })} data-testid="check-pages">
          <RefreshCw className={cn(check.isPending && "animate-spin")} />
          {check.isPending ? "Checking…" : "Check again"}
        </Button>
      </div>
      {failure && (
        <p role="alert" className="text-small text-danger-helper">
          {failure}
        </p>
      )}
      {problems.length === 0 ? (
        <p className="flex items-start gap-2 text-small text-muted-foreground" data-testid="page-check-ok">
          {current.length > 0 && <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-success-fg" aria-hidden />}
          <span>
            {check.isPending && current.length === 0
              ? "Checking the picked pages on Instagram…"
              : current.length > 0
                ? `All ${plural(pickedIds.length, "picked page")} found.${unknown > 0 ? ` ${unknown} couldn't be checked right now.` : ""}${lastChecked.length ? ` Checked ${new Date(Math.max(...lastChecked)).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}.` : ""}`
                : "Pages are checked on Instagram when you pick them."}
          </span>
        </p>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="page-check-problems">
          {problems.map((p) => (
            <li key={p.asset.id} className="flex items-center gap-3 rounded-md bg-danger-soft px-3 py-2" data-testid={`page-problem-${p.asset.id}`}>
              <TriangleAlert className="h-4 w-4 shrink-0 text-danger-fg" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-small font-semibold">{displayHandle(p.asset.handle, p.asset.platform)}</span>
                <span className="block truncate text-caption text-danger-fg" title={p.detail}>
                  {REASON[p.reason]} · {p.detail}
                </span>
              </span>
              <Button size="sm" variant="outline" onClick={() => setReplacing(p.asset)} data-testid={`replace-page-${p.asset.id}`}>
                Replace
              </Button>
            </li>
          ))}
        </ul>
      )}
      <ReplacePageSheet
        broken={replacing}
        assets={assets}
        excludeIds={pickedIds}
        onClose={() => setReplacing(null)}
        onPick={(a) => {
          if (replacing) onReplace(replacing.id, a);
          setReplacing(null);
        }}
      />
    </Card>
  );
}

/**
 * Pages that can stand in for `broken` (approved, active, not broken, not already picked), in two views:
 * "similar" (same category, closest in followers first) and "all" (whole inventory, same sort).
 */
export function replacementCandidates(broken: Asset, assets: Asset[], excludeIds: string[]): { similar: Asset[]; all: Asset[] } {
  const usable = assets.filter((a) => a.id !== broken.id && !excludeIds.includes(a.id) && a.approvalStatus === "approved" && a.isActive !== false && !a.profileBroken);
  const cat = (broken.category ?? "").trim().toLowerCase();
  const byDistance = (a: Asset, b: Asset) => Math.abs(a.followers - broken.followers) - Math.abs(b.followers - broken.followers);
  const similar = cat ? usable.filter((a) => (a.category ?? "").trim().toLowerCase() === cat).sort(byDistance) : [];
  return { similar, all: [...usable].sort(byDistance) };
}

function ReplacePageSheet({ broken, assets, excludeIds, onClose, onPick }: { broken: Asset | null; assets: Asset[]; excludeIds: string[]; onClose: () => void; onPick: (a: Asset) => void }) {
  return (
    <Sheet open={!!broken} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-md" data-testid="replace-page-picker">
        {broken && <ReplacePicker key={broken.id} broken={broken} assets={assets} excludeIds={excludeIds} onPick={onPick} />}
      </SheetContent>
    </Sheet>
  );
}

function ReplacePicker({ broken, assets, excludeIds, onPick }: { broken: Asset; assets: Asset[]; excludeIds: string[]; onPick: (a: Asset) => void }) {
  const [q, setQ] = useState("");
  const { similar, all } = useMemo(() => replacementCandidates(broken, assets, excludeIds), [broken, assets, excludeIds]);
  // Similar pages first when there are any; "Show all pages" (or a search) opens up the whole inventory.
  const [scope, setScope] = useState<"similar" | "all">(similar.length > 0 ? "similar" : "all");
  const needle = q.trim().toLowerCase();
  const pool = scope === "similar" && !needle ? similar : all;
  const shown = (needle ? pool.filter((a) => `${a.handle} ${a.category ?? ""}`.toLowerCase().includes(needle)) : pool).slice(0, 80);
  return (
    <>
      <SheetHeader className="gap-1 border-b p-5 text-left">
        <SheetTitle className="text-section">Replace {displayHandle(broken.handle, broken.platform)}</SheetTitle>
        <SheetDescription>Its formats and posts move to the page you pick; costs reset to that page&apos;s rates.</SheetDescription>
      </SheetHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-5">
        <SearchField label="Search replacement pages" placeholder="Search the whole inventory..." value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="flex flex-wrap items-center justify-between gap-2 text-small">
          <span className="text-muted-foreground" data-testid="replacement-scope">
            {needle
              ? `${plural(shown.length, "match", "matches")} in the whole inventory`
              : scope === "similar"
                ? `Same category (${broken.category}), closest to ${audienceLabel(broken.followers, broken.platform) ?? "its audience"} first`
                : similar.length > 0
                  ? "Whole inventory, closest in followers first"
                  : `No other ${broken.category ? `${broken.category} ` : ""}pages are free. Whole inventory, closest in followers first.`}
          </span>
          {!needle && similar.length > 0 && (
            <Button variant="link" size="sm" className="h-auto p-0" onClick={() => setScope(scope === "similar" ? "all" : "similar")} data-testid="replacement-toggle-scope">
              {scope === "similar" ? `Show all pages (${all.length})` : `Show similar pages (${similar.length})`}
            </Button>
          )}
        </div>
        {shown.length === 0 ? (
          <p className="py-6 text-center text-small text-muted-foreground">{needle ? "No pages match." : "No pages are free to use."}</p>
        ) : (
          <ul className="thin-scroll min-h-0 flex-1 divide-y overflow-y-auto rounded-card border" data-testid="replacement-list">
            {shown.map((a) => {
              const reel = rateOf(a, "reel");
              return (
                <li key={a.id}>
                  <button type="button" onClick={() => onPick(a)} className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted" data-testid={`replacement-${a.id}`}>
                    <PageAvatar assetId={a.id} handle={a.handle} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-body-strong">{displayHandle(a.handle, a.platform)}</span>
                        {a.grade && <GradeBadge grade={a.grade} />}
                      </span>
                      <span className="block truncate text-small text-muted-foreground">
                        {audienceLabel(a.followers, a.platform) ?? "No follower count"}
                        {a.category ? ` · ${a.category}` : ""}
                      </span>
                    </span>
                    <span className="whitespace-nowrap text-small text-muted-foreground">{reel ? <>Reel <Money value={reel} /></> : "No reel rate"}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
