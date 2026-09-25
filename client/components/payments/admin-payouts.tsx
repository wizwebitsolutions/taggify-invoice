"use client";

import { Fragment, useEffect, useMemo, useState, type ComponentType } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Sheet } from "@/components/ui/sheet";
import { StatusPill } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";
import { TableSkeleton, ErrorNotice } from "@/components/ui/table-parts";
import { ArrowRightIcon, CheckCircleIcon, ChevronDownIcon, ChevronRightIcon, ClockIcon, DownloadIcon, InvoiceIcon, WalletIcon } from "@/components/icons";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { LinkDetailPanel } from "@/components/dashboard/link-detail-panel";
import { PaySheet, shortDate } from "@/components/payments/pay-sheet";
import {
  PaymentsFilterBar,
  DEFAULT_FILTERS,
  toApiFilters,
  useDebounced,
  currentMonthKey,
  periodRange,
  periodLabel,
  type FilterState,
} from "@/components/payments/payments-filters";
import { payments as paymentsApi, assets as assetsApi, ApiError, type Link, type PageOwner, type Payout, type PendingLink } from "@/lib/api-client";
import { money, compactNumber, initialsOf, personLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Payments → Internal · creator payouts (24 Sep redesign). List-first: the
 * Pending tab shows every payable link across vendors, filterable by vendor,
 * page and month; pick one vendor's links and pay them from a single screen.
 * Paid shows each payout made with its links, tax split and receipt. A link
 * that's been paid (or sits on an unfinished draft) never shows on Pending.
 */
export function AdminPayouts({ token }: { token: string }) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"pending" | "paid">("pending");
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const debouncedQ = useDebounced(filters.q);
  const apiFilters = toApiFilters(filters, debouncedQ);

  const ownersQuery = useQuery({ queryKey: ["asset-owners"], queryFn: () => assetsApi.owners(token) });
  const pendingQuery = useQuery({ queryKey: ["payments", "pending", apiFilters], queryFn: () => paymentsApi.listPending(token, apiFilters) });
  const paidQuery = useQuery({
    queryKey: ["payments", "paid", apiFilters],
    queryFn: () => paymentsApi.listPayouts(token, { ...apiFilters, creatorId: apiFilters.ownerId, status: "PAID", pageSize: 100 }),
  });
  // Unfinished payouts, regardless of filters — their links are locked off
  // Pending until someone attaches the receipt or cancels.
  const draftsQuery = useQuery({ queryKey: ["payments", "drafts"], queryFn: () => paymentsApi.listPayouts(token, { status: "DRAFT", pageSize: 100 }) });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["payments"] });
    queryClient.invalidateQueries({ queryKey: ["links"] });
  };

  // The summary tiles are filter-independent: everything still owed, and this calendar month's payouts.
  const monthKey = currentMonthKey();
  const monthRange = periodRange({ kind: "month", month: monthKey });
  const allPendingQuery = useQuery({ queryKey: ["payments", "pending", {}], queryFn: () => paymentsApi.listPending(token, {}) });
  const monthPaidQuery = useQuery({
    queryKey: ["payments", "paid-month", monthKey],
    queryFn: () => paymentsApi.listPayouts(token, { status: "PAID", ...monthRange, pageSize: 100 }),
  });

  const pending = pendingQuery.data?.items ?? [];
  const paid = paidQuery.data?.items ?? [];
  const allPending = allPendingQuery.data?.items ?? [];
  const monthPaid = monthPaidQuery.data?.items ?? [];
  const monthLabel = periodLabel({ kind: "month", month: monthKey });
  const sum = <T,>(xs: T[], pick: (x: T) => string | number) => xs.reduce((s, x) => s + Number(pick(x)), 0);

  return (
    <div className="flex flex-col gap-5">
      <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 md:mx-0 md:grid md:grid-cols-3 md:gap-4 md:overflow-visible md:px-0 md:pb-0" data-testid="payments-kpis">
        <KpiCard
          className="w-[190px] shrink-0 md:w-auto"
          icon={ClockIcon}
          label="Pending payout"
          value={money(sum(allPending, (l) => l.cost))}
          foot={
            (allPendingQuery.data?.total ?? 0) > allPending.length
              ? `Latest ${allPending.length} of ${allPendingQuery.data?.total} links — filter to see the rest`
              : `${allPending.length} link${allPending.length === 1 ? "" : "s"} · ${new Set(allPending.map((l) => l.asset.ownerId)).size} page owners`
          }
          tone={allPending.length > 0 ? "violet" : undefined}
          active={tab === "pending"}
          onClick={() => setTab("pending")}
        />
        <KpiCard
          className="w-[190px] shrink-0 md:w-auto"
          icon={CheckCircleIcon}
          label={`Paid in ${monthLabel}`}
          value={money(sum(monthPaid, (p) => p.netAmount))}
          foot={
            (monthPaidQuery.data?.total ?? 0) > monthPaid.length
              ? `Latest ${monthPaid.length} of ${monthPaidQuery.data?.total} payouts`
              : `${monthPaid.length} payout${monthPaid.length === 1 ? "" : "s"}`
          }
          active={tab === "paid" && filters.period.kind === "month" && filters.period.month === monthKey}
          onClick={() => {
            setTab("paid");
            setFilters({ ...DEFAULT_FILTERS, period: { kind: "month", month: monthKey } });
          }}
        />
        <KpiCard
          className="w-[190px] shrink-0 md:w-auto"
          icon={InvoiceIcon}
          label={`TDS withheld · ${monthLabel}`}
          value={money(sum(monthPaid, (p) => p.tdsAmount))}
          foot={`GST paid ${money(sum(monthPaid, (p) => p.gstAmount))}`}
        />
      </div>

      <div role="tablist" aria-label="Payout status" className="flex gap-6 border-b border-border">
        {(
          [
            ["pending", "Pending", pendingQuery.data?.total],
            ["paid", "Paid", paidQuery.data?.total],
          ] as const
        ).map(([key, label, total]) => (
          <button
            key={key}
            role="tab"
            type="button"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={cn(
              "-mb-px flex items-center gap-2 border-b-2 pb-3 pt-1 text-[0.875rem] transition-colors",
              tab === key ? "border-ink font-medium text-text" : "border-transparent text-text-muted hover:text-text"
            )}
          >
            {label}
            {total !== undefined && (
              <span className={cn("rounded-full px-[7px] py-px text-[0.6875rem] tabular-nums", tab === key ? "bg-ink text-ink-fg" : "bg-surface-2 text-text-2")}>{total}</span>
            )}
          </button>
        ))}
      </div>

      <PaymentsFilterBar
        state={filters}
        onChange={setFilters}
        owners={ownersQuery.data}
        dateLabel={tab === "pending" ? "Posted in" : "Paid in"}
        summary={tab === "pending" ? pendingSummary(pending) : paidSummary(paid)}
      />
      <TruncationNote shown={tab === "pending" ? pending.length : paid.length} total={tab === "pending" ? pendingQuery.data?.total : paidQuery.data?.total} />

      {tab === "pending" ? (
        <PendingTab
          token={token}
          links={pending}
          isLoading={pendingQuery.isLoading}
          error={pendingQuery.error}
          drafts={draftsQuery.data?.items ?? []}
          owners={ownersQuery.data ?? []}
          // Unfiltered, Pending is a list of page owners only (24 Sep) — each
          // opens to its links. Narrowed to a vendor or a page, the links show
          // straight away.
          autoExpand={!!filters.ownerId || !!debouncedQ.trim()}
          onChanged={invalidate}
        />
      ) : (
        <PaidTab payouts={paid} isLoading={paidQuery.isLoading} error={paidQuery.error} />
      )}
    </div>
  );
}

