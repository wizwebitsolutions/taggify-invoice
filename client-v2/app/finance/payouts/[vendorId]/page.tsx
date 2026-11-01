"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowUpDown, BadgeCheck, CalendarDays, CreditCard, ExternalLink, FileText, Layers, Minus, Plus, Wallet } from "lucide-react";

import { useAuth } from "@/lib/auth-context";
import { ApiError, hasAccess, type Asset, type PaymentInvoice } from "@/lib/api-client";
import { captionTitle, dueStatus, formatLabel, inMonth, latestSnapshot, monthKeyOf, monthLabel, monthRange, postThumbSrc, workDate } from "@/lib/finance";
import { personLabel, plural } from "@/lib/format";
import { useAssets, useBillingProfiles, useDraftPayouts, usePaidLedger, usePaymentSummary, usePendingDues } from "@/lib/queries/finance";
import { cn } from "@/lib/utils";
import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { FilterSelect } from "@/components/taggify/filter-select";
import { EmptyState, Illustration } from "@/components/taggify/illustration";
import { MetricTile } from "@/components/taggify/metric-tile";
import { Money } from "@/components/taggify/money";
import { PlatformIcon } from "@/components/taggify/platform-icon";
import { SearchField } from "@/components/taggify/search-field";
import { StatusPill } from "@/components/taggify/status-pill";
import { UserAvatar } from "@/components/taggify/user-avatar";
import { audienceLabel, ContentThumb, displayHandle, PageAvatar } from "@/components/finance/identity";
import { Pager, PER_PAGE } from "@/components/finance/pager";
import { PaidTable } from "@/components/finance/paid-list";
import { PayoutRail, type SelectedDue } from "@/components/finance/payout-rail";
import { LoadError, NoAccess } from "@/components/finance/states";

type DueRow = SelectedDue & { date: string; amount: number; campaignKey: string; pageId: string | null; statusKey: "verified" | "pending" | "invoice"; search: string };

export default function VendorPayoutPage() {
  return (
    <AppShell active="payouts">
      <Suspense>
        <VendorPayout />
      </Suspense>
    </AppShell>
  );
}

