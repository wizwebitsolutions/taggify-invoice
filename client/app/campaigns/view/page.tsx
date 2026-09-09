"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { RequireAuth } from "@/components/auth/require-auth";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { Field, TextField } from "@/components/ui/form-field";
import { Panel, ProgressBar } from "@/components/ui/panel";
import { Th, TableSkeleton, EmptyState, ErrorNotice } from "@/components/ui/table-parts";
import { StatusPill } from "@/components/ui/status-pill";
import { LinkDetailPanel, STATUS_LABEL } from "@/components/dashboard/link-detail-panel";
import { ResolvePendingAssignmentsModal } from "@/components/campaigns/resolve-pending-assignments-modal";
import { ChevronRightIcon, HeartIcon, AlertIcon } from "@/components/icons";
import { useAuth } from "@/lib/auth-context";
import { campaigns as campaignsApi, links as linksApi, ApiError, type Campaign } from "@/lib/api-client";
import { initialsOf, roleLabel, money, count } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Campaign detail — bugs.md #7: a real view/edit page for one campaign
 * (brand/title/deadline/cost cap, budget, and every link/page submitted
 * under it), instead of only ever seeing it as a card on the list. Per-page
 * cost revision (bugs.md #7's other half) isn't new UI here — it reuses
 * LinkDetailPanel's existing CostRevisionControl unchanged, the same one
 * the dashboards' "Needs your review" queue already uses.
 */
export default function CampaignDetailPage() {
  return (
    <RequireAuth>
      {/* useSearchParams() requires a Suspense boundary for static export */}
      <Suspense fallback={null}>
        <CampaignDetailContent />
      </Suspense>
    </RequireAuth>
  );
}

function CampaignDetailContent() {
  const { user, accessToken } = useAuth();
  const searchParams = useSearchParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const token = accessToken!;
  const campaignId = searchParams.get("id") ?? "";
  const isAdmin = user?.role === "ADMIN";
  const isPrivileged = user?.role === "ADMIN" || user?.role === "FINANCE";

  const [detailId, setDetailId] = useState<string | null>(null);
  const [showEdit, setShowEdit] = useState(false);
  const [showResolvePending, setShowResolvePending] = useState(false);

  const campaignQuery = useQuery({
    queryKey: ["campaign", campaignId],
    queryFn: () => campaignsApi.get(token, campaignId),
    enabled: Boolean(campaignId), // no ?id= → skip the fetch and fall through to the not-found panel below
  });
  const linksQuery = useQuery({
    queryKey: ["links", { campaignId }],
    queryFn: () => linksApi.list(token, { campaignId, pageSize: 100 }),
    enabled: Boolean(campaignId),
  });
  // newTask.md, 8 Sep — "attached sheet/links for a campaign should be
  // visible to all creators listed in that sheet, not just admin/finance".
  // No extra role branching needed here: the server itself scopes what
  // comes back (everyone's rows for Admin/Finance, only your own matched
  // row(s) otherwise) — see campaigns/service.js's listAssignments.
  const assignmentsQuery = useQuery({
    queryKey: ["campaignAssignments", campaignId],
    queryFn: () => campaignsApi.listAssignments(token, campaignId),
    enabled: Boolean(campaignId),
  });

  const campaign = campaignQuery.data;
  const items = linksQuery.data?.items ?? [];
  const assignments = assignmentsQuery.data ?? [];
  const detail = items.find((l) => l.id === detailId) ?? null;
  const mobileDetail = detailId ? detail : null;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["campaign", campaignId] });
    queryClient.invalidateQueries({ queryKey: ["links", { campaignId }] });
  };

  // newTask.md, 8 Sep — more posts under the same brand deal become a new
  // phase; jump straight to it so admin lands where the new phase's own
  // (empty) link list is, not back on the phase they were just viewing.
  const createPhaseMutation = useMutation({
    mutationFn: () => campaignsApi.createPhase(token, campaignId),
    onSuccess: (newPhase) => {
      queryClient.invalidateQueries({ queryKey: ["campaign"] });
      router.push(`/campaigns/view?id=${newPhase.id}`);
    },
  });

  const costCapNum = campaign?.costCap != null ? Number(campaign.costCap) : null;
  const spentPct = costCapNum && costCapNum > 0 ? ((campaign?.spent ?? 0) / costCapNum) * 100 : null;
  const isOver = spentPct != null && spentPct > 100;

  return (
    <AppShell
      active="campaigns"
      user={{ initials: initialsOf(user?.name), name: user?.name ?? "—", role: roleLabel(user?.role), tone: user?.role === "FINANCE" ? "blue" : "emerald" }}
      searchPlaceholder="Search campaigns…"
    >
      <div className="flex flex-col gap-6">
        <Link href="/campaigns" className="flex w-fit items-center gap-1.5 text-[0.8125rem] font-semibold text-text-muted hover:text-text">
          <ChevronRightIcon className="h-3.5 w-3.5 rotate-180" />
          Back to campaigns
        </Link>

        {campaignQuery.isLoading ? (
          <Panel>
            <TableSkeleton />
          </Panel>
        ) : campaignQuery.isError || !campaign ? (
          <Panel>
            <EmptyState label="Campaign not found." />
          </Panel>
        ) : (
          <>
            <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-6 shadow-card md:flex-row md:items-start md:justify-between">
              <div className="min-w-0">
                <p className="text-[0.6875rem] font-bold uppercase tracking-[0.08em] text-text-faint">{campaign.brandName}</p>
                <h1 className="mt-1 text-[1.5rem] font-bold leading-snug">{campaign.title}</h1>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.8125rem] text-text-faint">
                  <span>Created {new Date(campaign.createdAt).toLocaleDateString()}</span>
                  {campaign.deadline && (
                    <span className={new Date(campaign.deadline) < new Date() ? "font-semibold text-rose" : ""}>
                      Deadline {new Date(campaign.deadline).toLocaleDateString()}
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    <HeartIcon className="h-3.5 w-3.5" /> {count(campaign.totalLikes ?? 0)} likes
                  </span>
                  <span>{campaign.postCount ?? 0} post{(campaign.postCount ?? 0) === 1 ? "" : "s"}</span>
                </div>
              </div>
              {isAdmin && (
                <Button variant="secondary" size="sm" onClick={() => setShowEdit(true)}>
                  Edit campaign
                </Button>
              )}
            </div>

            {/* Phases (newTask.md, 8 Sep) — more posts under the same brand
                deal, not a new campaign. Chips only once a 2nd phase exists;
                "Add phase" itself is always available to admin so there's a
                way to create the first one. */}
            {((campaign.phases?.length ?? 0) > 1 || isAdmin) && (
              <div className="flex flex-wrap items-center gap-2">
                {(campaign.phases?.length ?? 0) > 1 &&
                  campaign.phases!.map((p) => (
                    <Link
                      key={p.id}
                      href={`/campaigns/view?id=${p.id}`}
                      className={cn(
                        "rounded-full border px-3 py-1.5 text-[0.8125rem] font-semibold",
                        p.id === campaign.id ? "border-accent bg-accent-soft text-accent" : "border-border text-text-faint hover:text-text-muted"
                      )}
                    >
                      Phase {p.phaseNumber}
                    </Link>
                  ))}
                {isAdmin && (
                  <Button variant="ghost" size="sm" onClick={() => createPhaseMutation.mutate()} disabled={createPhaseMutation.isPending}>
                    {createPhaseMutation.isPending ? "Adding…" : "+ Add phase"}
                  </Button>
                )}
                {createPhaseMutation.isError && (
                  <ErrorNotice message={createPhaseMutation.error instanceof ApiError ? createPhaseMutation.error.message : "Couldn't add a phase."} />
                )}
              </div>
            )}

            {isAdmin && !!campaign.pendingAssignmentCount && (
              <button
                type="button"
                onClick={() => setShowResolvePending(true)}
                className="flex w-fit items-center gap-1.5 rounded-md border border-rose/25 bg-rose-soft px-3 py-2 text-[0.8125rem] font-semibold text-rose"
              >
                <AlertIcon className="h-3.5 w-3.5 shrink-0" />
                {campaign.pendingAssignmentCount} page{campaign.pendingAssignmentCount === 1 ? "" : "s"} from the sheet still need
                {campaign.pendingAssignmentCount === 1 ? "s" : ""} creating
              </button>
            )}

            {/* Attached sheet (newTask.md, 8 Sep) — Admin/Finance see every
                row; a Creator/Team member sees only the row(s) matched to
                a page they own (server-scoped, see listAssignments above).
                Hidden entirely when there's nothing relevant to this
                viewer, rather than an empty-state panel for a feature most
                creators will never encounter. */}
            {assignments.length > 0 && (
              <Panel
                title="Attached sheet"
                subtitle={isPrivileged ? "Every page/creator listed for this campaign." : "Your page(s) listed for this campaign."}
              >
                <div className="flex flex-col gap-2.5">
                  {assignments.map((a) => (
                    <div key={a.id} className="flex items-center justify-between gap-3 rounded-md border border-border px-3.5 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-[0.8438rem] font-semibold">@{a.pageHandle}</p>
                        {isPrivileged && a.creatorPhone && <p className="text-xs text-text-faint">{a.creatorPhone}</p>}
                        {/* newTask.md, 8 Sep — "if a post link is already
                            mentioned in the attached sheet, it should get
                            added directly to that creator's posts". */}
                        {a.postUrl && (
                          <p className="mt-0.5 truncate text-xs text-accent">
                            {a.linkId ? `Post attached${a.link ? ` · ${STATUS_LABEL[a.link.status] ?? a.link.status}` : ""}` : "Post named — attaches once matched"}
                          </p>
                        )}
                      </div>
                      <span
                        className={cn(
                          "shrink-0 rounded-full px-2.5 py-1 text-[0.6875rem] font-bold uppercase tracking-[0.04em]",
                          a.status === "matched" ? "bg-accent-soft text-accent" : "bg-surface-2 text-text-faint"
                        )}
                      >
                        {a.status === "matched" ? "Matched" : "Pending"}
                      </span>
                    </div>
                  ))}
                </div>
              </Panel>
            )}

            {costCapNum != null && spentPct != null && (
              <Panel title="Budget" bodyClassName="flex flex-col gap-2">
                <div className="flex items-baseline justify-between">
                  <span className="text-[1.0625rem] font-extrabold tabular-nums">
                    {money(campaign.spent ?? 0)} <span className="text-[0.8125rem] font-medium text-text-faint">/ {money(costCapNum)}</span>
                  </span>
                  <span className={isOver ? "text-[0.8125rem] font-bold text-rose" : "text-[0.8125rem] font-bold text-accent"}>
                    {Math.round(spentPct)}%{isOver ? " over" : ""}
                  </span>
                </div>
                <ProgressBar pct={spentPct} tone={isOver ? "rose" : "accent"} />
              </Panel>
            )}

            <div className="flex min-h-0 flex-col gap-4 md:flex-row md:gap-5">
              <Panel title="Links" subtitle={`${items.length} submitted under this campaign`} className="flex-1 overflow-hidden" bodyClassName="overflow-hidden">
                <div className="hidden overflow-hidden rounded-lg border border-border md:block">
                  <div className="grid grid-cols-[minmax(0,2.4fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.3fr)_24px] gap-3 border-b border-border bg-surface px-5 py-3.5">
                    <Th>Post</Th>
                    <Th>Page</Th>
                    <Th>Cost</Th>
                    <Th>Status</Th>
                    <div />
                  </div>
                  {linksQuery.isLoading ? (
                    <TableSkeleton />
                  ) : items.length === 0 ? (
                    <EmptyState label="No links submitted for this campaign yet." />
                  ) : (
                    items.map((link) => (
                      <div
                        key={link.id}
                        data-testid="campaign-link-row"
                        onClick={() => setDetailId(link.id)}
                        className={
                          "grid cursor-pointer grid-cols-[minmax(0,2.4fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.3fr)_24px] items-center gap-3 border-b border-l-[3px] border-border border-l-transparent bg-surface px-5 py-3.5 transition-colors last:border-b-0 hover:bg-surface-2 " +
                          (link.id === detailId ? "border-l-accent bg-accent-soft hover:bg-accent-soft" : "")
                        }
                      >
                        <div className="min-w-0 truncate text-sm text-text-muted">{link.url}</div>
                        <div className="text-[0.8438rem] text-text-muted">@{link.asset?.handle ?? "—"}</div>
                        <div className="text-sm font-bold tabular-nums">{money(link.cost)}</div>
                        <div>
                          <StatusPill status={link.status} />
                        </div>
                        <ChevronRightIcon className="h-3.5 w-3.5 text-text-faint" />
                      </div>
                    ))
                  )}
                </div>

                {/* Mobile: cards instead of a table row. */}
                <div className="flex flex-col gap-3 md:hidden">
                  {linksQuery.isLoading ? (
                    <TableSkeleton />
                  ) : items.length === 0 ? (
                    <EmptyState label="No links submitted for this campaign yet." />
                  ) : (
                    items.map((link) => (
                      <div
                        key={link.id}
                        onClick={() => setDetailId(link.id)}
                        className="flex items-center gap-3 rounded-[14px] border border-border bg-surface p-3.5 shadow-card"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-semibold">@{link.asset?.handle ?? "—"}</div>
                          <div className="mt-0.5 truncate text-xs text-text-faint">{money(link.cost)} · {link.url}</div>
                        </div>
                        <StatusPill status={link.status} />
                      </div>
                    ))
                  )}
                </div>
              </Panel>

              {/* Desktop: persistent side panel, same pattern as the dashboards' review queue. */}
              <Panel className="hidden w-[320px] shrink-0 md:block" bodyClassName="flex h-full flex-col gap-5">
                {detail ? (
                  <LinkDetailPanel link={detail} token={token} isAdmin={isAdmin} canUploadScreenshot={false} onChanged={invalidate} />
                ) : (
                  <p className="text-[0.8125rem] text-text-faint">Select a link to see its details, timeline, and cost history.</p>
                )}
              </Panel>
            </div>
          </>
        )}
      </div>

      {/* Mobile: detail opens as a bottom sheet. */}
      {mobileDetail && (
        <Sheet onClose={() => setDetailId(null)} overlayClassName="md:hidden" panelClassName="md:hidden">
          <div className="overflow-y-auto p-6 pt-1">
            <LinkDetailPanel link={mobileDetail} token={token} isAdmin={isAdmin} canUploadScreenshot={false} onChanged={invalidate} />
          </div>
        </Sheet>
      )}

      {showEdit && campaign && (
        <EditCampaignModal token={token} campaign={campaign} onClose={() => setShowEdit(false)} onSaved={() => setShowEdit(false)} />
      )}

      {showResolvePending && campaign && (
        <ResolvePendingAssignmentsModal
          token={token}
          campaignId={campaign.id}
          campaignTitle={campaign.title}
          onClose={() => setShowResolvePending(false)}
          onResolved={invalidate}
        />
      )}
    </AppShell>
  );
}

