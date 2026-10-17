"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { Sheet } from "@/components/ui/sheet";
import { StatusPill } from "@/components/ui/status-pill";
import { TableSkeleton, ErrorNotice } from "@/components/ui/table-parts";
import { CheckCircleIcon, ChevronRightIcon, DownloadIcon, WalletIcon } from "@/components/icons";
import { LinkDetailPanel } from "@/components/dashboard/link-detail-panel";
import { shortDate } from "@/components/payments/pay-sheet";
import { viewsOf, paidRowView } from "@/components/payments/admin-payouts";
import { pendingFoot, paidFoot } from "@/components/payments/summary-tiles";
import { PaymentsFilterBar, DEFAULT_FILTERS, toApiFilters, useDebounced, periodLabel, type FilterState } from "@/components/payments/payments-filters";
import NextLink from "next/link";
import { TruncationNote, PaymentsEmpty } from "@/components/payments/admin-payouts";
import { payments as paymentsApi, ApiError, type PaidLedgerRow, type PendingLink } from "@/lib/api-client";
import { money, compactNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { formatLabel } from "@/lib/formats";

/**
 * A creator's own Payments view (24 Sep redesign): Pending (their verified
 * links not paid yet) and Paid (each payout Taggify made them, with the
 * GST/TDS split and the receipt). Same page + month filters as Finance's
 * view, minus the vendor filter — it's always them. The server scopes both
 * reads to pages the caller owns.
 */
export function CreatorPayments({ token }: { token: string }) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"pending" | "paid">("pending");
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const debouncedQ = useDebounced(filters.q);
  const { ownerId: _ignored, ...apiFilters } = toApiFilters(filters, debouncedQ);

  const pendingQuery = useQuery({ queryKey: ["payments", "me", "pending", apiFilters], queryFn: () => paymentsApi.listMyPending(token, apiFilters) });
  const paidQuery = useQuery({ queryKey: ["payments", "me", "paid", apiFilters], queryFn: () => paymentsApi.listMyPaid(token, apiFilters) });

  // Tiles (2 Oct): Pending and Paid for the filters picked below — choose a month and both show that month.
  const summaryQuery = useQuery({ queryKey: ["payments", "me", "summary", apiFilters], queryFn: () => paymentsApi.mySummary(token, apiFilters) });
  const summary = summaryQuery.data;

  const pending = pendingQuery.data?.items ?? [];
  const paid = paidQuery.data?.items ?? [];
  const pendingTotal = pending.reduce((s, l) => s + Number(l.cost), 0);
  // TDS only ever exists on a real Payout — a legacy standalone-paid invoice row never had it withheld.
  const receivedTotal = paid.reduce((s, r) => s + Number(paidRowView(r).net), 0);
  const tdsTotal = paid.reduce((s, r) => s + Number(paidRowView(r).tds?.amount ?? 0), 0);

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3" data-testid="creator-payments-kpis">
        {(
          [
            ["pending", `Pending · ${periodLabel(filters.period)}`, summary?.pending.amount, pendingFoot(summary?.pending)],
            ["paid", `Paid · ${periodLabel(filters.period)}`, summary?.paid.amount, paidFoot(summary?.paid)],
          ] as const
        ).map(([key, label, value, foot]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            aria-pressed={tab === key}
            className={cn("flex flex-col justify-start rounded-lg border bg-surface p-3.5 text-left shadow-card transition-colors", tab === key ? "border-ink" : "border-border hover:border-border-strong")}
          >
            <p className="text-[0.75rem] text-text-muted">{label}</p>
            <p className="text-[1.25rem] font-semibold tabular-nums tracking-[-0.02em]">{money(value ?? 0)}</p>
            <p className="text-[0.72rem] text-text-faint">{foot}</p>
          </button>
        ))}
      </div>

      <div role="tablist" aria-label="Payout status" className="grid w-full grid-cols-2 rounded-[10px] bg-surface-2 p-[3px] sm:w-[320px]">
        {(
          [
            ["pending", "Pending", pendingQuery.data?.total],
            ["paid", "Paid", paidQuery.data?.total],
          ] as const
        ).map(([key, label, total]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={cn(
              "flex h-9 items-center justify-center gap-1.5 rounded-[8px] text-[0.8438rem] transition-colors",
              tab === key ? "bg-surface font-medium text-text shadow-card" : "text-text-muted hover:text-text"
            )}
          >
            {label}
            {total !== undefined && <span className="text-[0.72rem] tabular-nums text-text-muted">{total}</span>}
          </button>
        ))}
      </div>

      <PaymentsFilterBar state={filters} onChange={setFilters} dateLabel={tab === "pending" ? "Posted in" : "Paid in"} searchPlaceholder="Search your pages" />
      <TruncationNote shown={tab === "pending" ? pending.length : paid.length} total={tab === "pending" ? pendingQuery.data?.total : paidQuery.data?.total} />

      {tab === "pending" ? (
        <>
          <div className="flex flex-col gap-2.5 rounded-lg bg-ink p-4 text-ink-fg md:max-w-[520px]" data-testid="creator-pending-summary">
            <span className="text-[0.78rem] text-ink-fg opacity-70">Awaiting payout</span>
            <span className="text-[1.75rem] font-semibold tabular-nums tracking-[-0.03em]">{money(pendingTotal)}</span>
            <span className="border-t border-white/15 pt-2.5 text-[0.78rem] text-ink-fg opacity-80">
              {pending.length} link{pending.length === 1 ? "" : "s"} · amounts before GST/TDS — the final split shows once Taggify pays you
            </span>
          </div>
          <p className="-mt-2 text-[0.75rem] text-text-muted">
            Links you&rsquo;ve billed on your own invoice aren&rsquo;t listed here, but their amount is in your dues — track those under{" "}
            <NextLink href="/invoices" className="font-medium text-blue hover:underline">
              Invoices
            </NextLink>
            .
          </p>
          <CreatorPendingList token={token} links={pending} isLoading={pendingQuery.isLoading} error={pendingQuery.error} onChanged={() => queryClient.invalidateQueries({ queryKey: ["payments"] })} />
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:max-w-[520px]">
            <div className="rounded-lg border border-border bg-surface p-3.5 shadow-card">
              <p className="text-[0.75rem] text-text-muted">Received</p>
              <p className="text-[1.25rem] font-semibold tabular-nums tracking-[-0.02em]">{money(receivedTotal)}</p>
            </div>
            <div className="rounded-lg border border-border bg-surface p-3.5 shadow-card">
              <p className="text-[0.75rem] text-text-muted">TDS withheld</p>
              <p className="text-[1.25rem] font-semibold tabular-nums tracking-[-0.02em]">{money(tdsTotal)}</p>
            </div>
          </div>
          <CreatorPaidList rows={paid} isLoading={paidQuery.isLoading} error={paidQuery.error} />
        </>
      )}
    </div>
  );
}

