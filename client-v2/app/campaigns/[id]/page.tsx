"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, CircleCheck, ExternalLink, Image as ImageIcon, IndianRupee, MoreHorizontal, PanelRight, Pencil, Plus, Send, Trash2, Upload, Wallet } from "lucide-react";

import { useAuth } from "@/lib/auth-context";
import { ApiError, campaigns as campaignsApi, canUse, hasAccess, links as linksApi, type CampaignAssignment, type Link as Post } from "@/lib/api-client";
import { deadlineLabel, isEnded, pageProgress, POST_STATUS, type PostFilter } from "@/lib/campaigns";
import { captionTitle, formatLabel, latestSnapshot, postThumbSrc } from "@/lib/finance";
import { plural } from "@/lib/format";
import { campaignKeys, useAssignments, useCampaign, useCampaignLinks, invalidateAfterPostChange } from "@/lib/queries/campaigns";
import { usePlans } from "@/lib/queries/plans";
import { cn } from "@/lib/utils";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FilterSelect } from "@/components/taggify/filter-select";
import { SegmentedFilter } from "@/components/taggify/segmented-filter";
import { EmptyState } from "@/components/taggify/illustration";
import { MetricTile } from "@/components/taggify/metric-tile";
import { Money } from "@/components/taggify/money";
import { ProgressBar } from "@/components/taggify/progress-meter";
import { PlatformIcon } from "@/components/taggify/platform-icon";
import { SearchField } from "@/components/taggify/search-field";
import { StatusPill } from "@/components/taggify/status-pill";
import { audienceLabel, ContentThumb, displayHandle, PageAvatar } from "@/components/finance/identity";
import { Pager, PER_PAGE } from "@/components/finance/pager";
import { LoadError, NoAccess } from "@/components/finance/states";
import { FixProofDialog } from "@/components/creator/proof-upload";
import { MarkBrokenDialog } from "@/components/campaigns/mark-broken-dialog";
import { PostSheet, type PostSheetFocus } from "@/components/campaigns/post-sheet";
import { DeletePhaseDialog, type PhaseRef } from "@/components/campaigns/delete-phase-dialog";
import { MatchPageDialog } from "@/components/campaigns/match-page-dialog";
import { CampaignInvoices } from "@/components/campaigns/campaign-invoices";
import { AddPageDialog } from "@/components/creators/add-page-dialog";
import { canViewCreators } from "@/lib/creators";
import { invalidatePages, useAllPages } from "@/lib/queries/creators";

const FILTERS: { key: PostFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "review", label: "Needs review" },
  { key: "fix", label: "Needs fixing" },
  { key: "broken", label: "Broken" },
  { key: "verified", label: "Verified" },
];

const errText = (e: unknown, fallback: string) => (e instanceof ApiError || e instanceof Error ? e.message : fallback);

export default function CampaignPage() {
  return (
    <AppShell active="campaigns">
      <ControlRoom />
    </AppShell>
  );
}

