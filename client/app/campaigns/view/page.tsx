"use client";

import { OwnSectionGate } from "@/components/auth/own-section-gate";
import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { RequireAuth } from "@/components/auth/require-auth";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { Field, TextField, MoneyField } from "@/components/ui/form-field";
import { PageHeader } from "@/components/ui/page-header";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { Chip, Chips } from "@/components/ui/chips";
import { Tag } from "@/components/ui/tag";
import { Note } from "@/components/ui/note";
import { Card, CardHeader, Table, THead, TH, TR, TD, Cell2, Thumb } from "@/components/ui/data-table";
import { StatusSteps, statusHint } from "@/components/ui/status-steps";
import { TableSkeleton, EmptyState, ErrorNotice } from "@/components/ui/table-parts";
import { StatusPill } from "@/components/ui/status-pill";
import { LinkDetailPanel, STATUS_LABEL } from "@/components/dashboard/link-detail-panel";
import { ResolvePendingAssignmentsModal } from "@/components/campaigns/resolve-pending-assignments-modal";
import { CampaignInvoicesPanel } from "@/components/campaigns/campaign-invoices-panel";
import { ChevronRightIcon, HeartIcon, AlertIcon, PlusIcon, EditIcon, CloseIcon } from "@/components/icons";
import { useAuth } from "@/lib/auth-context";
import { campaigns as campaignsApi, links as linksApi, invoices as invoicesApi, ApiError, hasAccess, type Campaign, type Link as LinkRow, canUse } from "@/lib/api-client";
import { initialsOf, roleLabel, money, count, compactNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { formatLabel } from "@/lib/formats";

export default function CampaignDetailPage() {
  return (
    <RequireAuth>
      <OwnSectionGate ownKey="campaigns.view" active="campaigns">
      <Suspense fallback={null}>
        <CampaignDetailContent />
      </Suspense>
      </OwnSectionGate>
    </RequireAuth>
  );
}

const WAITING_ON_US: LinkRow["status"][] = ["PENDING_SCREENSHOT_REVIEW", "INSIGHTS_PENDING"];
const WAITING_ON_CREATOR: LinkRow["status"][] = ["SUBMITTED", "SCREENSHOT_REJECTED"];
const READY: LinkRow["status"][] = ["SCREENSHOT_APPROVED", "INSIGHTS_APPROVED"];
type PostFilter = "all" | "us" | "creator" | "ready" | "invoiced";

const shortDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "—");
const DAY = 24 * 60 * 60 * 1000;
const ago = (iso: string) => {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / DAY);
  return d === 0 ? "today" : `${d}d ago`;
};

/**
 * Campaign detail (premium mockup 05): header with live tag, four money
 * KPIs, the posts table with the five-segment status line and quick
 * filters on the left, featured post + phases + broken-link note on the
 * right (the right column becomes the post's review panel when a row is
 * selected). The attached sheet and invoicing sit below.
 */
