"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { LinkDetailPanel } from "@/components/dashboard/link-detail-panel";
import { StatusPill, type PillStatus } from "@/components/ui/status-pill";
import { LinkIcon, CameraIcon, CheckCircleIcon, InvoiceIcon, AlertIcon, PlusIcon, ChevronRightIcon, HeartIcon, MessageIcon } from "@/components/icons";
import { Th, TableSkeleton, EmptyState, ErrorNotice } from "@/components/ui/table-parts";
import { UploadLinksModal } from "@/components/links/upload-links-modal";
import { useAuth } from "@/lib/auth-context";
import {
  links as linksApi,
  campaigns as campaignsApi,
  assets as assetsApi,
  invoices as invoicesApi,
  ApiError,
  INVOICEABLE_LINK_STATUSES,
} from "@/lib/api-client";
import { money, initialsOf, roleLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

// Matches kpis.approved's definition below (everything past screenshot
// review) — kept as one constant so the "Links approved" KPI tile and the
// dropdown option that mirrors it can't drift apart.
const APPROVED_GROUP_FILTER = "SCREENSHOT_APPROVED,INSIGHTS_PENDING,INSIGHTS_APPROVED,INVOICED";

const INVOICEABLE_STATUSES = new Set<string>(INVOICEABLE_LINK_STATUSES);

const STATUS_FILTERS: { label: string; value: string | undefined }[] = [
  { label: "All statuses", value: undefined },
  { label: "Submitted", value: "SUBMITTED" },
  { label: "Pending review", value: "PENDING_SCREENSHOT_REVIEW" },
  { label: "Screenshot approved", value: "SCREENSHOT_APPROVED" },
  { label: "Insights pending", value: "INSIGHTS_PENDING" },
  { label: "Insights approved", value: "INSIGHTS_APPROVED" },
  { label: "Invoiced", value: "INVOICED" },
  // Comma-separated — the server treats a status filter with a comma as an
  // "IN" match (see listLinks). Mirrors the "Links approved" KPI tile's
  // definition below: everything past screenshot review.
  { label: "Approved (all stages)", value: APPROVED_GROUP_FILTER },
];

/** A creator/team member's own link-tracking workspace — "My Works". */
export function CreatorDashboard() {
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
      uninvoiced: items.filter((l) => INVOICEABLE_STATUSES.has(l.status)).length,
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
  // Desktop's persistent side panel defaults to the first row; the mobile
  // sheet only ever opens on an explicit tap, so it has no such fallback.
  const detailLink = rows.find((l) => l.id === detailId) ?? rows[0];
  const mobileDetailLink = detailId ? rows.find((l) => l.id === detailId) : undefined;

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
      fab={
        canSubmitLink ? (
          <Button size="lg" className="h-14 rounded-full px-5 shadow-glow" onClick={() => setShowSubmitForm(true)}>
            <PlusIcon className="h-4 w-4 text-accent-ink" />
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

        {/* Horizontal-scroll strip on mobile, a 5-up grid at md+ — one render, the container switches layout. */}
        <div className="flex gap-3 overflow-x-auto pb-1 -mx-4 px-4 md:mx-0 md:grid md:grid-cols-5 md:gap-4 md:overflow-visible md:px-0 md:pb-0">
          <KpiCard
            className="w-[152px] shrink-0 md:w-auto"
            icon={LinkIcon}
            label="Links added"
            value={String(kpis.added)}
            onClick={() => setStatusFilter(undefined)}
            active={statusFilter === undefined}
          />
          <KpiCard
            className="w-[152px] shrink-0 md:w-auto"
            icon={CameraIcon}
            label="Pending screenshots"
            value={String(kpis.pendingScreenshots)}
            onClick={() => setStatusFilter("PENDING_SCREENSHOT_REVIEW")}
            active={statusFilter === "PENDING_SCREENSHOT_REVIEW"}
          />
          <KpiCard
            className="w-[152px] shrink-0 md:w-auto"
            icon={CheckCircleIcon}
            label="Links approved"
            value={String(kpis.approved)}
            onClick={() => setStatusFilter(APPROVED_GROUP_FILTER)}
            active={statusFilter === APPROVED_GROUP_FILTER}
          />
          <KpiCard
            className="w-[152px] shrink-0 md:w-auto"
            icon={InvoiceIcon}
            label="Links invoiced"
            value={String(kpis.invoiced)}
            onClick={() => setStatusFilter("INVOICED")}
            active={statusFilter === "INVOICED"}
          />
          <KpiCard
            className="w-[152px] shrink-0 md:w-auto"
            icon={AlertIcon}
            label="Uninvoiced links"
            value={String(kpis.uninvoiced)}
            tone={kpis.uninvoiced > 0 ? "indigo" : undefined}
            onClick={() => setStatusFilter("INSIGHTS_APPROVED")}
            active={statusFilter === "INSIGHTS_APPROVED"}
          />
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

        <div className="flex min-h-0 flex-1 flex-col gap-4 md:flex-row md:gap-5">
          <div className="hidden flex-1 overflow-hidden rounded-lg border border-border bg-surface shadow-card md:block">
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
                  const eligible = INVOICEABLE_STATUSES.has(link.status);
                  return (
                    <div
                      key={link.id}
                      onClick={() => setDetailId(link.id)}
                      className={cn(
                        // Selected row gets a clear green highlight (accent bg + left
                        // bar), not just a faint gray shade — the old bg-surface-2-only
                        // highlight was easy to miss when scanning the table.
                        "grid cursor-pointer grid-cols-[28px_minmax(0,2.4fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1fr)_24px] items-center gap-3 border-b border-l-[3px] border-border border-l-transparent px-5 py-3.5 transition-colors hover:bg-surface-2",
                        (link.id === detailId || (!detailId && link.id === rows[0]?.id)) && "border-l-accent bg-accent-soft hover:bg-accent-soft"
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

          {/* Mobile: cards instead of a table row — same data and the same
              tap-to-open-detail interaction, with the same select toggle for
              bulk invoicing. */}
          <div className="flex flex-col gap-3 md:hidden">
            {filteredLinksQuery.isLoading ? (
              <TableSkeleton />
            ) : rows.length === 0 ? (
              <EmptyState label="No links match this filter yet." />
            ) : (
              rows.map((link) => {
                const snapshot = link.postSnapshots?.[0];
                const eligible = link.status === "INSIGHTS_APPROVED";
                return (
                  <div
                    key={link.id}
                    onClick={() => setDetailId(link.id)}
                    className="flex flex-col gap-2.5 rounded-[14px] border border-border bg-surface p-3.5 shadow-card"
                  >
                    <div className="flex items-center gap-2.5">
                      <div
                        onClick={(e) => {
                          e.stopPropagation();
                          if (eligible && canBulkInvoice) toggleSelect(link.id);
                        }}
                        className={cn(
                          "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border-[1.5px] border-border-strong",
                          !eligible && "opacity-30"
                        )}
                      >
                        {selectedIds.has(link.id) && (
                          <div className="flex h-full w-full items-center justify-center rounded-[4px] bg-accent text-accent-ink">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" className="h-[10px] w-[10px]">
                              <path d="M20 6L9 17l-5-5" />
                            </svg>
                          </div>
                        )}
                      </div>
                      <div className="h-10 w-10 shrink-0 rounded-[10px] bg-gradient-to-br from-accent-soft to-accent-2-soft" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold">{link.campaign?.title ?? "—"}</div>
                        <div className="mt-0.5 truncate text-xs text-text-faint">{link.url}</div>
                      </div>
                      <ChevronRightIcon className="h-3.5 w-3.5 shrink-0 text-text-faint" />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[0.8125rem] capitalize text-text-muted">
                        @{link.asset?.handle ?? "—"} · {link.format}
                      </span>
                      <span className="text-sm font-bold tabular-nums">{money(link.cost)}</span>
                    </div>
                    <div className="flex items-center justify-between border-t border-border pt-2.5">
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
                      <StatusPill status={link.status as PillStatus} />
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Desktop: persistent side panel. */}
          <div className="hidden w-[320px] shrink-0 flex-col gap-5 rounded-lg border border-border bg-surface p-6 shadow-card md:flex">
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
      </div>

      {/* Mobile: detail opens as a bottom sheet — no room for a persistent panel. */}
      {mobileDetailLink && (
        <Sheet onClose={() => setDetailId(null)} overlayClassName="md:hidden" panelClassName="md:hidden">
          <div className="overflow-y-auto p-6 pt-1">
            <LinkDetailPanel
              link={mobileDetailLink}
              token={token}
              isAdmin={user?.role === "ADMIN"}
              canUploadScreenshot={canSubmitLink}
              onChanged={() => {
                queryClient.invalidateQueries({ queryKey: ["links"] });
                queryClient.invalidateQueries({ queryKey: ["linkTimeline", mobileDetailLink.id] });
              }}
            />
          </div>
        </Sheet>
      )}

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