function CreatorPendingList({
  token,
  links,
  isLoading,
  error,
  onChanged,
}: {
  token: string;
  links: PendingLink[];
  isLoading: boolean;
  error: unknown;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<PendingLink | null>(null);
  const pages = useMemo(() => {
    const byPage = new Map<string, PendingLink[]>();
    for (const l of links) byPage.set(l.asset.handle, [...(byPage.get(l.asset.handle) ?? []), l]);
    return [...byPage.entries()];
  }, [links]);

  if (isLoading) return <TableSkeleton rows={3} />;
  if (error) return <ErrorNotice message={error instanceof ApiError ? error.message : "Couldn't load your pending links."} />;
  if (links.length === 0) return <PaymentsEmpty icon={CheckCircleIcon} title="Nothing awaiting payout" text="Every verified link on your pages has been paid — or none match these filters." />;

  return (
    <div className="grid gap-5 lg:grid-cols-2" data-testid="creator-pending-list">
      {pages.map(([handle, pageLinks]) => (
        <div key={handle} className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between px-0.5">
            <span className="text-[0.8438rem] font-semibold">@{handle}</span>
            <span className="text-[0.78rem] text-text-muted">
              {pageLinks.length} link{pageLinks.length === 1 ? "" : "s"} · {money(pageLinks.reduce((s, l) => s + Number(l.cost), 0))}
            </span>
          </div>
          {pageLinks.map((l) => {
            const views = viewsOf(l);
            return (
              <button
                key={l.id}
                type="button"
                onClick={() => setDetail(l)}
                data-testid="creator-pending-row"
                className="flex items-center gap-3 rounded-lg border border-border bg-surface px-3.5 py-3 text-left shadow-card transition-colors hover:border-border-strong"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-[0.8438rem] font-medium">{l.campaign?.title ?? "—"}</span>
                  <span className="text-[0.75rem] capitalize text-text-faint">
                    {formatLabel(l.format)} · {l.postedAt ? shortDate(l.postedAt) : `submitted ${shortDate(l.createdAt)}`}
                    {views !== null && ` · ${compactNumber(views)} views`}
                  </span>
                  <span className="mt-1 w-fit rounded-full border border-accent-2-line bg-accent-2-soft px-2 py-px text-[0.6875rem] font-medium text-accent-2">Awaiting payout</span>
                </span>
                <span className="text-[0.875rem] font-semibold tabular-nums">{money(l.cost)}</span>
                <ChevronRightIcon className="h-4 w-4 shrink-0 text-text-faint" />
              </button>
            );
          })}
        </div>
      ))}

      {detail && (
        <Sheet onClose={() => setDetail(null)} panelClassName="md:max-w-[520px]">
          <div className="flex flex-col gap-4 overflow-y-auto p-6 pt-1">
            <div>
              <p className="text-[0.75rem] text-text-muted">{detail.campaign?.title ?? "—"}</p>
              <h2 className="text-[1.125rem] font-semibold tracking-[-0.02em]">
                @{detail.asset.handle} · <span>{formatLabel(detail.format)}</span>
              </h2>
              <div className="mt-1 flex items-center gap-2 text-[0.8125rem]">
                <StatusPill status={detail.status} />
                <span className="text-accent-2">Awaiting payout · {money(detail.cost)}</span>
              </div>
            </div>
            <LinkDetailPanel link={detail} token={token} isAdmin={false} canUploadScreenshot={false} onChanged={onChanged} />
          </div>
        </Sheet>
      )}
    </div>
  );
}

function CreatorPaidList({ rows, isLoading, error }: { rows: PaidLedgerRow[]; isLoading: boolean; error: unknown }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  if (isLoading) return <TableSkeleton rows={3} />;
  if (error) return <ErrorNotice message={error instanceof ApiError ? error.message : "Couldn't load your payouts."} />;
  if (rows.length === 0) return <PaymentsEmpty icon={WalletIcon} title="No payouts yet" text="When Taggify pays you, each payout shows here with its GST/TDS split and receipt." />;

  return (
    <div className="grid gap-4 lg:grid-cols-2" data-testid="creator-paid-list">
      {rows.map((row, i) => {
        const v = paidRowView(row);
        // The newest payment opens expanded; the rest start collapsed.
        const expanded = open.has(v.id) !== (i === 0);
        const pages = [...new Set(v.items.map((it) => it.link.asset?.handle).filter(Boolean))];
        const toggle = () =>
          setOpen((prev) => {
            const next = new Set(prev);
            next.has(v.id) ? next.delete(v.id) : next.add(v.id);
            return next;
          });
        return (
          <article key={v.id} className="overflow-hidden rounded-lg border border-border bg-surface shadow-card" data-testid="creator-payout-card">
            <div className="flex items-start justify-between gap-3 p-3.5">
              <div className="flex flex-col gap-0.5">
                <span className="text-[0.75rem] text-text-faint">Paid {v.paidAt ? new Date(v.paidAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : ""}</span>
                <span className="text-[1.375rem] font-semibold tabular-nums tracking-[-0.02em]">{money(v.net)}</span>
                <span className="text-[0.78rem] text-text-muted">
                  {pages.map((h) => `@${h}`).join(", ")} · {v.items.length} link{v.items.length === 1 ? "" : "s"}
                </span>
              </div>
              <StatusPill status="PAID" />
            </div>
            {expanded && (
              <>
                <div className="mx-3.5 flex flex-col gap-1.5 border-t border-border py-3 text-[0.8125rem] text-text-2">
                  <div className="flex justify-between">
                    <span>Subtotal</span>
                    <span className="tabular-nums">{money(v.subtotal)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>GST</span>
                    <span className="tabular-nums">{v.gstShown ? `+${money(v.gstAmount)}` : "—"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>{v.tds ? `TDS ${v.tds.percent}% withheld` : "TDS"}</span>
                    <span className="tabular-nums">{v.tds ? `−${money(v.tds.amount)}` : "—"}</span>
                  </div>
                  <div className="flex justify-between font-semibold text-text">
                    <span>Received</span>
                    <span className="tabular-nums">{money(v.net)}</span>
                  </div>
                </div>
                <div className="mx-3.5 border-t border-border">
                  {v.items.map((item) => (
                    <div key={item.id} className="flex items-center justify-between gap-3 border-b border-border py-2 text-[0.8125rem] last:border-b-0">
                      <a href={item.link.url} target="_blank" rel="noreferrer" className="min-w-0 truncate font-medium text-text hover:underline">
                        {item.link.campaign?.title ?? item.link.url}
                        <span className="font-normal text-text-faint"> · {formatLabel(item.link.format)}</span>
                      </a>
                      <span className="tabular-nums">{money(item.amount)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
            <div className="flex items-center justify-between gap-3 border-t border-border bg-surface-2 px-3.5 py-2.5">
              <span className="flex flex-col">
                <button type="button" onClick={toggle} aria-expanded={expanded} className="w-fit text-[0.8125rem] font-medium text-blue hover:underline">
                  {expanded ? "Hide breakdown" : "Show breakdown"}
                </button>
                {v.utr && <span className="text-[0.72rem] text-text-faint">UTR {v.utr}</span>}
              </span>
              {v.receiptUrl ? (
                <a
                  href={v.receiptUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border-strong bg-surface px-3 text-[0.8125rem] font-medium text-text shadow-card hover:bg-surface-2"
                >
                  <DownloadIcon className="h-3.5 w-3.5" /> Receipt
                </a>
              ) : (
                v.legacy && <span className="text-[0.72rem] text-text-faint">No receipt on file yet</span>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