function EditCampaignModal({
  token,
  campaign,
  onClose,
  onSaved,
}: {
  token: string;
  campaign: Campaign;
  onClose: () => void;
  onSaved: () => void;
}) {
  const queryClient = useQueryClient();
  const [brandName, setBrandName] = useState(campaign.brandName);
  const [title, setTitle] = useState(campaign.title);
  const [deadline, setDeadline] = useState(campaign.deadline ? campaign.deadline.slice(0, 10) : "");
  const [costCap, setCostCap] = useState(campaign.costCap != null ? String(campaign.costCap) : "");

  const updateMutation = useMutation({
    mutationFn: () =>
      campaignsApi.update(token, campaign.id, {
        brandName,
        title,
        deadline: deadline || null,
        costCap: costCap ? Number(costCap) : null,
      }),
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
        className="flex flex-1 min-h-0 flex-col gap-5 overflow-y-auto p-6 pt-1"
      >
        <h2 className="text-lg font-bold">Edit campaign</h2>
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
          <TextField type="number" aria-label="Total cost cap" value={costCap} onChange={setCostCap} placeholder="e.g. 150000" />
        </Field>

        {updateMutation.isError && (
          <ErrorNotice message={updateMutation.error instanceof ApiError ? updateMutation.error.message : "Couldn't save these changes."} />
        )}
        <div className="flex gap-2.5">
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
