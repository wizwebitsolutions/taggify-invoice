"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { PageHeader } from "@/components/ui/page-header";
import { LinkDetailPanel } from "@/components/dashboard/link-detail-panel";
import { StatusPill, type PillStatus } from "@/components/ui/status-pill";
import { StatusSteps, statusHint } from "@/components/ui/status-steps";
import { Card, CardHeader, Thumb } from "@/components/ui/data-table";
import { FloatingBar, BarButton } from "@/components/ui/floating-bar";
import { PlusIcon, ChevronRightIcon, HeartIcon, MessageIcon, CloseIcon } from "@/components/icons";
import { TableSkeleton, EmptyState, ErrorNotice } from "@/components/ui/table-parts";
import { UploadLinksModal } from "@/components/links/upload-links-modal";
import { useAuth } from "@/lib/auth-context";
import { links as linksApi, campaigns as campaignsApi, assets as assetsApi, invoices as invoicesApi, ApiError, INVOICEABLE_LINK_STATUSES, type Link as LinkRow, canUse } from "@/lib/api-client";
import { money, count, initialsOf, roleLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

const APPROVED_GROUP_FILTER = "SCREENSHOT_APPROVED,INSIGHTS_PENDING,INSIGHTS_APPROVED,INVOICED";
const INVOICEABLE_STATUSES = new Set<string>(INVOICEABLE_LINK_STATUSES);
// Billable = an invoiceable status AND within the posts the campaign booked for
// the page (29 Sep) — an over-quota post is the creator's own extra and never
// billed, so it mustn't be counted, offered, or selected as ready to bill.
const isBillable = (l: Pick<LinkRow, "status" | "overQuota">) => INVOICEABLE_STATUSES.has(l.status) && !l.overQuota;

const STATUS_FILTERS: { label: string; value: string | undefined }[] = [
  { label: "All statuses", value: undefined },
  { label: "Submitted", value: "SUBMITTED" },
  { label: "Pending review", value: "PENDING_SCREENSHOT_REVIEW" },
  { label: "Screenshot approved", value: "SCREENSHOT_APPROVED" },
  { label: "Insights pending", value: "INSIGHTS_PENDING" },
  { label: "Insights approved", value: "INSIGHTS_APPROVED" },
  { label: "Invoiced", value: "INVOICED" },
  { label: "Approved (all stages)", value: APPROVED_GROUP_FILTER },
  { label: "Broken", value: "INVALID" },
];

const selectClass = "h-9 rounded-md border border-border bg-surface px-3 text-[0.8125rem] text-text-2 shadow-card focus:border-ink focus:outline-none focus:ring-[3px] focus:ring-ink-10";

/**
 * Creator home (premium mockup 12): "N posts ready to bill", one giant
 * primary action, two money tiles, then every post as a row with the
 * five-segment status line and a tag that says what to do next. Selecting
 * ready posts raises the dark floating bar to invoice them in one go.
 */
export function CreatorDashboard() {
  const { user, accessToken } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [assetFilter, setAssetFilter] = useState<string | undefined>(undefined);
  const [fromFilter, setFromFilter] = useState("");
  const [toFilter, setToFilter] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [detailId, setDetailId] = useState<string | null>(null);
  const [showSubmitForm, setShowSubmitForm] = useState(false);
  const token = accessToken!;

  // A section the admin switched off (24 Sep) isn't fetched at all — it would only 403.
  const canSeeLinks = canUse(user, "links.view");
  const allLinksQuery = useQuery({ queryKey: ["links", "all"], queryFn: () => linksApi.list(token, { pageSize: 100 }), enabled: canSeeLinks });
  const filteredLinksQuery = useQuery({
    queryKey: ["links", statusFilter ?? "all", assetFilter ?? "all", fromFilter, toFilter],
    queryFn: () => linksApi.list(token, { status: statusFilter, assetId: assetFilter, from: fromFilter || undefined, to: toFilter || undefined, pageSize: 100 }),
    enabled: canSeeLinks,
  });
  const invoicesQuery = useQuery({ queryKey: ["invoices", "creator-home"], queryFn: () => invoicesApi.list(token, { pageSize: 100 }), enabled: canUse(user, "finance.view") });
  const campaignsQuery = useQuery({ queryKey: ["campaigns"], queryFn: () => campaignsApi.list(token), enabled: canUse(user, "campaigns.view") });
  const assetsQuery = useQuery({ queryKey: ["assets"], queryFn: () => assetsApi.list(token), enabled: canUse(user, "inventory.view") });

  const kpis = useMemo(() => {
    const items = allLinksQuery.data?.items ?? [];
    return {
      added: allLinksQuery.data?.total ?? 0,
      pendingScreenshots: items.filter((l) => l.status === "PENDING_SCREENSHOT_REVIEW").length,
      approved: items.filter((l) => !["SUBMITTED", "PENDING_SCREENSHOT_REVIEW", "SCREENSHOT_REJECTED", "INVALID"].includes(l.status)).length,
      invoiced: items.filter((l) => l.status === "INVOICED").length,
      uninvoiced: items.filter(isBillable).length,
      readyAmount: items.filter(isBillable).reduce((s, l) => s + Number(l.cost), 0),
    };
  }, [allLinksQuery.data]);

  const moneyKpis = useMemo(() => {
    const invoices = invoicesQuery.data?.items ?? [];
    const open = invoices.filter((i) => i.status === "RAISED" || i.status === "APPROVED");
    const overdue = open.filter((i) => i.overdueDays > 0);
    const now = new Date();
    const paidThisMonth = invoices.filter((i) => i.status === "PAID" && new Date(i.paidAt ?? i.createdAt).getMonth() === now.getMonth() && new Date(i.paidAt ?? i.createdAt).getFullYear() === now.getFullYear());
    return {
      owed: open.reduce((s, i) => s + Number(i.amount), 0),
      openCount: open.length,
      overdueCount: overdue.length,
      paidMonth: paidThisMonth.reduce((s, i) => s + Number(i.amount), 0),
      paidCount: paidThisMonth.length,
    };
  }, [invoicesQuery.data]);

  const bulkInvoiceMutation = useMutation({
    mutationFn: (ids: string[]) => invoicesApi.bulkCreate(token, ids),
    onSuccess: () => {
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["links"] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
    },
  });

  const rows = filteredLinksQuery.data?.items ?? [];
  const detailLink = rows.find((l) => l.id === detailId) ?? null;

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  // Own-content switches (24 Sep) — an admin can turn invoicing or link submission off for a creator.
  const canBulkInvoice = (user?.role === "CREATOR" && canUse(user, "finance.edit")) || user?.role === "ADMIN";
  const canSubmitLink = (user?.role === "CREATOR" || user?.role === "TEAM_MEMBER") && canUse(user, "links.edit");
  const firstName = (user?.name ?? "there").split(" ")[0];
  const selectedTotal = rows.filter((l) => selectedIds.has(l.id)).reduce((s, l) => s + Number(l.cost), 0);
  const isFiltered = statusFilter !== undefined || assetFilter !== undefined || fromFilter || toFilter;

  const detailPanel = detailLink && (
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
  );

  return (
    <AppShell
      active="dashboard"
      user={{ initials: initialsOf(user?.name), name: user?.name ?? "—", role: roleLabel(user?.role), tone: user?.role === "FINANCE" ? "blue" : "emerald" }}
      searchPlaceholder="Search links, campaigns, pages…"
      topbarActions={
        canSubmitLink ? (
          <Button onClick={() => setShowSubmitForm(true)}>
            <PlusIcon className="h-4 w-4" />
            Upload links
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-5">
        <PageHeader
          title={
            <>
              Hi {firstName}, <span className="serif text-[1.15em]">{kpis.uninvoiced > 0 ? `${kpis.uninvoiced} post${kpis.uninvoiced === 1 ? "" : "s"} ready to bill.` : "all caught up."}</span>
            </>
          }
          subtitle={kpis.uninvoiced > 0 ? `${money(kpis.readyAmount)} of approved work is waiting to be invoiced.` : "Every submitted link, tracked from post to payout."}
        />

        {canSubmitLink && (
          <Button size="lg" className="w-full justify-center text-[1rem] md:hidden" onClick={() => setShowSubmitForm(true)}>
            <PlusIcon className="h-[18px] w-[18px]" />
            Submit a post link
          </Button>
        )}

        <div className="grid grid-cols-2 gap-3 md:grid-cols-5 md:gap-4">
          <KpiCard label="You're owed" value={money(moneyKpis.owed)} foot={moneyKpis.overdueCount > 0 ? `${moneyKpis.openCount} invoices · ${moneyKpis.overdueCount} overdue` : `${moneyKpis.openCount} open invoice${moneyKpis.openCount === 1 ? "" : "s"}`} tone={moneyKpis.overdueCount > 0 ? "rose" : undefined} onClick={() => router.push("/invoices")} />
          <KpiCard label="Paid this month" value={money(moneyKpis.paidMonth)} foot={`${moneyKpis.paidCount} invoice${moneyKpis.paidCount === 1 ? "" : "s"}`} onClick={() => router.push("/invoices?status=PAID")} />
          <KpiCard label="Links added" value={String(kpis.added)} onClick={() => setStatusFilter(undefined)} active={statusFilter === undefined} className="hidden md:flex" />
          <KpiCard label="Pending screenshots" value={String(kpis.pendingScreenshots)} onClick={() => setStatusFilter("PENDING_SCREENSHOT_REVIEW")} active={statusFilter === "PENDING_SCREENSHOT_REVIEW"} className="hidden md:flex" />
          <KpiCard label="Uninvoiced links" value={String(kpis.uninvoiced)} tone={kpis.uninvoiced > 0 ? "violet" : undefined} onClick={() => setStatusFilter("INSIGHTS_APPROVED")} active={statusFilter === "INSIGHTS_APPROVED"} className="hidden md:flex" />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_340px]">
          <Card className="flex flex-col" data-testid="creator-posts">
            <CardHeader
              title="Your posts"
              meta={<span className="text-[0.78rem] text-text-muted">{isFiltered ? `${rows.length} match` : `${kpis.added} tracked`}</span>}
              action={
                <div className="flex flex-wrap items-center gap-2">
                  <select value={statusFilter ?? ""} onChange={(e) => setStatusFilter(e.target.value || undefined)} aria-label="Filter by status" className={selectClass}>
                    {STATUS_FILTERS.map((f) => (
                      <option key={f.label} value={f.value ?? ""}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                  <select value={assetFilter ?? ""} onChange={(e) => setAssetFilter(e.target.value || undefined)} aria-label="Filter by page" className={cn(selectClass, "hidden sm:block")}>
                    <option value="">All pages</option>
                    {(assetsQuery.data ?? []).map((a) => (
                      <option key={a.id} value={a.id}>
                        @{a.handle}
                      </option>
                    ))}
                  </select>
                  <div className={cn(selectClass, "hidden items-center gap-1.5 text-text-faint md:flex")}>
                    <input type="date" value={fromFilter} onChange={(e) => setFromFilter(e.target.value)} aria-label="From date" className="bg-transparent text-text-2 focus:outline-none" />
                    <span>–</span>
                    <input type="date" value={toFilter} onChange={(e) => setToFilter(e.target.value)} aria-label="To date" className="bg-transparent text-text-2 focus:outline-none" />
                  </div>
                </div>
              }
            />
            {bulkInvoiceMutation.isError && (
              <div className="px-[18px] pt-3">
                <ErrorNotice message={bulkInvoiceMutation.error instanceof ApiError ? bulkInvoiceMutation.error.message : "Couldn't raise the invoice."} />
              </div>
            )}
            {filteredLinksQuery.isLoading ? (
              <TableSkeleton />
            ) : rows.length === 0 ? (
              <EmptyState label="No links match this filter yet." />
            ) : (
              <ul className="flex flex-col">
                {rows.map((link, i) => (
                  <PostRow
                    key={link.id}
                    link={link}
                    index={i}
                    selected={selectedIds.has(link.id)}
                    active={detailId === link.id}
                    canSelect={canBulkInvoice && isBillable(link)}
                    onToggle={() => toggleSelect(link.id)}
                    onOpen={() => setDetailId(link.id)}
                    onRaise={canBulkInvoice ? () => bulkInvoiceMutation.mutate([link.id]) : undefined}
                    raising={bulkInvoiceMutation.isPending}
                  />
                ))}
              </ul>
            )}
          </Card>

          <div className="hidden lg:block">
            {detailLink ? (
              <Card className="flex flex-col">
                <CardHeader
                  title={`@${detailLink.asset?.handle ?? "—"} · ${detailLink.format}`}
                  action={
                    <button type="button" onClick={() => setDetailId(null)} aria-label="Close post details" className="text-text-faint hover:text-text">
                      <CloseIcon className="h-4 w-4" />
                    </button>
                  }
                />
                <div className="p-[18px]">{detailPanel}</div>
              </Card>
            ) : (
              <Card className="p-8 text-center text-[0.8125rem] text-text-muted">Select a post to see its proof, timeline and cost history.</Card>
            )}
          </div>
        </div>
      </div>

      {canBulkInvoice && selectedIds.size > 0 && (
        <FloatingBar label={`${selectedIds.size} post${selectedIds.size === 1 ? "" : "s"} selected`} meta={money(selectedTotal)} onClear={() => setSelectedIds(new Set())} testId="bulk-invoice-bar">
          <BarButton primary onClick={() => bulkInvoiceMutation.mutate([...selectedIds])} disabled={bulkInvoiceMutation.isPending}>
            {bulkInvoiceMutation.isPending ? "Raising invoice…" : "Bulk invoice"}
          </BarButton>
        </FloatingBar>
      )}

      {detailLink && (
        <Sheet onClose={() => setDetailId(null)} overlayClassName="lg:hidden" panelClassName="lg:hidden">
          <div className="overflow-y-auto p-6 pt-1">{detailPanel}</div>
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

function PostRow({ link, index, selected, active, canSelect, onToggle, onOpen, onRaise, raising }: { link: LinkRow; index: number; selected: boolean; active: boolean; canSelect: boolean; onToggle: () => void; onOpen: () => void; onRaise?: () => void; raising: boolean }) {
  const hint = statusHint(link.status);
  const snapshot = link.postSnapshots?.[0];
  // "Ready" mirrors the server's invoiceable set (minus the two states where the creator still owes proof).
  const needsCreator = link.status === "SUBMITTED" || link.status === "SCREENSHOT_REJECTED";
  const ready = !needsCreator && isBillable(link);
  return (
    <li
      className={cn("flex cursor-pointer items-center gap-3 border-b border-border px-[18px] py-3 transition-colors last:border-b-0 hover:bg-[#fbfbfc] motion-safe:animate-reveal-up dark:hover:bg-surface-2", active && "bg-surface-2")}
      style={{ animationDelay: `${0.2 + index * 0.04}s` }}
      onClick={onOpen}
      tabIndex={0}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
          e.preventDefault();
          onOpen();
        }
      }}
      data-testid="post-row"
    >
      {canSelect ? (
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Select ${link.campaign?.title ?? "post"} for invoicing`}
          className="h-4 w-4 shrink-0 rounded accent-[var(--ink)]"
        />
      ) : (
        <span className="hidden h-4 w-4 shrink-0 md:block" />
      )}
      <Thumb src={null} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[0.8375rem] font-semibold">@{link.asset?.handle ?? "—"} · {link.format}</span>
          <span className="hidden truncate text-[0.78rem] text-text-muted sm:inline">{link.campaign?.title ?? "—"}</span>
          {link.overQuota && (
            <span
              className="shrink-0 rounded-full border border-rose/30 bg-rose-soft px-2 py-px text-[0.68rem] font-medium text-rose"
              title="More posts than the campaign booked for this page — only the booked number count, so this one won't be paid."
              data-testid="over-quota-badge"
            >
              Over limit · not paid
            </span>
          )}
        </div>
        <StatusSteps status={link.status} animate={false} />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[0.75rem]">
          <span className={cn("font-medium", hint.tone === "bad" && "text-rose", hint.tone === "ok" && "text-accent", hint.tone === "wait" && "text-accent-2", hint.tone === "neutral" && "text-text-muted")}>{hint.text}</span>
          {snapshot && (
            <span className="hidden items-center gap-2 text-text-muted md:flex">
              <span className="flex items-center gap-1">
                <HeartIcon className="h-3 w-3" /> {count(snapshot.likeCount)}
              </span>
              <span className="flex items-center gap-1">
                <MessageIcon className="h-3 w-3" /> {count(snapshot.commentsCount)}
              </span>
            </span>
          )}
          <span className="hidden text-text-muted md:inline">{money(link.cost)}</span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="hidden lg:inline-flex">
          <StatusPill status={link.status as PillStatus} />
        </span>
        {ready && onRaise ? (
          <Button
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onRaise();
            }}
            disabled={raising}
          >
            Raise invoice
          </Button>
        ) : needsCreator ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={(e) => {
              e.stopPropagation();
              onOpen();
            }}
          >
            {link.status === "SCREENSHOT_REJECTED" ? "Re-upload proof" : "Upload proof"}
          </Button>
        ) : (
          <ChevronRightIcon className="h-4 w-4 text-text-faint" />
        )}
      </div>
    </li>
  );
}
