"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CalendarDays, Layers, Target, Wallet } from "lucide-react";

import { useAuth } from "@/lib/auth-context";
import { ApiError, hasAccess, type Asset, type PageOwner } from "@/lib/api-client";
import { buildVendorRows, sumMoney, monthLabel, monthKeyOf, monthRange, recentMonths, VENDOR_STATUS, type VendorStatus } from "@/lib/finance";
import { personLabel, plural } from "@/lib/format";
import { useAssets, usePaidLedger, usePaymentSummary, usePendingDues } from "@/lib/queries/finance";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FilterSelect } from "@/components/taggify/filter-select";
import { MetricTile } from "@/components/taggify/metric-tile";
import { Money } from "@/components/taggify/money";
import { SearchField } from "@/components/taggify/search-field";
import { StatusPill } from "@/components/taggify/status-pill";
import { UserAvatar } from "@/components/taggify/user-avatar";
import { displayHandle, PageAvatarStack } from "@/components/finance/identity";
import { NoAccess, LoadError } from "@/components/finance/states";
import { EmptyState } from "@/components/taggify/illustration";
import { Pager, PER_PAGE } from "@/components/finance/pager";
import { PaidTable, paidTotals } from "@/components/finance/paid-list";

export default function CreatorPayoutsPage() {
  return (
    <AppShell active="payouts">
      <Suspense>
        <CreatorPayouts />
      </Suspense>
    </AppShell>
  );
}

