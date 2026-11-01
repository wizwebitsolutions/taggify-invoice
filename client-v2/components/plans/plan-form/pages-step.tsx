"use client";

import { useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, FileSpreadsheet, Info, Sparkles, TriangleAlert, Upload, X } from "lucide-react";

import { useAuth } from "@/lib/auth-context";
import { ApiError, plans as plansApi, type Asset, type Plan } from "@/lib/api-client";
import { formatName } from "@/lib/plans";
import { comboParts, FORMATS, formatLabel, isFormat } from "@/lib/formats";
import { parsePlanPageSheet, type CsvSource } from "@/lib/sheet-import";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FilterSelect } from "@/components/taggify/filter-select";
import { Money } from "@/components/taggify/money";
import { SearchField } from "@/components/taggify/search-field";
import { audienceLabel, displayHandle, PageAvatar } from "@/components/finance/identity";
import { BudgetMeter } from "./budget-meter";
import { PageCheck } from "./page-check";
import { comboSplitOf, type DraftItem, instagramUrl, itemCost, itemPostCount, lineCost, lineNeedsCost, newItem, rateFor, toDraft } from "./draft";

const errText = (e: unknown, fallback: string) => (e instanceof ApiError || e instanceof Error ? e.message : fallback);

/**
 * Step 2 · Budget & pages (v1 PagesStep, laid out like the approved reference:
 * the page list on the left, the picked pages on the right). The internal budget
 * comes first and is a target, not a cap (16 Oct): pages can take the plan past
 * it, the meter turns red and says by how much, and Next stays open. A page with
 * no rate can be picked; its cost is typed on the line. Formats are added one at
 * a time from a select (16 Oct), each becoming its own line with posts and cost.
 */