/** Friendlier empty state for the payments lists — an icon, a short title, one line of help. */
export function PaymentsEmpty({ icon: Icon, title, text }: { icon: ComponentType<{ className?: string }>; title: string; text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-8 py-12 text-center" data-testid="payments-empty">
      <span className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-surface-2 text-text-muted">
        <Icon className="h-5 w-5" />
      </span>
      <p className="text-[0.9375rem] font-semibold">{title}</p>
      <p className="max-w-[44ch] text-[0.8125rem] text-text-muted">{text}</p>
    </div>
  );
}

/** Summaries add up what's loaded (500 pending links / 100 payouts) — say so when the server has more, rather than show a quietly short total. */
export function TruncationNote({ shown, total }: { shown: number; total: number | undefined }) {
  if (total === undefined || total <= shown) return null;
  return (
    <p className="-mt-2 text-[0.75rem] text-accent-2" data-testid="truncation-note">
      Showing the latest {shown} of {total} — narrow the filters (vendor, page or month) to see the rest and get exact totals.
    </p>
  );
}

function pendingSummary(links: PendingLink[]) {
  const vendors = new Set(links.map((l) => l.asset.ownerId)).size;
  const total = links.reduce((s, l) => s + Number(l.cost), 0);
  return `${links.length} link${links.length === 1 ? "" : "s"} · ${vendors} vendor${vendors === 1 ? "" : "s"} · ${money(total)}`;
}