function CreatorPayouts() {
  const { user } = useAuth();
  const params = useSearchParams();
  const [view, setView] = useState<"vendors" | "paid">(params.get("view") === "paid" ? "paid" : "vendors");
  const urlView = params.get("view");
  useEffect(() => setView(urlView === "paid" ? "paid" : "vendors"), [urlView]);
  const [month, setMonth] = useState(monthKeyOf(new Date()));
  const [tab, setTab] = useState<"all" | VendorStatus>("all");
  const [q, setQ] = useState(params.get("q") ?? "");
  const urlQ = params.get("q") ?? "";
  useEffect(() => setQ(urlQ), [urlQ]);
  const [platform, setPlatform] = useState("all");
  const [sort, setSort] = useState("due");
  const [page, setPage] = useState(1);

  const range = monthRange(month);
  const pending = usePendingDues();
  const assets = useAssets();
  const paidMonth = usePaidLedger(range);
  const paidAll = usePaidLedger({});
  const paidLedgerTotal = paidAll.data ? paidAll.data.total : null;
  const total = usePaymentSummary({});
  const monthSummary = usePaymentSummary(range);

  const rows = useMemo(() => {
    if (!pending.data) return [];
    const paidMap = new Map<string, { amount: number; owner: PageOwner | null }>();
    for (const r of paidMonth.data?.items ?? []) {
      const id = r.kind === "payout" ? r.payout.creatorId : r.invoice.creatorId;
      const owner = (r.kind === "payout" ? r.payout.creator : r.invoice.creator) ?? null;
      const amount = Number(r.kind === "payout" ? r.payout.netAmount : r.invoice.amount);
      const prev = paidMap.get(id);
      paidMap.set(id, { amount: sumMoney([prev?.amount ?? 0, amount], (n) => n), owner: prev?.owner ?? owner });
    }
    return buildVendorRows({ links: pending.data.items, invoices: pending.data.invoices, assets: assets.data ?? [], paidThisMonth: paidMap, month });
  }, [pending.data, assets.data, paidMonth.data, month]);

  if (!hasAccess(user, "finance.pay")) return <NoAccess what="vendor payouts" hint="Ask an admin to give you the Finance “pay” permission if you need it." />;
  if (pending.error instanceof ApiError && pending.error.status === 403) return <NoAccess what="vendor payouts" hint="Ask an admin to give you the Finance “pay” permission if you need it." />;

  const needle = q.trim().toLowerCase();
  const counts = { all: rows.length, due: 0, partial: 0, paid: 0 } as Record<"all" | VendorStatus, number>;
  rows.forEach((r) => counts[r.status]++);
  const filtered = rows
    .filter((r) => tab === "all" || r.status === tab)
    .filter((r) => platform === "all" || r.pages.some((p) => p.platform.toLowerCase() === platform))
    .filter(
      (r) =>
        !needle ||
        [personLabel(r.owner, ""), ...r.pages.map((p) => p.handle), ...r.links.map((l) => `${l.asset.handle} ${l.campaign?.title ?? ""} ${l.campaign?.brandName ?? ""}`)]
          .join(" ")
          .toLowerCase()
          .includes(needle)
    )
    .sort((a, b) => (sort === "name" ? personLabel(a.owner).localeCompare(personLabel(b.owner)) : sort === "month" ? b.dueThisMonth - a.dueThisMonth : b.totalDue - a.totalDue));
  const pages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const current = Math.min(page, pages);
  const shown = filtered.slice((current - 1) * PER_PAGE, current * PER_PAGE);
  const vendorsOwed = rows.filter((r) => r.totalDue > 0).length;
  const loadingTiles = total.isLoading || monthSummary.isLoading;
  // The list is built from the newest 500 dues (and 100 payouts this month); say so rather than show quietly short totals.
  const pendingCut = !!pending.data && pending.data.total > pending.data.items.length;
  const invoicesCut = !!pending.data && pending.data.invoices.length >= 500;
  const paidCut = !!paidMonth.data && paidMonth.data.total > paidMonth.data.items.length;
  const truncation =
    pendingCut || invoicesCut || paidCut
      ? [
          pendingCut ? `This list adds up the newest ${pending.data!.items.length} of ${pending.data!.total} dues, so some vendors' totals may be short.` : null,
          invoicesCut ? "It counts only the newest 500 unpaid invoices, so some vendors' totals may be short." : null,
          paidCut ? `“Paid this month” counts the latest ${paidMonth.data!.items.length} of ${paidMonth.data!.total} payments.` : null,
          "The tiles above are exact. Open a vendor to see everything they're owed.",
        ]
          .filter(Boolean)
          .join(" ")
      : null;

  return (
    <div className="flex flex-col gap-5 pt-2">
      <div className="flex flex-wrap items-start gap-4">
        <div>
          <p className="text-body font-medium text-fg-strong">Finance</p>
          <h1 className="text-display">Creator Payouts</h1>
          <p className="mt-1 text-body text-muted-foreground">See what each vendor is owed, pay them, and keep the receipts.</p>
        </div>
        <FilterSelect
          className="ml-auto"
          label="Month"
          icon={CalendarDays}
          value={month}
          onValueChange={(v) => {
            setMonth(v);
            setPage(1);
          }}
          options={recentMonths(12).map((m) => ({ value: m, label: monthLabel(m, "long") }))}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <MetricTile tone="coral" icon={Wallet} label="Total Dues" loading={loadingTiles} value={<Money value={total.data?.pending.amount ?? 0} />} meta={`${plural(total.data?.pending.links ?? 0, "post")} across ${plural(vendorsOwed, "vendor")}`} />
        <MetricTile tone="amber" icon={Target} label="Dues This Month" loading={loadingTiles} value={<Money value={monthSummary.data?.pending.amount ?? 0} />} meta={`${plural(monthSummary.data?.pending.links ?? 0, "post")} from ${monthLabel(month, "long")}`} />
        <MetricTile tone="mint" icon={Layers} label="Paid This Month" loading={loadingTiles} value={<Money value={monthSummary.data?.paid.amount ?? 0} />} meta={`${plural(monthSummary.data?.paid.payments ?? 0, "payout")} · net of TDS`} />
      </div>

      <Tabs value={view} onValueChange={(v) => setView(v as typeof view)}>
        <TabsList>
          <TabsTrigger value="vendors">Vendors to pay</TabsTrigger>
          <TabsTrigger value="paid">Paid{paidLedgerTotal !== null ? ` (${paidLedgerTotal})` : ""}</TabsTrigger>
        </TabsList>
      </Tabs>

      {view === "paid" ? (
        <PaidLedger />
      ) : (
      <Card className="overflow-hidden">
        <Tabs
          value={tab}
          onValueChange={(v) => {
            setTab(v as typeof tab);
            setPage(1);
          }}
        >
          <div className="flex items-end gap-4 px-5 pt-2">
            <TabsList className="flex-1 border-b-0">
              <TabsTrigger value="all">All vendors ({counts.all})</TabsTrigger>
              <TabsTrigger value="due">Due ({counts.due})</TabsTrigger>
              <TabsTrigger value="partial">Partially paid ({counts.partial})</TabsTrigger>
              <TabsTrigger value="paid">Fully paid ({counts.paid})</TabsTrigger>
            </TabsList>
          </div>
        </Tabs>
        <div className="flex flex-wrap items-center gap-2 border-t px-5 py-4">
          <SearchField
            label="Search vendors"
            placeholder="Search vendor, page or campaign..."
            className="w-full sm:w-[300px]"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
          <FilterSelect label="Platform" value={platform} onValueChange={setPlatform} options={[{ value: "all", label: "All" }, { value: "instagram", label: "Instagram" }, { value: "youtube", label: "YouTube" }]} />
          <FilterSelect
            className="sm:ml-auto"
            label="Sort by"
            value={sort}
            onValueChange={setSort}
            options={[
              { value: "due", label: "Total due" },
              { value: "month", label: "Due this month" },
              { value: "name", label: "Vendor name" },
            ]}
          />
        </div>

        {truncation && <p className="border-t bg-warning-soft px-5 py-3 text-small text-warning-fg">{truncation}</p>}
        {pending.isError ? (
          <LoadError onRetry={() => pending.refetch()} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vendor</TableHead>
                <TableHead>Pages</TableHead>
                <TableHead>Campaigns</TableHead>
                <TableHead className="text-right">Total due</TableHead>
                <TableHead className="text-right">Due this month</TableHead>
                <TableHead className="text-right">Paid this month</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">
                  <span className="sr-only">Action</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pending.isLoading
                ? Array.from({ length: 5 }, (_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={8}>
                        <Skeleton className="h-8 w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                : shown.map((r) => {
                    const name = personLabel(r.owner, "Unnamed vendor");
                    const status = VENDOR_STATUS[r.status];
                    return (
                      <TableRow key={r.id}>
                        <TableCell>
                          <Link href={`/finance/payouts/${r.id}`} className="flex items-center gap-3 rounded-md text-foreground hover:text-brand-ink">
                            <UserAvatar name={name} size="md" />
                            <span className="min-w-0">
                              <span className="block truncate text-body font-semibold">{name}</span>
                              <span className="block truncate text-caption font-normal text-fg-muted">{r.pages[0] ? displayHandle(r.pages[0].handle, r.pages[0].platform) : r.owner.email}</span>
                            </span>
                          </Link>
                        </TableCell>
                        <TableCell>
                          <PageAvatarStack pages={r.pages} />
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {r.campaigns} campaign{r.campaigns === 1 ? "" : "s"}
                        </TableCell>
                        <TableCell className="text-right font-semibold">
                          <Money value={r.totalDue} />
                        </TableCell>
                        <TableCell className="text-right">
                          <Money value={r.dueThisMonth} />
                        </TableCell>
                        <TableCell className="text-right">
                          <Money value={r.paidThisMonth} />
                        </TableCell>
                        <TableCell>
                          <StatusPill tone={status.tone}>{status.label}</StatusPill>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button asChild variant="outline" size="sm">
                            <Link href={`/finance/payouts/${r.id}`} aria-label={`${r.totalDue ? "Review" : "View"} ${name}`}>
                              {r.totalDue ? "Review" : "View"}
                            </Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
              {!pending.isLoading && shown.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8}>
                    {rows.length === 0 ? (
                      <EmptyState name="empty-dues" title="No vendor is owed anything right now">
                        New dues show up here as posts go live.
                      </EmptyState>
                    ) : (
                      <EmptyState name="empty-search" title="No vendors match">
                        Clear the search or pick another tab.
                      </EmptyState>
                    )}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
        <Pager total={filtered.length} page={current} pages={pages} noun="vendors" onPage={setPage} />
      </Card>
      )}
    </div>
  );
}

const day = (key: string, end = false) => new Date(`${key}T${end ? "23:59:59.999" : "00:00:00"}`).toISOString();

/**
 * Every payout made, across vendors (v1 Payments → Paid): filter by vendor,
 * page and the month or dates it was paid in. The server returns the latest
 * 100; totals add up what's loaded, and a note says when there's more.
 */
function PaidLedger() {
  const pending = usePendingDues();
  const assets = useAssets();
  const [vendor, setVendor] = useState("all");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [period, setPeriod] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(q.trim().replace(/^@+/, ""));
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const range = period === "all" ? {} : period === "custom" ? { ...(from ? { from: day(from) } : {}), ...(to ? { to: day(to, true) } : {}) } : monthRange(period);
  const ledger = usePaidLedger({ ...(vendor !== "all" ? { creatorId: vendor } : {}), ...(search ? { q: search } : {}), ...range });

  // Vendor names seen anywhere on this screen; kept once seen, so picking a vendor doesn't shrink the list to just them.
  const seen = useRef(new Map<string, string>());
  const vendors = useMemo(() => {
    const add = (id: string | undefined, person: { name?: string | null; email?: string | null; phoneNumber?: string | null } | null | undefined) => {
      if (id && !seen.current.has(id) && person) seen.current.set(id, personLabel(person, "Unnamed vendor"));
    };
    for (const a of (assets.data ?? []) as (Asset & { owner?: PageOwner | null })[]) add(a.ownerId, a.owner);
    for (const l of pending.data?.items ?? []) add(l.asset.ownerId, l.asset.owner);
    for (const i of pending.data?.invoices ?? []) add(i.creatorId, i.creator);
    for (const r of ledger.data?.items ?? []) (r.kind === "payout" ? add(r.payout.creatorId, r.payout.creator) : add(r.invoice.creatorId, r.invoice.creator));
    return [...seen.current].sort((a, b) => a[1].localeCompare(b[1]));
  }, [assets.data, pending.data, ledger.data]);

  const items = ledger.data?.items ?? [];
  const totals = paidTotals(items);
  const pages = Math.max(1, Math.ceil(items.length / PER_PAGE));
  const current = Math.min(page, pages);
  const shown = items.slice((current - 1) * PER_PAGE, current * PER_PAGE);
  const hasFilters = vendor !== "all" || !!search || period !== "all";
  const reset = () => setPage(1);

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 px-5 py-4">
        <FilterSelect
          label="Vendor"
          value={vendor}
          onValueChange={(v) => {
            setVendor(v);
            reset();
          }}
          options={[{ value: "all", label: "All" }, ...vendors.map(([id, label]) => ({ value: id, label }))]}
        />
        <SearchField label="Search page" placeholder="Search page, e.g. riya.eats" className="w-full sm:w-64" maxLength={60} value={q} onChange={(e) => setQ(e.target.value)} />
        <FilterSelect
          label="Paid in"
          icon={CalendarDays}
          value={period}
          onValueChange={(v) => {
            setPeriod(v);
            reset();
          }}
          options={[{ value: "all", label: "All time" }, ...recentMonths(12).map((m) => ({ value: m, label: monthLabel(m, "long") })), { value: "custom", label: "Custom range" }]}
        />
        {period === "custom" && (
          <span className="flex flex-wrap items-center gap-2 text-small text-muted-foreground">
            <Input
              type="date"
              aria-label="Paid from"
              className="w-auto"
              value={from}
              max={to || undefined}
              onChange={(e) => {
                setFrom(e.target.value);
                reset();
              }}
            />
            <span>to</span>
            <Input
              type="date"
              aria-label="Paid to"
              className="w-auto"
              value={to}
              min={from || undefined}
              onChange={(e) => {
                setTo(e.target.value);
                reset();
              }}
            />
          </span>
        )}
        {ledger.data && (
          <p className="text-small text-muted-foreground sm:ml-auto" data-testid="paid-totals">
            {plural(totals.count, "payment")} · <Money value={totals.net} className="font-semibold text-foreground" /> paid · <Money value={totals.tds} className="font-semibold text-foreground" /> TDS withheld
          </p>
        )}
      </div>
      {ledger.data && ledger.data.total > items.length && (
        <p className="border-t bg-warning-soft px-5 py-3 text-small text-warning-fg" data-testid="truncation-note">
          Showing the latest {items.length} of {ledger.data.total} payments. Narrow the filters (vendor, page or month) to see the rest and get exact totals.
        </p>
      )}
      <div className="border-t">
        {ledger.isError ? (
          <LoadError onRetry={() => ledger.refetch()} what="paid payouts" />
        ) : ledger.isLoading ? (
          <div className="flex flex-col gap-2 p-5">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState name={hasFilters ? "empty-search" : "empty-dues"} title={hasFilters ? "No payouts match these filters" : "No payouts yet"}>
            {hasFilters ? "Try another vendor, page or month." : "Payouts show up here once their receipt is attached."}
          </EmptyState>
        ) : (
          <PaidTable rows={shown} showVendor />
        )}
      </div>
      <Pager total={items.length} page={current} pages={pages} noun="payments" onPage={setPage} />
    </Card>
  );
}
