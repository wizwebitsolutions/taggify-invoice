"use client";

import { OwnSectionGate } from "@/components/auth/own-section-gate";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { RequireAuth } from "@/components/auth/require-auth";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { Field, TextField, MoneyField, IntegerField, FieldError } from "@/components/ui/form-field";
import { ComboInput } from "@/components/ui/combo-input";
import { PageHeader } from "@/components/ui/page-header";
import { Chip, Chips } from "@/components/ui/chips";
import { Tag } from "@/components/ui/tag";
import { Card, Table, THead, TH, TR, TD } from "@/components/ui/data-table";
import { FloatingBar, BarButton } from "@/components/ui/floating-bar";
import { TableSkeleton, EmptyState, ErrorNotice } from "@/components/ui/table-parts";
import { PlusIcon, AssetIcon, SearchIcon, CloseIcon, RefreshIcon, TeamIcon, ChevronDownIcon, CheckIcon, UploadIcon } from "@/components/icons";
import { ImportPagesModal } from "@/components/inventory/import-pages-modal";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useAuth } from "@/lib/auth-context";
import { assets as assetsApi, auth as authApi, LINK_FORMATS as FORMATS, ApiError, hasAccess, type Asset, canUse } from "@/lib/api-client";
import { money, count, roleLabel, initialsOf, compactNumber, personLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Inventory (premium mockup 07): every page you can book, by category, as
 * one table — category chips, owner/sort filters, a checkbox per row for
 * roles that build plans, and a dark floating bar with "Create plan" once
 * something is selected. Rate cards, campaigns and approval live inline
 * on the row (expand with "Edit").
 */
export default function InventoryPage() {
  return (
    <RequireAuth>
      <OwnSectionGate ownKey="inventory.view" active="inventory">
        <InventoryContent />
      </OwnSectionGate>
    </RequireAuth>
  );
}

function InventoryContent() {
  const { user, accessToken } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [showAddPage, setShowAddPage] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(new Set());
  const token = accessToken!;
  // "Admin" in the loose sense of "can manage Inventory" — a plain ADMIN by
  // default, or (15 Sep) any other role explicitly granted inventory.manage.
  const isAdmin = hasAccess(user, "inventory.edit");
  // A creator adds their own pages; a plan maker (25 Sep) registers a
  // vendor's page while building a plan — both via the same simple "Add
  // page" entry point, distinguished inside the modal by canAssignOwner.
  // Whoever can manage Inventory more broadly (unless their sub-admin
  // overlay turns it off, or — 15 Sep — a non-admin role was granted it)
  // registers pages under any creator account, one at a time or from a
  // sheet (user request, 14 Sep).
  const canAddPage = (user?.role === "CREATOR" || user?.role === "PLAN_MAKER") && canUse(user, "inventory.edit");
  // Owner-assignment UI (existing-account picker + create-a-new-creator):
  // real staff isAdmin, or a plan maker granted inventory.edit — never a
  // plain creator, whose own page is implicitly theirs.
  const canAssignOwner = isAdmin || (user?.role === "PLAN_MAKER" && canUse(user, "inventory.edit"));
  const canManagePlans = hasAccess(user, "plans.edit") || (user?.role === "PLAN_MAKER" && canUse(user, "plans.edit"));

  function onCreatePlanFromSelection() {
    const ids = [...selectedAssetIds];
    setSelectedAssetIds(new Set());
    router.push(`/plans?assetIds=${ids.map(encodeURIComponent).join(",")}`);
  }

  const hasSelection = (canManagePlans || isAdmin) && selectedAssetIds.size > 0;
  const refreshSelectedMutation = useMutation({
    mutationFn: (ids: string[]) => assetsApi.refreshProfiles(token, ids),
    onSuccess: () => {
      setSelectedAssetIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["assets"] });
    },
  });

  return (
    <AppShell
      active="inventory"
      user={{ initials: initialsOf(user?.name), name: user?.name ?? "—", role: roleLabel(user?.role), tone: user?.role === "FINANCE" ? "blue" : "emerald" }}
      searchPlaceholder="Search pages…"
      topbarActions={
        canAddPage ? (
          <Button onClick={() => setShowAddPage(true)}>
            <PlusIcon className="h-4 w-4" />
            Add page
          </Button>
        ) : undefined
      }
      fab={
        canAddPage && !hasSelection ? (
          <Button size="icon" className="h-12 w-12 rounded-full shadow-lg" onClick={() => setShowAddPage(true)} aria-label="Add page">
            <PlusIcon className="h-5 w-5" />
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-5">
        <PageHeader
          title="Inventory"
          subtitle={canManagePlans ? "Every page you can book, by category. Select pages to build a plan." : "Pages and their rate cards."}
          actions={
            isAdmin ? (
              <>
                <Button variant="secondary" onClick={() => setShowImport(true)} data-testid="import-pages-button">
                  <UploadIcon className="h-4 w-4" />
                  Import pages
                </Button>
                <Button onClick={() => setShowAddPage(true)} data-testid="create-page-button">
                  <PlusIcon className="h-4 w-4" />
                  Create page
                </Button>
              </>
            ) : undefined
          }
        />
        <PagesSection token={token} isAdmin={isAdmin} canAssignOwner={canAssignOwner} showForm={showAddPage} setShowForm={setShowAddPage} canSelect={canManagePlans || isAdmin} selectedAssetIds={selectedAssetIds} setSelectedAssetIds={setSelectedAssetIds} />
      </div>

      {showImport && <ImportPagesModal token={token} onClose={() => setShowImport(false)} onImported={() => queryClient.invalidateQueries({ queryKey: ["assets"] })} />}

      {hasSelection && (
        <FloatingBar label={`${selectedAssetIds.size} page${selectedAssetIds.size === 1 ? "" : "s"} selected`} onClear={() => setSelectedAssetIds(new Set())} testId="selection-bar">
          <BarButton onClick={() => setSelectedAssetIds(new Set())}>Clear</BarButton>
          {isAdmin && (
            <BarButton onClick={() => refreshSelectedMutation.mutate([...selectedAssetIds])} disabled={refreshSelectedMutation.isPending} testId="refresh-selected">
              <RefreshIcon className={cn("h-3.5 w-3.5", refreshSelectedMutation.isPending && "animate-spin")} />
              Refresh from Instagram
            </BarButton>
          )}
          {canManagePlans && (
            <BarButton primary onClick={onCreatePlanFromSelection} testId="create-plan-from-selection">
              <PlusIcon className="h-3.5 w-3.5" />
              Create plan
            </BarButton>
          )}
        </FloatingBar>
      )}
    </AppShell>
  );
}

function PagesSection({
  token,
  isAdmin,
  canAssignOwner,
  showForm,
  setShowForm,
  canSelect,
  selectedAssetIds,
  setSelectedAssetIds,
}: {
  token: string;
  isAdmin: boolean;
  canAssignOwner: boolean;
  showForm: boolean;
  setShowForm: (v: boolean) => void;
  canSelect: boolean;
  selectedAssetIds: Set<string>;
  setSelectedAssetIds: (updater: (prev: Set<string>) => Set<string>) => void;
}) {
  const queryClient = useQueryClient();
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("All");
  const [sortBy, setSortBy] = useState<"newest" | "followers-desc" | "followers-asc">("newest");

  const assetsQuery = useQuery({
    queryKey: ["assets"],
    queryFn: () => assetsApi.list(token),
    // A just-created page's followers/avg views arrive from Instagram in the
    // background (Apify can take a minute or two) — poll while any page is
    // still waiting on its first scrape, then stop.
    refetchInterval: (query) => ((query.state.data ?? []).some(isAwaitingFirstScrape) ? 5_000 : false),
    // Keep polling even while the tab is hidden (React Query pauses interval
    // refetches otherwise), so the numbers are there when the admin comes back.
    refetchIntervalInBackground: true,
  });
  const allItems = assetsQuery.data ?? [];
  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of allItems) if (a.category) counts.set(a.category, (counts.get(a.category) ?? 0) + 1);
    return [{ label: "All", count: allItems.length }, ...[...counts.entries()].map(([label, count]) => ({ label, count }))];
  }, [allItems]);
  const owners = useMemo(() => {
    const byId = new Map<string, string>();
    for (const a of allItems) if (a.owner) byId.set(a.owner.id, personLabel(a.owner));
    return [...byId.entries()];
  }, [allItems]);

  const items = useMemo(() => {
    let result = allItems;
    if (categoryFilter !== "All") result = result.filter((a) => a.category === categoryFilter);
    if (ownerFilter !== "All") result = result.filter((a) => a.owner?.id === ownerFilter);
    const q = search.trim().toLowerCase();
    if (q) result = result.filter((a) => a.handle.toLowerCase().includes(q) || (a.category ?? "").toLowerCase().includes(q) || (a.owner?.name ?? "").toLowerCase().includes(q) || (a.owner?.phoneNumber ?? "").toLowerCase().includes(q));
    if (sortBy === "followers-desc") result = [...result].sort((a, b) => b.followers - a.followers);
    else if (sortBy === "followers-asc") result = [...result].sort((a, b) => a.followers - b.followers);
    return result;
  }, [allItems, categoryFilter, ownerFilter, search, sortBy]);

  function toggleSelected(assetId: string) {
    setSelectedAssetIds((prev) => {
      const next = new Set(prev);
      if (next.has(assetId)) next.delete(assetId);
      else next.add(assetId);
      return next;
    });
  }
  const selectedInView = items.filter((a) => selectedAssetIds.has(a.id)).length;
  const allInViewSelected = items.length > 0 && selectedInView === items.length;
  function toggleSelectAllInView() {
    setSelectedAssetIds((prev) => {
      const next = new Set(prev);
      for (const a of items) {
        if (allInViewSelected) next.delete(a.id);
        else next.add(a.id);
      }
      return next;
    });
  }
  function selectFirstNInView(n: number) {
    const c = Math.max(0, Math.min(n, items.length));
    setSelectedAssetIds((prev) => {
      const next = new Set(prev);
      items.forEach((a, i) => {
        if (i < c) next.add(a.id);
        else next.delete(a.id);
      });
      return next;
    });
  }

  return (
    <>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
            <div className="relative w-full shrink-0 sm:w-72">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-faint" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search pages, categories, users…"
                aria-label="Search pages by handle, category, or owner"
                className="h-9 w-full rounded-md border border-border bg-surface pl-8 pr-8 text-[0.8125rem] text-text shadow-card placeholder:text-text-faint focus:border-ink focus:outline-none focus:ring-[3px] focus:ring-ink-10"
              />
              {search && (
                <button type="button" onClick={() => setSearch("")} aria-label="Clear search" className="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-text-faint hover:bg-surface-2 hover:text-text">
                  <CloseIcon className="h-3 w-3" />
                </button>
              )}
            </div>
            {owners.length > 1 && (
              <FilterSelect icon={<TeamIcon className="h-3.5 w-3.5" />} value={ownerFilter} onChange={setOwnerFilter} aria-label="Filter by page owner">
                <option value="All">All owners</option>
                {owners.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </FilterSelect>
            )}
            {allItems.length > 0 && (
              <FilterSelect value={sortBy} onChange={(v) => setSortBy(v as typeof sortBy)} aria-label="Sort pages">
                <option value="newest">Newest first</option>
                <option value="followers-desc">Followers: high to low</option>
                <option value="followers-asc">Followers: low to high</option>
              </FilterSelect>
            )}
          </div>
        </div>
        {categories.length > 2 && (
          <Chips>
            {categories.map((c) => (
              <Chip key={c.label} on={categoryFilter === c.label} count={c.count} onClick={() => setCategoryFilter(c.label)}>
                {c.label}
              </Chip>
            ))}
          </Chips>
        )}
      </div>

      <Card>
        {canSelect && !assetsQuery.isLoading && items.length > 0 && <SelectionBar total={items.length} selectedCount={selectedInView} allSelected={allInViewSelected} onToggleAll={toggleSelectAllInView} onSelectFirst={selectFirstNInView} />}
        {assetsQuery.isLoading ? (
          <TableSkeleton />
        ) : items.length === 0 ? (
          <EmptyState label={allItems.length === 0 ? "No pages registered yet." : search ? `No pages match "${search}".` : "No pages in this category."} />
        ) : (
          <Table data-testid="inventory-table" className="min-w-[880px]">
            <THead>
              <tr>
                {canSelect && <TH className="w-9 pr-0" />}
                <TH>Page</TH>
                <TH className="hidden md:table-cell">Category</TH>
                <TH right className="hidden sm:table-cell">
                  Followers
                </TH>
                <TH right className="hidden lg:table-cell">
                  Avg views
                </TH>
                <TH right>Reel</TH>
                <TH className="hidden 2xl:table-cell">Campaigns</TH>
                <TH className="hidden md:table-cell">Owner</TH>
                <TH />
              </tr>
            </THead>
            {items.map((asset, i) => (
              <AssetRow key={asset.id} asset={asset} index={i} token={token} editable={isAdmin} selectable={canSelect} selected={selectedAssetIds.has(asset.id)} onToggleSelect={() => toggleSelected(asset.id)} />
            ))}
          </Table>
        )}
      </Card>

      {showForm && (
        <NewAssetModal
          token={token}
          isAdmin={isAdmin}
          canAssignOwner={canAssignOwner}
          existingCategories={categories.filter((c) => c.label !== "All").map((c) => c.label)}
          onClose={() => setShowForm(false)}
          // The modal closes itself — after the success screen when a new
          // account was created (its one-time password is shown there).
          onCreated={() => queryClient.invalidateQueries({ queryKey: ["assets"] })}
        />
      )}
    </>
  );
}