function VendorPayout() {
  const { vendorId } = useParams<{ vendorId: string }>();
  const { user } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const wantInvoice = params.get("invoice");
  const month = monthKeyOf(new Date());
  const range = monthRange(month);

  const pending = usePendingDues({ ownerId: vendorId });
  const assets = useAssets();
  const billing = useBillingProfiles();
  const drafts = useDraftPayouts(vendorId);
  const paid = usePaidLedger({ creatorId: vendorId });
  const totals = usePaymentSummary({ ownerId: vendorId });
  const monthTotals = usePaymentSummary({ ownerId: vendorId, ...range });

  const [tab, setTab] = useState(() => (["dues", "paid", "invoices", "billing"].includes(params.get("tab") ?? "") ? params.get("tab")! : "dues"));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [fMonth, setFMonth] = useState("all");
  const [fPage, setFPage] = useState("all");
  const [fCampaign, setFCampaign] = useState("all");
  const [fStatus, setFStatus] = useState("all");
  const [sort, setSort] = useState("newest");
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (!pending.data) return;
    const ok = new Set([...pending.data.items.map((l) => `l:${l.id}`), ...pending.data.invoices.filter((i) => i.selectable).map((i) => `i:${i.id}`)]);
    setSelected((cur) => {
      const kept = new Set([...cur].filter((k) => ok.has(k)));
      if (kept.size === cur.size) return cur;
      toast.info(`${cur.size - kept.size} selected item${cur.size - kept.size === 1 ? " is" : "s are"} no longer payable and ${cur.size - kept.size === 1 ? "was" : "were"} removed from the payout.`);
      return kept;
    });
  }, [pending.data]);

  const pages: Asset[] = useMemo(() => (assets.data ?? []).filter((a) => a.ownerId === vendorId), [assets.data, vendorId]);
  const assetById = useMemo(() => new Map((assets.data ?? []).map((a) => [a.id, a])), [assets.data]);
  const profile = useMemo(() => {
    const mine = (billing.data ?? []).filter((b) => b.userId === vendorId);
    return mine.find((b) => b.approvalStatus === "approved") ?? mine[0] ?? null;
  }, [billing.data, vendorId]);

  const owner =
    pending.data?.items[0]?.asset.owner ??
    pending.data?.invoices[0]?.creator ??
    (paid.data?.items[0]?.kind === "payout" ? paid.data.items[0].payout.creator : null) ??
    (assets.data?.find((a) => a.ownerId === vendorId) as (Asset & { owner?: { name: string | null } }) | undefined)?.owner ??
    null;
  const name = personLabel(owner, profile?.name ?? "Vendor");

  const rows: DueRow[] = useMemo(() => {
    if (!pending.data) return [];
    const linkRows: DueRow[] = pending.data.items.map((link) => {
      const asset = assetById.get(link.asset.id);
      const st = dueStatus(link.status);
      const snap = latestSnapshot(link);
      return {
        key: `l:${link.id}`,
        kind: "link",
        link,
        platform: asset?.platform ?? "instagram",
        date: workDate(link),
        amount: Number(link.cost),
        campaignKey: link.campaign?.id ?? link.campaignId,
        pageId: link.asset.id,
        statusKey: st.label === "Verified" ? "verified" : "pending",
        search: `${snap?.caption ?? ""} ${link.format} ${link.campaign?.title ?? ""} ${link.campaign?.brandName ?? ""} ${link.asset.handle}`.toLowerCase(),
      };
    });
    const invoiceRows: DueRow[] = pending.data.invoices.map((invoice) => ({
      key: `i:${invoice.id}`,
      kind: "invoice",
      invoice,
      date: invoice.createdAt,
      amount: Number(invoice.amount),
      campaignKey: invoice.links[0]?.campaign?.id ?? "",
      pageId: invoice.links[0]?.asset?.id ?? null,
      statusKey: "invoice",
      search: `invoice ${invoice.invoiceNumber} ${invoice.links.map((l) => `${l.campaign?.title ?? ""} ${l.asset?.handle ?? ""}`).join(" ")}`.toLowerCase(),
    }));
    return [...linkRows, ...invoiceRows];
  }, [pending.data, assetById]);

  // Arriving from an invoice's "Pay" (?invoice=<id>): tick that invoice, show its page of Dues and bring the payout rail into view.
  const handledInvoice = useRef<string | null>(null);
  const [railFocus, setRailFocus] = useState(false);
  useEffect(() => {
    if (!wantInvoice || handledInvoice.current === wantInvoice || !pending.data) return;
    handledInvoice.current = wantInvoice;
    const inv = pending.data.invoices.find((i) => i.id === wantInvoice);
    if (!inv) toast.error("That invoice isn't waiting to be paid any more. Check the Paid tab.");
    else if (!inv.selectable) toast.error(`Invoice ${inv.invoiceNumber} can't be paid yet. ${inv.overQuotaCount ? "It has posts beyond the campaign booking." : "One of its posts is already on another payout."}`);
    else {
      const key = `i:${inv.id}`;
      setSelected(new Set([key]));
      setTab("dues");
      const order = [...rows].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      const at = order.findIndex((r) => r.key === key);
      setPage(at < 0 ? 1 : Math.floor(at / PER_PAGE) + 1);
      setRailFocus(true);
    }
    router.replace(`/finance/payouts/${vendorId}`, { scroll: false });
  }, [wantInvoice, pending.data, rows, router, vendorId]);
  useEffect(() => {
    if (!railFocus) return;
    setRailFocus(false);
    focusRail();
  }, [railFocus]);

  if (!hasAccess(user, "finance.pay") || (pending.error instanceof ApiError && pending.error.status === 403)) return <NoAccess what="vendor payouts" hint="Ask an admin to give you the Finance “pay” permission if you need it." />;

  const selectable = (r: DueRow) => r.kind === "link" || r.invoice.selectable;
  const needle = q.trim().toLowerCase();
  const visible = rows
    .filter((r) => fMonth === "all" || inMonth(r.date, fMonth))
    .filter((r) => fPage === "all" || r.pageId === fPage || (r.kind === "invoice" && r.invoice.links.some((l) => l.asset?.id === fPage)))
    .filter((r) => fCampaign === "all" || r.campaignKey === fCampaign)
    .filter((r) => fStatus === "all" || r.statusKey === fStatus)
    .filter((r) => !needle || r.search.includes(needle))
    .sort((a, b) => (sort === "amount" ? b.amount - a.amount : new Date(b.date).getTime() - new Date(a.date).getTime()));
  const pageCount = Math.max(1, Math.ceil(visible.length / PER_PAGE));
  const current = Math.min(page, pageCount);
  const shown = visible.slice((current - 1) * PER_PAGE, current * PER_PAGE);
  // Select-all covers every due that matches the filters, on every page of the table (v1 ticked all of a vendor's dues).
  const allSelectable = visible.filter(selectable);
  const nSelAll = allSelectable.filter((r) => selected.has(r.key)).length;
  const headerState = nSelAll === 0 ? false : nSelAll === allSelectable.length ? true : "indeterminate";
  const selectedDues: SelectedDue[] = rows.filter((r) => selected.has(r.key));
  const filtered = fMonth !== "all" || fPage !== "all" || fCampaign !== "all" || fStatus !== "all" || !!needle;
  /** v1's "Select [N] of M": exactly the first N payable dues in the order shown; anything else ticked is dropped. */
  const selectFirst = (n: number) => setSelected(new Set(allSelectable.slice(0, Math.max(0, Math.min(Number.isFinite(n) ? Math.floor(n) : 0, allSelectable.length))).map((r) => r.key)));

  const toggle = (key: string, on: boolean) =>
    setSelected((s) => {
      const n = new Set(s);
      if (on) n.add(key);
      else n.delete(key);
      return n;
    });

  const months = [...new Set(rows.map((r) => monthKeyOf(new Date(r.date))))].sort().reverse();
  const campaigns = new Map<string, string>();
  rows.forEach((r) => {
    if (r.kind === "link" && r.link.campaign) campaigns.set(r.link.campaign.id, r.link.campaign.title);
  });
  const categories = [...new Set(pages.map((p) => p.category).filter(Boolean))] as string[];
  const paidCount = paid.data?.total ?? 0;
  const loadingTiles = totals.isLoading || monthTotals.isLoading;
  const resetPage = () => setPage(1);

  const rail = (
    <PayoutRail
      vendorId={vendorId}
      vendorName={name}
      selected={selectedDues}
      onRemove={(k) => toggle(k, false)}
      onClear={() => setSelected(new Set())}
      billingProfile={profile}
      billingError={billing.isError}
      drafts={drafts.data?.items ?? []}
    />
  );

  return (
    <TooltipProvider delayDuration={200}>
      <div className="grid items-start gap-6 pt-1 xl:grid-cols-[minmax(0,1fr)_var(--rail-width)]">
        <section className="flex min-w-0 flex-col gap-6">
          <Link href="/finance/payouts" className="inline-flex items-center gap-3 self-start text-body font-semibold text-foreground hover:text-brand-ink">
            <ArrowLeft className="h-[18px] w-[18px]" aria-hidden />
            Back to Payouts
          </Link>

          {/* Vendor header */}
          <div className="detail-heading relative grid grid-cols-[auto_minmax(0,1fr)] items-center gap-4 2xl:grid-cols-[auto_minmax(0,1fr)_auto]">
            {/* Vendors have no photo, so initials at 64px read cleaner than a 112px circle with small letters. */}
            <UserAvatar name={name} size="lg" />
            <div className="min-w-0">
              <h1 className="flex flex-wrap items-center gap-3 text-h1">
                {name}
                {profile && (
                  <Badge variant={profile.approvalStatus === "approved" ? "success" : "warning"} className="tracking-normal">
                    <BadgeCheck className="h-3.5 w-3.5" aria-hidden />
                    {profile.approvalStatus === "approved" ? "Billing approved" : profile.approvalStatus === "pending" ? "Billing pending approval" : "Billing rejected"}
                  </Badge>
                )}
              </h1>
              <p className="mt-1 flex flex-wrap gap-2 text-body text-muted-foreground">
                <span>Creator / Vendor</span>
                <span aria-hidden className="text-fg-muted">•</span>
                <span>
                  {pages.length} page{pages.length === 1 ? "" : "s"}
                </span>
                <span aria-hidden className="text-fg-muted">•</span>
                <span>
                  {rows.length} due{rows.length === 1 ? "" : "s"}
                </span>
              </p>
              {categories.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {categories.map((c) => (
                    <Badge key={c} variant="chip">
                      {c}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
            <Illustration name="header-ribbon" className="pointer-events-none hidden h-28 w-auto 2xl:block" />
          </div>

          {/* Pages */}
          <div className="flex flex-col gap-3">
          <h2 className="section-heading text-section">Pages ({pages.length})</h2>
          {assets.isLoading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-24 rounded-card" />
              ))}
            </div>
          ) : pages.length === 0 ? (
            <p className="text-small text-muted-foreground">No pages found for this vendor.</p>
          ) : (
            <div className="flex gap-4 overflow-x-auto pb-1 sm:grid sm:grid-cols-[repeat(auto-fill,minmax(250px,1fr))] sm:overflow-visible">
              {pages.map((p) => {
                const on = fPage === p.id;
                return (
                  <Card key={p.id} className={cn("relative flex min-w-[250px] items-center gap-4 border-input bg-card p-5 shadow-1 transition-colors hover:bg-brand-50", on && "border-brand ring-1 ring-brand")}>
                    <button
                      type="button"
                      className="absolute inset-0 rounded-card focus-visible:outline-none focus-visible:ring-focus focus-visible:ring-ring-soft"
                      aria-pressed={on}
                      aria-label={on ? `Show dues from all pages` : `Show only ${displayHandle(p.handle, p.platform)}'s dues`}
                      onClick={() => {
                        setFPage(on ? "all" : p.id);
                        resetPage();
                      }}
                    />
                    <PageAvatar assetId={p.id} handle={p.handle} size="lg" />
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-body font-bold">
                        <PlatformIcon platform={p.platform} />
                        <span className="truncate">{displayHandle(p.handle, p.platform)}</span>
                      </p>
                      <p className="mb-2 mt-1 text-body text-muted-foreground">{audienceLabel(p.followers, p.platform)}</p>
                      {p.category && <Badge variant="tag">{p.category}</Badge>}
                    </div>
                    <a
                      href={p.platform.toLowerCase() === "youtube" ? `https://www.youtube.com/@${p.handle.replace(/^@/, "")}` : `https://www.instagram.com/${p.handle.replace(/^@/, "")}/`}
                      target="_blank"
                      rel="noreferrer"
                      className="absolute right-3 top-3 z-10 grid h-7 w-7 place-items-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                      aria-label={`Open ${displayHandle(p.handle, p.platform)} on ${p.platform}`}
                    >
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </Card>
                );
              })}
            </div>
          )}
          </div>

          {/* Tiles */}
          <div className="grid gap-4 md:grid-cols-3">
            <MetricTile tone="coral" icon={Wallet} label="Total Dues" loading={loadingTiles} value={<Money value={totals.data?.pending.amount ?? 0} />} meta={`${plural(totals.data?.pending.links ?? 0, "post")} across ${plural(new Set(rows.map((r) => r.pageId)).size, "page")}`} />
            <MetricTile tone="amber" icon={CalendarDays} label="Dues This Month" loading={loadingTiles} value={<Money value={monthTotals.data?.pending.amount ?? 0} />} meta={`${plural(monthTotals.data?.pending.links ?? 0, "post")} from ${monthLabel(month, "long")}`} />
            <MetricTile tone="mint" icon={Layers} label="Paid This Month" loading={loadingTiles} value={<Money value={monthTotals.data?.paid.amount ?? 0} />} meta={`${plural(monthTotals.data?.paid.payments ?? 0, "payout")} · net of TDS`} />
          </div>

          <Tabs value={tab} onValueChange={setTab}>
            <div className="flex flex-wrap items-end gap-3 border-b border-input">
              <TabsList className="flex-1 border-b-0">
                <TabsTrigger value="dues">Dues ({rows.length})</TabsTrigger>
                <TabsTrigger value="paid">Paid ({paidCount})</TabsTrigger>
                <TabsTrigger value="invoices">Invoices ({pending.data?.invoices.length ?? 0})</TabsTrigger>
                <TabsTrigger value="billing">Billing Details</TabsTrigger>
              </TabsList>
              {tab === "dues" && (
                <FilterSelect
                  className="mb-2"
                  label="Sort"
                  icon={ArrowUpDown}
                  value={sort}
                  onValueChange={setSort}
                  options={[
                    { value: "newest", label: "Newest first" },
                    { value: "amount", label: "Highest amount" },
                  ]}
                />
              )}
            </div>

            <TabsContent value="dues" className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <SearchField
                  label="Search dues"
                  placeholder="Search campaign or page..."
                  className="w-full sm:w-64"
                  value={q}
                  onChange={(e) => {
                    setQ(e.target.value);
                    resetPage();
                  }}
                />
                <FilterSelect
                  label="Month"
                  icon={CalendarDays}
                  value={fMonth}
                  onValueChange={(v) => {
                    setFMonth(v);
                    resetPage();
                  }}
                  options={[{ value: "all", label: "All" }, ...months.map((m) => ({ value: m, label: monthLabel(m) }))]}
                />
                <FilterSelect
                  label="Page"
                  value={fPage}
                  onValueChange={(v) => {
                    setFPage(v);
                    resetPage();
                  }}
                  options={[{ value: "all", label: "All" }, ...pages.map((p) => ({ value: p.id, label: displayHandle(p.handle, p.platform), leading: <PageAvatar assetId={p.id} handle={p.handle} size="xs" /> }))]}
                />
                <FilterSelect
                  label="Campaign"
                  value={fCampaign}
                  onValueChange={(v) => {
                    setFCampaign(v);
                    resetPage();
                  }}
                  options={[{ value: "all", label: "All" }, ...[...campaigns].map(([id, title]) => ({ value: id, label: title }))]}
                />
                <FilterSelect
                  label="Status"
                  value={fStatus}
                  onValueChange={(v) => {
                    setFStatus(v);
                    resetPage();
                  }}
                  options={[
                    { value: "all", label: "All" },
                    { value: "verified", label: "Verified" },
                    { value: "pending", label: "Pending" },
                    { value: "invoice", label: "Invoices" },
                  ]}
                />
                {allSelectable.length > 0 && <SelectFirst selected={nSelAll} total={allSelectable.length} onSelect={selectFirst} />}
              </div>

              {pending.data && pending.data.total > pending.data.items.length && (
                <p className="rounded-md bg-warning-soft px-4 py-3 text-small text-warning-fg">Showing the newest {pending.data.items.length} of {pending.data.total} dues. Pay these first, then the rest appear.</p>
              )}
              {pending.data && pending.data.invoices.length >= 500 && (
                <p className="rounded-md bg-warning-soft px-4 py-3 text-small text-warning-fg">Showing the newest 500 invoices. Pay these first, then older ones appear.</p>
              )}
              <Card className="ledger-panel">
                {selectedDues.length > 0 && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b bg-brand-soft px-5 py-3 text-small" role="status" data-testid="selection-bar">
                    <span className="font-semibold text-foreground">
                      {nSelAll === allSelectable.length && selectedDues.length === nSelAll
                        ? `All ${plural(nSelAll, "due")}${filtered ? " matching these filters" : ""} selected`
                        : `${plural(selectedDues.length, "due")} selected`}
                    </span>
                    {nSelAll < allSelectable.length && (
                      <Button
                        variant="link"
                        size="sm"
                        // Adds to the selection like the header checkbox, so dues ticked under another filter stay ticked.
                        onClick={() => setSelected((s) => new Set([...s, ...allSelectable.map((r) => r.key)]))}
                      >
                        Select all {plural(allSelectable.length, "due")}
                      </Button>
                    )}
                    <Button variant="link" size="sm" onClick={() => setSelected(new Set())}>
                      Clear selection
                    </Button>
                  </div>
                )}
                {pending.isError ? (
                  <LoadError onRetry={() => pending.refetch()} what="this vendor's dues" />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>
                          <Checkbox
                            aria-label={`Select all ${plural(allSelectable.length, "due")}`}
                            checked={headerState}
                            disabled={allSelectable.length === 0}
                            onCheckedChange={(v) =>
                              setSelected((s) => {
                                const n = new Set(s);
                                allSelectable.forEach((r) => (v === true ? n.add(r.key) : n.delete(r.key)));
                                return n;
                              })
                            }
                          />
                        </TableHead>
                        <TableHead>Content</TableHead>
                        <TableHead>Campaign</TableHead>
                        <TableHead>Page</TableHead>
                        <TableHead>Posted</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pending.isLoading
                        ? Array.from({ length: 5 }, (_, i) => (
                            <TableRow key={i}>
                              <TableCell colSpan={7}>
                                <Skeleton className="h-9 w-full" />
                              </TableCell>
                            </TableRow>
                          ))
                        : shown.map((r) => <DueTableRow key={r.key} row={r} selected={selected.has(r.key)} selectable={selectable(r)} onToggle={(on) => toggle(r.key, on)} assetById={assetById} />)}
                      {!pending.isLoading && shown.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={7}>
                            {rows.length === 0 ? (
                              <EmptyState name="empty-dues" title={`Nothing is owed to ${name}`}>
                                New posts show up here once they go live.
                              </EmptyState>
                            ) : (
                              <EmptyState name="empty-search" title="No dues match these filters">
                                Try another month, page or status.
                              </EmptyState>
                            )}
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                )}
                <Pager total={visible.length} page={current} pages={pageCount} noun="dues" onPage={setPage} />
              </Card>
            </TabsContent>

            <TabsContent value="paid">
              <PaidTab ledger={paid} />
            </TabsContent>
            <TabsContent value="invoices">
              <InvoicesTab invoices={pending.data?.invoices ?? []} />
            </TabsContent>
            <TabsContent value="billing">
              <Card className="max-w-xl p-5">
                {profile ? (
                  <dl className="grid grid-cols-[auto_1fr] gap-x-8 gap-y-3 text-body">
                    <dt className="text-muted-foreground">Name on PAN</dt>
                    <dd className="font-semibold">{profile.name}</dd>
                    <dt className="text-muted-foreground">PAN</dt>
                    <dd className="font-semibold">{profile.pan}</dd>
                    <dt className="text-muted-foreground">Bank account</dt>
                    <dd className="font-semibold">•••• {profile.bankAccountNumber.slice(-4)}</dd>
                    <dt className="text-muted-foreground">IFSC</dt>
                    <dd className="font-semibold">{profile.ifscCode}</dd>
                    <dt className="text-muted-foreground">GSTIN</dt>
                    <dd className="font-semibold">{profile.gstin || "Not registered"}</dd>
                    <dt className="text-muted-foreground">Status</dt>
                    <dd>
                      <StatusPill tone={profile.approvalStatus === "approved" ? "success" : profile.approvalStatus === "pending" ? "warning" : "danger"}>{profile.approvalStatus === "approved" ? "Approved" : profile.approvalStatus === "pending" ? "Pending approval" : "Rejected"}</StatusPill>
                    </dd>
                  </dl>
                ) : billing.isLoading ? (
                  <Skeleton className="h-24 w-full" />
                ) : (
                  <p className="text-muted-foreground">No billing profile on file. The vendor adds one from their profile.</p>
                )}
              </Card>
            </TabsContent>
          </Tabs>
        </section>

        {/* One payout rail: beside the content on wide screens, under it on smaller ones. */}
        <aside id="payout-rail" className="flex scroll-mt-24 flex-col gap-5 xl:sticky xl:top-24" aria-label="Process payout">
          <div className="hidden justify-end gap-3 xl:flex">
            <Button size="lg" onClick={focusRail}>
              <CreditCard />
              Process Payout
            </Button>
          </div>
          {rail}
        </aside>
        <div className="fixed inset-x-0 bottom-0 z-20 flex items-center gap-3 border-t bg-card px-4 pb-6 pt-3 shadow-3 xl:hidden">
          <div className="min-w-0 flex-1">
            <p className="text-small font-semibold">{selectedDues.length ? `${selectedDues.length} selected for payout` : "Process payout"}</p>
            <p className="text-small text-muted-foreground">{selectedDues.length ? "Review taxes, payment and receipt" : "Tick dues to pay them"}</p>
          </div>
          <Button onClick={focusRail}>
            <CreditCard />
            Go to payout
          </Button>
        </div>
        <div className="h-20 xl:hidden" aria-hidden />
      </div>
    </TooltipProvider>
  );
}