export function PagesStep({
  assets,
  allAssets,
  loading,
  items,
  setItems,
  budget,
  setBudget,
  planId,
  onSheetImported,
}: {
  assets: Asset[];
  /** Every page, inactive and rejected ones too, so the Instagram check can flag a picked page that has since been switched off. */
  allAssets: Asset[];
  loading: boolean;
  items: DraftItem[];
  setItems: (fn: (items: DraftItem[]) => DraftItem[]) => void;
  budget: string;
  setBudget: (v: string) => void;
  /** Set once the plan is saved; attaching a sheet adds pages to the saved plan, so it needs one. */
  planId: string | null;
  onSheetImported: (plan: Plan) => void;
}) {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("All");
  const [platform, setPlatform] = useState("all");
  const [topN, setTopN] = useState("10");
  const [message, setMessage] = useState("");

  const byId = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]);
  // A page can carry one line per format (8 Oct — "option of selecting both story and reel").
  const picked = new Set(items.map((i) => i.assetId));
  const lineOf = (assetId: string, format: string) => items.find((i) => i.assetId === assetId && i.format === format);
  const budgetNumber = Number(budget) > 0 ? Number(budget) : null;
  const used = items.reduce((s, i) => s + lineCost(i, byId.get(i.assetId)), 0);
  const over = budgetNumber ? used - budgetNumber : 0;
  const unpriced = items.filter((i) => lineNeedsCost(i, byId.get(i.assetId))).length;

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of assets) if (a.category) counts.set(a.category, (counts.get(a.category) ?? 0) + 1);
    return [{ label: "All", count: assets.length }, ...[...counts.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([label, count]) => ({ label, count }))];
  }, [assets]);
  const needle = q.trim().toLowerCase();
  const visible = useMemo(
    () =>
      assets
        .filter((a) => category === "All" || a.category === category)
        .filter((a) => platform === "all" || a.platform.toLowerCase() === platform)
        .filter((a) => !needle || `${a.handle} ${a.fullName ?? ""} ${a.category ?? ""}`.toLowerCase().includes(needle))
        .sort((a, b) => b.followers - a.followers),
    [assets, category, platform, needle]
  );

  const costToAdd = (a: Asset) => rateFor(a, newItem(a).format);
  /** Why a page can't be added right now, or null if it can. Only the budget gates picking (16 Oct). */
  const blocker = (): string | null => (!budgetNumber ? "Set the budget first" : null);

  function toggle(a: Asset) {
    setMessage("");
    if (picked.has(a.id)) return setItems((ls) => ls.filter((i) => i.assetId !== a.id));
    if (blocker()) return setMessage("Enter the budget first. Pages are picked against it.");
    if (!(costToAdd(a) > 0)) setMessage(`${displayHandle(a.handle)} has no rate yet. Type its cost on the line.`);
    setItems((ls) => [...ls, newItem(a)]);
  }

  /** Edits one line (by identity: a plan saved with two prices for one format keeps both lines — see toDraft). */
  function update(current: DraftItem, patch: Partial<DraftItem>) {
    setMessage("");
    const next = { ...current, ...patch };
    setItems((ls) => ls.map((i) => (i === current ? next : i)));
  }

  /** Adds a format as a new line (any format; one with no rate needs its cost typed) or removes one (the page keeps at least one). */
  function toggleFormat(assetId: string, format: string) {
    setMessage("");
    const a = byId.get(assetId);
    const handle = displayHandle(a?.handle ?? "this page");
    const existing = lineOf(assetId, format);
    if (existing) {
      if (items.filter((i) => i.assetId === assetId).length === 1) return setMessage(`${handle} needs at least one format. Use × to remove the page.`);
      return setItems((ls) => ls.filter((i) => i !== existing));
    }
    if (!(rateFor(a, format) > 0)) setMessage(`${handle} has no ${formatName(format)} rate. Type its cost on the line.`);
    setItems((ls) => [...ls, { assetId, format, cost: "", posts: "1" }]);
  }

  function addTop() {
    setMessage("");
    if (!budgetNumber) return setMessage("Enter the budget first. Pages are picked against it.");
    const n = Math.max(1, Math.min(500, Number(topN) || 0));
    // Every candidate is added (over budget is allowed); pages without a rate need their cost typed.
    const candidates = visible.filter((a) => !picked.has(a.id)).slice(0, n);
    const noRate = candidates.filter((a) => !(costToAdd(a) > 0)).length;
    if (noRate > 0) setMessage(`${noRate} of ${candidates.length} added pages have no rate. Type their cost on the line.`);
    setItems((ls) => [...ls, ...candidates.map(newItem)]);
  }

  return (
    <div className="flex flex-col gap-6">
      <Card className="flex flex-wrap items-end gap-x-8 gap-y-4 p-6">
        <div className="flex w-full max-w-xs flex-col gap-2">
          <Label htmlFor="pl-budget" className="text-body-strong">
            Internal budget (₹)
          </Label>
          <Input id="pl-budget" type="number" inputMode="numeric" min={1} className="h-control-lg text-h4" placeholder="e.g. 200000" value={budget} onChange={(e) => setBudget(e.target.value)} />
        </div>
        <p className="max-w-md flex-1 pb-2 text-small text-muted-foreground">What we plan to spend on pages. Going over it is allowed; the meter shows by how much. The price quoted to the client is set on the next step.</p>
      </Card>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="ledger-panel">
          <div className="flex flex-wrap items-center gap-2 px-5 pt-5">
            <SearchField label="Search pages" placeholder="Search page or category..." className="w-full sm:w-64" value={q} onChange={(e) => setQ(e.target.value)} />
            <FilterSelect
              label="Platform"
              value={platform}
              onValueChange={setPlatform}
              options={[
                { value: "all", label: "All" },
                { value: "instagram", label: "Instagram" },
                { value: "youtube", label: "YouTube" },
              ]}
            />
            <div className="flex items-center gap-2 sm:ml-auto">
              <Label htmlFor="pl-topn" className="whitespace-nowrap text-small font-normal text-muted-foreground">
                Add top
              </Label>
              <Input id="pl-topn" type="number" inputMode="numeric" min={1} max={500} className="w-20" value={topN} onChange={(e) => setTopN(e.target.value)} />
              <Button variant="outline" onClick={addTop} disabled={!budgetNumber}>
                <Sparkles />
                by followers
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 px-5 pb-4 pt-3" role="group" aria-label="Category">
            {categories.map((c) => (
              <button
                key={c.label}
                type="button"
                aria-pressed={category === c.label}
                onClick={() => setCategory(c.label)}
                className={cn("inline-flex h-8 items-center gap-1.5 rounded-pill border px-3 text-small transition-colors", category === c.label ? "border-brand bg-brand-soft font-semibold text-brand-ink" : "bg-card text-fg-strong hover:bg-muted")}
              >
                {c.label}
                <span className={cn("text-caption", category === c.label ? "text-brand-ink" : "text-muted-foreground")}>{c.count}</span>
              </button>
            ))}
          </div>
          {message && (
            <p role="status" className="mx-5 mb-3 flex items-center gap-2 rounded-md bg-warning-soft px-3 py-2 text-small text-warning-fg">
              <Info className="h-4 w-4 shrink-0" aria-hidden />
              {message}
            </p>
          )}

          <div className="grid grid-cols-[minmax(0,1fr)_auto] border-t bg-muted/50 px-5 py-2 text-th uppercase text-muted-foreground sm:grid-cols-[minmax(0,1fr)_90px_90px_110px]">
            <span>Page</span>
            <span className="hidden text-right sm:block">Followers</span>
            <span className="hidden text-right sm:block">Avg views</span>
            <span className="text-right">Rate</span>
          </div>
          {loading ? (
            <div className="flex flex-col gap-2 p-5">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : visible.length === 0 ? (
            <p className="px-5 py-10 text-center text-small text-muted-foreground">{assets.length === 0 ? "No approved pages yet. Add pages in Inventory first." : "No pages match. Try another search or category."}</p>
          ) : (
            <ul className="max-h-[640px] divide-y overflow-y-auto thin-scroll">
              {visible.map((a) => {
                const on = picked.has(a.id);
                const why = on ? null : blocker();
                const rate = costToAdd(a);
                return (
                  <li key={a.id} className={cn("grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-5 py-3 transition-colors sm:grid-cols-[minmax(0,1fr)_90px_90px_110px]", on ? "bg-brand-50" : "hover:bg-muted/60", why && "opacity-70")}>
                    <span className="flex min-w-0 items-center gap-3">
                      <Checkbox checked={on} disabled={!!why && !on} onCheckedChange={() => toggle(a)} aria-label={`Add ${displayHandle(a.handle, a.platform)}`} aria-describedby={why ? `why-${a.id}` : undefined} />
                      <PageAvatar assetId={a.id} handle={a.handle} size="sm" />
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-body-strong">{displayHandle(a.handle, a.platform)}</span>
                          {a.platform.toLowerCase() === "instagram" && (
                            <a href={instagramUrl(a.handle)} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-brand-ink" aria-label={`Open ${displayHandle(a.handle)} on Instagram`}>
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          )}
                        </span>
                        <span className="flex items-center gap-2 text-small text-muted-foreground">
                          {a.category && <Badge variant="tag">{a.category}</Badge>}
                          {why && (
                            <span id={`why-${a.id}`} className="text-caption text-warning-fg">
                              {why}
                            </span>
                          )}
                        </span>
                      </span>
                    </span>
                    <span className="hidden text-right text-small sm:block">{audienceLabel(a.followers, a.platform, true) ?? "—"}</span>
                    <span className="hidden text-right text-small text-muted-foreground sm:block">{a.engagement?.avgViews != null ? audienceLabel(a.engagement.avgViews, null, true) : "—"}</span>
                    <span className="text-right text-small font-semibold">{rate > 0 ? <Money value={rate} /> : <span className="font-normal text-muted-foreground">No rate</span>}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* Stays in view while the list scrolls; scrolls on its own when it's taller than the window. */}
        <div className="thin-scroll flex flex-col gap-4 xl:sticky xl:top-[calc(var(--topbar-height)+1rem)] xl:max-h-[calc(100vh-var(--topbar-height)-7rem)] xl:overflow-y-auto xl:pb-1">
          <Card className="summary-panel flex flex-col gap-4 p-6" aria-label="Selected pages">
            <div className="flex items-baseline justify-between">
              <h2 className="text-card-title">Selected pages</h2>
              <span className="text-small text-muted-foreground">{picked.size}</span>
            </div>
            {budgetNumber ? <BudgetMeter budget={budgetNumber} used={used} /> : <p className="rounded-md bg-muted px-3 py-2 text-small text-muted-foreground">Set the budget to start picking pages.</p>}
            {over > 0 && (
              <p role="status" className="flex items-start gap-2 rounded-md bg-warning-soft px-3 py-2 text-small text-warning-fg" data-testid="over-budget-warning">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>
                  Over budget by <Money value={over} />. You can carry on; the plan will show it as over budget.
                </span>
              </p>
            )}
            {unpriced > 0 && (
              <p role="status" className="flex items-start gap-2 rounded-md bg-warning-soft px-3 py-2 text-small text-warning-fg" data-testid="unpriced-lines-warning">
                <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>{unpriced === 1 ? "1 line has no cost yet" : `${unpriced} lines have no cost yet`}. Type it on the line before moving on.</span>
              </p>
            )}
            {items.length === 0 ? (
              <p className="py-4 text-center text-small text-muted-foreground">Pick pages from the list. They show up here with their posts and cost.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {[...new Set(items.map((i) => i.assetId))].map((assetId) => {
                  const a = byId.get(assetId);
                  const handle = a?.handle ?? "page";
                  const lines = items.filter((i) => i.assetId === assetId);
                  return (
                    <li key={assetId} className="flex flex-col gap-2.5 rounded-md border p-3">
                      <div className="flex items-center gap-2">
                        <PageAvatar assetId={assetId} handle={handle} size="xs" />
                        <span className="min-w-0 flex-1 truncate text-small font-semibold">{displayHandle(handle, a?.platform)}</span>
                        <span className="text-small font-semibold">
                          <Money value={lines.reduce((s, l) => s + lineCost(l, a), 0)} />
                        </span>
                        <button type="button" onClick={() => setItems((ls) => ls.filter((x) => x.assetId !== assetId))} className="grid h-6 w-6 place-items-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Remove ${displayHandle(handle)}`}>
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      {lines.map((l, n) => {
                        const split = comboSplitOf(l, a);
                        const parts = comboParts(l.format);
                        const rate = rateFor(a, l.format);
                        const needsCost = lineNeedsCost(l, a);
                        return (
                          <div key={`${l.format}-${n}`} className="flex flex-col gap-1" data-testid={`plan-line-${assetId}-${l.format}`}>
                            <div className="flex items-center gap-2">
                              <span className="min-w-0 flex-1 truncate text-small font-medium leading-tight">{formatName(l.format)}</span>
                              <Input
                                type="number"
                                inputMode="numeric"
                                min={1}
                                max={1000}
                                step={1}
                                className="h-control-sm w-16 text-small"
                                aria-label={`${formatName(l.format)} posts on ${displayHandle(handle)}`}
                                value={l.posts}
                                onChange={(e) => update(l, { posts: (e.target.value.match(/^\d*/)?.[0] ?? "").slice(0, 4) })}
                              />
                              <span className="text-caption text-muted-foreground">×</span>
                              <Input
                                type="number"
                                inputMode="numeric"
                                min={0}
                                className={cn("h-control-sm w-24 text-small", needsCost && "border-danger-fg")}
                                placeholder={rate > 0 ? String(rate) : "Cost"}
                                aria-label={`${formatName(l.format)} cost on ${displayHandle(handle)}`}
                                aria-invalid={needsCost || undefined}
                                title={needsCost ? `No ${formatName(l.format)} rate on the page. Type the cost per post.` : "Cost per post. Blank uses the page's rate."}
                                value={l.cost}
                                onChange={(e) => update(l, { cost: e.target.value })}
                              />
                              <Button type="button" variant="ghost" size="icon" className="h-control-sm w-9 shrink-0" onClick={() => toggleFormat(assetId, l.format)} aria-label={`Remove ${formatName(l.format)} on ${displayHandle(handle)}`} title={lines.length === 1 ? "The page's last format. Use × on the page to remove it." : undefined}>
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                            {split && parts && (
                              <p className="text-caption text-muted-foreground">
                                {formatName(parts[0])} <Money value={split[parts[0]] ?? 0} /> + {formatName(parts[1])} <Money value={split[parts[1]] ?? 0} />
                                {itemPostCount(l) > 2 ? " per combo" : ""}
                              </p>
                            )}
                            {!isFormat(l.format) && (
                              <p className="flex items-center gap-2 text-caption text-warning-fg">
                                Plans no longer use this format. Pick another below and remove this line.
                                <button type="button" className="font-semibold underline" onClick={() => setItems((ls) => ls.filter((x) => x !== l))}>
                                  Remove
                                </button>
                              </p>
                            )}
                          </div>
                        );
                      })}
                      {/* Pick a format to add it as a line (16 Oct) — the same "choose a format" control as Inventory's rates. */}
                      {FORMATS.some((f) => !lines.some((l) => l.format === f)) && (
                        <Select value="" onValueChange={(f) => f && toggleFormat(assetId, f)}>
                          <SelectTrigger className="h-control-sm" aria-label={`Add a format for ${displayHandle(handle)}`} data-testid={`plan-add-format-${assetId}`}>
                            <SelectValue placeholder="Add a format…" />
                          </SelectTrigger>
                          <SelectContent>
                            {FORMATS.filter((f) => !lines.some((l) => l.format === f)).map((f) => {
                              const r = rateFor(a, f);
                              return (
                                <SelectItem key={f} value={f}>
                                  {formatLabel(f)}
                                  <span className="ml-2 text-muted-foreground">{r > 0 ? `₹${r.toLocaleString("en-IN")}` : "no rate"}</span>
                                </SelectItem>
                              );
                            })}
                          </SelectContent>
                        </Select>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {items.length > 0 && (
              <p className="flex justify-between border-t pt-3 text-small">
                <span className="text-muted-foreground">
                  {items.reduce((s, i) => s + itemPostCount(i), 0)} posts · our cost
                </span>
                <span className="font-semibold">
                  <Money value={used} />
                </span>
              </p>
            )}
          </Card>
          {/* "Are these pages still up?" (17 Oct): checked on Instagram (24h cache), with a swap for any that aren't. */}
          {items.length > 0 && (
            <PageCheck
              assets={allAssets}
              pickedIds={[...picked]}
              onReplace={(oldId, replacement) => {
                setMessage("");
                setItems((ls) => {
                  const moved = ls.filter((i) => i.assetId === oldId).map((i) => ({ ...i, assetId: replacement.id, cost: "" }));
                  const rest = ls.filter((i) => i.assetId !== oldId);
                  // The replacement may already be on the plan: keep its lines, add only the formats it lacks.
                  const have = new Set(rest.filter((i) => i.assetId === replacement.id).map((i) => i.format));
                  return [...rest, ...moved.filter((i) => !have.has(i.format))];
                });
              }}
            />
          )}
          <SheetImport
            planId={planId}
            onImported={(plan) => {
              // Local rows win (they may hold unsaved edits); the sheet only adds pages not picked yet, once
              // each, since the server appends sheet rows without de-duplicating. The next save replaces the lines.
              setItems((local) => {
                const key = (x: DraftItem) => `${x.assetId}:${x.format}`;
                const seen = new Set(local.map(key));
                const added = toDraft(plan).filter((x) => !seen.has(key(x)) && seen.add(key(x)));
                return [...local, ...added];
              });
              onSheetImported(plan);
            }}
          />
        </div>
      </div>
    </div>
  );
}

/** "Attach a Google Sheet of pages" (v1): matches handles to existing pages and creates the rest. */
function SheetImport({ planId, onImported }: { planId: string | null; onImported: (plan: Plan) => void }) {
  const { accessToken } = useAuth();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState("");
  const [result, setResult] = useState("");
  const [error, setError] = useState("");

  const attach = useMutation({
    mutationFn: async (source: { url: string } | { file: File }) => {
      const csv: CsvSource = "url" in source ? (await plansApi.importSheetUrl(accessToken!, source.url)).csv : source.file;
      const rows = await parsePlanPageSheet(csv);
      if (rows.length === 0) throw new Error('No rows found. Check the sheet has a header row (e.g. "handle").');
      return plansApi.importSheetPages(accessToken!, planId!, rows);
    },
    onMutate: () => {
      setError("");
      setResult("");
    },
    onSuccess: async (r) => {
      setResult(`${r.matchedCount} matched, ${r.createdCount} new page${r.createdCount === 1 ? "" : "s"} created.`);
      if (r.failures.length) setError(r.failures.map((f) => `${f.handle}: ${f.reason}`).join(" "));
      onImported(r.plan);
      await qc.invalidateQueries({ queryKey: ["assets"] });
    },
    onError: (e) => setError(errText(e, "Couldn't import that sheet.")),
  });

  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex items-center gap-2">
        <FileSpreadsheet className="h-4 w-4 text-muted-foreground" aria-hidden />
        <h2 className="text-body-strong">Attach a Google Sheet of pages</h2>
      </div>
      {!planId ? (
        <p className="text-small text-muted-foreground">Save this step once (Next), then come back to attach a sheet.</p>
      ) : (
        <>
          <p className="text-small text-muted-foreground">Columns by name: handle or page link, and optionally category, followers, format, cost, posts. New handles become pages.</p>
          <div className="flex gap-2">
            <Input aria-label="Google Sheet link" placeholder="Paste the Google Sheet link" value={url} onChange={(e) => setUrl(e.target.value)} />
            <Button variant="outline" disabled={!url.trim() || attach.isPending} onClick={() => attach.mutate({ url: url.trim() })}>
              Fetch
            </Button>
          </div>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="sr-only" aria-label="Upload a CSV of pages" onChange={(e) => e.target.files?.[0] && attach.mutate({ file: e.target.files[0] })} />
          <Button variant="ghost" size="sm" className="self-start" disabled={attach.isPending} onClick={() => fileRef.current?.click()}>
            <Upload />
            Or upload a CSV
          </Button>
          {attach.isPending && <p className="text-small text-muted-foreground">Importing…</p>}
          {result && <p className="text-small text-success-fg">{result}</p>}
          {error && <p className="text-small text-danger-helper">{error}</p>}
        </>
      )}
    </Card>
  );
}