function paidSummary(payouts: Payout[]) {
  const net = payouts.reduce((s, p) => s + Number(p.netAmount), 0);
  const tds = payouts.reduce((s, p) => s + Number(p.tdsAmount), 0);
  return `${payouts.length} payout${payouts.length === 1 ? "" : "s"} · ${money(net)} paid · ${money(tds)} TDS withheld`;
}

/** Latest scraped views, or null — Apify reports -1 for "unknown". */
export function viewsOf(link: Pick<Link, "postSnapshots">) {
  const v = link.postSnapshots?.[0]?.videoViews;
  return typeof v === "number" && v >= 0 ? v : null;
}

const PENDING_COLS = "md:grid-cols-[20px_minmax(0,2.2fr)_minmax(0,1.1fr)_minmax(0,0.7fr)_minmax(0,0.7fr)_minmax(0,0.9fr)_minmax(0,0.8fr)_16px]";

function PendingTab({
  token,
  links,
  isLoading,
  error,
  drafts,
  owners,
  autoExpand,
  onChanged,
}: {
  token: string;
  links: PendingLink[];
  isLoading: boolean;
  error: unknown;
  drafts: Payout[];
  owners: PageOwner[];
  autoExpand: boolean;
  onChanged: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Owners the user flipped away from the default (collapsed, or expanded
  // under autoExpand). Reset whenever that default changes.
  const [flipped, setFlipped] = useState<Set<string>>(new Set());
  useEffect(() => setFlipped(new Set()), [autoExpand]);
  const isOpen = (ownerId: string) => autoExpand !== flipped.has(ownerId);
  const toggleOpen = (ownerId: string) =>
    setFlipped((prev) => {
      const next = new Set(prev);
      next.has(ownerId) ? next.delete(ownerId) : next.add(ownerId);
      return next;
    });
  const [detail, setDetail] = useState<PendingLink | null>(null);
  // The vendor being paid, captured when the sheet opens — so removing the
  // last link shows the sheet's "no links left" state instead of unmounting
  // it and leaving the page stuck in "paying".
  const [payingVendor, setPayingVendor] = useState<PageOwner | null>(null);
  const [resuming, setResuming] = useState<Payout | null>(null);

  const groups = useMemo(() => {
    const byOwner = new Map<string, { owner: PageOwner; links: PendingLink[] }>();
    for (const link of links) {
      const ownerId = link.asset.ownerId;
      if (!byOwner.has(ownerId)) {
        const owner = link.asset.owner ?? owners.find((o) => o.id === ownerId) ?? { id: ownerId, name: null, phoneNumber: null };
        byOwner.set(ownerId, { owner, links: [] });
      }
      byOwner.get(ownerId)!.links.push(link);
    }
    return [...byOwner.values()];
  }, [links, owners]);

  // Anything no longer on the list (filtered out, or paid meanwhile) drops out of the selection.
  const chosen = links.filter((l) => selected.has(l.id));
  const vendorId = chosen[0]?.asset.ownerId ?? null;

  // One vendor per payout: picking another vendor's link starts a fresh selection.
  function toggle(link: PendingLink) {
    setSelected((prev) => {
      const sameVendor = vendorId === null || vendorId === link.asset.ownerId;
      const next = sameVendor ? new Set([...prev].filter((id) => links.some((l) => l.id === id))) : new Set<string>();
      next.has(link.id) ? next.delete(link.id) : next.add(link.id);
      return next;
    });
  }
  function toggleGroup(groupLinks: PendingLink[]) {
    const allIn = groupLinks.every((l) => selected.has(l.id));
    setSelected(allIn ? new Set() : new Set(groupLinks.map((l) => l.id)));
  }
  /** "Select [N] of M" (24 Sep): the vendor's first N links in list order; any other vendor's selection is dropped. */
  function selectFirst(groupLinks: PendingLink[], n: number) {
    const count = Math.max(0, Math.min(Number.isFinite(n) ? Math.floor(n) : 0, groupLinks.length));
    setSelected(new Set(groupLinks.slice(0, count).map((l) => l.id)));
  }

  const cancelDraft = useMutation({ mutationFn: (id: string) => paymentsApi.cancelPayout(token, id), onSuccess: onChanged });

  return (
    <>
      {drafts.map((d) => (
        <div
          key={d.id}
          className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-accent-2-line bg-accent-2-soft px-3.5 py-2.5 text-[0.8125rem] text-text-2"
          data-testid="draft-payout-banner"
        >
          <ClockIcon className="h-4 w-4 shrink-0 text-accent-2" />
          <span className="min-w-0 flex-1">
            <b className="font-semibold">Waiting for a receipt:</b> {personLabel(d.creator)} · {d.items?.length ?? 0} link
            {(d.items?.length ?? 0) === 1 ? "" : "s"} · {money(d.netAmount)}. Its links stay off this list until it&rsquo;s finished or cancelled.
          </span>
          <button type="button" onClick={() => setResuming(d)} className="font-medium text-blue hover:underline">
            Attach receipt
          </button>
          <button type="button" onClick={() => cancelDraft.mutate(d.id)} disabled={cancelDraft.isPending} className="font-medium text-rose hover:underline disabled:opacity-50">
            Cancel payout
          </button>
        </div>
      ))}
      {cancelDraft.isError && <ErrorNotice message={cancelDraft.error instanceof ApiError ? cancelDraft.error.message : "Couldn't cancel that payout."} />}

      <section className="overflow-hidden rounded-lg border border-border bg-surface shadow-card" data-testid="pending-list">
        <div className={cn("hidden gap-3.5 border-b border-border px-5 py-3", groups.some((g) => isOpen(g.owner.id)) ? "md:grid" : "", PENDING_COLS)}>
          <span />
          {["Post · campaign", "Page", "Format", "Posted", "Status"].map((h) => (
            <span key={h} className="text-[0.72rem] font-medium tracking-[0.02em] text-text-muted">
              {h}
            </span>
          ))}
          <span className="text-right text-[0.72rem] font-medium tracking-[0.02em] text-text-muted">Cost</span>
          <span />
        </div>
        {!groups.some((g) => isOpen(g.owner.id)) && (
          <div className="hidden items-center gap-3.5 border-b border-border px-5 py-3 md:flex">
            <span className="w-4" />
            <span className="text-[0.72rem] font-medium tracking-[0.02em] text-text-muted">Page owner</span>
            <span className="ml-auto pr-[34px] text-[0.72rem] font-medium tracking-[0.02em] text-text-muted">Pending</span>
          </div>
        )}

        {isLoading ? (
          <TableSkeleton />
        ) : error ? (
          <div className="p-5">
            <ErrorNotice message={error instanceof ApiError ? error.message : "Couldn't load pending links."} />
          </div>
        ) : groups.length === 0 ? (
          <PaymentsEmpty icon={CheckCircleIcon} title="All caught up" text="Nothing pending for these filters — every matching link has been paid or invoiced." />
        ) : (
          groups.map((group) => {
            const allIn = group.links.every((l) => selected.has(l.id));
            const pages = new Set(group.links.map((l) => l.assetId)).size;
            const name = personLabel(group.owner);
            const open = isOpen(group.owner.id);
            const groupSelected = group.links.filter((l) => selected.has(l.id));
            const groupTotal = group.links.reduce((s, l) => s + Number(l.cost), 0);
            return (
              <Fragment key={group.owner.id}>
                <div className={cn("flex flex-wrap items-center gap-x-3.5 gap-y-2 border-b border-border px-5 py-3", open ? "bg-surface-2" : "hover:bg-surface-2")} data-testid="pending-vendor-group">
                  <input
                    type="checkbox"
                    aria-label={`Select all of ${name}'s links`}
                    checked={allIn}
                    onChange={() => toggleGroup(group.links)}
                    className="h-4 w-4 shrink-0 accent-[var(--ink)]"
                  />
                  <button type="button" aria-expanded={open} onClick={() => toggleOpen(group.owner.id)} className="group flex min-w-0 items-center gap-3 text-left">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[0.75rem] font-semibold text-text-2 ring-1 ring-inset ring-border">
                      {initialsOf(name)}
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-[0.875rem] font-semibold group-hover:underline">{name}</span>
                      <span className="flex flex-wrap items-center gap-1.5 text-[0.72rem] text-text-muted">
                        <span className="rounded-full border border-border bg-surface px-1.5 py-px tabular-nums">
                          {pages} page{pages === 1 ? "" : "s"}
                        </span>
                        <span className="rounded-full border border-border bg-surface px-1.5 py-px tabular-nums">
                          {group.links.length} link{group.links.length === 1 ? "" : "s"}
                        </span>
                        <span className="hidden text-text-faint sm:inline">{group.owner.email ?? group.owner.phoneNumber}</span>
                      </span>
                    </span>
                  </button>
                  <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-x-3 gap-y-1.5">
                    {/* "Select [N] of M" as a stepper (24 Sep): type a number or tap −/+. */}
                    <div className="flex items-center gap-1.5 text-[0.75rem] text-text-muted">
                      <span className="hidden sm:inline">Select</span>
                      <div className="flex h-8 items-center overflow-hidden rounded-md border border-border-strong bg-surface shadow-card">
                        <button
                          type="button"
                          aria-label={`One fewer of ${name}'s links`}
                          disabled={groupSelected.length === 0}
                          onClick={() => selectFirst(group.links, groupSelected.length - 1)}
                          className="flex h-full w-7 items-center justify-center text-text-2 hover:bg-surface-2 disabled:opacity-40"
                        >
                          −
                        </button>
                        <input
                          type="number"
                          inputMode="numeric"
                          min={0}
                          max={group.links.length}
                          placeholder="0"
                          aria-label={`Number of ${name}'s links to select`}
                          value={groupSelected.length || ""}
                          onChange={(e) => {
                            if (e.target.value === "" && e.target.validity.badInput) return;
                            selectFirst(group.links, Number(e.target.value));
                          }}
                          className="h-full w-9 border-x border-border bg-transparent text-center text-[0.8125rem] font-medium tabular-nums text-text [appearance:textfield] focus:outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                        />
                        <button
                          type="button"
                          aria-label={`One more of ${name}'s links`}
                          disabled={groupSelected.length >= group.links.length}
                          onClick={() => selectFirst(group.links, groupSelected.length + 1)}
                          className="flex h-full w-7 items-center justify-center text-text-2 hover:bg-surface-2 disabled:opacity-40"
                        >
                          +
                        </button>
                      </div>
                      <span className="tabular-nums">of {group.links.length}</span>
                    </div>
                    <span className="text-[0.8438rem] tabular-nums" data-testid="vendor-amount">
                      {groupSelected.length > 0 ? (
                        <>
                          <b className="font-semibold">{money(groupSelected.reduce((s, l) => s + Number(l.cost), 0))}</b>
                          <span className="text-text-faint"> of {money(groupTotal)}</span>
                        </>
                      ) : (
                        <b className="font-semibold">{money(groupTotal)}</b>
                      )}
                    </span>
                    {/* Pay lives on the vendor's own row (24 Sep) — only while some of their links are selected. */}
                    {groupSelected.length > 0 && (
                      <Button size="sm" onClick={() => setPayingVendor(group.owner)} data-testid="pay-vendor">
                        Pay {name.split(" ")[0]} · {groupSelected.length} <ArrowRightIcon className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-label={`${open ? "Hide" : "Show"} ${name}'s links`}
                    onClick={() => toggleOpen(group.owner.id)}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-text-muted hover:border-border-strong hover:text-text"
                  >
                    <ChevronDownIcon className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
                  </button>
                </div>
                {open && group.links.map((link) => {
                  const on = selected.has(link.id);
                  const otherVendor = vendorId !== null && vendorId !== link.asset.ownerId;
                  return (
                    <div
                      key={link.id}
                      data-testid="pending-row"
                      className={cn(
                        "grid grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-x-3.5 gap-y-1 border-b border-border px-5 py-3 transition-colors md:gap-y-0",
                        PENDING_COLS,
                        on ? "bg-surface-2" : "hover:bg-surface-2",
                        otherVendor && "opacity-60"
                      )}
                    >
                      <input
                        type="checkbox"
                        aria-label={`Select ${link.campaign?.title ?? "link"} on @${link.asset.handle}`}
                        checked={on}
                        onChange={() => toggle(link)}
                        className="h-4 w-4 accent-[var(--ink)]"
                      />
                      <button type="button" onClick={() => setDetail(link)} className="flex min-w-0 flex-col text-left">
                        <span className="truncate text-[0.8438rem] font-medium hover:underline">{link.campaign?.title ?? "—"}</span>
                        <span className="truncate text-[0.72rem] text-text-faint">
                          <span className="md:hidden">
                            @{link.asset.handle} · <span className="capitalize">{link.format}</span> ·{" "}
                          </span>
                          {link.url.replace(/^https?:\/\/(www\.)?/, "")}
                        </span>
                      </button>
                      <span className="hidden truncate text-[0.8125rem] text-text-2 md:block">@{link.asset.handle}</span>
                      <span className="hidden text-[0.8125rem] capitalize text-text-2 md:block">{link.format}</span>
                      <span className="hidden text-[0.8125rem] text-text-2 md:block" title={link.postedAt ? "Posted" : "Not posted yet — submitted date"}>
                        {shortDate(link.postedAt ?? link.createdAt)}
                        {!link.postedAt && <span className="text-text-faint">*</span>}
                      </span>
                      <span className="hidden md:block">
                        <StatusPill status={link.status} />
                      </span>
                      <span className="text-right text-[0.8438rem] font-semibold tabular-nums">{money(link.cost)}</span>
                      <button type="button" aria-label="Open link details" onClick={() => setDetail(link)} className="hidden text-text-faint hover:text-text md:block">
                        <ChevronRightIcon className="h-4 w-4" />
                      </button>
                    </div>
                  );
                })}
              </Fragment>
            );
          })
        )}
      </section>
      {links.some((l) => !l.postedAt) && <p className="-mt-2 text-[0.72rem] text-text-faint">* Not posted yet — showing the date it was submitted.</p>}


      {payingVendor && (
        <PaySheet
          mode="new"
          token={token}
          vendor={payingVendor}
          links={chosen}
          onRemoveLink={(id) =>
            setSelected((prev) => {
              const next = new Set(prev);
              next.delete(id);
              return next;
            })
          }
          onClose={() => setPayingVendor(null)}
          onPaid={() => {
            setPayingVendor(null);
            setSelected(new Set());
            onChanged();
          }}
        />
      )}

      {resuming && (
        <PaySheet
          mode="draft"
          token={token}
          payout={resuming}
          onClose={() => setResuming(null)}
          onPaid={() => {
            setResuming(null);
            onChanged();
          }}
        />
      )}

      {detail && (
        <Sheet onClose={() => setDetail(null)} panelClassName="md:max-w-[520px]">
          <div className="flex flex-col gap-4 overflow-y-auto p-6 pt-1" data-testid="payments-link-detail">
            <div>
              <p className="text-[0.75rem] text-text-muted">
                {detail.campaign?.title ?? "—"} · {personLabel(detail.asset.owner, "")}
              </p>
              <h2 className="text-[1.125rem] font-semibold tracking-[-0.02em]">
                @{detail.asset.handle} · <span className="capitalize">{detail.format}</span>
              </h2>
              <p className="mt-1 text-[0.8125rem] text-accent-2">Not paid yet · in Pending</p>
            </div>
            <LinkDetailPanel link={detail} token={token} isAdmin={false} canUploadScreenshot={false} onChanged={onChanged} />
          </div>
        </Sheet>
      )}
    </>
  );
}

const PAID_COLS = "md:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)_minmax(0,1.3fr)_minmax(0,0.4fr)_minmax(0,0.8fr)_minmax(0,0.7fr)_minmax(0,0.8fr)_minmax(0,0.9fr)_minmax(0,0.6fr)_16px]";

function PaidTab({ payouts, isLoading, error }: { payouts: Payout[]; isLoading: boolean; error: unknown }) {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-surface shadow-card" data-testid="paid-list">
      <div className={cn("hidden gap-3.5 border-b border-border px-5 py-3 md:grid", PAID_COLS)}>
        {["Paid on", "Vendor", "Pages", "Links", "Subtotal", "GST", "TDS", "Net paid", "Receipt"].map((h) => (
          <span key={h} className="text-[0.72rem] font-medium tracking-[0.02em] text-text-muted">
            {h}
          </span>
        ))}
        <span />
      </div>
      {isLoading ? (
        <TableSkeleton />
      ) : error ? (
        <div className="p-5">
          <ErrorNotice message={error instanceof ApiError ? error.message : "Couldn't load payouts."} />
        </div>
      ) : payouts.length === 0 ? (
        <PaymentsEmpty icon={WalletIcon} title="No payouts yet" text="Payouts show up here once a receipt is attached. Try another month or clear the filters." />
      ) : (
        payouts.map((p) => {
          const expanded = open === p.id;
          const pages = [...new Set((p.items ?? []).map((i) => i.link.asset?.handle).filter(Boolean))];
          return (
            <div key={p.id} className="border-b border-border" data-testid="paid-row">
              <div className={cn("grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3.5 px-5 py-3.5", PAID_COLS)}>
                <span className="text-[0.8125rem] tabular-nums text-text-2">{p.paidAt ? shortDate(p.paidAt) : "—"}</span>
                <button type="button" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : p.id)} className="flex min-w-0 flex-col text-left">
                  <span className="truncate text-[0.8438rem] font-medium hover:underline">{personLabel(p.creator)}</span>
                  <span className="truncate text-[0.72rem] text-text-faint">by {p.markedPaidBy?.name ?? p.createdBy?.name ?? "—"}</span>
                </button>
                <span className="hidden truncate text-[0.8125rem] text-text-2 md:block">{pages.map((h) => `@${h}`).join(", ") || "—"}</span>
                <span className="hidden text-[0.8125rem] tabular-nums text-text-2 md:block">{p.items?.length ?? 0}</span>
                <span className="hidden text-[0.8125rem] tabular-nums text-text-2 md:block">{money(p.subtotal)}</span>
                <span className="hidden text-[0.8125rem] tabular-nums text-text-2 md:block">{p.isGstInvoice ? money(p.gstAmount) : "—"}</span>
                <span className="hidden text-[0.8125rem] tabular-nums text-text-2 md:block">{p.tdsPercent ? `${Number(p.tdsPercent)}% · −${money(p.tdsAmount)}` : "—"}</span>
                <span className="text-right text-[0.9rem] font-semibold tabular-nums md:text-left">{money(p.netAmount)}</span>
                <span className="hidden md:block">
                  {p.receipt?.url ? (
                    <a href={p.receipt.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[0.75rem] font-semibold text-blue hover:underline">
                      <DownloadIcon className="h-3.5 w-3.5" /> View
                    </a>
                  ) : (
                    <span className="text-[0.75rem] text-text-faint">—</span>
                  )}
                </span>
                <button type="button" aria-expanded={expanded} aria-label={expanded ? "Hide links" : "Show links"} onClick={() => setOpen(expanded ? null : p.id)} className="hidden text-text-faint md:block">
                  <ChevronRightIcon className={cn("h-4 w-4 transition-transform", expanded && "rotate-90")} />
                </button>
              </div>
              {expanded && (
                <div className="bg-surface-2 px-5 pb-4 pt-1" data-testid="paid-row-links">
                  <div className="flex flex-wrap gap-x-5 gap-y-1 py-2 text-[0.75rem] text-text-muted">
                    <span>{p.utr ? `UTR ${p.utr}` : "No UTR recorded"}</span>
                    <span>{p.isGstInvoice ? `GST 18% · ${money(p.gstAmount)}` : "No GST"}</span>
                    <span>{p.tdsPercent ? `TDS ${Number(p.tdsPercent)}% · −${money(p.tdsAmount)}` : "No TDS"}</span>
                    {p.receipt?.url && (
                      <a href={p.receipt.url} target="_blank" rel="noreferrer" className="font-semibold text-blue hover:underline md:hidden">
                        View receipt
                      </a>
                    )}
                  </div>
                  <div className="overflow-hidden rounded-[10px] border border-border bg-surface">
                    {(p.items ?? []).map((item) => {
                      const views = viewsOf(item.link);
                      return (
                        <div key={item.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border px-4 py-2.5 text-[0.8125rem] last:border-b-0 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,0.6fr)_minmax(0,0.6fr)_minmax(0,0.6fr)_minmax(0,0.6fr)]">
                          <a href={item.link.url} target="_blank" rel="noreferrer" className="truncate font-medium text-text hover:underline">
                            {item.link.campaign?.title ?? item.link.url}
                          </a>
                          <span className="hidden text-text-2 md:block">@{item.link.asset?.handle ?? "—"}</span>
                          <span className="hidden capitalize text-text-2 md:block">{item.link.format}</span>
                          <span className="hidden text-text-2 md:block">{item.link.postedAt ? shortDate(item.link.postedAt) : "—"}</span>
                          <span className="hidden tabular-nums text-text-2 md:block">{views === null ? "—" : compactNumber(views)}</span>
                          <span className="text-right font-semibold tabular-nums">{money(item.amount)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })
      )}
    </section>
  );
}
