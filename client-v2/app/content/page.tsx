"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, ClipboardCheck, ExternalLink, Image as ImageIcon, IndianRupee, MoreHorizontal, PanelRight, Send, Upload } from "lucide-react";

import { useAuth } from "@/lib/auth-context";
import { canUse, hasAccess, links as linksApi, type Link as Post } from "@/lib/api-client";
import { captionTitle, formatLabel, latestSnapshot, monthKeyOf, monthLabel, monthRange, recentMonths } from "@/lib/finance";
import { personLabel, plural } from "@/lib/format";
import { useCampaign, useCampaigns, invalidateAfterPostChange } from "@/lib/queries/campaigns";
import { useAllPages } from "@/lib/queries/creators";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/taggify/illustration";
import { FilterSelect } from "@/components/taggify/filter-select";
import { MetricTile } from "@/components/taggify/metric-tile";
import { Money } from "@/components/taggify/money";
import { PlatformIcon } from "@/components/taggify/platform-icon";
import { audienceLabel, ContentThumb, displayHandle, PageAvatar } from "@/components/finance/identity";
import { Pager, PER_PAGE } from "@/components/finance/pager";
import { LoadError, NoAccess } from "@/components/finance/states";
import { MarkBrokenDialog } from "@/components/campaigns/mark-broken-dialog";
import { PostStatusMenu } from "@/components/campaigns/post-status-menu";
import { PostSheet, type PostSheetFocus } from "@/components/campaigns/post-sheet";
import { ImportPostsDialog } from "@/components/campaigns/import-posts-dialog";

/**
 * Tabs are server-side status groups (GET /links takes a comma list), so each
 * count is the server's own `total` and paging never hides posts. "Ready to bill"
 * is the server's billable rule (invoices INVOICEABLE_STATUSES, not on an
 * invoice or payout, not over booking) — the same posts Payouts counts as owed
 * when no month is picked (Payouts dates by postedAt, this list by submission).
 * Tabs are views, not stages, so a post can sit in more than one.
 */
const TABS = {
  all: { label: "All", status: undefined, unbilled: false },
  review: { label: "Waiting for review", status: "PENDING_SCREENSHOT_REVIEW,INSIGHTS_PENDING", unbilled: false },
  fix: { label: "Need fixing", status: "SUBMITTED,SCREENSHOT_REJECTED,INVALID", unbilled: false },
  bill: { label: "Ready to bill", status: "SUBMITTED,PENDING_SCREENSHOT_REVIEW,SCREENSHOT_APPROVED,INSIGHTS_PENDING,INSIGHTS_APPROVED", unbilled: true },
  invoiced: { label: "Invoiced", status: "INVOICED", unbilled: false },
} as const;
type Tab = keyof typeof TABS;
const NOT_BROKEN = "SUBMITTED,PENDING_SCREENSHOT_REVIEW,SCREENSHOT_REJECTED,SCREENSHOT_APPROVED,INSIGHTS_PENDING,INSIGHTS_APPROVED,INVOICED";

export default function ContentPage() {
  return (
    <AppShell active="content">
      <Content />
    </AppShell>
  );
}