/** True while a profile scrape is queued or running for the page (create, import, bulk refresh). */
// Bounded client-side too: if a marker somehow outlives the server's own
// clean-up, the row stops spinning (and the page stops polling) after this.
const SCRAPE_QUEUE_MAX_AGE_MS = 15 * 60 * 1000;
function isAwaitingFirstScrape(asset: Asset) {
  if (!asset.scrapeQueuedAt) return false;
  return Date.now() - new Date(asset.scrapeQueuedAt).getTime() < SCRAPE_QUEUE_MAX_AGE_MS;
}

function FilterSelect({ icon, value, onChange, children, "aria-label": ariaLabel }: { icon?: ReactNode; value: string; onChange: (value: string) => void; children: ReactNode; "aria-label": string }) {
  return (
    <div className="relative shrink-0">
      {icon && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-faint">{icon}</span>}
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={ariaLabel} className={cn("h-9 appearance-none rounded-md border border-border bg-surface py-0 pr-8 text-[0.8125rem] text-text-2 shadow-card focus:border-ink focus:outline-none focus:ring-[3px] focus:ring-ink-10", icon ? "pl-8" : "pl-3")}>
        {children}
      </select>
      <ChevronDownIcon className="pointer-events-none absolute right-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-text-faint" />
    </div>
  );
}

function SelectionBar({ total, selectedCount, allSelected, onToggleAll, onSelectFirst }: { total: number; selectedCount: number; allSelected: boolean; onToggleAll: () => void; onSelectFirst: (n: number) => void }) {
  const [countInput, setCountInput] = useState("");
  const checkboxRef = useCallback(
    (el: HTMLInputElement | null) => {
      if (el) el.indeterminate = selectedCount > 0 && !allSelected;
    },
    [selectedCount, allSelected]
  );
  function applyCount() {
    const n = Number.parseInt(countInput, 10);
    if (!Number.isFinite(n) || n <= 0) return;
    onSelectFirst(n);
    setCountInput("");
  }
  const presets = [10, 25, 50].filter((n) => n < total);
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-[#fbfbfc] px-[18px] py-2.5 dark:bg-surface-2">
      <label className="flex cursor-pointer select-none items-center gap-2">
        <input ref={checkboxRef} type="checkbox" checked={allSelected} onChange={onToggleAll} aria-label={allSelected ? `Deselect all ${total} pages` : `Select all ${total} pages`} className="h-4 w-4 rounded accent-[var(--ink)]" />
        <span className="text-[0.8125rem] font-medium text-text">
          {selectedCount > 0 ? (
            <>
              <span className="tabular-nums">{selectedCount}</span> of {total} selected
            </>
          ) : (
            `Select all ${total}`
          )}
        </span>
      </label>
      <div className="hidden h-4 w-px bg-border sm:block" />
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[0.75rem] text-text-muted">Select first</span>
        {presets.map((n) => (
          <button key={n} type="button" onClick={() => onSelectFirst(n)} className="rounded-[6px] border border-border bg-surface px-2 py-0.5 text-[0.75rem] font-medium text-text-2 hover:border-ink">
            {n}
          </button>
        ))}
        <div className="flex items-center gap-1">
          <IntegerField
            value={countInput}
            onChange={setCountInput}
            max={total}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyCount();
              }
            }}
            placeholder="e.g. 5"
            aria-label={`Number of pages to select (out of ${total})`}
            className="h-7 w-16 rounded-[6px] px-2 text-[0.75rem] shadow-none"
          />
          <button type="button" onClick={applyCount} disabled={!countInput} className="rounded-[6px] border border-border bg-surface px-2 py-1 text-[0.75rem] font-medium text-text-2 hover:border-ink disabled:cursor-not-allowed disabled:opacity-40">
            <CheckIcon className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  );
}