function CampaignDetailContent() {
  const { user, accessToken } = useAuth();
  const searchParams = useSearchParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const token = accessToken!;
  const campaignId = searchParams.get("id") ?? "";
  const focusInvoices = searchParams.get("section") === "invoices";
  // Two distinct sections, same as the server's requireAccess() keys (15
  // Sep — a granted non-admin role might hold one without the other):
  // campaigns.manage for phases/edit/resolve-pending, links.review for the
  // post review panel.
  const isAdmin = hasAccess(user, "campaigns.edit");
  // The post review panel bundles screenshot/insight approval (links.approve)
  // with cost revision / invalidation (links.edit); either opens it.
  const canReviewLinks = hasAccess(user, "links.approve") || hasAccess(user, "links.edit");
  const isPrivileged = user?.role === "ADMIN" || user?.role === "FINANCE" || user?.role === "PLAN_MAKER";
  // 22 Sep — a Plan Maker can add a real phase to their own plans' campaigns
  // (the server scopes which); deleting one stays an admin action.
  const canAddPhase = isAdmin || (user?.role === "PLAN_MAKER" && canUse(user, "campaigns.edit"));
  const canDeletePhase = isAdmin;

  const [detailId, setDetailId] = useState<string | null>(null);
  const [showEdit, setShowEdit] = useState(false);
  const [showResolvePending, setShowResolvePending] = useState(false);
  const [filter, setFilter] = useState<PostFilter>("all");
  const [phaseToDelete, setPhaseToDelete] = useState<{ id: string; phaseNumber: number } | null>(null);

  const campaignQuery = useQuery({ queryKey: ["campaign", campaignId], queryFn: () => campaignsApi.get(token, campaignId), enabled: Boolean(campaignId) });
  const linksQuery = useQuery({ queryKey: ["links", { campaignId }], queryFn: () => linksApi.list(token, { campaignId, pageSize: 100 }), enabled: Boolean(campaignId) });
  const assignmentsQuery = useQuery({ queryKey: ["campaignAssignments", campaignId], queryFn: () => campaignsApi.listAssignments(token, campaignId), enabled: Boolean(campaignId) });
  const invoicesQuery = useQuery({ queryKey: ["invoices", { campaignId }], queryFn: () => invoicesApi.list(token, { campaignId, pageSize: 100 }), enabled: Boolean(campaignId) && isPrivileged });

  // Opening a page's 2nd-post row directly (dashboards link to a link's
  // campaignId) answers with the phase it belongs to — follow it, so every
  // query and action on this page is about the real phase.
  const resolvedId = campaignQuery.data?.id;
  useEffect(() => {
    if (resolvedId && resolvedId !== campaignId) router.replace(`/campaigns/view?id=${resolvedId}${focusInvoices ? "&section=invoices" : ""}`);
  }, [resolvedId, campaignId, focusInvoices, router]);

  const readyToFocus = Boolean(campaignQuery.data) && !linksQuery.isLoading;
  useEffect(() => {
    if (!focusInvoices || !readyToFocus) return;
    document.getElementById("campaign-invoices")?.scrollIntoView({ block: "start" });
  }, [focusInvoices, readyToFocus]);

  const campaign = campaignQuery.data;
  const items = linksQuery.data?.items ?? [];
  const assignments = assignmentsQuery.data ?? [];
  const detail = items.find((l) => l.id === detailId) ?? null;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["campaign", campaignId] });
    queryClient.invalidateQueries({ queryKey: ["links", { campaignId }] });
    queryClient.invalidateQueries({ queryKey: ["invoices", { campaignId }] });
  };

  const createPhaseMutation = useMutation({
    mutationFn: () => campaignsApi.createPhase(token, campaignId),
    onSuccess: (newPhase) => {
      queryClient.invalidateQueries({ queryKey: ["campaign"] });
      router.push(`/campaigns/view?id=${newPhase.id}`);
    },
  });

  const deletePhaseMutation = useMutation({
    mutationFn: (phaseId: string) => campaignsApi.deletePhase(token, phaseId),
    onSuccess: (result, phaseId) => {
      setPhaseToDelete(null);
      queryClient.invalidateQueries({ queryKey: ["campaign"] });
      queryClient.invalidateQueries({ queryKey: ["campaigns"] });
      // The phase being viewed is gone — land on Phase 1.
      if (phaseId === campaignId) router.push(`/campaigns/view?id=${result.rootId}`);
    },
  });

  const costCapNum = campaign?.costCap != null ? Number(campaign.costCap) : null;
  const spent = campaign?.spent ?? 0;
  const spentPct = costCapNum && costCapNum > 0 ? (spent / costCapNum) * 100 : null;
  const isOver = spentPct != null && spentPct > 100;
  const paidOut = useMemo(() => (invoicesQuery.data?.items ?? []).filter((i) => i.status === "PAID").reduce((s, i) => s + Number(i.amount), 0), [invoicesQuery.data]);
  const invoicedNotPaid = useMemo(() => (invoicesQuery.data?.items ?? []).filter((i) => i.status === "RAISED" || i.status === "APPROVED").reduce((s, i) => s + Number(i.amount), 0), [invoicesQuery.data]);
  const pageCount = useMemo(() => new Set([...items.map((l) => l.assetId), ...assignments.filter((a) => a.assetId).map((a) => a.assetId!)]).size, [items, assignments]);
  const counts = useMemo(
    () => ({
      all: items.length,
      us: items.filter((l) => WAITING_ON_US.includes(l.status)).length,
      creator: items.filter((l) => WAITING_ON_CREATOR.includes(l.status)).length,
      ready: items.filter((l) => READY.includes(l.status)).length,
      invoiced: items.filter((l) => l.status === "INVOICED").length,
    }),
    [items]
  );
  const visible = useMemo(
    () =>
      items.filter((l) =>
        filter === "us" ? WAITING_ON_US.includes(l.status) : filter === "creator" ? WAITING_ON_CREATOR.includes(l.status) : filter === "ready" ? READY.includes(l.status) : filter === "invoiced" ? l.status === "INVOICED" : true
      ),
    [items, filter]
  );
  const featured = useMemo(() => items.find((l) => l.postSnapshots?.[0]) ?? items[0], [items]);
  const broken = items.filter((l) => l.status === "INVALID");
  const isLive = campaign ? !campaign.deadline || new Date(campaign.deadline).getTime() >= Date.now() - DAY : false;
  const phaseLabel = campaign ? (campaign.phases && campaign.phases.length > 1 ? `Phase ${campaign.phaseNumber ?? 1} of ${campaign.phases.length}` : "Phase 1") : "";

  return (
    <AppShell active="campaigns" user={{ initials: initialsOf(user?.name), name: user?.name ?? "—", role: roleLabel(user?.role), tone: user?.role === "FINANCE" ? "blue" : "emerald" }} searchPlaceholder="Search campaigns…">
      <div className="flex flex-col gap-5">
        <Link href="/campaigns" className="flex w-fit items-center gap-1 text-[0.8125rem] font-medium text-text-muted hover:text-text">
          <ChevronRightIcon className="h-3.5 w-3.5 rotate-180" />
          Campaigns
        </Link>

        {campaignQuery.isLoading ? (
          <Card>
            <TableSkeleton />
          </Card>
        ) : campaignQuery.isError || !campaign ? (
          <Card>
            <EmptyState label="Campaign not found." />
          </Card>
        ) : (
          <>
            <PageHeader
              title={campaign.title}
              tags={isLive ? <Tag tone="ok">Live</Tag> : <Tag tone="neutral">Ended</Tag>}
              subtitle={
                <>
                  {campaign.brandName} · {phaseLabel} · {pageCount} page{pageCount === 1 ? "" : "s"} · {campaign.postCount ?? items.length} post{(campaign.postCount ?? items.length) === 1 ? "" : "s"}
                  {campaign.deadline && <> · {isLive ? "ends" : "ended"} {shortDate(campaign.deadline)}</>}
                  <span className="ml-1 inline-flex items-center gap-1 text-text-faint">
                    · <HeartIcon className="h-3 w-3" /> {count(campaign.totalLikes ?? 0)} likes
                  </span>
                </>
              }
              actions={
                canAddPhase ? (
                  <>
                    <Button
                      variant="secondary"
                      onClick={() => createPhaseMutation.mutate()}
                      disabled={createPhaseMutation.isPending}
                      title="Adds the next phase, starting with Phase 1's pages (one post each)"
                    >
                      <PlusIcon className="h-4 w-4" />
                      {createPhaseMutation.isPending ? "Adding…" : "Add phase"}
                    </Button>
                    {isAdmin && (
                      <Button onClick={() => setShowEdit(true)}>
                        <EditIcon className="h-4 w-4" />
                        Edit campaign
                      </Button>
                    )}
                  </>
                ) : undefined
              }
            />
            {createPhaseMutation.isError && <ErrorNotice message={createPhaseMutation.error instanceof ApiError ? createPhaseMutation.error.message : "Couldn't add a phase."} />}

            {(campaign.phases?.length ?? 0) > 1 && (
              <Chips>
                {campaign.phases!.map((p) => (
                  <Link
                    key={p.id}
                    href={`/campaigns/view?id=${p.id}`}
                    aria-current={p.id === campaign.id ? "page" : undefined}
                    className={cn(
                      "inline-flex h-[30px] items-center rounded-full border border-border bg-surface px-[11px] text-[0.78rem] font-medium text-text-2 shadow-card transition-colors hover:border-ink",
                      p.id === campaign.id && "border-ink bg-ink text-ink-fg hover:border-ink"
                    )}
                  >
                    Phase {p.phaseNumber}
                  </Link>
                ))}
              </Chips>
            )}

            {isAdmin && !!campaign.pendingAssignmentCount && (
              <Note
                tone="warn"
                action={
                  <Button size="sm" variant="secondary" onClick={() => setShowResolvePending(true)}>
                    Create all
                  </Button>
                }
              >
                <b>{campaign.pendingAssignmentCount} page{campaign.pendingAssignmentCount === 1 ? "" : "s"} from the sheet still need{campaign.pendingAssignmentCount === 1 ? "s" : ""} creating.</b> They aren&apos;t in the database yet.
              </Note>
            )}

            {isPrivileged ? (
            <div className={cn("grid grid-cols-2 gap-3 md:gap-4", isPrivileged ? "md:grid-cols-4" : "md:grid-cols-3")}>
                <KpiCard label="Budget cap" value={costCapNum != null ? money(costCapNum) : "No cap"} foot={costCapNum != null ? `${money(spent)} / ${money(costCapNum)} · ${Math.round(spentPct ?? 0)}% used` : "Set one in Edit campaign"} />
                <KpiCard label="Committed" value={money(spent)} foot={`${campaign.postCount ?? items.length} posts · ${counts.invoiced} invoiced`} />
                <KpiCard label="Remaining" value={campaign.remainingBudget != null ? money(campaign.remainingBudget) : "—"} tone={isOver ? "rose" : undefined} foot={isOver ? `Over cap by ${money(spent - (costCapNum ?? 0))}` : campaign.remainingBudget != null ? "Left for more posts or a phase" : "No cap set"} />
                {isPrivileged && <KpiCard label="Paid out" value={money(paidOut)} foot={invoicedNotPaid > 0 ? `${money(invoicedNotPaid)} invoiced, awaiting payout` : "Nothing awaiting payout"} />}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4">
                <KpiCard label="Your earnings" value={money(campaign.yourEarnings ?? 0)} foot={`${campaign.postCount ?? items.length} posts · ${counts.invoiced} invoiced`} />
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_340px]">
              <Card className="flex min-w-0 flex-col" data-testid="campaign-posts">
                <CardHeader
                  title="Posts"
                  meta={<span className="text-[0.78rem] text-text-muted">{items.length} submitted</span>}
                  action={
                    <Chips>
                      <Chip on={filter === "all"} count={counts.all} onClick={() => setFilter("all")}>
                        All
                      </Chip>
                      <Chip on={filter === "us"} count={counts.us} onClick={() => setFilter("us")}>
                        Waiting on us
                      </Chip>
                      <Chip on={filter === "creator"} count={counts.creator} onClick={() => setFilter("creator")}>
                        Waiting on creator
                      </Chip>
                      <Chip on={filter === "ready"} count={counts.ready} onClick={() => setFilter("ready")}>
                        Ready to invoice
                      </Chip>
                    </Chips>
                  }
                />
                {linksQuery.isLoading ? (
                  <TableSkeleton />
                ) : visible.length === 0 ? (
                  <EmptyState label={items.length === 0 ? "No links submitted for this campaign yet." : "No posts match this filter."} />
                ) : (
                  <Table>
                    <THead>
                      <tr>
                        <TH className="w-[54px]" />
                        <TH>Page · Post</TH>
                        <TH className="hidden md:table-cell">Status</TH>
                        <TH right>Cost</TH>
                        <TH right className="hidden lg:table-cell">
                          Likes
                        </TH>
                        <TH />
                      </tr>
                    </THead>
                    <tbody>
                      {visible.map((link, i) => {
                        const hint = statusHint(link.status);
                        const likes = link.postSnapshots?.[0]?.likeCount;
                        return (
                          <TR key={link.id} interactive selected={link.id === detailId} data-testid="campaign-link-row" onClick={() => setDetailId(link.id)} style={{ animationDelay: `${0.2 + i * 0.04}s` }}>
                            <TD className="pr-0">
                              <Thumb src={null} />
                            </TD>
                            <TD>
                              <Cell2
                                primary={
                                  <span className="inline-flex items-center gap-1.5">
                                    @{link.asset?.handle ?? "—"}
                                    {isPrivileged && (link.campaign?.postNumber ?? 1) > 1 && (
                                      <span className="rounded-[5px] border border-border bg-surface-2 px-1.5 py-px text-[0.66rem] font-semibold text-text-2" data-testid="post-number-tag">
                                        Post {link.campaign!.postNumber}
                                      </span>
                                    )}
                                  </span>
                                }
                                secondary={`${formatLabel(link.format)} · ${ago(link.createdAt)} · ${link.url}`}
                              >
                                <StatusSteps status={link.status} className="mt-1" animate={false} />
                              </Cell2>
                            </TD>
                            <TD className="hidden md:table-cell">
                              <Tag tone={hint.tone === "ok" ? "ok" : hint.tone === "bad" ? "bad" : hint.tone === "wait" ? "wait" : "neutral"}>{STATUS_LABEL[link.status] ?? hint.text}</Tag>
                            </TD>
                            <TD right className="font-semibold">
                              {money(link.cost)}
                            </TD>
                            <TD right className="hidden text-text-muted lg:table-cell">
                              {likes != null && likes >= 0 ? compactNumber(likes) : "—"}
                            </TD>
                            <TD right>
                              <ChevronRightIcon className="h-4 w-4 text-text-faint" />
                            </TD>
                          </TR>
                        );
                      })}
                    </tbody>
                  </Table>
                )}
              </Card>

              <div className="hidden flex-col gap-4 lg:flex">
                {detail ? (
                  <Card className="flex flex-col">
                    <CardHeader
                      title={`@${detail.asset?.handle ?? "—"} · ${formatLabel(detail.format)}`}
                      action={
                        <button type="button" onClick={() => setDetailId(null)} aria-label="Close post details" className="text-text-faint hover:text-text">
                          <CloseIcon className="h-4 w-4" />
                        </button>
                      }
                    />
                    <div className="p-[18px]">
                      <LinkDetailPanel link={detail} token={token} isAdmin={canReviewLinks} canUploadScreenshot={false} onChanged={invalidate} />
                    </div>
                  </Card>
                ) : (
                  <>
                    <Card>
                      <CardHeader title="Featured post" />
                      {featured ? (
                        <div className="flex flex-col gap-3 p-[18px]">
                          <div className="flex gap-3.5">
                            <Thumb src={campaign.representativePost?.thumbnailUrl} className="h-20 w-16 rounded-[10px]" />
                            <div className="flex min-w-0 flex-col gap-1">
                              <b className="text-[0.8375rem]">@{featured.asset?.handle ?? "—"}</b>
                              <span className="line-clamp-2 text-[0.78rem] text-text-2">{campaign.representativePost?.caption ?? featured.url}</span>
                              <span className="text-[0.78rem] tabular-nums text-text-muted">
                                <b className="text-text">{featured.postSnapshots?.[0] ? compactNumber(featured.postSnapshots[0].likeCount) : "—"}</b> likes ·{" "}
                                {featured.postSnapshots?.[0] ? compactNumber(featured.postSnapshots[0].videoViews) : "—"} views
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center justify-between border-t border-border pt-3 text-[0.8125rem]">
                            <span className="text-text-muted">Total likes, all posts</span>
                            <b className="tabular-nums">{compactNumber(campaign.totalLikes ?? 0)}</b>
                          </div>
                        </div>
                      ) : (
                        <EmptyState label="No posts yet." />
                      )}
                    </Card>
                    <Card>
                      <CardHeader
                        title="Phases"
                        action={
                          canAddPhase ? (
                            <button type="button" onClick={() => createPhaseMutation.mutate()} className="flex items-center gap-1 text-[0.8125rem] font-medium text-blue hover:text-text">
                              <PlusIcon className="h-3 w-3" /> Add
                            </button>
                          ) : undefined
                        }
                      />
                      <div className="flex flex-col gap-2.5 p-[18px] pt-3">
                        {(campaign.phases ?? [{ id: campaign.id, phaseNumber: campaign.phaseNumber ?? 1, title: campaign.title, createdAt: campaign.createdAt }]).map((p) => (
                          <div key={p.id} className="flex items-center gap-2" data-testid="phase-row">
                            <Link href={`/campaigns/view?id=${p.id}`} className="flex min-w-0 flex-1 items-center gap-2">
                              <Cell2 primary={`Phase ${p.phaseNumber}`} secondary={`created ${shortDate(p.createdAt)}`} />
                              <span className="ml-auto">{p.id === campaign.id ? <Tag tone="ok">Viewing</Tag> : <Tag tone="neutral">Open</Tag>}</span>
                            </Link>
                            {canDeletePhase && p.phaseNumber > 1 && (
                              <button
                                type="button"
                                onClick={() => {
                                  deletePhaseMutation.reset();
                                  setPhaseToDelete({ id: p.id, phaseNumber: p.phaseNumber });
                                }}
                                aria-label={`Delete phase ${p.phaseNumber}`}
                                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-text-faint transition-colors hover:bg-rose-soft hover:text-rose"
                              >
                                <CloseIcon className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </Card>
                    {broken.length > 0 && (
                      <Note tone="warn">
                        <b>
                          {broken.length} broken link{broken.length === 1 ? "" : "s"}.
                        </b>{" "}
                        {money(broken.reduce((s, l) => s + Number(l.cost), 0))} is still tied to {broken.length === 1 ? "it" : "them"}.
                      </Note>
                    )}
                  </>
                )}
              </div>
            </div>

            {assignments.length > 0 && (
              <Card>
                <CardHeader title="Attached sheet" meta={<span className="text-[0.78rem] text-text-muted">{isPrivileged ? "Every page/creator listed for this campaign." : "Your page(s) listed for this campaign."}</span>} />
                <Table>
                  <THead>
                    <tr>
                      <TH>Page</TH>
                      {isPrivileged && <TH>Creator</TH>}
                      <TH>Post</TH>
                      <TH>Status</TH>
                    </tr>
                  </THead>
                  <tbody>
                    {assignments.map((a) => (
                      <TR key={a.id}>
                        <TD className="font-semibold">
                          @{a.pageHandle}
                          {isPrivileged && (a.postNumber ?? 1) > 1 && <span className="ml-1.5 text-[0.72rem] font-medium text-text-muted">· Post {a.postNumber}</span>}
                        </TD>
                        {isPrivileged && <TD className="text-text-muted">{a.creatorPhone ?? "—"}</TD>}
                        <TD className="text-[0.8125rem]">
                          {a.postUrl ? (
                            <span className="text-accent">{a.linkId ? `Post attached${a.link ? ` · ${STATUS_LABEL[a.link.status] ?? a.link.status}` : ""}` : "Post named — attaches once matched"}</span>
                          ) : (
                            <span className="text-text-muted">—</span>
                          )}
                        </TD>
                        <TD>{a.status === "matched" ? <Tag tone="ok">Matched</Tag> : <Tag tone="wait">Pending</Tag>}</TD>
                      </TR>
                    ))}
                  </tbody>
                </Table>
              </Card>
            )}

            <div id="campaign-invoices" className="scroll-mt-4">
              <CampaignInvoicesPanel token={token} campaign={campaign} role={user?.role} permissions={user?.permissions} />
            </div>
          </>
        )}
      </div>

      {detail && (
        <Sheet onClose={() => setDetailId(null)} overlayClassName="lg:hidden" panelClassName="lg:hidden">
          <div className="overflow-y-auto p-6 pt-1">
            <LinkDetailPanel link={detail} token={token} isAdmin={canReviewLinks} canUploadScreenshot={false} onChanged={invalidate} />
          </div>
        </Sheet>
      )}

      {phaseToDelete && (
        <Sheet onClose={() => setPhaseToDelete(null)} panelClassName="md:max-w-[440px]">
          <div className="flex flex-col gap-4 p-6 pt-1" data-testid="delete-phase-confirm">
            <h2 className="text-[1.0625rem] font-semibold tracking-[-0.02em]">Delete Phase {phaseToDelete.phaseNumber}?</h2>
            <p className="text-[0.8125rem] text-text-muted">
              This removes the phase and the pages booked on it. Later phases move up a number. A phase with submitted posts or invoices can&apos;t be deleted.
            </p>
            {deletePhaseMutation.isError && <ErrorNotice message={deletePhaseMutation.error instanceof ApiError ? deletePhaseMutation.error.message : "Couldn't delete this phase."} />}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setPhaseToDelete(null)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={() => deletePhaseMutation.mutate(phaseToDelete.id)} disabled={deletePhaseMutation.isPending}>
                {deletePhaseMutation.isPending ? "Deleting…" : `Delete Phase ${phaseToDelete.phaseNumber}`}
              </Button>
            </div>
          </div>
        </Sheet>
      )}

      {showEdit && campaign && <EditCampaignModal token={token} campaign={campaign} onClose={() => setShowEdit(false)} onSaved={() => setShowEdit(false)} />}

      {showResolvePending && campaign && <ResolvePendingAssignmentsModal token={token} campaignId={campaign.id} campaignTitle={campaign.title} onClose={() => setShowResolvePending(false)} onResolved={invalidate} />}
    </AppShell>
  );
}

function EditCampaignModal({ token, campaign, onClose, onSaved }: { token: string; campaign: Campaign; onClose: () => void; onSaved: () => void }) {
  const queryClient = useQueryClient();
  const [brandName, setBrandName] = useState(campaign.brandName);
  const [title, setTitle] = useState(campaign.title);
  const [deadline, setDeadline] = useState(campaign.deadline ? campaign.deadline.slice(0, 10) : "");
  const [costCap, setCostCap] = useState(campaign.costCap != null ? String(campaign.costCap) : "");

  const updateMutation = useMutation({
    mutationFn: () => campaignsApi.update(token, campaign.id, { brandName, title, deadline: deadline || null, costCap: costCap ? Number(costCap) : null }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["campaign", campaign.id] });
      queryClient.invalidateQueries({ queryKey: ["campaigns"] });
      onSaved();
    },
  });

  return (
    <Sheet onClose={onClose} panelClassName="md:max-w-[420px]">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          updateMutation.mutate();
        }}
        className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-6 pt-1"
      >
        <h2 className="text-[1.125rem] font-semibold tracking-[-0.02em]">Edit campaign</h2>
        <Field label="Brand name">
          <TextField required aria-label="Brand name" value={brandName} onChange={setBrandName} />
        </Field>
        <Field label="Campaign title">
          <TextField required aria-label="Campaign title" value={title} onChange={setTitle} />
        </Field>
        <Field label="Deadline (optional)">
          <TextField type="date" aria-label="Deadline" value={deadline} onChange={setDeadline} />
        </Field>
        <Field label="Total cost cap (optional)">
          <MoneyField aria-label="Total cost cap" value={costCap} onChange={setCostCap} placeholder="1,50,000" />
        </Field>
        {updateMutation.isError && <ErrorNotice message={updateMutation.error instanceof ApiError ? updateMutation.error.message : "Couldn't save these changes."} />}
        <div className="mt-auto flex gap-2.5 border-t border-border pt-4">
          <Button type="button" variant="ghost" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" className="flex-1" disabled={updateMutation.isPending}>
            {updateMutation.isPending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}
