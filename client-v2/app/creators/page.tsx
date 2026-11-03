"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowUpDown, CircleCheck, ClipboardList, Eye, MoreHorizontal, Plus, RefreshCw, SlidersHorizontal, Trash2, Upload, X } from "lucide-react";

import { useAuth } from "@/lib/auth-context";
import { ApiError, assets as assetsApi, hasAccess, type Asset } from "@/lib/api-client";
import { canAddForOwner, canApprovePages, canDeletePage, canImportPages, canEditPages, canProposeEdits, canViewCreators, GRADES, groupVendors, rateOf, scrapeState } from "@/lib/creators";
import { money, personLabel, plural } from "@/lib/format";
import { canEditPlan } from "@/lib/plans";
import { FORMATS, formatLabel } from "@/lib/formats";
import { invalidatePages, useAllPages } from "@/lib/queries/creators";
import { cn } from "@/lib/utils";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/taggify/illustration";
import { ActionBarDivider, FloatingActionBar } from "@/components/taggify/floating-action-bar";
import { Money } from "@/components/taggify/money";
import { PlatformIcon, WhatsAppIcon } from "@/components/taggify/platform-icon";
import { SearchField } from "@/components/taggify/search-field";
import { SelectMenu } from "@/components/taggify/select-menu";
import { StatusPill } from "@/components/taggify/status-pill";
import { UserAvatar } from "@/components/taggify/user-avatar";
import { audienceLabel, displayHandle, PageAvatar, PageAvatarStack } from "@/components/finance/identity";
import { Pager, PER_PAGE } from "@/components/finance/pager";
import { LoadError, NoAccess } from "@/components/finance/states";
import { AddPageDialog } from "@/components/creators/add-page-dialog";
import { ImportPagesDialog } from "@/components/creators/import-pages-dialog";
import { GradeMark, PageSheet } from "@/components/creators/page-sheet";

type Tab = "pages" | "vendors" | "waiting";
const errText = (e: unknown, fallback: string) => (e instanceof ApiError || e instanceof Error ? e.message : fallback);
const count = (n: number | null | undefined) => (n == null ? "—" : audienceLabel(n, null, true));

const PLATFORMS = [
  { value: "all", label: "All" },
  { value: "instagram", label: "Instagram" },
  { value: "youtube", label: "YouTube" },
];
const SORTS = [
  { value: "followers", label: "Most followers" },
  { value: "newest", label: "Newest" },
  { value: "handle", label: "A–Z" },
];

/** One status per row (3 Nov): Inactive wins, else the approval state; colour plus the word. */
function rowStatus(p: Asset) {
  if (p.isActive === false) return { label: "Inactive", className: "text-fg-muted" };
  if (p.approvalStatus === "approved") return { label: "Approved", className: "text-success-fg" };
  if (p.approvalStatus === "rejected") return { label: "Rejected", className: "text-danger-fg" };
  return { label: "Waiting for approval", className: "text-warning-fg" };
}

export default function CreatorsPage() {
  return (
    <AppShell active="creators">
      <Suspense>
        <Creators />
      </Suspense>
    </AppShell>
  );
}

/**
 * Creators = vendors and the pages they own (v1 Inventory; prototype "Creators").
 * A vendor is paid once for all their pages, so the Vendors tab groups by owner.
 *
 * Declutter (3 Nov, approved mockup): one quiet toolbar (search, a Filters menu
 * with removable chips, a small sort), selection from the header checkbox's
 * menu, bulk actions in a floating bar only while rows are ticked, one status
 * per row, and a "⋯" menu per row.
 */