function Content() {
  const { user, accessToken } = useAuth();
  const qc = useQueryClient();
  const allowed = !!user && user.role !== "CREATOR" && user.role !== "TEAM_MEMBER" && canUse(user, "links.view");
  const campaigns = useCampaigns();
  const pages = useAllPages();
  const [tab, setTab] = useState<Tab>("all");
  const [campaignId, setCampaignId] = useState("all");
  // GET /links?campaignId= covers one phase (plus its extra posts), so a phased campaign needs a phase pick.
  const [phaseId, setPhaseId] = useState<string | null>(null);
  const rootCampaign = (campaigns.data ?? []).find((c) => c.id === campaignId);
  const phased = (rootCampaign?.phaseCount ?? 1) > 1;
  const detail = useCampaign(phased ? campaignId : "");
  const phases = detail.data?.phases ?? [];
  const [assetId, setAssetId] = useState("all");
  const [month, setMonth] = useState("all");
  const [page, setPage] = useState(1);
  const [broken, setBroken] = useState<Post | null>(null);
  const [importing, setImporting] = useState(false);
  const [opened, setOpened] = useState<{ post: Post; focus: PostSheetFocus } | null>(null);

  const filters = useMemo(
    () => ({
      ...(campaignId !== "all" ? { campaignId: phaseId ?? campaignId } : {}),
      ...(assetId !== "all" ? { assetId } : {}),
      ...(month !== "all" ? monthRange(month as ReturnType<typeof monthKeyOf>) : {}),
    }),
    [campaignId, phaseId, assetId, month]
  );
  const token = allowed ? accessToken : null;
  const list = useQuery({
    queryKey: ["links", "content", tab, filters, page],
    queryFn: () => linksApi.list(token!, { ...filters, status: TABS[tab].status, unbilled: TABS[tab].unbilled, page, pageSize: PER_PAGE }),
    enabled: !!token,
    placeholderData: keepPreviousData,
  });
  // One cheap count per tab (pageSize 1 → the server's total), with the same filters.
  const counts = useQuery({
    placeholderData: keepPreviousData,
    queryKey: ["links", "content", "counts", filters],
    queryFn: async () => {
      const entries = await Promise.all((Object.keys(TABS) as Tab[]).map(async (k) => [k, (await linksApi.list(token!, { ...filters, status: TABS[k].status, unbilled: TABS[k].unbilled, pageSize: 1 })).total] as const));
      return Object.fromEntries(entries) as Record<Tab, number>;
    },
    enabled: !!token,
  });
  const thisMonth = monthKeyOf(new Date());
  const live = useQuery({
    queryKey: ["links", "content", "month", thisMonth],
    queryFn: () => linksApi.list(token!, { ...monthRange(thisMonth), status: NOT_BROKEN, pageSize: 1 }),
    enabled: !!token,
  });

  // A list that shrank under the current page (e.g. its last post marked broken) falls back to its last page.
  const lastPage = Math.max(1, Math.ceil((list.data?.total ?? 0) / PER_PAGE));
  useEffect(() => {
    if (list.data && page > lastPage) setPage(lastPage);
  }, [list.data, page, lastPage]);

  if (!allowed) return <NoAccess what="Content" />;
  const canReview = hasAccess(user, "links.approve");
  const canEditPosts = hasAccess(user, "links.edit");
  const toCampaign = canUse(user, "campaigns.view");
  const total = list.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PER_PAGE));
  const rows = list.data?.items ?? [];
  const reset = () => setPage(1);

  return (
    <div className="flex flex-col gap-5 pt-2">
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0">
          <h1 className="text-display">Content</h1>
          <p className="mt-1 text-body text-muted-foreground">Every post submitted for a campaign, from posted to paid.</p>
        </div>
        {/* POST /links/bulk-import needs links.edit. */}
        {canEditPosts && (
          <Button variant="outline" className="ml-auto" onClick={() => setImporting(true)}>
            <Upload />
            Import posts
          </Button>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <MetricTile tone="amber" icon={ClipboardCheck} label="Waiting for review" loading={counts.isLoading} value={plural(counts.data?.review ?? 0, "post")} meta={canReview ? "Proofs and insights to check" : "Being checked by the team"} />
        <MetricTile tone="coral" icon={CircleAlert} label="Need fixing" loading={counts.isLoading} value={plural(counts.data?.fix ?? 0, "post")} meta="No proof, rejected proof or broken link" />
        <MetricTile tone="mint" icon={Send} label={`Submitted in ${monthLabel(thisMonth)}`} loading={live.isLoading} value={plural(live.data?.total ?? 0, "post")} meta="Not counting broken links" />
      </div>

      <Card className="overflow-hidden">
        <Tabs
          value={tab}
          onValueChange={(v) => {
            setTab(v as Tab);
            reset();
          }}
        >
          <div className="flex items-end gap-4 overflow-x-auto px-5 pt-2">
            <TabsList className="flex-1 border-b-0">
              {(Object.keys(TABS) as Tab[]).map((k) => (
                <TabsTrigger key={k} value={k}>
                  {TABS[k].label}
                  {counts.data ? ` (${counts.data[k]})` : ""}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
        </Tabs>
        <div className="flex flex-wrap items-center gap-2 border-t px-5 py-4">
          {toCampaign && (
            <FilterSelect
              label="Campaign"
              value={campaignId}
              onValueChange={(v) => {
                setCampaignId(v);
                setPhaseId(null);
                reset();
              }}
              options={[{ value: "all", label: "All" }, ...(campaigns.data ?? []).map((c) => ({ value: c.id, label: (c.phaseCount ?? 1) > 1 ? `${c.title} (${c.phaseCount} phases)` : c.title }))]}
            />
          )}
          {phased && phases.length > 1 && (
            <FilterSelect
              label="Phase"
              value={phaseId ?? campaignId}
              onValueChange={(v) => {
                setPhaseId(v === campaignId ? null : v);
                reset();
              }}
              options={phases.map((ph) => ({ value: ph.id, label: `Phase ${ph.phaseNumber}` }))}
            />
          )}
          {pages.data && (
            <FilterSelect
              label="Page"
              value={assetId}
              onValueChange={(v) => {
                setAssetId(v);
                reset();
              }}
              options={[{ value: "all", label: "All" }, ...[...pages.data].sort((a, b) => a.handle.localeCompare(b.handle)).map((p) => ({ value: p.id, label: displayHandle(p.handle, p.platform), leading: <PageAvatar assetId={p.id} handle={p.handle} size="xs" /> }))]}
            />
          )}
          <FilterSelect
            label="Submitted"
            value={month}
            onValueChange={(v) => {
              setMonth(v);
              reset();
            }}
            options={[{ value: "all", label: "Any time" }, ...recentMonths(12).map((m) => ({ value: m, label: monthLabel(m, "long") }))]}
          />
          {(campaignId !== "all" || assetId !== "all" || month !== "all") && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setCampaignId("all");
                setPhaseId(null);
                setAssetId("all");
                setMonth("all");
                reset();
              }}
            >
              Clear filters
            </Button>
          )}
        </div>

        {list.isError ? (
          <LoadError onRetry={() => list.refetch()} what="posts" />
        ) : list.isLoading ? (
          <div className="flex flex-col gap-2 border-t p-5">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="border-t">
            <EmptyState name="empty-content" title={tab === "all" ? "No posts yet" : `Nothing in ${TABS[tab].label}`}>
              {campaignId !== "all" || assetId !== "all" || month !== "all" ? "Try clearing the filters." : "Posts show up here once creators submit them."}
            </EmptyState>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Content</TableHead>
                <TableHead>Campaign</TableHead>
                <TableHead>Page</TableHead>
                <TableHead>Submitted</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody aria-busy={list.isFetching}>
              {rows.map((l) => {
                const snap = latestSnapshot(l);
                const title = captionTitle(snap?.caption) ?? formatLabel(l.format);
                const billed = l.invoiceItem?.invoice?.invoiceNumber;
                return (
                  <TableRow key={l.id}>
                    <TableCell>
                      <span className="flex items-center gap-3">
                        <ContentThumb src={snap?.thumbnailUrl} format={l.format} />
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
                      {toCampaign && l.campaign ? (
                        <Link href={`/campaigns/${l.campaignId}`} className="flex flex-col text-foreground hover:text-brand-ink">
                          <span className="max-w-48 truncate font-medium">{l.campaign.title}</span>
                          <span className="text-small text-fg-muted">{l.campaign.brandName}</span>
                        </Link>
                      ) : (
                        <span className="flex flex-col">
                          <span className="max-w-48 truncate font-medium">{l.campaign?.title ?? "—"}</span>
                          <span className="text-small text-fg-muted">{l.campaign?.brandName}</span>
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="flex items-center gap-2">
                        <PageAvatar assetId={l.assetId} handle={l.asset?.handle ?? "page"} size="sm" />
                        <span className="min-w-0">
                          <span className="flex items-center gap-1 font-medium">
                            <PlatformIcon platform={l.asset?.platform ?? "instagram"} size={16} />
                            {displayHandle(l.asset?.handle ?? "—", l.asset?.platform)}
                          </span>
                          <span className="block text-small text-fg-muted">{personLabel(l.asset?.owner, audienceLabel(l.asset?.followers, l.asset?.platform) ?? "")}</span>
                        </span>
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{new Date(l.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</TableCell>
                    <TableCell>
                      <span className="flex flex-col items-start gap-1">
                        <PostStatusMenu post={l} onMarkBroken={setBroken} />
                        {billed && <span className="text-small text-fg-muted">{billed}</span>}
                        {!billed && l.payoutItem && <span className="text-small text-fg-muted">On a payout</span>}
                      </span>
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
                          {canEditPosts && l.status !== "INVALID" && l.status !== "INVOICED" && !l.invoiceItem && !l.payoutItem && (
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
                          {canReview && (l.status === "PENDING_SCREENSHOT_REVIEW" || l.status === "INSIGHTS_PENDING") && (
                            <DropdownMenuItem asChild>
                              <Link href={`/approvals?type=${l.status === "PENDING_SCREENSHOT_REVIEW" ? "proof" : "insights"}`}>Review in Approvals</Link>
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        {total > 0 && <Pager total={total} page={Math.min(page, pageCount)} pages={pageCount} noun="posts" onPage={setPage} />}
      </Card>

      {/* Fresh copy from the list; if a refetch drops the post (other tab or page), keep the last copy instead of closing. */}
      <PostSheet post={opened ? (rows.find((l) => l.id === opened.post.id) ?? opened.post) : null} focus={opened?.focus} onClose={() => setOpened(null)} />
      <ImportPostsDialog open={importing} onOpenChange={setImporting} />
      <MarkBrokenDialog post={broken} onClose={() => setBroken(null)} onDone={() => invalidateAfterPostChange(qc)} />
    </div>
  );
}