function DueTableRow({ row, selected, selectable, onToggle, assetById }: { row: DueRow; selected: boolean; selectable: boolean; onToggle: (on: boolean) => void; assetById: Map<string, Asset> }) {
  const date = new Date(row.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  if (row.kind === "invoice") {
    const inv = row.invoice;
    const handles = [...new Set(inv.links.map((l) => l.asset?.handle).filter(Boolean))] as string[];
    return (
      <TableRow data-state={selected ? "selected" : undefined}>
        <TableCell>
          <Checkbox aria-label={`Select invoice ${inv.invoiceNumber}`} checked={selected} disabled={!selectable} onCheckedChange={(v) => onToggle(v === true)} />
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-3">
            <span className="grid h-control w-control place-items-center rounded-sm bg-brand-soft text-brand-ink">
              <FileText className="h-4 w-4" aria-hidden />
            </span>
            <span>
              <span className="block font-medium">Invoice {inv.invoiceNumber}</span>
              <span className="block text-small text-fg-muted">
                {inv.links.length} post{inv.links.length === 1 ? "" : "s"} · raised by the creator
              </span>
            </span>
          </div>
        </TableCell>
        <TableCell>
          <span className="block font-medium">{[...new Set(inv.links.map((l) => l.campaign?.title).filter(Boolean))].join(", ") || "—"}</span>
        </TableCell>
        <TableCell className="text-muted-foreground">{handles.map((h) => displayHandle(h)).join(", ")}</TableCell>
        <TableCell className="whitespace-nowrap text-muted-foreground">{date}</TableCell>
        <TableCell>
          {selectable ? (
            <StatusPill tone="info">{inv.status === "APPROVED" ? "Invoice approved" : "Invoice raised"}</StatusPill>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0}>
                  <StatusPill tone="danger">Can&apos;t pay yet</StatusPill>
                </span>
              </TooltipTrigger>
              <TooltipContent>{inv.overQuotaCount ? "It has posts beyond the campaign booking. Reject it so the creator can re-raise it." : "One of its posts is already on another payout."}</TooltipContent>
            </Tooltip>
          )}
        </TableCell>
        <TableCell className="text-right text-body font-bold">
          <Money value={inv.amount} />
        </TableCell>
      </TableRow>
    );
  }
  const link = row.link;
  const asset = assetById.get(link.asset.id);
  const snap = latestSnapshot(link);
  const st = dueStatus(link.status);
  const title = captionTitle(snap?.caption) ?? formatLabel(link.format);
  return (
    <TableRow data-state={selected ? "selected" : undefined}>
      <TableCell>
        <Checkbox aria-label={`Select ${title}`} checked={selected} onCheckedChange={(v) => onToggle(v === true)} />
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-3">
          <ContentThumb src={postThumbSrc(link)} format={link.format} />
          <span className="min-w-0">
            <a href={link.url} target="_blank" rel="noreferrer" className="block max-w-[200px] truncate font-medium text-foreground hover:text-brand-ink hover:underline">
              {title}
            </a>
            <span className="block text-small text-fg-muted">{formatLabel(link.format)}</span>
          </span>
        </div>
      </TableCell>
      <TableCell>
        <span className="block max-w-[180px] truncate font-medium">{link.campaign?.title ?? "—"}</span>
        <span className="block text-small text-fg-muted">{link.campaign?.brandName}</span>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <PageAvatar assetId={link.asset.id} handle={link.asset.handle} size="sm" />
          <span className="min-w-0">
            <span className="block truncate font-medium">{displayHandle(link.asset.handle, asset?.platform)}</span>
            <span className="block text-small text-fg-muted">{audienceLabel(asset?.followers, asset?.platform, true) ?? ""}</span>
          </span>
        </div>
      </TableCell>
      <TableCell className="whitespace-nowrap text-muted-foreground">{date}</TableCell>
      <TableCell>
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={0} className="rounded-sm focus-visible:outline-none focus-visible:ring-focus focus-visible:ring-ring-soft">
              <StatusPill tone={st.tone}>{st.label}</StatusPill>
            </span>
          </TooltipTrigger>
          <TooltipContent>{st.detail}</TooltipContent>
        </Tooltip>
      </TableCell>
      <TableCell className="text-right text-body font-bold">
        <Money value={link.cost} />
      </TableCell>
    </TableRow>
  );
}