function Creators() {
  const { user, accessToken } = useAuth();
  const params = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const pages = useAllPages();
  const initialTab = params.get("tab");
  const [tab, setTab] = useState<Tab>(initialTab === "vendors" || initialTab === "waiting" ? initialTab : "pages");
  const [q, setQ] = useState("");
  const [platform, setPlatform] = useState("all");
  const [category, setCategory] = useState("all");
  const [grade, setGrade] = useState("all");
  const [sort, setSort] = useState("followers");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(PER_PAGE);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Asset | null>(null);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  // Pages awaiting the remove confirmation: the selection (bulk) or one row from its "⋯" menu.
  const [removing, setRemoving] = useState<{ ids: string[]; bulk: boolean } | null>(null);

  const editable = canEditPages(user);
  const deletable = canDeletePage(user);
  const proposer = canProposeEdits(user);
  // Ticking pages: bulk Instagram refresh (inventory.edit) and, as in v1, "Create plan" for anyone who can make plans.
  const canPlan = canEditPlan(user);
  const canSelect = editable || canPlan;
  const approvable = canApprovePages(user);
  const all = useMemo(() => pages.data ?? [], [pages.data]);
  const categories = useMemo(() => [...new Set(all.map((p) => p.category).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b)), [all]);
  const waiting = all.filter((p) => p.approvalStatus === "pending");

  const needle = q.trim().toLowerCase();
  const matches = (p: Asset) =>
    (platform === "all" || p.platform.toLowerCase() === platform) &&
    (category === "all" || p.category === category) &&
    (grade === "all" || (grade === "none" ? !p.grade : p.grade === grade)) &&
    (!needle || `${p.handle} ${p.fullName ?? ""} ${p.category ?? ""} ${personLabel(p.owner, "")} ${p.owner?.email ?? ""}`.toLowerCase().includes(needle));
  const sortPages = (a: Asset, b: Asset) => (sort === "handle" ? a.handle.localeCompare(b.handle) : sort === "newest" ? +new Date(b.createdAt) - +new Date(a.createdAt) : (b.followers ?? 0) - (a.followers ?? 0));

  const pageRows = all.filter((p) => (tab === "waiting" ? p.approvalStatus === "pending" : true)).filter(matches).sort(sortPages);
  const vendors = useMemo(() => groupVendors(all), [all]);
  const vendorRows = vendors
    .filter((v) => v.pages.some(matches))
    .sort((a, b) => (sort === "handle" ? personLabel(a.owner).localeCompare(personLabel(b.owner)) : sort === "newest" ? Math.max(...b.pages.map((p) => +new Date(p.createdAt))) - Math.max(...a.pages.map((p) => +new Date(p.createdAt))) : b.followers - a.followers));
  const rowsCount = tab === "vendors" ? vendorRows.length : pageRows.length;
  const pageCount = Math.max(1, Math.ceil(rowsCount / perPage));
  const current = Math.min(page, pageCount);
  const slice = <T,>(rows: T[]) => rows.slice((current - 1) * perPage, current * perPage);
  const shownPages = slice(pageRows);
  // The selection spans every pager page of the current filter (a filter or tab change clears it).
  const selectedRows = pageRows.filter((p) => selected.has(p.id));
  const visibleSelected = shownPages.filter((p) => selected.has(p.id));
  const selectFirst = (n: number) => setSelected(new Set(pageRows.slice(0, Math.max(0, n)).map((p) => p.id)));
  const toggleShown = (on: boolean) =>
    setSelected((s) => {
      const n = new Set(s);
      for (const p of shownPages) {
        if (on) n.add(p.id);
        else n.delete(p.id);
      }
      return n;
    });
  const createPlan = () => router.push(`/plans/new?assetIds=${selectedRows.map((p) => encodeURIComponent(p.id)).join(",")}`);

  // `bulk`: the ids are the ticked selection (floating bar) rather than one row's "⋯" menu, which leaves the ticks alone.
  const refreshMany = useMutation({
    mutationFn: ({ ids }: { ids: string[]; bulk: boolean }) => assetsApi.refreshProfiles(accessToken!, ids),
    onSuccess: async (r, v) => {
      if (v.bulk) setSelected(new Set());
      await invalidatePages(qc);
      toast.success(`Fetching ${plural(r.queued, "page")} from Instagram. Numbers update in a few minutes.`);
    },
    onError: (e) => toast.error(errText(e, "Couldn't start the refresh.")),
  });
  // Bulk delete (19 Oct, v1 parity): pages the server refuses (posts on record / approved plan) stay ticked so they can be switched to Inactive.
  const removeMany = useMutation({
    mutationFn: ({ ids }: { ids: string[]; bulk: boolean }) => assetsApi.removeMany(accessToken!, ids),
    onSuccess: async ({ deleted, skipped }, v) => {
      // Bulk: what the server kept stays ticked (switch it to Inactive instead). One row: just drop it from the ticks if it went.
      if (v.bulk) setSelected(new Set(skipped.map((s) => s.id)));
      else
        setSelected((s) => {
          const n = new Set(s);
          for (const id of deleted) n.delete(id);
          return n;
        });
      setRemoving(null);
      await invalidatePages(qc);
      await qc.invalidateQueries({ queryKey: ["plans"] });
      if (skipped.length === 0) toast.success(`${plural(deleted.length, "page")} removed from Inventory.`);
      else toast.warning(`${plural(deleted.length, "page")} removed. ${plural(skipped.length, "page")} couldn't be (usually posts on record or an approved plan). They're still selected; switch them to Inactive instead.`);
    },
    onError: async (e) => {
      setRemoving(null);
      // The server removes pages one by one, so a failure part-way may still have removed some.
      await invalidatePages(qc);
      await qc.invalidateQueries({ queryKey: ["plans"] });
      toast.error(errText(e, "Couldn't remove these pages."));
    },
  });
  const decide = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "approved" | "rejected"; handle: string }) => assetsApi.setApproval(accessToken!, id, status),
    onSuccess: async (_r, v) => {
      await invalidatePages(qc);
      toast.success(`${v.handle} ${v.status === "approved" ? "approved" : "rejected"}.`);
    },
    onError: (e) => toast.error(errText(e, "That didn't go through. Try again.")),
  });

  if (!canViewCreators(user)) return <NoAccess what="Inventory" />;
  // A filter change hides rows; never keep hidden rows ticked.
  const resetPage = () => {
    setPage(1);
    setSelected(new Set());
  };
  const setFilter = (set: (v: string) => void) => (v: string) => {
    set(v);
    resetPage();
  };
  const activeFilters = [
    platform !== "all" && { key: "platform", label: `Platform: ${PLATFORMS.find((o) => o.value === platform)?.label ?? platform}`, clear: () => setFilter(setPlatform)("all") },
    category !== "all" && { key: "category", label: `Category: ${category}`, clear: () => setFilter(setCategory)("all") },
    grade !== "all" && { key: "grade", label: grade === "none" ? "Not graded" : `Grade ${grade}`, clear: () => setFilter(setGrade)("all") },
  ].filter((f): f is { key: string; label: string; clear: () => void } => !!f);
  const filtering = !!needle || activeFilters.length > 0;
  const adder = canAddForOwner(user);
  // The page panel always reads the latest copy of the page after a save.
  const openPage = open ? (all.find((p) => p.id === open.id) ?? open) : null;
  const removingCount = removing?.ids.length ?? 0;
  const showWaitingTab = waiting.length > 0 || tab === "waiting";
  const selecting = canSelect && tab !== "vendors" && selectedRows.length > 0;

  return (
    <div className={cn("workspace-page", selecting && "pb-24")}>
      <div className="page-heading">
        <div className="page-heading-copy">
          <h1 className="text-display">Inventory</h1>
          <p className="mt-1 text-body text-muted-foreground">Pages and the vendors who own them.</p>
        </div>
        {(adder || canImportPages(user)) && (
          <div className="ml-auto flex flex-wrap gap-2">
            {canImportPages(user) && (
              <Button variant="outline" onClick={() => setImporting(true)}>
                <Upload />
                Import pages
              </Button>
            )}
            {adder && (
              <Button onClick={() => setAdding(true)}>
                <Plus />
                Add page
              </Button>
            )}
          </div>
        )}
      </div>

      <Card className="ledger-panel">
        <Tabs
          value={tab}
          onValueChange={(v) => {
            setTab(v as Tab);
            resetPage();
          }}
        >
          <div className="tab-shelf flex items-center gap-4">
            <TabsList className="flex-1 border-b-0">
              <TabsTrigger value="pages" aria-label={`Pages (${all.length})`}>
                Pages<span className="tab-count">{all.length}</span>
              </TabsTrigger>
              <TabsTrigger value="vendors" aria-label={`Vendors (${vendors.length})`}>
                Vendors<span className="tab-count">{vendors.length}</span>
              </TabsTrigger>
              {showWaitingTab && (
                <TabsTrigger value="waiting" aria-label={`Waiting for approval (${waiting.length})`}>
                  Waiting for approval<span className="tab-count tab-count-attention">{waiting.length}</span>
                </TabsTrigger>
              )}
            </TabsList>
            {!showWaitingTab && approvable && !pages.isLoading && (
              <span className="hidden items-center gap-2 text-small text-muted-foreground sm:inline-flex">
                <CircleCheck className="h-4 w-4 text-success" aria-hidden />
                No approvals waiting
              </span>
            )}
          </div>
        </Tabs>

        <div className="filter-bar">
          <SearchField
            label="Search creators"
            placeholder="Search page, vendor or category..."
            className="w-full sm:w-80"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              resetPage();
            }}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                <SlidersHorizontal />
                Filters
                {activeFilters.length > 0 && <span className="floating-action-count">{activeFilters.length}</span>}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <FilterSub label="Platform" value={platform} onChange={setFilter(setPlatform)} options={PLATFORMS} />
              <FilterSub label="Category" value={category} onChange={setFilter(setCategory)} options={[{ value: "all", label: "All" }, ...categories.map((c) => ({ value: c, label: c }))]} />
              <FilterSub label="Grade" value={grade} onChange={setFilter(setGrade)} options={[{ value: "all", label: "All" }, ...GRADES.map((g) => ({ value: g, label: `Grade ${g}` })), { value: "none", label: "Not graded" }]} />
              {activeFilters.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => activeFilters.forEach((f) => f.clear())}>Clear filters</DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          {activeFilters.map((f) => (
            <span key={f.key} className="filter-chip">
              {f.label}
              <button type="button" aria-label={`Remove filter ${f.label}`} onClick={f.clear}>
                <X className="h-3 w-3" aria-hidden />
              </button>
            </span>
          ))}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="text-muted-foreground sm:ml-auto" aria-label={`Sort: ${SORTS.find((s) => s.value === sort)?.label}`}>
                <ArrowUpDown />
                {tab === "vendors" && sort === "handle" ? "Name A–Z" : SORTS.find((s) => s.value === sort)?.label}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Sort by</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={sort} onValueChange={setSort}>
                {SORTS.map((s) => (
                  <DropdownMenuRadioItem key={s.value} value={s.value}>
                    {tab === "vendors" && s.value === "handle" ? "Name A–Z" : s.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {pages.isError ? (
          <LoadError onRetry={() => pages.refetch()} what="creators" />
        ) : pages.isLoading ? (
          <div className="flex flex-col gap-2 border-t p-5">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : rowsCount === 0 ? (
          <div className="border-t">
            <EmptyState name={all.length === 0 ? "onboarding-01" : tab === "waiting" && !filtering ? "empty-plans" : "empty-search"} title={all.length === 0 ? "No pages yet" : tab === "waiting" && !filtering ? "Nothing waiting for approval" : "Nothing matches"}>
              {all.length === 0 ? (adder ? "Add the first page with Add page." : "Pages show up here once they're added.") : tab === "waiting" && !filtering ? "Pages creators add themselves show up here." : "Try another search or filter."}
            </EmptyState>
          </div>
        ) : tab === "vendors" ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vendor</TableHead>
                <TableHead>Pages</TableHead>
                <TableHead className="text-right">Total audience</TableHead>
                <TableHead className="text-right">Campaigns</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">
                  <span className="sr-only">Action</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {slice(vendorRows).map((v) => (
                <TableRow key={v.id}>
                  <TableCell>
                    <span className="flex items-center gap-3">
                      <UserAvatar name={personLabel(v.owner, "Vendor")} size="md" />
                      <span className="min-w-0">
                        <span className="block truncate text-body-strong">{personLabel(v.owner, "Unnamed vendor")}</span>
                        <span className="block truncate text-small text-fg-muted">{v.owner?.email ?? v.owner?.phoneNumber ?? "—"}</span>
                      </span>
                    </span>
                  </TableCell>
                  <TableCell>
                    <PageAvatarStack pages={v.pages} onOpen={setOpen} />
                  </TableCell>
                  <TableCell className="text-right">{count(v.followers)}</TableCell>
                  <TableCell className="text-right">{v.campaigns}</TableCell>
                  <TableCell>
                    <span className="inline-flex flex-nowrap items-center gap-2">
                      {v.pending > 0 && <StatusPill tone="warning">{plural(v.pending, "page")} waiting</StatusPill>}
                      {v.rejected > 0 && <StatusPill tone="danger">{plural(v.rejected, "page")} rejected</StatusPill>}
                      {v.pending === 0 && v.rejected === 0 && <StatusPill tone="success">Approved</StatusPill>}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    {hasAccess(user, "finance.pay") && (
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/finance/payouts/${v.id}`}>Payouts</Link>
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                {canSelect && (
                  <TableHead className="w-20">
                    <SelectMenu
                      total={pageRows.length}
                      shown={shownPages.length}
                      shownSelected={visibleSelected.length}
                      selectedCount={selectedRows.length}
                      onToggleShown={toggleShown}
                      onSelectFirst={selectFirst}
                      onClear={() => setSelected(new Set())}
                    />
                  </TableHead>
                )}
                <TableHead>Page</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-center">Grade</TableHead>
                <TableHead className="text-right">Reach</TableHead>
                <TableHead className="text-right">Rate</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shownPages.map((p) => {
                const status = rowStatus(p);
                const scrape = scrapeState(p);
                const handle = displayHandle(p.handle, p.platform);
                const reel = rateOf(p, "reel");
                // Every priced format, in the app's order; the row shows Reel (or the first priced one) and how many more.
                const priced = FORMATS.filter((f) => rateOf(p, f) != null);
                const lead = reel != null ? "reel" : priced[0];
                const more = priced.length - (lead ? 1 : 0);
                const allRates = priced.map((f) => `${formatLabel(f)}: ${money(rateOf(p, f)!)}`).join(" · ") || "No rates yet";
                const editSuggested = !!p.pendingEdit && typeof p.pendingEdit === "object" && Object.keys(p.pendingEdit).length > 0;
                return (
                  <TableRow key={p.id} data-state={selected.has(p.id) ? "selected" : undefined} className={cn(p.isActive === false && "inventory-row-inactive")}>
                    {canSelect && (
                      <TableCell>
                        <span className="inline-flex pl-2">
                          <Checkbox
                            aria-label={`Select ${handle}`}
                            checked={selected.has(p.id)}
                            onCheckedChange={(v) =>
                              setSelected((s) => {
                                const n = new Set(s);
                                if (v === true) n.add(p.id);
                                else n.delete(p.id);
                                return n;
                              })
                            }
                          />
                        </span>
                      </TableCell>
                    )}
                    <TableCell>
                      <div className="inventory-identity">
                        <button type="button" tabIndex={-1} aria-hidden onClick={() => setOpen(p)} className="shrink-0 rounded-pill">
                          <PageAvatar assetId={p.id} handle={p.handle} size="md" />
                        </button>
                        <div className="inventory-identity-text">
                          <div className="inventory-identity-line">
                            <button type="button" aria-label={`View ${handle}`} title={proposer ? "View / suggest changes" : "View details"} onClick={() => setOpen(p)} className="inline-flex min-w-0 items-center gap-2 rounded-md text-left text-body-strong text-foreground hover:text-brand-ink">
                              <PlatformIcon platform={p.platform} size={16} />
                              <span className="truncate">{handle}</span>
                            </button>
                            {p.groupLink && (
                              <a href={p.groupLink} target="_blank" rel="noreferrer" className="whatsapp-dot" title={`WhatsApp group: ${p.groupLink}`} aria-label={`WhatsApp group for ${handle}`}>
                                <WhatsAppIcon size={14} />
                              </a>
                            )}
                          </div>
                          <span className="inventory-identity-name">{scrape === "fetching" ? "Fetching from Instagram…" : scrape === "failed" ? "Couldn't fetch the profile" : (p.fullName ?? (p.platform.toLowerCase() === "youtube" ? "YouTube" : "Instagram"))}</span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-fg-strong">{personLabel(p.owner, "—")}</TableCell>
                    <TableCell className={cn("whitespace-nowrap", p.category ? "text-fg-strong" : "text-fg-muted")}>{p.category ?? "Not set"}</TableCell>
                    <TableCell className="text-center">{p.grade ? <GradeMark grade={p.grade} /> : <span className="text-fg-muted">–</span>}</TableCell>
                    <TableCell className="text-right">
                      <span className="inventory-stack">
                        <span className="font-semibold">{count(p.followers)}</span>
                        <span className="text-small text-fg-muted">{p.engagement.avgViews != null ? `${count(p.engagement.avgViews)} avg views` : "No views yet"}</span>
                      </span>
                    </TableCell>
                    <TableCell className="text-right" title={allRates}>
                      {lead ? (
                        <span className="inventory-stack">
                          <span className="font-semibold">
                            <Money value={rateOf(p, lead)!} />
                          </span>
                          <span className="text-small text-fg-muted">
                            {formatLabel(lead)}
                            {more > 0 && ` · +${plural(more, "format")}`}
                          </span>
                        </span>
                      ) : (
                        <span className="text-fg-muted">No rates</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="flex flex-col gap-1">
                        <span className={cn("status-dot", status.className)}>{status.label}</span>
                        {p.profileBroken && (
                          <span className="text-micro text-danger-fg" title={p.lastScrapeError ?? "Not found on Instagram"}>
                            Not on Instagram
                          </span>
                        )}
                        {editSuggested && <span className="text-micro text-fg-secondary">Edit suggested</span>}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="inline-flex items-center gap-2">
                        {approvable && p.approvalStatus === "pending" && (
                          <>
                            <Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => decide.mutate({ id: p.id, status: "rejected", handle: p.handle })}>
                              Reject
                            </Button>
                            <Button size="sm" variant="success" disabled={decide.isPending} onClick={() => decide.mutate({ id: p.id, status: "approved", handle: p.handle })}>
                              Approve
                            </Button>
                          </>
                        )}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="icon-sm" variant="ghost" aria-label={`More actions for ${handle}`}>
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => setOpen(p)}>
                              <Eye />
                              {proposer ? "View / suggest changes" : "View details"}
                            </DropdownMenuItem>
                            {editable && (
                              <DropdownMenuItem disabled={refreshMany.isPending} onSelect={() => refreshMany.mutate({ ids: [p.id], bulk: false })}>
                                <RefreshCw />
                                Refresh from Instagram
                              </DropdownMenuItem>
                            )}
                            {deletable && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem className="text-danger-fg focus:text-danger-fg" onSelect={() => setRemoving({ ids: [p.id], bulk: false })}>
                                  <Trash2 />
                                  Remove…
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        {rowsCount > 0 && (
          <Pager
            total={rowsCount}
            page={current}
            pages={pageCount}
            noun={tab === "vendors" ? "vendors" : "pages"}
            onPage={setPage}
            perPage={perPage}
            onPerPage={(n) => {
              setPerPage(n);
              setPage(1);
            }}
          />
        )}
      </Card>

      {selecting && (
        <FloatingActionBar count={selectedRows.length} total={pageRows.length} onClear={() => setSelected(new Set())}>
          {editable && (
            <Button size="sm" variant="ghost" disabled={refreshMany.isPending} onClick={() => refreshMany.mutate({ ids: selectedRows.map((p) => p.id), bulk: true })}>
              <RefreshCw />
              Refresh from Instagram
            </Button>
          )}
          {canPlan && (
            <Button size="sm" aria-label={`Create plan (${selectedRows.length})`} onClick={createPlan}>
              <ClipboardList />
              Create plan
            </Button>
          )}
          {deletable && (
            <>
              <ActionBarDivider />
              <Button size="icon-sm" variant="ghost" className="text-danger-fg hover:bg-danger-soft hover:text-danger-fg" aria-label={`Remove (${selectedRows.length})`} title="Remove selected pages" onClick={() => setRemoving({ ids: selectedRows.map((p) => p.id), bulk: true })}>
                <Trash2 />
              </Button>
            </>
          )}
        </FloatingActionBar>
      )}

      <PageSheet page={openPage} onClose={() => setOpen(null)} />
      <AddPageDialog open={adding} onOpenChange={setAdding} />
      <ImportPagesDialog open={importing} onOpenChange={setImporting} />
      <Dialog open={removing != null} onOpenChange={(o) => !o && !removeMany.isPending && setRemoving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {plural(removingCount, "page")}?</DialogTitle>
            <DialogDescription>
              {removingCount === 1 ? "It leaves" : "They leave"} Inventory and any draft plans {removingCount === 1 ? "it is" : "they are"} on. A page with posts on record or on an approved plan can&apos;t be removed{removing?.bulk ? "; it stays selected so you can switch it to Inactive instead" : "; switch it to Inactive instead"}.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={removeMany.isPending} onClick={() => setRemoving(null)}>
              {removingCount === 1 ? "Keep it" : "Keep them"}
            </Button>
            <Button variant="destructive" disabled={removeMany.isPending || removingCount === 0} onClick={() => removing && removeMany.mutate(removing)}>
              {removeMany.isPending ? "Removing…" : `Remove ${plural(removingCount, "page")}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** One filter inside the Filters menu: "Platform · All ›" opening its choices. */
function FilterSub({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  const current = options.find((o) => o.value === value)?.label ?? value;
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        {label}
        <span className={cn("ml-auto pl-4 text-small", value === "all" ? "text-fg-muted" : "font-semibold text-brand-ink")}>{current}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="max-h-80 overflow-y-auto">
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          {options.map((o) => (
            <DropdownMenuRadioItem key={o.value} value={o.value}>
              {o.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
