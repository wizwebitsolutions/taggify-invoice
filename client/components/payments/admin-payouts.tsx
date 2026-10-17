"use client";

import { Fragment, useEffect, useMemo, useState, type ComponentType } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Sheet } from "@/components/ui/sheet";
import { StatusPill } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";
import { TableSkeleton, ErrorNotice } from "@/components/ui/table-parts";
import { ArrowRightIcon, CheckCircleIcon, ChevronDownIcon, ChevronRightIcon, ClockIcon, DownloadIcon, WalletIcon } from "@/components/icons";
import { LinkDetailPanel } from "@/components/dashboard/link-detail-panel";
import { PaySheet, shortDate } from "@/components/payments/pay-sheet";
import { SummaryTiles } from "@/components/payments/summary-tiles";
import { InvoiceReceiptUpload } from "@/components/payments/invoice-receipt-upload";
import {
  PaymentsFilterBar,
  DEFAULT_FILTERS,
  toApiFilters,
  useDebounced,
  type FilterState,
} from "@/components/payments/payments-filters";
import {
  payments as paymentsApi,
  assets as assetsApi,
  ApiError,
  type Link,
  type PageOwner,
  type PaymentInvoice,
  type Payout,
  type PendingLink,
  type PaidLedgerRow,
} from "@/lib/api-client";
import { money, compactNumber, initialsOf, personLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { formatLabel } from "@/lib/formats";

/**
 * Payments → Internal · creator payouts (24 Sep redesign). List-first: the
 * Pending tab shows every payable link across vendors, filterable by vendor,
 * page and month; pick one vendor's links and pay them from a single screen.
 * Paid shows each payout made with its links, tax split and receipt. A link
 * that's been paid (or sits on an unfinished draft) never shows on Pending.
 *
 * 25 Sep: creator-raised invoices sit in the same list (paid whole, alongside
 * unbilled links).
 *
 * 2 Oct: the old "falls due 30 days after posting" tiles (Due this month /
 * 30+ days) are gone — an unpaid link is pending. 3 Oct: the tiles are Total
 * dues / Dues for a month / Paid for a month — see SummaryTiles.
 *
 * 28 Sep: paying an invoice off directly (no receipt, no TDS) was removed —
 * every invoice payment now goes through this same PaySheet, so a paid
 * invoice always ends up in the Paid tab's merged ledger (a real Payout, or —
 * for invoices paid the old way before this fix — a legacy standalone row).
 * The Invoices sub-tab below only ever shows what's still owed; the old
 * Due/Paid/All switch is gone since "Paid"/"All" would just duplicate the
 * Paid tab now.
 */
export function AdminPayouts({ token }: { token: string }) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"pending" | "invoices" | "paid">("pending");
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const debouncedQ = useDebounced(filters.q);
  const apiFilters = toApiFilters(filters, debouncedQ);

  const ownersQuery = useQuery({ queryKey: ["asset-owners"], queryFn: () => assetsApi.owners(token) });
  // One read covers both the Pending and Invoices tabs — listPendingLinks
  // always returns unbilled links (`items`) and owed invoices (`invoices`)
  // together now that "paid"/"all" invoice filtering moved to the Paid tab.
  const pendingQuery = useQuery({
    queryKey: ["payments", "pending", apiFilters],
    queryFn: () => paymentsApi.listPending(token, apiFilters),
  });
  const paidQuery = useQuery({
    queryKey: ["payments", "paid", apiFilters],
    queryFn: () => paymentsApi.listPaid(token, { ...apiFilters, creatorId: apiFilters.ownerId }),
  });
  // Unfinished payouts, regardless of filters — their links are locked off
  // Pending until someone attaches the receipt or cancels.
  const draftsQuery = useQuery({ queryKey: ["payments", "drafts"], queryFn: () => paymentsApi.listPayouts(token, { status: "DRAFT", pageSize: 100 }) });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["payments"] });
    queryClient.invalidateQueries({ queryKey: ["links"] });
  };

  const pending = pendingQuery.data?.items ?? [];
  const pendingInvoices = pendingQuery.data?.invoices ?? [];
  const paid = paidQuery.data?.items ?? [];

  return (
    <div className="flex flex-col gap-5">
      <SummaryTiles
        testId="payments-kpis"
        queryKey={["payments", "summary"]}
        filters={{ ownerId: apiFilters.ownerId, q: apiFilters.q }}
        load={(f) => paymentsApi.summary(token, f)}
      />

      <div role="tablist" aria-label="Payout status" className="flex gap-6 border-b border-border">
        {(
          [
            ["pending", "Pending", pendingQuery.data?.total],
            ["invoices", "Invoices", pendingQuery.data ? pendingInvoices.length : undefined],
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
        dateLabel={tab === "pending" ? "Posted in" : tab === "invoices" ? "Raised in" : "Paid in"}
        summary={tab === "pending" ? pendingSummary(pending, []) : tab === "invoices" ? pendingSummary([], pendingInvoices) : paidSummary(paid)}
      />
      <TruncationNote
        shown={tab === "paid" ? paid.length : tab === "invoices" ? pendingInvoices.length : pending.length}
        total={tab === "paid" ? paidQuery.data?.total : tab === "pending" ? pendingQuery.data?.total : undefined}
      />

      {tab !== "paid" ? (
        <PendingTab
          key={tab}
          token={token}
          mode={tab}
          links={tab === "pending" ? pending : []}
          invoices={tab === "invoices" ? pendingInvoices : []}
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
        <PaidTab rows={paid} isLoading={paidQuery.isLoading} error={paidQuery.error} onChanged={invalidate} token={token} />
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

function pendingSummary(links: PendingLink[], invoices: PaymentInvoice[]) {
  const vendors = new Set([...links.map((l) => l.asset.ownerId), ...invoices.map((i) => i.creatorId)]).size;
  const owed = invoices.filter((i) => i.status !== "PAID");
  const total = links.reduce((s, l) => s + Number(l.cost), 0) + owed.reduce((s, i) => s + Number(i.amount), 0);
  const inv = invoices.length ? ` · ${invoices.length} invoice${invoices.length === 1 ? "" : "s"}` : "";
  return `${links.length} link${links.length === 1 ? "" : "s"}${inv} · ${vendors} vendor${vendors === 1 ? "" : "s"} · ${money(total)} owed`;
}

function paidSummary(rows: PaidLedgerRow[]) {
  // TDS only ever exists on a real Payout — a legacy standalone-paid invoice
  // (rows[].kind === "invoice") never had it withheld, so it contributes 0.
  const net = rows.reduce((s, r) => s + Number(r.kind === "payout" ? r.payout.netAmount : r.invoice.amount), 0);
  const tds = rows.reduce((s, r) => s + Number(r.kind === "payout" ? r.payout.tdsAmount : 0), 0);
  return `${rows.length} payment${rows.length === 1 ? "" : "s"} · ${money(net)} paid · ${money(tds)} TDS withheld`;
}

/** Latest scraped views, or null — Apify reports -1 for "unknown". */
export function viewsOf(link: Pick<Link, "postSnapshots">) {
  const v = link.postSnapshots?.[0]?.videoViews;
  return typeof v === "number" && v >= 0 ? v : null;
}

const PENDING_COLS = "md:grid-cols-[20px_minmax(0,2.2fr)_minmax(0,1.1fr)_minmax(0,0.7fr)_minmax(0,0.7fr)_minmax(0,0.9fr)_minmax(0,0.8fr)_16px]";

function PendingTab({
  token,
  mode,
  links,
  invoices,
  isLoading,
  error,
  drafts,
  owners,
  autoExpand,
  onChanged,
}: {
  token: string;
  mode: "pending" | "invoices";
  links: PendingLink[];
  invoices: PaymentInvoice[];
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

  // Selection keys: "l:<linkId>" for an unbilled link, "i:<invoiceId>" for a raised invoice (paid whole).
  const [openInvoices, setOpenInvoices] = useState<Set<string>>(new Set());
  const groups = useMemo(() => {
    const byOwner = new Map<string, { owner: PageOwner; links: PendingLink[]; invoices: PaymentInvoice[] }>();
    const ownerOf = (ownerId: string, fromRow?: PageOwner | null) => {
      if (!byOwner.has(ownerId)) {
        const owner = fromRow ?? owners.find((o) => o.id === ownerId) ?? { id: ownerId, name: null, phoneNumber: null };
        byOwner.set(ownerId, { owner, links: [], invoices: [] });
      }
      return byOwner.get(ownerId)!;
    };
    for (const link of links) ownerOf(link.asset.ownerId, link.asset.owner).links.push(link);
    for (const inv of invoices) ownerOf(inv.creatorId, inv.creator).invoices.push(inv);
    return [...byOwner.values()];
  }, [links, invoices, owners]);

  /** Everything in a group that can be ticked: unbilled links, and owed invoices — a paid invoice never is. */
  const selectableOf = (g: { links: PendingLink[]; invoices: PaymentInvoice[] }) => [
    ...g.links.map((l) => ({ key: `l:${l.id}`, amount: Number(l.cost) })),
    ...g.invoices.filter((i) => i.selectable).map((i) => ({ key: `i:${i.id}`, amount: Number(i.amount) })),
  ];
  const validKeys = useMemo(() => new Set(groups.flatMap(selectableOf).map((e) => e.key)), [groups]);

  // Anything no longer on the list (filtered out, or paid meanwhile) drops out of the selection.
  const chosenLinks = links.filter((l) => selected.has(`l:${l.id}`));
  const chosenInvoices = invoices.filter((i) => i.selectable && selected.has(`i:${i.id}`));
  const vendorId = chosenLinks[0]?.asset.ownerId ?? chosenInvoices[0]?.creatorId ?? null;

  // One vendor per payout: picking another vendor's row starts a fresh selection.
  function toggle(key: string, ownerId: string) {
    setSelected((prev) => {
      const sameVendor = vendorId === null || vendorId === ownerId;
      const next = sameVendor ? new Set([...prev].filter((k) => validKeys.has(k))) : new Set<string>();
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }
  function toggleGroup(group: { links: PendingLink[]; invoices: PaymentInvoice[] }) {
    const keys = selectableOf(group).map((e) => e.key);
    const allIn = keys.length > 0 && keys.every((k) => selected.has(k));
    setSelected(allIn ? new Set() : new Set(keys));
  }
  /** "Select [N] of M" (24 Sep): the vendor's first N payable rows in list order (links, then invoices); any other vendor's selection is dropped. */
  function selectFirst(group: { links: PendingLink[]; invoices: PaymentInvoice[] }, n: number) {
    const keys = selectableOf(group).map((e) => e.key);
    const count = Math.max(0, Math.min(Number.isFinite(n) ? Math.floor(n) : 0, keys.length));
    setSelected(new Set(keys.slice(0, count)));
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
          <PaymentsEmpty icon={CheckCircleIcon} title="All caught up" text={mode === "invoices" ? "No invoices for these filters." : "Nothing pending for these filters — every uninvoiced link has been paid out."} />
        ) : (
          groups.map((group) => {
            const selectable = selectableOf(group);
            const allIn = selectable.length > 0 && selectable.every((e) => selected.has(e.key));
            const pages = new Set(group.links.map((l) => l.assetId)).size;
            const name = personLabel(group.owner);
            const noun = mode === "invoices" ? "invoices" : "links";
            const open = isOpen(group.owner.id);
            const groupSelected = selectable.filter((e) => selected.has(e.key));
            const groupTotal = selectable.reduce((s, e) => s + e.amount, 0);
            return (
              <Fragment key={group.owner.id}>
                <div className={cn("flex flex-wrap items-center gap-x-3.5 gap-y-2 border-b border-border px-5 py-3", open ? "bg-surface-2" : "hover:bg-surface-2")} data-testid="pending-vendor-group">
                  <input
                    type="checkbox"
                    aria-label={`Select all of ${name}'s ${noun}`}
                    checked={allIn}
                    disabled={selectable.length === 0}
                    onChange={() => toggleGroup(group)}
                    className="h-4 w-4 shrink-0 accent-[var(--ink)] disabled:opacity-40"
                  />
                  <button type="button" aria-expanded={open} onClick={() => toggleOpen(group.owner.id)} className="group flex min-w-0 items-center gap-3 text-left">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[0.75rem] font-semibold text-text-2 ring-1 ring-inset ring-border">
                      {initialsOf(name)}
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-[0.875rem] font-semibold group-hover:underline">{name}</span>
                      <span className="flex flex-wrap items-center gap-1.5 text-[0.72rem] text-text-muted">
                        {group.links.length > 0 && (
                          <>
                            <span className="rounded-full border border-border bg-surface px-1.5 py-px tabular-nums">
                              {pages} page{pages === 1 ? "" : "s"}
                            </span>
                            <span className="rounded-full border border-border bg-surface px-1.5 py-px tabular-nums">
                              {group.links.length} link{group.links.length === 1 ? "" : "s"}
                            </span>
                          </>
                        )}
                        {group.invoices.length > 0 && (
                          <span className="rounded-full border border-border bg-surface px-1.5 py-px tabular-nums">
                            {group.invoices.length} invoice{group.invoices.length === 1 ? "" : "s"}
                          </span>
                        )}
                        <span className="hidden text-text-faint sm:inline">{group.owner.email ?? group.owner.phoneNumber}</span>
                      </span>
                    </span>
                  </button>
                  <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-x-3 gap-y-1.5">
                    {/* "Select [N] of M" as a stepper (24 Sep): type a number or tap −/+. */}
                    {selectable.length > 0 && (
                      <div className="flex items-center gap-1.5 text-[0.75rem] text-text-muted">
                        <span className="hidden sm:inline">Select</span>
                        <div className="flex h-8 items-center overflow-hidden rounded-md border border-border-strong bg-surface shadow-card">
                          <button
                            type="button"
                            aria-label={`One fewer of ${name}'s ${noun}`}
                            disabled={groupSelected.length === 0}
                            onClick={() => selectFirst(group, groupSelected.length - 1)}
                            className="flex h-full w-7 items-center justify-center text-text-2 hover:bg-surface-2 disabled:opacity-40"
                          >
                            −
                          </button>
                          <input
                            type="number"
                            inputMode="numeric"
                            min={0}
                            max={selectable.length}
                            placeholder="0"
                            aria-label={`Number of ${name}'s ${noun} to select`}
                            value={groupSelected.length || ""}
                            onChange={(e) => {
                              if (e.target.value === "" && e.target.validity.badInput) return;
                              selectFirst(group, Number(e.target.value));
                            }}
                            className="h-full w-9 border-x border-border bg-transparent text-center text-[0.8125rem] font-medium tabular-nums text-text [appearance:textfield] focus:outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                          />
                          <button
                            type="button"
                            aria-label={`One more of ${name}'s ${noun}`}
                            disabled={groupSelected.length >= selectable.length}
                            onClick={() => selectFirst(group, groupSelected.length + 1)}
                            className="flex h-full w-7 items-center justify-center text-text-2 hover:bg-surface-2 disabled:opacity-40"
                          >
                            +
                          </button>
                        </div>
                        <span className="tabular-nums">of {selectable.length}</span>
                      </div>
                    )}
                    <span className="text-[0.8438rem] tabular-nums" data-testid="vendor-amount">
                      {groupSelected.length > 0 ? (
                        <>
                          <b className="font-semibold">{money(groupSelected.reduce((s, e) => s + e.amount, 0))}</b>
                          <span className="text-text-faint"> of {money(groupTotal)}</span>
                        </>
                      ) : (
                        <b className="font-semibold">{money(groupTotal)}</b>
                      )}
                    </span>
                    {/* Pay lives on the vendor's own row (24 Sep) — only while some of their rows are selected. */}
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
                  const on = selected.has(`l:${link.id}`);
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
                        onChange={() => toggle(`l:${link.id}`, link.asset.ownerId)}
                        className="h-4 w-4 accent-[var(--ink)]"
                      />
                      <button type="button" onClick={() => setDetail(link)} className="flex min-w-0 flex-col text-left">
                        <span className="truncate text-[0.8438rem] font-medium hover:underline">{link.campaign?.title ?? "—"}</span>
                        <span className="truncate text-[0.72rem] text-text-faint">
                          <span className="md:hidden">
                            @{link.asset.handle} · <span>{formatLabel(link.format)}</span> ·{" "}
                          </span>
                          {link.url.replace(/^https?:\/\/(www\.)?/, "")}
                        </span>
                      </button>
                      <span className="hidden truncate text-[0.8125rem] text-text-2 md:block">@{link.asset.handle}</span>
                      <span className="hidden text-[0.8125rem] text-text-2 md:block">{formatLabel(link.format)}</span>
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
                {open && group.invoices.map((inv) => {
                  const on = inv.selectable && selected.has(`i:${inv.id}`);
                  const otherVendor = vendorId !== null && vendorId !== inv.creatorId;
                  const expanded = openInvoices.has(inv.id);
                  return (
                    <Fragment key={inv.id}>
                      <div
                        data-testid="pending-invoice-row"
                        data-selectable={inv.selectable ? "true" : "false"}
                        className={cn(
                          "grid grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-x-3.5 gap-y-1 border-b border-border px-5 py-3 transition-colors md:gap-y-0",
                          PENDING_COLS,
                          on ? "bg-surface-2" : "hover:bg-surface-2",
                          (otherVendor || !inv.selectable) && "opacity-60"
                        )}
                      >
                        <input
                          type="checkbox"
                          aria-label={`Select invoice ${inv.invoiceNumber}`}
                          checked={on}
                          disabled={!inv.selectable}
                          onChange={() => toggle(`i:${inv.id}`, inv.creatorId)}
                          className="h-4 w-4 accent-[var(--ink)] disabled:cursor-not-allowed"
                        />
                        <button
                          type="button"
                          aria-expanded={expanded}
                          onClick={() =>
                            setOpenInvoices((prev) => {
                              const next = new Set(prev);
                              next.has(inv.id) ? next.delete(inv.id) : next.add(inv.id);
                              return next;
                            })
                          }
                          className="flex min-w-0 flex-col text-left"
                        >
                          <span className="truncate text-[0.8438rem] font-medium hover:underline">Invoice {inv.invoiceNumber}</span>
                          <span className="truncate text-[0.72rem] text-text-faint">
                            {inv.links.length} link{inv.links.length === 1 ? "" : "s"} · {inv.isGstInvoice ? "GST invoice" : "no GST"} · paid in full only
                            {(inv.overQuotaCount ?? 0) > 0 && (
                              // Why the checkbox is off (29 Sep): posts beyond their booking — it has to be rejected and re-raised, not paid.
                              <span className="font-semibold text-rose" data-testid="pending-invoice-over-quota">
                                {" "}
                                · {inv.overQuotaCount} over the booking — reject to re-raise
                              </span>
                            )}
                          </span>
                        </button>
                        <span className="hidden truncate text-[0.8125rem] text-text-2 md:block">{[...new Set(inv.links.map((l) => `@${l.asset?.handle ?? "—"}`))].join(", ")}</span>
                        <span className="hidden text-[0.8125rem] text-text-2 md:block">Invoice</span>
                        <span className="hidden text-[0.8125rem] text-text-2 md:block" title={inv.status === "PAID" ? "Paid on" : "Due"}>
                          {inv.status === "PAID" ? (inv.paidAt ? shortDate(inv.paidAt) : "—") : inv.dueDate ? shortDate(inv.dueDate) : "—"}
                        </span>
                        <span className="hidden md:block">
                          <StatusPill status={inv.status} />
                        </span>
                        <span className="text-right text-[0.8438rem] font-semibold tabular-nums">{money(inv.amount)}</span>
                        <button
                          type="button"
                          aria-label={expanded ? "Hide invoice links" : "Show invoice links"}
                          onClick={() =>
                            setOpenInvoices((prev) => {
                              const next = new Set(prev);
                              next.has(inv.id) ? next.delete(inv.id) : next.add(inv.id);
                              return next;
                            })
                          }
                          className="hidden text-text-faint hover:text-text md:block"
                        >
                          <ChevronRightIcon className={cn("h-4 w-4 transition-transform", expanded && "rotate-90")} />
                        </button>
                      </div>
                      {expanded &&
                        inv.links.map((l) => (
                          <div key={l.id} data-testid="pending-invoice-link" className="flex items-center gap-3 border-b border-border bg-surface-2 px-5 py-2 pl-[52px] text-[0.78rem] text-text-2">
                            <span className="min-w-0 flex-1 truncate">
                              {l.campaign?.title ?? "—"} · @{l.asset?.handle ?? "—"} · <span>{formatLabel(l.format)}</span>
                            </span>
                            <span className="tabular-nums">{money(l.cost ?? 0)}</span>
                          </div>
                        ))}
                    </Fragment>
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
          links={chosenLinks}
          invoices={chosenInvoices}
          onRemoveLink={(id) =>
            setSelected((prev) => {
              const next = new Set(prev);
              next.delete(`l:${id}`);
              return next;
            })
          }
          onRemoveInvoice={(id) =>
            setSelected((prev) => {
              const next = new Set(prev);
              next.delete(`i:${id}`);
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
                @{detail.asset.handle} · <span>{formatLabel(detail.format)}</span>
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

/** Normalizes a Payout row or a legacy standalone-paid Invoice row onto the same shape PaidTab renders — see PaidLedgerRow. Exported for creator-payments.tsx's own Paid list. */
export function paidRowView(row: PaidLedgerRow) {
  if (row.kind === "payout") {
    const p = row.payout;
    return {
      id: p.id,
      paidAt: p.paidAt,
      vendor: p.creator,
      by: p.markedPaidBy?.name ?? p.createdBy?.name ?? "—",
      items: (p.items ?? []).map((i) => ({ id: i.id, amount: i.amount, link: i.link })),
      subtotal: p.subtotal,
      gstShown: p.isGstInvoice,
      gstAmount: p.gstAmount,
      tds: p.tdsPercent ? { percent: Number(p.tdsPercent), amount: p.tdsAmount } : null,
      net: p.netAmount,
      utr: p.utr,
      receiptUrl: p.receipt?.url ?? null,
      legacy: false as const,
    };
  }
  const inv = row.invoice;
  return {
    id: inv.id,
    paidAt: inv.paidAt,
    vendor: inv.creator,
    by: null,
    items: inv.links.map((l) => ({ id: l.id, amount: l.cost ?? "0", link: l })),
    subtotal: inv.subtotal,
    gstShown: inv.isGstInvoice,
    gstAmount: inv.gstAmount,
    // A standalone-paid invoice never had TDS withheld — it was paid directly,
    // outside the Payout flow that's the only place TDS is applied.
    tds: null,
    net: inv.amount,
    utr: null,
    receiptUrl: inv.receipt?.url ?? null,
    legacy: true as const,
  };
}

function PaidTab({ rows, isLoading, error, onChanged, token }: { rows: PaidLedgerRow[]; isLoading: boolean; error: unknown; onChanged: () => void; token: string }) {
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
      ) : rows.length === 0 ? (
        <PaymentsEmpty icon={WalletIcon} title="No payouts yet" text="Payouts show up here once a receipt is attached. Try another month or clear the filters." />
      ) : (
        rows.map((row) => {
          const v = paidRowView(row);
          const expanded = open === v.id;
          const pages = [...new Set(v.items.map((i) => i.link.asset?.handle).filter(Boolean))];
          return (
            <div key={v.id} className="border-b border-border" data-testid="paid-row" data-kind={row.kind}>
              <div className={cn("grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3.5 px-5 py-3.5", PAID_COLS)}>
                <span className="text-[0.8125rem] tabular-nums text-text-2">{v.paidAt ? shortDate(v.paidAt) : "—"}</span>
                <button type="button" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : v.id)} className="flex min-w-0 flex-col text-left">
                  <span className="truncate text-[0.8438rem] font-medium hover:underline">{personLabel(v.vendor)}</span>
                  <span className="truncate text-[0.72rem] text-text-faint">{v.legacy ? "invoice paid directly · no TDS on file" : `by ${v.by}`}</span>
                </button>
                <span className="hidden truncate text-[0.8125rem] text-text-2 md:block">{pages.map((h) => `@${h}`).join(", ") || "—"}</span>
                <span className="hidden text-[0.8125rem] tabular-nums text-text-2 md:block">{v.items.length}</span>
                <span className="hidden text-[0.8125rem] tabular-nums text-text-2 md:block">{money(v.subtotal)}</span>
                <span className="hidden text-[0.8125rem] tabular-nums text-text-2 md:block">{v.gstShown ? money(v.gstAmount) : "—"}</span>
                <span className="hidden text-[0.8125rem] tabular-nums text-text-2 md:block">{v.tds ? `${v.tds.percent}% · −${money(v.tds.amount)}` : "—"}</span>
                <span className="text-right text-[0.9rem] font-semibold tabular-nums md:text-left">{money(v.net)}</span>
                <span className="hidden md:block">
                  {v.receiptUrl ? (
                    <a href={v.receiptUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[0.75rem] font-semibold text-blue hover:underline">
                      <DownloadIcon className="h-3.5 w-3.5" /> View
                    </a>
                  ) : v.legacy ? (
                    // Plain text, not a control — the one real upload widget lives in
                    // the expanded panel below, so there's only ever one file input
                    // with this accessible name in the DOM, not two.
                    <span className="text-[0.75rem] text-text-faint">Attach in details</span>
                  ) : (
                    <span className="text-[0.75rem] text-text-faint">—</span>
                  )}
                </span>
                <button type="button" aria-expanded={expanded} aria-label={expanded ? "Hide links" : "Show links"} onClick={() => setOpen(expanded ? null : v.id)} className="hidden text-text-faint md:block">
                  <ChevronRightIcon className={cn("h-4 w-4 transition-transform", expanded && "rotate-90")} />
                </button>
              </div>
              {expanded && (
                <div className="bg-surface-2 px-5 pb-4 pt-1" data-testid="paid-row-links">
                  <div className="flex flex-wrap gap-x-5 gap-y-1 py-2 text-[0.75rem] text-text-muted">
                    <span>{v.utr ? `UTR ${v.utr}` : v.legacy ? "Paid directly — no UTR on file" : "No UTR recorded"}</span>
                    <span>{v.gstShown ? `GST 18% · ${money(v.gstAmount)}` : "No GST"}</span>
                    <span>{v.tds ? `TDS ${v.tds.percent}% · −${money(v.tds.amount)}` : v.legacy ? "No TDS — paid outside a payout" : "No TDS"}</span>
                    {v.receiptUrl ? (
                      <a href={v.receiptUrl} target="_blank" rel="noreferrer" className="font-semibold text-blue hover:underline md:hidden">
                        View receipt
                      </a>
                    ) : (
                      // The only InvoiceReceiptUpload instance for this row (not
                      // duplicated per breakpoint) — reachable by expanding, from any width.
                      v.legacy && <InvoiceReceiptUpload token={token} invoiceId={v.id} onUploaded={onChanged} />
                    )}
                  </div>
                  <div className="overflow-hidden rounded-[10px] border border-border bg-surface">
                    {v.items.map((item) => {
                      const views = viewsOf(item.link);
                      return (
                        <div key={item.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border px-4 py-2.5 text-[0.8125rem] last:border-b-0 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,0.6fr)_minmax(0,0.6fr)_minmax(0,0.6fr)_minmax(0,0.6fr)]">
                          <a href={item.link.url} target="_blank" rel="noreferrer" className="truncate font-medium text-text hover:underline">
                            {item.link.campaign?.title ?? item.link.url}
                          </a>
                          <span className="hidden text-text-2 md:block">@{item.link.asset?.handle ?? "—"}</span>
                          <span className="hidden text-text-2 md:block">{formatLabel(item.link.format)}</span>
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