function ControlRoom() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const campaign = useCampaign(id);
  const posts = useCampaignLinks(id);
  const assignments = useAssignments(id);
  const plans = usePlans();
  const [filter, setFilter] = useState<PostFilter>("all");
  const [q, setQ] = useState("");
  const [pageFilter, setPageFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [broken, setBroken] = useState<Post | null>(null);
  const [fixing, setFixing] = useState<Post | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [deleting, setDeleting] = useState<PhaseRef | null>(null);
  const [matching, setMatching] = useState<CampaignAssignment | null>(null);
  const [addingFor, setAddingFor] = useState<CampaignAssignment | null>(null);
  const [opened, setOpened] = useState<{ post: Post; focus: PostSheetFocus } | null>(null);
  const qc = useQueryClient();
  const { accessToken } = useAuth();

  // Creators/team members see their own side (earnings, their posts); staff and planners see spend and bookings.
  const staff = user?.role !== "CREATOR" && user?.role !== "TEAM_MEMBER";
  const canEdit = hasAccess(user, "campaigns.edit");
  const canAddPhase = canEdit || user?.role === "PLAN_MAKER";
  const canMarkBroken = hasAccess(user, "links.edit");
  // Pointing a sheet row at a page: PUT /campaigns/:id/assignments/:assignmentId needs campaigns.edit.
  // Picking the page also needs the page list (GET /assets returns only your own pages without inventory.view).
  const canMatch = hasAccess(user, "campaigns.edit") && canViewCreators(user);
  // A match can book the page and auto-attach a post the sheet already named.
  const afterMatch = () => Promise.all([qc.invalidateQueries({ queryKey: campaignKeys.assignments(id) }), invalidateAfterPostChange(qc), invalidatePages(qc)]);
  const canReviseCost = staff && hasAccess(user, "links.edit");
  // The poster re-uploads a rejected (or missing) proof; the server only lets the owner do this.
  const canFixProof = !staff && canUse(user, "links.edit");

  const items = useMemo(() => posts.data?.items ?? [], [posts.data]);
  const progress = useMemo(() => (campaign.data ? pageProgress(campaign.data, assignments.data ?? [], items) : []), [campaign.data, assignments.data, items]);
  // An unmatched sheet row whose handle is already a page in Inventory shows that page's photo (same list the Match dialog loads).
  const allPages = useAllPages();
  const pageIdByHandle = useMemo(() => new Map((allPages.data ?? []).map((p) => [displayHandle(p.handle).toLowerCase(), p.id])), [allPages.data]);

  const addPhase = useMutation({
    mutationFn: () => campaignsApi.createPhase(accessToken!, id),
    onSuccess: async (p) => {
      await qc.invalidateQueries({ queryKey: ["campaigns"] });
      toast.success(`Phase ${p.phaseNumber} added.`);
    },
    onError: (e) => toast.error(errText(e, "Couldn't add a phase.")),
  });

  if (!canUse(user, "campaigns.view")) return <NoAccess what="campaigns" />;
  if (campaign.isLoading) return <Skeleton className="mt-6 h-96 w-full rounded-card" />;
  if (campaign.isError || !campaign.data) return <LoadError onRetry={() => campaign.refetch()} what="this campaign" />;

  const c = campaign.data;
  const plan = (plans.data ?? []).find((p) => p.campaignId === c.id || (c.parentCampaignId && p.campaignId === c.parentCampaignId));
  const cap = c.costCap ? Number(c.costCap) : null;
  const spent = c.spent ?? 0;
  const booked = progress.reduce((s, p) => s + p.booked, 0);
  const live = items.filter((l) => l.status !== "INVALID").length;
  // Posts that fill a booking (a page's extra posts don't cover another page's gap).
  const filled = progress.reduce((s, p) => s + Math.min(p.posted, p.booked), 0);
  const verified = items.filter((l) => l.status === "INSIGHTS_APPROVED" || l.status === "INVOICED").length;
  const inReview = items.filter((l) => POST_STATUS[l.status].filter === "review").length;
  const brokenCount = items.filter((l) => l.status === "INVALID").length;
  const missing = progress.reduce((s, p) => s + Math.max(0, p.booked - p.posted), 0);
  const pendingRows = (assignments.data ?? []).filter((a) => !a.assetId);
  // Phase 1 is the campaign itself; only later phases can be deleted. The one you're on is listed first.
  const laterPhases = (c.phases ?? []).filter((p) => p.phaseNumber > 1).sort((a, b) => Number(b.id === c.id) - Number(a.id === c.id) || a.phaseNumber - b.phaseNumber);

  const count = (f: PostFilter) => (f === "all" ? items.length : items.filter((l) => POST_STATUS[l.status].filter === f).length);
  const needle = q.trim().toLowerCase();
  const visible = items
    .filter((l) => filter === "all" || POST_STATUS[l.status].filter === filter)
    .filter((l) => pageFilter === "all" || l.assetId === pageFilter)
    .filter((l) => !needle || `${latestSnapshot(l)?.caption ?? ""} ${l.asset?.handle ?? ""} ${l.format}`.toLowerCase().includes(needle));
  const pageCount = Math.max(1, Math.ceil(visible.length / PER_PAGE));
  const current = Math.min(page, pageCount);
  const shown = visible.slice((current - 1) * PER_PAGE, current * PER_PAGE);
  const pagesSeen = new Map(items.map((l) => [l.assetId, l.asset?.handle ?? "page"]));

  return (
    <div className="workspace-page">
      <Link href="/campaigns" className="inline-flex items-center gap-2 self-start text-body-strong text-foreground hover:text-brand-ink">
        <ArrowLeft className="h-[18px] w-[18px]" aria-hidden />
        Back to Campaigns
      </Link>

      <div className="page-heading detail-heading">
        <div className="page-heading-copy">
          <p className="page-eyebrow">{c.brandName}</p>
          <h1 className="text-display">{c.title}</h1>
          <p className="mt-1 text-body text-muted-foreground">
            {deadlineLabel(c)}
            {plan && (
              <>
                {" "}
                · from{" "}
                <Link href={`/plans/${plan.id}`} className="font-semibold text-foreground underline underline-offset-4">
                  {plan.variantLabel} of {plan.name}
                </Link>
              </>
            )}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          {canFixProof && (
            <Button asChild>
              <Link href={`/submit?campaign=${c.id}`}>
                <Upload />
                Upload links
              </Link>
            </Button>
          )}
          {c.sheetLink && (
            <Button asChild variant="outline">
              <a href={c.sheetLink} target="_blank" rel="noreferrer">
                <ExternalLink />
                Campaign sheet
              </a>
            </Button>
          )}
          {canEdit && (
            <Button variant="outline" onClick={() => setEditOpen(true)}>
              <Pencil />
              Edit details
            </Button>
          )}
          {canAddPhase && (
            <Button variant="outline" disabled={addPhase.isPending} onClick={() => addPhase.mutate()}>
              <Plus />
              Add phase
            </Button>
          )}
          {canEdit && laterPhases.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label="More campaign actions">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {laterPhases.map((p) => (
                  <DropdownMenuItem key={p.id} className="text-danger focus:text-danger" onSelect={() => setDeleting({ id: p.id, phaseNumber: p.phaseNumber })}>
                    <Trash2 className="h-4 w-4" aria-hidden />
                    {p.id === c.id ? `Delete this phase (${p.phaseNumber})…` : `Delete phase ${p.phaseNumber}…`}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {(c.phases?.length ?? 0) > 1 && (
        <nav aria-label="Phases" className="flex flex-wrap gap-2">
          {c.phases!.map((p) => (
            <Button key={p.id} asChild size="sm" variant={p.id === c.id ? "default" : "outline"}>
              <Link href={`/campaigns/${p.id}`} aria-current={p.id === c.id ? "page" : undefined}>
                Phase {p.phaseNumber}
              </Link>
            </Button>
          ))}
        </nav>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <MetricTile tone="coral" icon={Send} label="Posts live" loading={posts.isLoading} value={staff && booked ? `${filled} / ${booked}` : String(live)} meta={staff ? (missing ? `${plural(missing, "post")} still to go${isEnded(c) ? " · deadline passed" : ""}` : booked ? "Every booked post is up" : "Bookings appear once pages are matched") : "Your posts on this campaign"} />
        {staff ? (
          <MetricTile tone="amber" icon={Wallet} label="Spend" value={<Money value={spent} />} meta={cap ? <>of <Money value={cap} /> budget · <Money value={cap - spent} /> left</> : "No budget set"} />
        ) : (
          <MetricTile tone="amber" icon={Wallet} label="Your earnings" value={<Money value={c.yourEarnings ?? 0} />} meta="Verified posts get paid" />
        )}
        <MetricTile tone="mint" icon={CircleCheck} label="Verified" loading={posts.isLoading} value={plural(verified, "post")} meta={`${inReview} in review · ${plural(brokenCount, "broken link")}`} />
      </div>

      <Tabs defaultValue="posts">
        <TabsList className="detail-tabs">
          <TabsTrigger value="posts">Posts ({items.length})</TabsTrigger>
          {staff && assignments.data && (
            <TabsTrigger value="pages">
              Pages ({progress.length}){pendingRows.length > 0 && <span className="ml-1 text-warning-fg">· {pendingRows.length} to match</span>}
            </TabsTrigger>
          )}
          {canUse(user, "finance.view") && <TabsTrigger value="invoices">Invoices</TabsTrigger>}
          {plan?.notes && <TabsTrigger value="brief">Brief</TabsTrigger>}
        </TabsList>

        <TabsContent value="posts" className="flex flex-col gap-4">
          <div className="detail-filters">
            <SegmentedFilter
              label="Show posts"
              value={filter}
              onChange={(v) => {
                setFilter(v);
                setPage(1);
              }}
              options={FILTERS.map((f) => ({ value: f.key, label: f.label, count: count(f.key) }))}
            />
            <SearchField label="Search posts" placeholder="Search caption or page..." className="w-full sm:w-56" value={q} onChange={(e) => setQ(e.target.value)} />
            <FilterSelect label="Page" value={pageFilter} onValueChange={setPageFilter} options={[{ value: "all", label: "All" }, ...[...pagesSeen].map(([value, h]) => ({ value, label: displayHandle(h), leading: <PageAvatar assetId={value} handle={h} size="xs" /> }))]} />
          </div>
          <Card className="ledger-panel">
            {posts.isError ? (
              <LoadError onRetry={() => posts.refetch()} what="this campaign's posts" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Content</TableHead>
                    <TableHead>Page</TableHead>
                    <TableHead>Posted</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">{staff ? "Cost" : "You earn"}</TableHead>
                    <TableHead className="text-right">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {posts.isLoading
                    ? Array.from({ length: 4 }, (_, i) => (
                        <TableRow key={i}>
                          <TableCell colSpan={6}>
                            <Skeleton className="h-9 w-full" />
                          </TableCell>
                        </TableRow>
                      ))
                    : shown.map((l) => {
                        const snap = latestSnapshot(l);
                        const st = POST_STATUS[l.status];
                        const title = captionTitle(snap?.caption) ?? formatLabel(l.format);
                        return (
                          <TableRow key={l.id}>
                            <TableCell>
                              <span className="flex items-center gap-3">
                                <ContentThumb src={postThumbSrc(l)} format={l.format} />
                                <span className="min-w-0">
                                  <button type="button" onClick={() => setOpened({ post: l, focus: "details" })} className="block max-w-56 truncate rounded-sm text-left font-medium text-foreground hover:text-brand-ink hover:underline focus-visible:outline-none focus-visible:shadow-focus">
                                    {title}
                                  </button>
                                  <span className="block text-small text-fg-muted">
                                    {formatLabel(l.format)}
                                    {l.overQuota ? " · over booking" : ""}
                                  </span>
                                </span>
                              </span>
                            </TableCell>
                            <TableCell>
                              <span className="flex items-center gap-2">
                                <PageAvatar assetId={l.assetId} handle={l.asset?.handle ?? "page"} size="sm" />
                                <span className="min-w-0">
                                  <span className="flex items-center gap-1 font-medium">
                                    <PlatformIcon platform={l.asset?.platform ?? "instagram"} size={16} />
                                    {displayHandle(l.asset?.handle ?? "—", l.asset?.platform)}
                                  </span>
                                  <span className="block text-small text-fg-muted">{audienceLabel(l.asset?.followers, l.asset?.platform)}</span>
                                </span>
                              </span>
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-muted-foreground">{l.postedAt ? new Date(l.postedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : "Not yet"}</TableCell>
                            <TableCell>
                              <StatusPill tone={st.tone}>{st.label}</StatusPill>
                            </TableCell>
                            <TableCell className="text-right font-semibold">
                              <Money value={l.cost} />
                            </TableCell>
                            <TableCell className="text-right">
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" aria-label={`Actions for ${title}`}>
                                    <MoreHorizontal />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onSelect={() => setOpened({ post: l, focus: "details" })}>
                                    <PanelRight className="h-4 w-4" aria-hidden />
                                    Details
                                  </DropdownMenuItem>
                                  {canReviseCost && l.status !== "INVALID" && l.status !== "INVOICED" && !l.invoiceItem && !l.payoutItem && (
                                    <DropdownMenuItem onSelect={() => setOpened({ post: l, focus: "cost" })}>
                                      <IndianRupee className="h-4 w-4" aria-hidden />
                                      Revise cost…
                                    </DropdownMenuItem>
                                  )}
                                  <DropdownMenuItem asChild>
                                    <a href={l.url} target="_blank" rel="noreferrer">
                                      <ExternalLink className="h-4 w-4" aria-hidden />
                                      Open post
                                    </a>
                                  </DropdownMenuItem>
                                  {l.screenshot?.url && (
                                    <DropdownMenuItem asChild>
                                      <a href={l.screenshot.url} target="_blank" rel="noreferrer">
                                        <ImageIcon className="h-4 w-4" aria-hidden />
                                        View proof
                                      </a>
                                    </DropdownMenuItem>
                                  )}
                                  {canFixProof && (l.status === "SCREENSHOT_REJECTED" || (l.status === "SUBMITTED" && !l.screenshot)) && (
                                    <DropdownMenuItem onSelect={() => setFixing(l)}>{l.status === "SCREENSHOT_REJECTED" ? "Upload new proof…" : "Add proof…"}</DropdownMenuItem>
                                  )}
                                  {canMarkBroken && l.status !== "INVALID" && l.status !== "INVOICED" && <DropdownMenuItem onSelect={() => setBroken(l)}>Mark as broken…</DropdownMenuItem>}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                  {!posts.isLoading && shown.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6}>
                        {items.length === 0 ? (
                          <EmptyState name="empty-content" title="No posts yet">
                            Posts appear here as pages submit them or the execution sheet is read.
                          </EmptyState>
                        ) : (
                          <EmptyState name="empty-search" title="No posts match">
                            Try another filter or page.
                          </EmptyState>
                        )}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
            <Pager total={visible.length} page={current} pages={pageCount} noun="posts" onPage={setPage} />
          </Card>
        </TabsContent>

        {staff && assignments.data && (
          <TabsContent value="pages" className="flex flex-col gap-4">
            {pendingRows.length > 0 && (
              <Card className="ledger-panel">
                <div className="border-b px-5 py-4">
                  <h2 className="text-card-title">Waiting for a page ({pendingRows.length})</h2>
                  <p className="text-small text-muted-foreground">
                    {canMatch ? "These rows from the campaign sheet don't match a page in Inventory. Match each one to a page, or add it as a new page." : "These rows from the campaign sheet don't match a page in Inventory yet. Someone with campaign edit and Inventory access can match them."}
                  </p>
                </div>
                <ul className="divide-y">
                  {pendingRows.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                      <PageAvatar assetId={pageIdByHandle.get(displayHandle(r.pageHandle).toLowerCase())} handle={r.pageHandle} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-body-strong">{displayHandle(r.pageHandle)}</span>
                        <span className="block truncate text-small text-fg-muted">
                          {[r.creatorPhone, r.format ? formatLabel(r.format) : null, r.postUrl ? "Post link in sheet" : null].filter(Boolean).join(" · ") || "From the campaign sheet"}
                        </span>
                      </span>
                      {canMatch && (
                        <Button size="sm" variant="outline" onClick={() => setMatching(r)}>
                          Match
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              </Card>
            )}
            <Card className="ledger-panel">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Page</TableHead>
                    <TableHead>Progress</TableHead>
                    <TableHead className="text-right">Booked</TableHead>
                    <TableHead className="text-right">Posted</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {progress.map((p) => {
                    const gap = Math.max(0, p.booked - p.posted);
                    return (
                      <TableRow key={p.assetId}>
                        <TableCell>
                          <span className="flex items-center gap-3">
                            <PageAvatar assetId={p.assetId} handle={p.handle} size="sm" />
                            <span>
                              <span className="block text-body-strong">{displayHandle(p.handle)}</span>
                              <span className="block text-small text-fg-muted">{p.category ?? "—"}</span>
                            </span>
                          </span>
                        </TableCell>
                        <TableCell className="min-w-48">
                          <ProgressBar value={p.booked ? p.posted : 1} max={p.booked || 1} tone={gap === 0 ? "success" : "brand"} label={`${displayHandle(p.handle)} posted against booked`} />
                        </TableCell>
                        <TableCell className="num text-right">{p.booked}</TableCell>
                        <TableCell className="num text-right">{p.posted}</TableCell>
                        <TableCell>
                          {p.broken > 0 ? (
                            <StatusPill tone="danger">{plural(p.broken, "broken link")}</StatusPill>
                          ) : gap === 0 ? (
                            <StatusPill tone="success">Complete</StatusPill>
                          ) : (
                            <StatusPill tone={p.late ? "danger" : "warning"}>
                              {p.late ? "Late · " : ""}
                              {gap} missing
                            </StatusPill>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {progress.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5}>
                        <EmptyState name="empty-campaigns" title="No pages booked yet">
                          Pages appear here once the campaign&apos;s plan or sheet is matched to Inventory.
                        </EmptyState>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </Card>

          </TabsContent>
        )}

        {canUse(user, "finance.view") && (
          <TabsContent value="invoices">
            <CampaignInvoices campaignId={c.id} />
          </TabsContent>
        )}

        {plan?.notes && (
          <TabsContent value="brief">
            <Card className="form-panel max-w-3xl p-6">
              <h2 className="mb-2 text-card-title">Brief</h2>
              <p className="whitespace-pre-line text-body">{plan.notes}</p>
              <p className="mt-4 text-small text-muted-foreground">
                From {plan.variantLabel} of {plan.name}, by {plan.createdBy?.name ?? "the planner"}.
              </p>
            </Card>
          </TabsContent>
        )}
      </Tabs>

      {/* Fresh copy from the list; if a refetch drops the post (other tab or page), keep the last copy instead of closing. */}
      <PostSheet post={opened ? (items.find((l) => l.id === opened.post.id) ?? opened.post) : null} focus={opened?.focus} onClose={() => setOpened(null)} />
      <FixProofDialog post={fixing} onClose={() => setFixing(null)} />
      <MarkBrokenDialog post={broken} onClose={() => setBroken(null)} onDone={() => invalidateAfterPostChange(qc)} />
      {canMatch && (
        <>
          <MatchPageDialog
            campaignId={c.id}
            row={matching}
            onClose={() => setMatching(null)}
            onMatched={afterMatch}
            onAddNew={(r) => {
              setMatching(null);
              setAddingFor(r);
            }}
          />
          <AddPageDialog
            open={!!addingFor}
            onOpenChange={(o) => !o && setAddingFor(null)}
            prefill={
              addingFor
                ? {
                    handle: displayHandle(addingFor.pageHandle),
                    note: addingFor.creatorPhone ? `The sheet lists ${addingFor.creatorPhone} for it.` : undefined,
                    ownerSearch: addingFor.creatorPhone ?? undefined,
                    onCreated: async (page) => {
                      await campaignsApi.resolveAssignment(accessToken!, c.id, addingFor.id, page.id);
                      await afterMatch();
                      toast.success(`${displayHandle(page.handle)} added and matched.`);
                    },
                  }
                : undefined
            }
          />
        </>
      )}
      {canEdit && <DeletePhaseDialog phase={deleting} viewingId={c.id} onClose={() => setDeleting(null)} />}
      {canEdit && <EditCampaignDialog open={editOpen} onOpenChange={setEditOpen} campaign={c} />}
    </div>
  );
}

function EditCampaignDialog({ open, onOpenChange, campaign: c }: { open: boolean; onOpenChange: (o: boolean) => void; campaign: { id: string; title: string; brandName: string; deadline: string | null; costCap?: string | null; parentCampaignId?: string | null } }) {
  // The budget lives on phase 1; a later phase only edits its own name/brand/deadline.
  const isPhase = !!c.parentCampaignId;
  const { accessToken } = useAuth();
  const qc = useQueryClient();
  const [form, setForm] = useState({ title: c.title, brandName: c.brandName, deadline: c.deadline ? c.deadline.slice(0, 10) : "", costCap: c.costCap ? String(Number(c.costCap)) : "" });
  const save = useMutation({
    mutationFn: () =>
      campaignsApi.update(accessToken!, c.id, {
        title: form.title.trim(),
        brandName: form.brandName.trim(),
        deadline: form.deadline ? new Date(`${form.deadline}T12:00:00`).toISOString() : null,
        ...(isPhase ? {} : { costCap: form.costCap ? Number(form.costCap) : null }),
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["campaigns"] });
      toast.success("Campaign updated.");
      onOpenChange(false);
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit campaign details</DialogTitle>
          <DialogDescription>Changes show for everyone on this campaign straight away.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          {(
            [
              ["title", "Campaign name", "text"],
              ["brandName", "Brand", "text"],
              ["deadline", "Deadline", "date"],
              ["costCap", "Budget (₹)", "number"],
            ] as const
          )
            .filter(([key]) => !(isPhase && key === "costCap"))
            .map(([key, label, type]) => (
            <div key={key} className="flex flex-col gap-2">
              <Label htmlFor={`ec-${key}`}>{label}</Label>
              <Input id={`ec-${key}`} type={type} value={form[key]} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} />
            </div>
          ))}
        </div>
        {save.isError && (
          <p className="text-small text-danger-helper" role="alert">
            {errText(save.error, "Couldn't save. Check the details and try again.")}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!form.title.trim() || !form.brandName.trim() || save.isPending} onClick={() => save.mutate()}>
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