function AssetRow({ asset, index, token, editable, selectable, selected, onToggleSelect }: { asset: Asset; index: number; token: string; editable: boolean; selectable: boolean; selected: boolean; onToggleSelect: () => void }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  // reel/story only (user request, 14 Sep) — no custom formats any more; a
  // legacy rate card in another format simply isn't shown or re-saved.
  const formats: string[] = [...FORMATS];
  const [amounts, setAmounts] = useState<Record<string, string>>(() => Object.fromEntries(formats.map((f) => [f, asset.rateCards.find((rc) => rc.format === f)?.amount ?? ""])));

  const saveMutation = useMutation({
    mutationFn: () => assetsApi.updateRateCard(token, asset.id, formats.filter((f) => amounts[f]).map((f) => ({ format: f, amount: Number(amounts[f]) }))),
    onSuccess: () => {
      setEditing(false);
      queryClient.invalidateQueries({ queryKey: ["assets"] });
    },
  });
  const approvalMutation = useMutation({ mutationFn: (approvalStatus: "approved" | "rejected") => assetsApi.setApproval(token, asset.id, approvalStatus), onSuccess: () => queryClient.invalidateQueries({ queryKey: ["assets"] }) });
  const refreshMutation = useMutation({ mutationFn: () => assetsApi.refreshProfile(token, asset.id), onSuccess: () => queryClient.invalidateQueries({ queryKey: ["assets"] }) });

  const reelRate = asset.rateCards.find((rc) => rc.format === "reel");
  const campaigns = asset.campaigns ?? [];
  const awaitingScrape = isAwaitingFirstScrape(asset);

  // Profile picture via one fetch into a blob URL (two <img> tags on the
  // same proxied URL raced each other in Chrome — see git history).
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [coverFailed, setCoverFailed] = useState(false);
  useEffect(() => {
    if (!asset.profilePicUrl) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    fetch(assetsApi.profilePicUrl(asset.id))
      .then((res) => (res.ok ? res.blob() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setCoverUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setCoverFailed(true);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset.id, asset.profilePicUrl]);
  const showCover = Boolean(coverUrl) && !coverFailed;
  const cols = selectable ? 9 : 8;

  // One <tbody> per page so the main row and its expanded editor read as
  // one "card" (tests and screen readers alike).
  return (
    <tbody data-testid="asset-card">
      <TR selected={selectable && selected} style={{ animationDelay: `${0.15 + index * 0.03}s` }}>
        {selectable && (
          <TD className="w-9 pr-0">
            <input type="checkbox" checked={selected} onChange={onToggleSelect} aria-label={`Select @${asset.handle} for a plan`} className="h-4 w-4 rounded accent-[var(--ink)]" />
          </TD>
        )}
        <TD>
          <div className="flex items-center gap-3">
            {showCover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={coverUrl!} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover ring-1 ring-border" />
            ) : (
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-text-faint ring-1 ring-inset ring-border">
                <AssetIcon className="h-3.5 w-3.5" />
              </span>
            )}
            <div className="min-w-0 max-w-[200px]">
              <div className="flex flex-wrap items-center gap-1.5">
                <a href={`https://www.instagram.com/${encodeURIComponent(asset.handle)}/`} target="_blank" rel="noopener noreferrer" title={`Open @${asset.handle} on Instagram`} className="truncate font-semibold hover:underline" data-testid="asset-instagram-link">
                  @{asset.handle}
                </a>
                {asset.approvalStatus === "pending" && <Tag tone="wait">Pending</Tag>}
                {asset.approvalStatus === "rejected" && <Tag tone="bad">Rejected</Tag>}
              </div>
              <p className="text-[0.75rem] text-text-muted sm:hidden">
                {awaitingScrape ? "Fetching from Instagram…" : compactNumber(asset.followers)}
                {asset.category ? ` · ${asset.category}` : ""}
              </p>
            </div>
          </div>
        </TD>
        <TD className="hidden md:table-cell">{asset.category ? <Tag tone="neutral" dot={false}>{asset.category}</Tag> : <span className="text-text-faint">—</span>}</TD>
        <TD right className="hidden whitespace-nowrap sm:table-cell">
          {awaitingScrape ? (
            <span className="inline-flex items-center gap-1.5 text-[0.78rem] text-text-muted" data-testid="scrape-pending">
              <RefreshIcon className="h-3 w-3 animate-spin" />
              Fetching…
            </span>
          ) : (
            <>
              <span title={`${count(asset.followers)} followers`} className="font-medium">
                {compactNumber(asset.followers)}
              </span>
              {asset.lastScrapeError && !asset.lastScrapedAt && (
                <span className="block text-[0.72rem] text-rose" title={asset.lastScrapeError} data-testid="scrape-failed">
                  Couldn&apos;t fetch from Instagram
                </span>
              )}
            </>
          )}
        </TD>
        <TD right className="hidden text-text-muted lg:table-cell">
          {awaitingScrape ? <span className="text-text-faint">…</span> : asset.engagement.avgViews === null ? "N/A" : compactNumber(asset.engagement.avgViews)}
        </TD>
        <TD right className="whitespace-nowrap">
          {reelRate ? (
            <span className="inline-flex items-center gap-1.5" data-testid="rate-card-cell">
              <span className="text-[0.75rem] text-text-muted">Reel</span>
              <span className="font-semibold tabular-nums">{money(reelRate.amount)}</span>
            </span>
          ) : (
            <span className="text-text-faint" title="No reel rate set yet">—</span>
          )}
        </TD>
        <TD className="hidden 2xl:table-cell">
          {campaigns.length === 0 ? (
            <span className="text-text-faint" title="No campaigns yet">—</span>
          ) : (
            <div className="flex max-w-[200px] flex-wrap gap-1">
              {campaigns.slice(0, 2).map((c) => (
                <Tag key={c.id} tone="neutral" dot={false} className="max-w-full truncate">
                  {c.title}
                </Tag>
              ))}
              {campaigns.length > 2 && <span className="text-[0.72rem] text-text-muted">+{campaigns.length - 2} more</span>}
            </div>
          )}
        </TD>
        <TD className="hidden whitespace-nowrap text-text-2 md:table-cell">{personLabel(asset.owner)}</TD>
        <TD right>
          <div className="flex items-center justify-end gap-1 whitespace-nowrap">
            {editable && asset.approvalStatus === "pending" && (
              <>
                <Button size="sm" onClick={() => approvalMutation.mutate("approved")} disabled={approvalMutation.isPending} aria-label={`Approve @${asset.handle}`}>
                  Approve
                </Button>
                <Button size="sm" variant="danger" onClick={() => approvalMutation.mutate("rejected")} disabled={approvalMutation.isPending}>
                  Reject
                </Button>
              </>
            )}
            {editable && (
              <button
                type="button"
                onClick={() => refreshMutation.mutate()}
                disabled={refreshMutation.isPending}
                title="Pull latest followers/profile from Instagram"
                aria-label={`Refresh @${asset.handle}'s profile from Instagram`}
                className="flex h-7 w-7 items-center justify-center rounded-[6px] border border-border text-text-muted hover:text-text disabled:opacity-50"
              >
                <RefreshIcon className={cn("h-3 w-3", refreshMutation.isPending && "animate-spin")} />
              </button>
            )}
            {editable && (
              <button type="button" onClick={() => setEditing((v) => !v)} className="text-[0.78rem] font-medium text-blue hover:text-text">
                {editing ? "Close" : "Edit"}
              </button>
            )}
          </div>
        </TD>
      </TR>
      {(editing || refreshMutation.isError || approvalMutation.isError) && (
        <tr className="border-b border-border bg-surface-2">
          <td colSpan={cols} className="px-[18px] py-3">
            {refreshMutation.isError && <ErrorNotice message={refreshMutation.error instanceof ApiError ? refreshMutation.error.message : "Couldn't refresh from Instagram."} />}
            {approvalMutation.isError && <ErrorNotice message={approvalMutation.error instanceof ApiError ? approvalMutation.error.message : "Couldn't update approval status."} />}
            {editing && (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_1fr_1fr]">
                <div>
                  <p className="mb-2 text-[0.72rem] font-medium text-text-muted">Rate card</p>
                  <div className="flex flex-col gap-2">
                    {formats.map((f) => (
                      <div key={f} className="flex items-center justify-between gap-3">
                        <span className="text-[0.8125rem] capitalize text-text-2">{f}</span>
                        <MoneyField compact value={String(amounts[f] ?? "")} onChange={(v) => setAmounts((prev) => ({ ...prev, [f]: v }))} placeholder="—" aria-label={`${f} rate`} className="w-32" />
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-[0.72rem] font-medium text-text-muted">Engagement</p>
                  <div className="grid grid-cols-3 gap-1.5">
                    <EngagementStat label="Avg. likes" value={asset.engagement.avgLikes} />
                    <EngagementStat label="Avg. comments" value={asset.engagement.avgComments} />
                    <EngagementStat label="Avg. views" value={asset.engagement.avgViews} />
                  </div>
                  {asset.engagement.sampleSize > 0 && (
                    <p className="mt-1.5 text-[0.68rem] text-text-muted">
                      Across {asset.engagement.sampleSize} {asset.engagement.source === "profile" ? "recent post" : "scraped post"}
                      {asset.engagement.sampleSize === 1 ? "" : "s"}
                      {asset.engagement.source === "profile" ? " on the profile" : ""}
                    </p>
                  )}
                  <p className="mb-2 mt-3 text-[0.72rem] font-medium text-text-muted">Campaigns</p>
                  {campaigns.length === 0 ? (
                    <p className="text-[0.78rem] text-text-faint">No campaigns yet.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {campaigns.map((c) => (
                        <Tag key={c.id} tone="neutral" dot={false}>
                          {c.title}
                        </Tag>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex flex-col justify-end gap-2">
                  {saveMutation.isError && <ErrorNotice message={saveMutation.error instanceof ApiError ? saveMutation.error.message : "Couldn't save."} />}
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
                      Cancel
                    </Button>
                    <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                      {saveMutation.isPending ? "Saving…" : "Save"}
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </td>
        </tr>
      )}
    </tbody>
  );
}

function EngagementStat({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-md border border-border bg-surface px-1.5 py-1.5 text-center">
      <span className="truncate text-[0.8125rem] font-semibold tabular-nums">{value === null ? "N/A" : compactNumber(value)}</span>
      <span className="truncate text-[0.65rem] text-text-muted">{label}</span>
    </div>
  );
}

/** Instagram's own handle rules — letters, digits, "." and "_", up to 30 chars. Mirrors server/src/modules/assets/importParser.js. */
const HANDLE_PATTERN = /^[a-z0-9._]{1,30}$/i;

/** "@handle" / "https://instagram.com/handle/" → "handle"; null when nothing usable is left. */
function normalizeHandleInput(raw: string): string | null {
  let value = raw.trim();
  if (!value) return null;
  const urlMatch = value.match(/^(?:https?:\/\/)?(?:www\.)?instagram\.com\/([^/?#\s]+)/i);
  if (urlMatch) value = urlMatch[1];
  else if (/^(?:https?:\/\/|www\.)/i.test(value)) return null;
  value = value.replace(/^@+/, "").trim();
  return value || null;
}

function NewAssetModal({
  token,
  isAdmin,
  canAssignOwner,
  existingCategories,
  onClose,
  onCreated,
}: {
  token: string;
  /** Real staff admin extras only — rate cards, auto-approval-on-creation. */
  isAdmin: boolean;
  /** Owner-picker + new-account creation: real admin, or a plan maker granted inventory.edit (25 Sep). A plain creator's page is always their own, so neither applies to them. */
  canAssignOwner: boolean;
  /** Distinct categories already on some page in the DB (user request, 23 Sep — search, not a fixed list). */
  existingCategories: string[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [handle, setHandle] = useState("");
  const [category, setCategory] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [reelRate, setReelRate] = useState("");
  const [storyRate, setStoryRate] = useState("");
  const [submitted, setSubmitted] = useState(false);
  // Whoever can assign an owner picks which creator account the page sits
  // under (user request, 14 Sep; extended to plan makers 25 Sep); a plain
  // creator's page is always their own, so no picker for them.
  const ownersQuery = useQuery({ queryKey: ["assets", "owners"], queryFn: () => assetsApi.owners(token), enabled: canAssignOwner });
  const owners = ownersQuery.data ?? [];

  // Account for the page (admin only): an existing creator, or a brand-new
  // one. 24 Sep redesign: a new account is NOT created on its own any more —
  // it's created together with the page on the one "Create page" submit, and
  // its one-time password is shown on the success screen afterwards (with a
  // Copy button), never mid-form. That way an abandoned form leaves no orphan
  // account behind, and the password can't vanish when the modal closes.
  const [accountMode, setAccountMode] = useState<"existing" | "new">("existing");
  // Only name + email for a new account (24 Sep) — the email is their login.
  const [newUserName, setNewUserName] = useState("");
  const [newUserEmail, setNewUserEmail] = useState("");
  const newUserEmailValid = /^\S+@\S+\.\S+$/.test(newUserEmail.trim());
  // Set once signup succeeds — kept so a failed page create can be retried
  // without creating the account twice, and so its password is never lost.
  const [createdAccount, setCreatedAccount] = useState<{ id: string; name: string | null; email: string; password: string } | null>(null);
  const [created, setCreated] = useState<{ handle: string } | null>(null);
  const [copied, setCopied] = useState(false);

  // No accounts yet → start on "New account".
  useEffect(() => {
    if (canAssignOwner && ownersQuery.isSuccess && owners.length === 0) setAccountMode("new");
  }, [canAssignOwner, ownersQuery.isSuccess, owners.length]);

  const cleanHandle = normalizeHandleInput(handle);
  const handleError = !handle.trim() ? "Enter the page's Instagram handle." : !cleanHandle ? "That doesn't look like an Instagram handle or profile link." : !HANDLE_PATTERN.test(cleanHandle) ? "Handles use letters, digits, dots and underscores only (up to 30 characters)." : null;
  const usingNewAccount = canAssignOwner && accountMode === "new" && !createdAccount;
  const ownerError = !canAssignOwner || createdAccount ? null : accountMode === "new" ? (newUserEmailValid ? null : "Enter the new account's email — it's their login.") : !ownerId ? "Pick the creator account this page belongs to." : null;

  const rateCards = [
    { format: "reel", amount: Number(reelRate) },
    { format: "story", amount: Number(storyRate) },
  ].filter((rc) => rc.amount > 0);

  const createMutation = useMutation({
    mutationFn: async () => {
      let owner = canAssignOwner ? (createdAccount?.id ?? (accountMode === "existing" ? ownerId : null)) : null;
      if (usingNewAccount) {
        const result = await authApi.signup(token, { email: newUserEmail.trim(), name: newUserName.trim() || undefined, role: "CREATOR" });
        setCreatedAccount({ id: result.user.id, name: result.user.name, email: result.user.email ?? newUserEmail.trim(), password: result.generatedPassword });
        owner = result.user.id;
      }
      return assetsApi.create(token, cleanHandle as string, "instagram", { ...(category ? { category } : {}), ...(canAssignOwner && owner ? { ownerId: owner } : {}), ...(rateCards.length > 0 ? { rateCards } : {}) });
    },
    onSuccess: () => {
      onCreated();
      // Nothing one-time to show for an existing account — close as before.
      if (createdAccount || usingNewAccount) setCreated({ handle: cleanHandle as string });
      else onClose();
    },
    onSettled: () => ownersQuery.refetch(),
  });
  const ownerOptions = owners.map((o) => ({ value: o.id, label: personLabel(o), hint: o.name?.trim() ? (o.email ?? o.phoneNumber ?? undefined) : undefined, keywords: [o.email, o.phoneNumber].filter(Boolean).join(" ") || undefined }));
  const categorySuggestions = existingCategories.map((c) => ({ key: c, label: c }));

  async function copyCredentials() {
    if (!createdAccount) return;
    try {
      await navigator.clipboard.writeText(`Email: ${createdAccount.email}\nPassword: ${createdAccount.password}`);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const credentials = createdAccount && (
    <div className="flex flex-col gap-3 rounded-lg border border-border-strong bg-surface-2 p-4" data-testid="new-account-credentials">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface text-[0.75rem] font-semibold text-text-2 ring-1 ring-inset ring-border">
          {initialsOf(createdAccount.name ?? createdAccount.email)}
        </span>
        <div className="min-w-0">
          <p className="truncate text-[0.875rem] font-semibold">{createdAccount.name ?? "New creator"}</p>
          <p className="truncate text-[0.75rem] text-text-muted">{createdAccount.email}</p>
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-[0.72rem] font-medium text-text-muted">Login password</span>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 break-all rounded-md border border-border bg-surface px-3 py-2 font-mono text-[0.9375rem] font-semibold tracking-wide" data-testid="generated-password">
            {createdAccount.password}
          </code>
          <Button type="button" size="sm" variant="secondary" onClick={copyCredentials}>
            {copied ? <CheckIcon className="h-3.5 w-3.5" /> : null}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      </div>
      <p className="text-[0.75rem] text-accent-2">Share it with the creator now — it won&rsquo;t be shown again. They sign in with this email and confirm a code we email them.</p>
    </div>
  );

  // ── Success (new account only): the page exists, hand over the login. ──
  if (created && createdAccount) {
    return (
      <Sheet onClose={onClose} panelClassName="md:max-w-[440px]">
        <div className="flex flex-col gap-5 overflow-y-auto p-6 pt-1" data-testid="create-page-success">
          <div className="flex flex-col items-center gap-2 text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-full border border-accent-line bg-accent-soft text-accent">
              <CheckIcon className="h-5 w-5" />
            </span>
            <h2 className="text-[1.125rem] font-semibold tracking-[-0.02em]">@{created.handle} is live</h2>
            <p className="max-w-[36ch] text-[0.8125rem] text-text-muted">Page created under a new creator account. Followers and average views are being fetched from Instagram.</p>
          </div>
          {credentials}
          <Button type="button" className="w-full" onClick={onClose}>
            {copied ? "Done" : "I've saved the password — done"}
          </Button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet onClose={onClose} panelClassName="md:max-w-[440px]">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(true);
          if (handleError || ownerError) return;
          createMutation.mutate();
        }}
        noValidate
        className="flex min-w-0 flex-col gap-5 overflow-y-auto p-6 pt-1"
        data-testid="create-page-form"
      >
        <h2 className="text-[1.125rem] font-semibold tracking-[-0.02em]">{canAssignOwner ? "Create a page" : "Add a page"}</h2>
        {canAssignOwner && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[0.78rem] font-medium text-text-2">Account</span>
              {!createdAccount && (
                <div role="tablist" aria-label="Account" className="inline-flex rounded-full border border-border bg-surface-2 p-0.5 text-[0.75rem]">
                  {(
                    [
                      ["existing", "Existing account"],
                      ["new", "New account"],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      role="tab"
                      aria-selected={accountMode === key}
                      onClick={() => setAccountMode(key)}
                      className={cn("rounded-full px-2.5 py-1 font-medium transition-colors", accountMode === key ? "bg-surface text-text shadow-card" : "text-text-muted hover:text-text")}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {createdAccount ? (
              // Account was created but the page wasn't (e.g. a bad handle) — keep the login visible; a retry reuses this account.
              credentials
            ) : accountMode === "new" ? (
              <div className="flex flex-col gap-2.5 rounded-lg border border-border bg-surface-2 p-3" data-testid="new-account-fields">
                <TextField value={newUserName} onChange={setNewUserName} placeholder="Creator name (optional)" aria-label="New user name" />
                <TextField type="email" value={newUserEmail} onChange={setNewUserEmail} placeholder="Email — their login (e.g. name@gmail.com)" aria-label="New user email" />
                {submitted && !newUserEmailValid && <FieldError message="Enter a valid email address — it's their login." />}
                <p className="text-[0.72rem] text-text-muted">The account is created together with the page. Its login password is shown once, right after.</p>
              </div>
            ) : ownersQuery.isError ? (
              <ErrorNotice message={ownersQuery.error instanceof ApiError ? ownersQuery.error.message : "Couldn't load creator accounts."} />
            ) : (
              <>
                <SearchableSelect
                  className="min-w-0"
                  value={ownerId}
                  onChange={setOwnerId}
                  options={ownerOptions}
                  disabled={ownersQuery.isLoading}
                  invalid={submitted && Boolean(ownerError)}
                  placeholder={ownersQuery.isLoading ? "Loading accounts…" : "Search by name, phone or email…"}
                  emptyText="No creator account matches — switch to New account."
                  aria-label="Creator account"
                />
                {submitted && <FieldError message={ownerError} />}
              </>
            )}
          </div>
        )}
        <Field label="Instagram handle">
          <TextField value={handle} onChange={setHandle} placeholder="e.g. demo.page" aria-label="Instagram handle" />
          {submitted && <FieldError message={handleError} />}
          {!handleError && cleanHandle && cleanHandle !== handle.trim() && <p className="text-[0.75rem] text-text-muted">Will be saved as @{cleanHandle}</p>}
        </Field>
        <Field label="Category (optional)">
          <ComboInput aria-label="Category" value={category} onChange={setCategory} suggestions={categorySuggestions} placeholder="Search or type a new category…" />
        </Field>
        {isAdmin && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Reel rate (optional)">
              <MoneyField value={reelRate} onChange={setReelRate} placeholder="0" aria-label="Reel rate" />
            </Field>
            <Field label="Story rate (optional)">
              <MoneyField value={storyRate} onChange={setStoryRate} placeholder="0" aria-label="Story rate" />
            </Field>
          </div>
        )}
        {isAdmin && <p className="-mt-2 text-[0.75rem] text-text-muted">Approved on creation. Followers and average views are fetched from Instagram right after — usually within a minute or two.</p>}
        {createMutation.isError && (
          <ErrorNotice
            message={`${createdAccount ? "The account was created, but the page wasn't: " : ""}${createMutation.error instanceof ApiError ? createMutation.error.message : "Couldn't add the page."}`}
          />
        )}
        <div className="flex gap-2.5">
          <Button type="button" variant="ghost" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" className="flex-1" disabled={createMutation.isPending}>
            {createMutation.isPending ? "Creating…" : !canAssignOwner ? "Add page" : usingNewAccount ? "Create account & page" : "Create page"}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}
