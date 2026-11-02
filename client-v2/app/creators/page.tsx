"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ClipboardList, Eye, Plus, RefreshCw, Trash2, Upload } from "lucide-react";

import { useAuth } from "@/lib/auth-context";
import { ApiError, assets as assetsApi, hasAccess, type Asset } from "@/lib/api-client";
import { canAddForOwner, canApprovePages, canDeletePage, canImportPages, canEditPages, canProposeEdits, canViewCreators, GRADES, groupVendors, PAGE_APPROVAL, rateOf, scrapeState } from "@/lib/creators";
import { money, personLabel, plural } from "@/lib/format";
import { canEditPlan } from "@/lib/plans";
import { FORMATS, formatLabel } from "@/lib/formats";
import { invalidatePages, useAllPages } from "@/lib/queries/creators";
import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/taggify/illustration";
import { FilterSelect } from "@/components/taggify/filter-select";
import { Money } from "@/components/taggify/money";
import { PlatformIcon } from "@/components/taggify/platform-icon";
import { SearchField } from "@/components/taggify/search-field";
import { SelectionBar } from "@/components/taggify/selection-bar";
import { StatusPill } from "@/components/taggify/status-pill";
import { UserAvatar } from "@/components/taggify/user-avatar";
import { audienceLabel, displayHandle, PageAvatar, PageAvatarStack } from "@/components/finance/identity";
import { Pager, PER_PAGE } from "@/components/finance/pager";
import { WhatsAppIcon } from "@/components/taggify/platform-icon";
import { LoadError, NoAccess } from "@/components/finance/states";
import { AddPageDialog } from "@/components/creators/add-page-dialog";
import { ImportPagesDialog } from "@/components/creators/import-pages-dialog";
import { GradeBadge, PageSheet } from "@/components/creators/page-sheet";