function PaidTab({ ledger }: { ledger: ReturnType<typeof usePaidLedger> }) {
  if (ledger.isLoading) return <Skeleton className="h-32 w-full rounded-card" />;
  if (ledger.isError) return <LoadError onRetry={() => ledger.refetch()} what="the paid history" />;
  const items = ledger.data?.items ?? [];
  if (items.length === 0) return <Card className="p-8 text-center text-muted-foreground">Nothing has been paid to this vendor yet.</Card>;
  const total = ledger.data?.total ?? items.length;
  return (
    <Card className="ledger-panel">
      {total > items.length && <p className="bg-warning-soft px-5 py-3 text-small text-warning-fg">Showing the latest {items.length} of {total} payments.</p>}
      <PaidTable rows={items} />
    </Card>
  );
}

function InvoicesTab({ invoices }: { invoices: PaymentInvoice[] }) {
  if (invoices.length === 0) return <Card className="p-8 text-center text-muted-foreground">No raised invoices waiting to be paid. Creators raise them from their own Money page.</Card>;
  return (
    <Card className="divide-y overflow-hidden">
      {invoices.map((inv) => (
        <div key={inv.id} className="flex flex-wrap items-center gap-4 px-5 py-4 text-small">
          <span className="w-36 font-semibold">Invoice {inv.invoiceNumber}</span>
          <span className="flex-1 text-muted-foreground">
            {inv.links.length} posts · raised {new Date(inv.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
          </span>
          <StatusPill tone={inv.selectable ? "info" : "danger"}>{inv.status === "APPROVED" ? "Approved" : "Raised"}</StatusPill>
          <Money value={inv.amount} className="font-bold" />
        </div>
      ))}
      <p className="px-5 py-3 text-caption text-muted-foreground">Pay an invoice by ticking it in Dues. It&apos;s paid with its posts in one payout.</p>
    </Card>
  );
}

function focusRail() {
  const el = document.getElementById("payout-rail");
  el?.scrollIntoView({ behavior: "smooth", block: "start" });
  el?.querySelector<HTMLElement>("button:not([disabled]), input")?.focus({ preventScroll: true });
}

/** v1's "Select [N] of M" stepper: type a number or step it; it ticks the first N payable dues in the order shown. */
function SelectFirst({ selected, total, onSelect }: { selected: number; total: number; onSelect: (n: number) => void }) {
  return (
    <div className="flex items-center gap-2 text-small text-muted-foreground sm:ml-auto">
      <span>Select first</span>
      <div className="flex h-control items-center overflow-hidden rounded-md border border-input bg-card focus-within:border-ring focus-within:shadow-focus">
        <button type="button" aria-label="Select one due fewer" disabled={selected === 0} onClick={() => onSelect(selected - 1)} className="grid h-full w-8 place-items-center text-fg-strong hover:bg-muted disabled:opacity-40">
          <Minus className="h-3.5 w-3.5" aria-hidden />
        </button>
        <input
          type="text"
          inputMode="numeric"
          placeholder="0"
          aria-label="Number of dues to select"
          value={selected || ""}
          onChange={(e) => {
            const digits = e.target.value.replace(/\D/g, "");
            onSelect(digits ? Number(digits) : 0);
          }}
          className="h-full w-12 border-x border-input bg-transparent text-center text-small font-semibold text-foreground outline-none"
        />
        <button type="button" aria-label="Select one due more" disabled={selected >= total} onClick={() => onSelect(selected + 1)} className="grid h-full w-8 place-items-center text-fg-strong hover:bg-muted disabled:opacity-40">
          <Plus className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
      <span>of {total}</span>
    </div>
  );
}
