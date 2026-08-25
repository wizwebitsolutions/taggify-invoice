"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { RequireAuth } from "@/components/auth/require-auth";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { StatusPill, type PillStatus } from "@/components/ui/status-pill";
import { StatusTimeline, type TimelineStep } from "@/components/dashboard/status-timeline";
import {
  LinkIcon,
  CameraIcon,
  CheckCircleIcon,
  InvoiceIcon,
  AlertIcon,
  PlusIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  HeartIcon,
  MessageIcon,
} from "@/components/icons";
import { Th, TableSkeleton, EmptyState, ErrorNotice } from "@/components/ui/table-parts";
import { UploadLinksModal } from "@/components/links/upload-links-modal";
import { useAuth } from "@/lib/auth-context";
import {
  links as linksApi,
  campaigns as campaignsApi,
  assets as assetsApi,
  invoices as invoicesApi,
  screenshots as screenshotsApi,
  ApiError,
  type Link,
} from "@/lib/api-client";
import { money, initialsOf, roleLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

const STATUS_FILTERS: { label: string; value: string | undefined }[] = [
  { label: "All statuses", value: undefined },
  { label: "Submitted", value: "SUBMITTED" },
  { label: "Pending review", value: "PENDING_SCREENSHOT_REVIEW" },
  { label: "Screenshot approved", value: "SCREENSHOT_APPROVED" },
  { label: "Insights pending", value: "INSIGHTS_PENDING" },
  { label: "Insights approved", value: "INSIGHTS_APPROVED" },
  { label: "Invoiced", value: "INVOICED" },
];

export default function DashboardPage() {
  return (
    <RequireAuth>
      <DashboardContent />
    </RequireAuth>
  );
}

function DashboardContent() {
  const { user, accessToken } = useAuth();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [assetFilter, setAssetFilter] = useState<string | undefined>(undefined);
  const [fromFilter, setFromFilter] = useState("");
  const [toFilter, setToFilter] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [detailId, setDetailId] = useState<string | null>(null);
  const [showSubmitForm, setShowSubmitForm] = useState(false);

  const token = accessToken!;

  // Unfiltered fetch powers the KPI tiles; the filtered fetch powers the table.
  const allLinksQuery = useQuery({
    queryKey: ["links", "all"],
    queryFn: () => linksApi.list(token, { pageSize: 100 }),
  });
  const filteredLinksQuery = useQuery({
    queryKey: ["links", statusFilter ?? "all", assetFilter ?? "all", fromFilter, toFilter],
    queryFn: () =>
      linksApi.list(token, {
        status: statusFilter,
        assetId: assetFilter,
        from: fromFilter || undefined,
        to: toFilter || undefined,
        pageSize: 100,
      }),
  });
  const campaignsQuery = useQuery({ queryKey: ["campaigns"], queryFn: () => campaignsApi.list(token) });
  const assetsQuery = useQuery({ queryKey: ["assets"], queryFn: () => assetsApi.list(token) });

  const kpis = useMemo(() => {
    const items = allLinksQuery.data?.items ?? [];
    return {
      added: allLinksQuery.data?.total ?? 0,
      pendingScreenshots: items.filter((l) => l.status === "PENDING_SCREENSHOT_REVIEW").length,
      approved: items.filter((l) => !["SUBMITTED", "PENDING_SCREENSHOT_REVIEW", "SCREENSHOT_REJECTED"].includes(l.status)).length,
      invoiced: items.filter((l) => l.status === "INVOICED").length,
      uninvoiced: items.filter((l) => l.status === "INSIGHTS_APPROVED").length,
    };
  }, [allLinksQuery.data]);

  const bulkInvoiceMutation = useMutation({
    mutationFn: () => invoicesApi.bulkCreate(token, [...selectedIds]),
    onSuccess: () => {
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["links"] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
    },
  });

  const rows = filteredLinksQuery.data?.items ?? [];
  const detailLink = rows.find((l) => l.id === detailId) ?? rows[0];

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const canBulkInvoice = user?.role === "CREATOR" || user?.role === "ADMIN";
  const canSubmitLink = user?.role === "CREATOR" || user?.role === "TEAM_MEMBER";

  return (
    <AppShell
      active="dashboard"
      user={{ initials: initialsOf(user?.name), name: user?.name ?? "—", role: roleLabel(user?.role), tone: user?.role === "FINANCE" ? "blue" : "emerald" }}
      searchPlaceholder="Search links, campaigns, pages…"
      topbarActions={
        canSubmitLink ? (
          <Button size="default" onClick={() => setShowSubmitForm(true)}>
            <PlusIcon className="h-[15px] w-[15px] text-accent-ink" />
            Upload links
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-7">
        <div>
          <p className="mb-1.5 text-[0.6875rem] font-bold uppercase tracking-[0.08em] text-text-faint">Overview</p>
          <h1 className="mb-1.5 text-[1.625rem] font-bold">My Works</h1>
          <p className="text-[0.9375rem] text-text-muted">Every submitted link, tracked from post to payout.</p>
        </div>

        <div className="grid grid-cols-5 gap-4">
          <KpiCard icon={LinkIcon} label="Links added" value={String(kpis.added)} />
          <KpiCard icon={CameraIcon} label="Pending screenshots" value={String(kpis.pendingScreenshots)} />
          <KpiCard icon={CheckCircleIcon} label="Links approved" value={String(kpis.approved)} />
          <KpiCard icon={InvoiceIcon} label="Links invoiced" value={String(kpis.invoiced)} />
          <KpiCard icon={AlertIcon} label="Uninvoiced links" value={String(kpis.uninvoiced)} tone={kpis.uninvoiced > 0 ? "indigo" : undefined} />
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <select
            value={statusFilter ?? ""}
            onChange={(e) => setStatusFilter(e.target.value || undefined)}
            className="h-[38px] rounded-full border border-border bg-surface px-3.5 text-[0.8125rem] text-text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {STATUS_FILTERS.map((f) => (
              <option key={f.label} value={f.value ?? ""}>
                {f.label}
              </option>
            ))}
          </select>

          <select
            value={assetFilter ?? ""}
            onChange={(e) => setAssetFilter(e.target.value || undefined)}
            className="h-[38px] rounded-full border border-border bg-surface px-3.5 text-[0.8125rem] text-text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <option value="">All pages</option>
            {(assetsQuery.data ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                @{a.handle}
              </option>
            ))}
          </select>

          <div className="flex items-center gap-1.5 rounded-full border border-border bg-surface px-3.5 h-[38px] text-[0.8125rem] text-text-faint">
            <input
              type="date"
              value={fromFilter}
              onChange={(e) => setFromFilter(e.target.value)}
              aria-label="From date"
              className="bg-transparent text-text-muted focus:outline-none"
            />
            <span>–</span>
            <input
              type="date"
              value={toFilter}
              onChange={(e) => setToFilter(e.target.value)}
              aria-label="To date"
              className="bg-transparent text-text-muted focus:outline-none"
            />
          </div>

          <div className="flex-1" />
          {canBulkInvoice && selectedIds.size > 0 && (
            <Button
              variant="secondary"
              size="sm"
              className="rounded-full"
              onClick={() => bulkInvoiceMutation.mutate()}
              disabled={bulkInvoiceMutation.isPending}
            >
              {bulkInvoiceMutation.isPending ? "Raising invoice…" : `Bulk invoice · ${selectedIds.size} selected`}
            </Button>
          )}
        </div>

        {bulkInvoiceMutation.isError && (
          <ErrorNotice message={bulkInvoiceMutation.error instanceof ApiError ? bulkInvoiceMutation.error.message : "Couldn't raise the invoice."} />
        )}

        <div className="flex min-h-0 flex-1 gap-5">
          <div className="flex-1 overflow-hidden rounded-lg border border-border bg-surface shadow-card">
            <div className="grid grid-cols-[28px_minmax(0,2.4fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1fr)_24px] gap-3 border-b border-border px-5 py-3.5">
              <div />
              <Th>Post</Th>
              <Th>Page</Th>
              <Th>Format</Th>
              <Th>Cost</Th>
              <Th>Engagement</Th>
              <Th>Status</Th>
              <div />
            </div>

            {filteredLinksQuery.isLoading ? (
              <TableSkeleton />
            ) : rows.length === 0 ? (
              <EmptyState label="No links match this filter yet." />
            ) : (
              <div>
                {rows.map((link) => {
                  const snapshot = link.postSnapshots?.[0];
                  const eligible = link.status === "INSIGHTS_APPROVED";
                  return (
                    <div
                      key={link.id}
                      onClick={() => setDetailId(link.id)}
                      className={cn(
                        "grid cursor-pointer grid-cols-[28px_minmax(0,2.4fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1fr)_24px] items-center gap-3 border-b border-border px-5 py-3.5 hover:bg-surface-2",
                        (link.id === detailId || (!detailId && link.id === rows[0]?.id)) && "bg-surface-2"
                      )}
                    >
                      <div
                        onClick={(e) => {
                          e.stopPropagation();
                          if (eligible && canBulkInvoice) toggleSelect(link.id);
                        }}
                        className={cn(
                          "flex h-4 w-4 items-center justify-center rounded-[5px] border-[1.5px] border-border-strong",
                          !eligible && "opacity-30"
                        )}
                      >
                        {selectedIds.has(link.id) && (
                          <div className="flex h-full w-full items-center justify-center rounded-[4px] bg-accent text-accent-ink">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" className="h-[11px] w-[11px]">
                              <path d="M20 6L9 17l-5-5" />
                            </svg>
                          </div>
                        )}
                      </div>
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="h-10 w-10 shrink-0 rounded-[9px] bg-gradient-to-br from-accent-soft to-accent-2-soft" />
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold">{link.campaign?.title ?? "—"}</div>
                          <div className="mt-0.5 truncate text-xs text-text-faint">{link.url}</div>
                        </div>
                      </div>
                      <div className="text-[0.8438rem] text-text-muted">@{link.asset?.handle ?? "—"}</div>
                      <div className="text-[0.8438rem] capitalize text-text-muted">{link.format}</div>
                      <div className="text-sm font-bold tabular-nums">{money(link.cost)}</div>
                      <div className="flex min-w-0 items-center gap-2.5 text-xs text-text-faint">
                        {snapshot ? (
                          <>
                            <span className="flex items-center gap-1">
                              <HeartIcon className="h-[13px] w-[13px]" /> {snapshot.likeCount.toLocaleString()}
                            </span>
                            <span className="flex items-center gap-1">
                              <MessageIcon className="h-[13px] w-[13px]" /> {snapshot.commentsCount.toLocaleString()}
                            </span>
                          </>
                        ) : (
                          <span>No metrics yet</span>
                        )}
                      </div>
                      <div>
                        <StatusPill status={link.status as PillStatus} />
                      </div>
                      <ChevronRightIcon className="h-3.5 w-3.5 text-text-faint" />
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {detailLink && (
            <LinkDetailPanel
              link={detailLink}
              token={token}
              isAdmin={user?.role === "ADMIN"}
              canUploadScreenshot={canSubmitLink}
              onChanged={() => {
                queryClient.invalidateQueries({ queryKey: ["links"] });
                queryClient.invalidateQueries({ queryKey: ["linkTimeline", detailLink.id] });
              }}
            />
          )}
        </div>
      </div>

      {showSubmitForm && (
        <UploadLinksModal
          token={token}
          campaigns={campaignsQuery.data ?? []}
          assets={assetsQuery.data ?? []}
          onClose={() => setShowSubmitForm(false)}
          onCreated={() => {
            setShowSubmitForm(false);
            queryClient.invalidateQueries({ queryKey: ["links"] });
          }}
        />
      )}
    </AppShell>
  );
}

function LinkDetailPanel({
  link,
  token,
  isAdmin,
  canUploadScreenshot,
  onChanged,
}: {
  link: Link;
  token: string;
  isAdmin: boolean;
  canUploadScreenshot: boolean;
  onChanged: () => void;
}) {
  const timelineQuery = useQuery({
    queryKey: ["linkTimeline", link.id],
    queryFn: () => linksApi.timeline(token, link.id),
  });

  const reviewMutation = useMutation({
    mutationFn: (approved: boolean) => linksApi.reviewScreenshot(token, link.id, approved),
    onSuccess: onChanged,
  });
  const approveInsightsMutation = useMutation({
    mutationFn: () => linksApi.approveInsights(token, link.id),
    onSuccess: onChanged,
  });
  const refreshMetricsMutation = useMutation({
    mutationFn: () => linksApi.refreshMetrics(token, link.id),
    onSuccess: onChanged,
  });

  const uploadScreenshotMutation = useMutation({
    mutationFn: async (file: File) => {
      const params = await screenshotsApi.requestUploadUrl(token, link.id);

      // Direct-to-Cloudinary signed upload — only the fields that were part
      // of the signature may be sent, or Cloudinary rejects it (server side,
      // see cloudinaryClient.js).
      const form = new FormData();
      form.append("file", file);
      form.append("api_key", params.apiKey);
      form.append("timestamp", String(params.timestamp));
      form.append("signature", params.signature);
      form.append("public_id", params.publicId);

      const uploadRes = await fetch(params.uploadUrl, { method: "POST", body: form });
      if (!uploadRes.ok) {
        throw new Error("Cloudinary rejected the upload — check the image and try again.");
      }

      return screenshotsApi.confirm(token, link.id, params.publicId);
    },
    onSuccess: onChanged,
  });

  const steps: TimelineStep[] = (timelineQuery.data ?? []).map((event, i, arr) => ({
    id: event.id,
    title: STATUS_LABEL[event.status] ?? event.status,
    time: new Date(event.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }),
    note: event.note,
    state: i === arr.length - 1 ? "current" : "done",
  }));

  return (
    <div className="flex w-[320px] shrink-0 flex-col gap-5 rounded-lg border border-border bg-surface p-6 shadow-card">
      <div className="h-[140px] rounded-[14px] bg-gradient-to-br from-accent-soft to-accent-2-soft" />
      <div>
        <p className="text-base font-bold">{link.campaign?.title ?? "—"}</p>
        <p className="mt-1 text-[0.8125rem] text-text-faint">@{link.asset?.handle} · {link.url}</p>
      </div>
      <div className="flex items-center justify-between border-t border-border pt-3">
        <span className="text-xs text-text-faint">Cost</span>
        <span className="text-[1.125rem] font-extrabold tabular-nums">{money(link.cost)}</span>
      </div>

      {timelineQuery.isLoading ? (
        <p className="text-[0.8125rem] text-text-faint">Loading timeline…</p>
      ) : (
        <StatusTimeline steps={steps.length > 0 ? steps : [{ title: STATUS_LABEL[link.status] ?? link.status, state: "current" }]} />
      )}

      {canUploadScreenshot && (link.status === "SUBMITTED" || link.status === "SCREENSHOT_REJECTED") && (
        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <label className="text-xs font-semibold text-text-faint">
            {link.status === "SCREENSHOT_REJECTED" ? "Re-upload proof screenshot" : "Upload proof screenshot"}
          </label>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={uploadScreenshotMutation.isPending}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) uploadScreenshotMutation.mutate(file);
              e.target.value = "";
            }}
            className="text-[0.8125rem] text-text-faint file:mr-3 file:rounded-md file:border-0 file:bg-accent file:px-3 file:py-2 file:text-[0.8125rem] file:font-bold file:text-accent-ink"
          />
          {uploadScreenshotMutation.isPending && <p className="text-[0.8125rem] text-text-faint">Uploading…</p>}
          {uploadScreenshotMutation.isError && (
            <ErrorNotice
              message={uploadScreenshotMutation.error instanceof ApiError ? uploadScreenshotMutation.error.message : "Couldn't upload the screenshot."}
            />
          )}
        </div>
      )}

      {isAdmin && link.status === "PENDING_SCREENSHOT_REVIEW" && (
        <div className="flex gap-2 border-t border-border pt-4">
          <Button size="sm" className="flex-1" onClick={() => reviewMutation.mutate(true)} disabled={reviewMutation.isPending}>
            Approve
          </Button>
          <Button variant="danger" size="sm" className="flex-1" onClick={() => reviewMutation.mutate(false)} disabled={reviewMutation.isPending}>
            Reject
          </Button>
        </div>
      )}
      {isAdmin && (link.status === "SCREENSHOT_APPROVED" || link.status === "INSIGHTS_PENDING") && (
        <div className="flex flex-col gap-2 border-t border-border pt-4">
          {link.status === "INSIGHTS_PENDING" && (
            <Button size="sm" className="w-full" onClick={() => approveInsightsMutation.mutate()} disabled={approveInsightsMutation.isPending}>
              Approve insights
            </Button>
          )}
          <Button
            size="sm"
            variant="secondary"
            className="w-full"
            onClick={() => refreshMetricsMutation.mutate()}
            disabled={refreshMetricsMutation.isPending}
          >
            {refreshMetricsMutation.isPending ? "Refreshing…" : "Refresh metrics"}
          </Button>
          {refreshMetricsMutation.data && !refreshMetricsMutation.data.ok && (
            <p className="text-[0.8125rem] text-rose">No data found for this URL — it may be dead, private, or invalid.</p>
          )}
          {refreshMetricsMutation.data?.ok && <p className="text-[0.8125rem] font-semibold text-accent">Metrics updated.</p>}
          {refreshMetricsMutation.isError && (
            <ErrorNotice
              message={refreshMetricsMutation.error instanceof ApiError ? refreshMetricsMutation.error.message : "Couldn't refresh metrics."}
            />
          )}
        </div>
      )}
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = {
  SUBMITTED: "Submitted",
  PENDING_SCREENSHOT_REVIEW: "Screenshot submitted",
  SCREENSHOT_REJECTED: "Screenshot rejected",
  SCREENSHOT_APPROVED: "Screenshot approved",
  INSIGHTS_PENDING: "Insights pending",
  INSIGHTS_APPROVED: "Insights approved",
  INVOICED: "Invoiced",
};