type Tab = "pages" | "vendors" | "waiting";
const errText = (e: unknown, fallback: string) => (e instanceof ApiError || e instanceof Error ? e.message : fallback);
const count = (n: number | null | undefined) => (n == null ? "—" : audienceLabel(n, null, true));

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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Asset | null>(null);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

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
  const pageCount = Math.max(1, Math.ceil(rowsCount / PER_PAGE));
  const current = Math.min(page, pageCount);
  const slice = <T,>(rows: T[]) => rows.slice((current - 1) * PER_PAGE, current * PER_PAGE);
  const shownPages = slice(pageRows);
  // The selection spans every pager page of the current filter (a filter or tab change clears it).
  const selectedRows = pageRows.filter((p) => selected.has(p.id));
  const visibleSelected = shownPages.filter((p) => selected.has(p.id));
  const selectFirst = (n: number) => setSelected(new Set(pageRows.slice(0, Math.max(0, n)).map((p) => p.id)));
  const createPlan = () => router.push(`/plans/new?assetIds=${selectedRows.map((p) => encodeURIComponent(p.id)).join(",")}`);

  const refreshMany = useMutation({
    mutationFn: (ids: string[]) => assetsApi.refreshProfiles(accessToken!, ids),
    onSuccess: async (r) => {
      setSelected(new Set());
      await invalidatePages(qc);
      toast.success(`Fetching ${plural(r.queued, "page")} from Instagram. Numbers update in a few minutes.`);
    },
    onError: (e) => toast.error(errText(e, "Couldn't start the refresh.")),
  });
  // Bulk delete (19 Oct, v1 parity): pages the server refuses (posts on record / approved plan) stay ticked so they can be switched to Inactive.
  const removeMany = useMutation({
    mutationFn: (ids: string[]) => assetsApi.removeMany(accessToken!, ids),
    onSuccess: async ({ deleted, skipped }) => {
      setSelected(new Set(skipped.map((s) => s.id)));
      setConfirmDelete(false);
      await invalidatePages(qc);
      await qc.invalidateQueries({ queryKey: ["plans"] });
      if (skipped.length === 0) toast.success(`${plural(deleted.length, "page")} removed from Inventory.`);
      else toast.warning(`${plural(deleted.length, "page")} removed. ${plural(skipped.length, "page")} couldn't be (usually posts on record or an approved plan). They're still selected; switch them to Inactive instead.`);
    },
    onError: async (e) => {
      setConfirmDelete(false);
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
  const filtering = !!needle || platform !== "all" || category !== "all" || grade !== "all";
  const adder = canAddForOwner(user);
  // The page panel always reads the latest copy of the page after a save.
  const openPage = open ? (all.find((p) => p.id === open.id) ?? open) : null;

  return (
    <div className="workspace-page">
      <div className="page-heading">
        <div className="page-heading-copy">
          <h1 className="text-display">Inventory</h1>
          <p className="mt-1 text-body text-muted-foreground">Vendors and the pages they own. A vendor is paid once for all their pages.</p>
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
            setSelected(new Set());
          }}
        >
          <div className="tab-shelf flex items-end gap-4">
            <TabsList className="flex-1 border-b-0">
              <TabsTrigger value="pages">Pages ({all.length})</TabsTrigger>
              <TabsTrigger value="vendors">Vendors ({vendors.length})</TabsTrigger>
              <TabsTrigger value="waiting">Waiting for approval ({waiting.length})</TabsTrigger>
            </TabsList>
          </div>
        </Tabs>
        <div className="filter-bar">
          <SearchField
            label="Search creators"
            placeholder="Search page, vendor or category..."
            className="w-full sm:w-72"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              resetPage();
            }}
          />
          <FilterSelect
            label="Platform"
            value={platform}
            onValueChange={(v) => {
              setPlatform(v);
              resetPage();
            }}
            options={[
              { value: "all", label: "All" },
              { value: "instagram", label: "Instagram" },
              { value: "youtube", label: "YouTube" },
            ]}
          />
          <FilterSelect
            label="Category"
            value={category}
            onValueChange={(v) => {
              setCategory(v);
              resetPage();
            }}
            options={[{ value: "all", label: "All" }, ...categories.map((c) => ({ value: c, label: c }))]}
          />
          <FilterSelect
            label="Grade"
            value={grade}
            onValueChange={(v) => {
              setGrade(v);
              resetPage();
            }}
            options={[{ value: "all", label: "All" }, ...GRADES.map((g) => ({ value: g, label: `Grade ${g}` })), { value: "none", label: "Not graded" }]}
          />
          <FilterSelect
            className="sm:ml-auto"
            label="Sort by"
            value={sort}
            onValueChange={setSort}
            options={[
              { value: "followers", label: "Followers" },
              { value: "newest", label: "Newest" },
              { value: "handle", label: tab === "vendors" ? "Name" : "Handle" },
            ]}
          />
        </div>

        {canSelect && tab !== "vendors" && pageRows.length > 0 && !pages.isLoading && (
          <SelectionBar
            total={pageRows.length}
            selectedCount={selectedRows.length}
            onToggleAll={() => setSelected(selectedRows.length === pageRows.length ? new Set() : new Set(pageRows.map((p) => p.id)))}
            onSelectFirst={selectFirst}
          >
            {selectedRows.length > 0 && (
              <span className="flex flex-wrap items-center gap-2 sm:ml-auto">
                {editable && (
                  <Button size="sm" variant="outline" disabled={refreshMany.isPending} onClick={() => refreshMany.mutate(selectedRows.map((p) => p.id))}>
                    <RefreshCw />
                    Refresh from Instagram
                  </Button>
                )}
                {canPlan && (
                  <Button size="sm" onClick={createPlan}>
                    <ClipboardList />
                    Create plan ({selectedRows.length})
                  </Button>
                )}
                {deletable && (
                  <Button size="sm" variant="ghost" className="text-danger-fg hover:text-danger-fg" onClick={() => setConfirmDelete(true)}>
                    <Trash2 />
                    Remove ({selectedRows.length})
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                  Clear
                </Button>
              </span>
            )}
          </SelectionBar>
        )}

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
                  <TableHead className="w-10">
                    <Checkbox
                      aria-label="Select all pages on this page"
                      checked={visibleSelected.length === 0 ? false : visibleSelected.length === shownPages.length ? true : "indeterminate"}
                      onCheckedChange={(v) =>
                        setSelected((s) => {
                          const n = new Set(s);
                          for (const p of shownPages) {
                            if (v === true) n.add(p.id);
                            else n.delete(p.id);
                          }
                          return n;
                        })
                      }
                    />
                  </TableHead>
                )}
                <TableHead>Page</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Grade</TableHead>
                <TableHead className="text-right">Followers</TableHead>
                <TableHead className="text-right">Avg views</TableHead>
                <TableHead className="text-right">Rates</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">
                  <span className="sr-only">Action</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shownPages.map((p) => {
                const st = PAGE_APPROVAL[p.approvalStatus] ?? PAGE_APPROVAL.pending;
                const scrape = scrapeState(p);
                const reel = rateOf(p, "reel");
                // Every priced format, in the app's order; the row shows Reel and how many more.
                const priced = FORMATS.filter((f) => rateOf(p, f) != null);
                const others = priced.filter((f) => f !== "reel");
                const allRates = priced.map((f) => `${formatLabel(f)}: ${money(rateOf(p, f)!)}`).join(" · ") || "No rates yet";
                return (
                  <TableRow key={p.id} data-state={selected.has(p.id) ? "selected" : undefined}>
                    {canSelect && (
                      <TableCell>
                        <Checkbox
                          aria-label={`Select ${displayHandle(p.handle, p.platform)}`}
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
                      </TableCell>
                    )}
                    <TableCell>
                      <div className="inventory-identity">
                        <button type="button" tabIndex={-1} aria-hidden onClick={() => setOpen(p)} className="shrink-0 rounded-pill">
                          <PageAvatar assetId={p.id} handle={p.handle} size="md" />
                        </button>
                        <div className="inventory-identity-text">
                          <div className="inventory-identity-line">
                            <button type="button" onClick={() => setOpen(p)} className="inline-flex min-w-0 items-center gap-2 rounded-md text-left text-body-strong text-foreground hover:text-brand-ink">
                              <PlatformIcon platform={p.platform} size={16} />
                              <span className="truncate">{displayHandle(p.handle, p.platform)}</span>
                            </button>
                            {p.groupLink && (
                              <a href={p.groupLink} target="_blank" rel="noreferrer" className="whatsapp-chip" title={`Open WhatsApp group: ${p.groupLink}`} aria-label={`WhatsApp group for ${displayHandle(p.handle, p.platform)}`}>
                                <WhatsAppIcon size={14} />
                                WhatsApp
                              </a>
                            )}
                          </div>
                          <span className="inventory-identity-name">{scrape === "fetching" ? "Fetching from Instagram…" : scrape === "failed" ? "Couldn't fetch the profile" : (p.fullName ?? (p.platform.toLowerCase() === "youtube" ? "YouTube" : "Instagram"))}</span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{personLabel(p.owner, "—")}</TableCell>
                    <TableCell>{p.category ? <Badge variant="tag">{p.category}</Badge> : <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell>{p.grade ? <GradeBadge grade={p.grade} /> : <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-right">{count(p.followers)}</TableCell>
                    <TableCell className="text-right">{count(p.engagement.avgViews)}</TableCell>
                    <TableCell className="text-right" title={allRates}>
                      <span className="inventory-rate">
                      <span className="font-semibold">{reel != null ? <>Reel <Money value={reel} /></> : priced.length ? <>{formatLabel(priced[0])} <Money value={rateOf(p, priced[0])!} /></> : <span className="font-normal text-muted-foreground">No rates</span>}</span>
                      {others.length > 0 && <span className="text-small text-fg-muted">{reel != null ? `+${others.length} more` : others.length > 1 ? `+${others.length - 1} more` : ""}</span>}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex flex-nowrap items-center gap-2">
                        <StatusPill tone={st.tone}>{st.label}</StatusPill>
                        {p.isActive === false && <StatusPill tone="neutral">Inactive</StatusPill>}
                        {p.profileBroken && (
                          <span title={p.lastScrapeError ?? "Not found on Instagram"}>
                            <StatusPill tone="danger">Not on Instagram</StatusPill>
                          </span>
                        )}
                        {p.pendingEdit && typeof p.pendingEdit === "object" && Object.keys(p.pendingEdit).length > 0 && <StatusPill tone="info">Edit suggested</StatusPill>}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      {/* Every row opens the page's full details, all rates included (1 Nov) — pending ones too. */}
                      <span className="inline-flex items-center gap-2">
                        <Button size="icon-sm" variant="ghost" aria-label={`View ${displayHandle(p.handle, p.platform)}`} title={proposer ? "View / suggest changes" : "View details"} onClick={() => setOpen(p)}>
                          <Eye />
                        </Button>
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
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        {rowsCount > 0 && <Pager total={rowsCount} page={current} pages={pageCount} noun={tab === "vendors" ? "vendors" : "pages"} onPage={setPage} />}
      </Card>

      <PageSheet page={openPage} onClose={() => setOpen(null)} />
      <AddPageDialog open={adding} onOpenChange={setAdding} />
      <ImportPagesDialog open={importing} onOpenChange={setImporting} />
      <Dialog open={confirmDelete} onOpenChange={(o) => !o && !removeMany.isPending && setConfirmDelete(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {plural(selectedRows.length, "page")}?</DialogTitle>
            <DialogDescription>They leave Inventory and any draft plans they are on. A page with posts on record or on an approved plan can&apos;t be removed; it stays selected so you can switch it to Inactive instead.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={removeMany.isPending} onClick={() => setConfirmDelete(false)}>
              Keep them
            </Button>
            <Button variant="destructive" disabled={removeMany.isPending || selectedRows.length === 0} onClick={() => removeMany.mutate(selectedRows.map((p) => p.id))}>
              {removeMany.isPending ? "Removing…" : `Remove ${plural(selectedRows.length, "page")}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
