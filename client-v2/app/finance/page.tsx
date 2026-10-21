"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CalendarDays, FileText, Landmark, Layers, ReceiptText, Target, Wallet, type LucideIcon } from "lucide-react";

import { useAuth } from "@/lib/auth-context";
import { billing as billingApi, clientInvoices as clientInvoicesApi, hasAccess, invoices as invoicesApi } from "@/lib/api-client";
import { monthKeyOf, monthLabel, monthRange, recentMonths, type MonthKey } from "@/lib/finance";
import { personLabel, plural } from "@/lib/format";
import { useDraftPayouts, usePaidLedger, usePaymentSummary } from "@/lib/queries/finance";
import { AppShell } from "@/components/layout/app-shell";
import { isBuilt } from "@/components/layout/nav-config";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { FilterSelect } from "@/components/taggify/filter-select";
import { MetricTile } from "@/components/taggify/metric-tile";
import { Money } from "@/components/taggify/money";
import { StatusPill } from "@/components/taggify/status-pill";
import { UserAvatar } from "@/components/taggify/user-avatar";
import { NoAccess } from "@/components/finance/states";
import { Rows, SectionCard, VendorsToPay } from "@/components/home/staff-home";

type Attention = { key: string; icon: LucideIcon; count: number; label: string; href: string; screen?: string };

export default function FinanceOverviewPage() {
  return (
    <AppShell active="finance-overview">
      <Overview />
    </AppShell>
  );
}

/**
 * Finance overview (prototype S.finance): dues and payouts (finance.pay), creator
 * invoices and client receivables (finance.view). Each section asks only for what
 * the server would serve this user.
 */
function Overview() {
  const { user, accessToken } = useAuth();
  const canView = hasAccess(user, "finance.view");
  const canPay = hasAccess(user, "finance.pay");
  const [month, setMonth] = useState<MonthKey>(monthKeyOf(new Date()));
  const range = monthRange(month);

  const total = usePaymentSummary({});
  const monthSummary = usePaymentSummary(range);
  const drafts = useDraftPayouts();
  const paid = usePaidLedger(range);
  const viewToken = canView ? accessToken : null;
  const raised = useQuery({ queryKey: ["invoices", "overview", "raised"], queryFn: () => invoicesApi.list(viewToken!, { status: "RAISED", pageSize: 1 }), enabled: !!viewToken });
  const issued = useQuery({ queryKey: ["clientInvoices", "overview", "issued"], queryFn: () => clientInvoicesApi.list(viewToken!, { status: "ISSUED" }), enabled: !!viewToken });
  const clientPaid = useQuery({ queryKey: ["clientInvoices", "overview", "paid"], queryFn: () => clientInvoicesApi.list(viewToken!, { status: "PAID" }), enabled: !!viewToken });
  // Bank details (account numbers) are fetched only for payers, who are the ones who approve them.
  const bank = useQuery({ queryKey: ["billing", "all"], queryFn: () => billingApi.list(accessToken!), enabled: !!accessToken && canPay && canView });

  if (!canView) return <NoAccess what="the Finance overview" hint="Ask an admin to give you the Finance “view” permission if you need it." />;

  const unpaid = issued.data?.items ?? [];
  // Money is summed in whole paise and converted once, never as running floats.
  const sumRupees = (xs: (string | number | null | undefined)[]) => xs.reduce<number>((p, x) => p + Math.round(Number(x ?? 0) * 100), 0) / 100;
  const unpaidTotal = sumRupees(unpaid.map((i) => i.total));
  const oldest = unpaid.reduce<string | null>((o, i) => (!o || i.issuedAt < o ? i.issuedAt : o), null);
  const paidInMonth = (clientPaid.data?.items ?? []).filter((i) => i.paidAt && i.paidAt >= range.from && i.paidAt <= range.to);
  // Approving bank details is a finance.pay action, so only payers get the count.
  const bankPending = canPay ? (bank.data ?? []).filter((b) => b.approvalStatus === "pending").length : 0;
  const current = month === monthKeyOf(new Date());

  const attention: Attention[] = [
    ...(canPay ? [{ key: "drafts", icon: ReceiptText, count: drafts.data?.total ?? 0, label: (drafts.data?.total ?? 0) === 1 ? "Payout waiting for its receipt" : "Payouts waiting for receipts", href: "/finance/payouts" }] : []),
    { key: "raised", icon: FileText, count: raised.data?.total ?? 0, label: (raised.data?.total ?? 0) === 1 ? "Creator invoice waiting for approval" : "Creator invoices waiting for approval", href: "/finance/invoices", screen: "invoices" },
    ...(canPay ? [{ key: "bank", icon: Landmark, count: bankPending, label: "Bank details to check", href: "/approvals?type=billing" }] : []),
    { key: "issued", icon: Wallet, count: unpaid.length, label: unpaid.length === 1 ? "Client invoice unpaid" : "Client invoices unpaid", href: "/finance/receivables", screen: "receivables" },
  ].filter((a) => a.count > 0);
  const attentionQueries = canPay ? [drafts, raised, issued, bank] : [raised, issued];
  const attentionLoading = attentionQueries.some((q) => q.isLoading);
  const attentionFailed = attentionQueries.some((q) => q.isError);
  const loadingTiles = total.isLoading || monthSummary.isLoading;

  return (
    <div className="flex flex-col gap-6 pt-2">
      <div className="flex flex-wrap items-start gap-4">
        <div>
          <p className="text-body font-medium text-fg-strong">Finance</p>
          <h1 className="text-display">Overview</h1>
          <p className="mt-1 text-body text-muted-foreground">Dues to creators, payouts, and what clients still owe.</p>
        </div>
        <FilterSelect className="ml-auto" label="Month" icon={CalendarDays} value={month} onValueChange={(v) => setMonth(v as MonthKey)} options={recentMonths(12).map((m) => ({ value: m, label: monthLabel(m, "long") }))} />
      </div>

      {canPay && (
        <div className="grid gap-4 md:grid-cols-3">
          <MetricTile tone="coral" icon={Wallet} label="Total Dues" loading={loadingTiles} value={<Money value={total.data?.pending.amount ?? 0} />} meta={`${plural(total.data?.pending.links ?? 0, "post")}${total.data?.pending.invoices ? ` · ${plural(total.data.pending.invoices, "invoice")}` : ""} · all months`} />
          <MetricTile tone="amber" icon={Target} label={current ? "Dues This Month" : `Dues in ${monthLabel(month, "long")}`} loading={loadingTiles} value={<Money value={monthSummary.data?.pending.amount ?? 0} />} meta={`${plural(monthSummary.data?.pending.links ?? 0, "post")}${monthSummary.data?.pending.invoices ? ` · ${plural(monthSummary.data.pending.invoices, "invoice")}` : ""} from ${monthLabel(month, "long")}`} />
          <MetricTile tone="mint" icon={Layers} label={current ? "Paid This Month" : `Paid in ${monthLabel(month, "long")}`} loading={loadingTiles} value={<Money value={monthSummary.data?.paid.amount ?? 0} />} meta={`${plural(monthSummary.data?.paid.payments ?? 0, "payout")} · net of TDS`} />
        </div>
      )}

      <section aria-labelledby="fin-attn" className="flex flex-col gap-3">
        <h2 id="fin-attn" className="text-section">
          Needs attention <span className="text-body font-normal text-muted-foreground">right now</span>
        </h2>
        {attentionFailed && attention.length > 0 && (
          <p role="alert" className="-mt-1 text-small text-danger-helper">
            Some of this couldn&apos;t load, so the list may be incomplete. Refresh to try again.
          </p>
        )}
        {attentionLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: attentionQueries.length }, (_, i) => (
              <Skeleton key={i} className="h-20 rounded-card" />
            ))}
          </div>
        ) : attentionFailed && attention.length === 0 ? (
          <Card role="alert" className="p-4 text-body text-danger-helper">
            Couldn&apos;t check what needs attention. Refresh the page to try again.
          </Card>
        ) : attention.length === 0 ? (
          <Card className="p-4 text-body text-muted-foreground">All clear. Nothing is waiting on Finance.</Card>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {attention.map((a) => {
              const inner = (
                <>
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-tile-coral-icon text-tile-coral-fg">
                    <a.icon className="h-5 w-5" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="num block text-section">{a.count}</span>
                    <span className="block text-small text-fg-muted">{a.label}</span>
                  </span>
                </>
              );
              const live = !a.screen || isBuilt(a.screen);
              return (
                <li key={a.key}>
                  {live ? (
                    <Link href={a.href} className="flex items-center gap-3 rounded-card border bg-card p-4 text-foreground shadow-2 transition-colors hover:border-brand hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring-soft">
                      {inner}
                      <ArrowRight className="h-4 w-4 text-fg-muted" aria-hidden />
                    </Link>
                  ) : (
                    // That screen isn't built yet: show the number, don't link to a 404.
                    <div className="flex items-center gap-3 rounded-card border bg-card p-4 shadow-2">{inner}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="grid items-start gap-6 xl:grid-cols-2">
        {canPay && <VendorsToPay />}
        {canPay && (
          <SectionCard title={`Payouts in ${monthLabel(month, "long")}`} href="/finance/payouts?view=paid" linkLabel="Paid payouts">
            <Rows loading={paid.isLoading} error={paid.isError} empty={(paid.data?.items.length ?? 0) ? null : "No payouts this month."}>
              {(paid.data?.items ?? []).slice(0, 5).map((r) => {
                const creator = r.kind === "payout" ? r.payout.creator : r.invoice.creator;
                const amount = r.kind === "payout" ? r.payout.netAmount : r.invoice.amount;
                const meta = [
                  r.paidAt ? new Date(r.paidAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : null,
                  r.kind === "payout" && r.payout.tdsPercent ? `TDS ${Number(r.payout.tdsPercent)}%` : null,
                  r.kind === "payout" && r.payout.utr ? `UTR ${r.payout.utr}` : null,
                  r.kind === "invoice" ? `Invoice ${r.invoice.invoiceNumber}` : null,
                ].filter(Boolean);
                const id = r.kind === "payout" ? r.payout.creatorId : r.invoice.creatorId;
                return (
                  <li key={r.kind === "payout" ? r.payout.id : r.invoice.id}>
                    <Link href={`/finance/payouts/${id}?tab=paid`} className="flex items-center gap-3 px-5 py-3 text-foreground hover:bg-accent hover:text-foreground">
                      <UserAvatar name={personLabel(creator, "Vendor")} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-body-strong">
                          {personLabel(creator, "Vendor")} · <Money value={amount} />
                        </span>
                        <span className="block truncate text-small text-fg-muted">{meta.join(" · ")}</span>
                      </span>
                      <StatusPill tone="success">Paid</StatusPill>
                    </Link>
                  </li>
                );
              })}
            </Rows>
          </SectionCard>
        )}
        <SectionCard title="Client receivables" href={isBuilt("receivables") ? "/finance/receivables" : undefined} linkLabel="Open">
          {issued.isLoading || clientPaid.isLoading ? (
            <div className="p-5">
              <Skeleton className="h-20" />
            </div>
          ) : issued.isError || clientPaid.isError ? (
            <p className="px-5 py-6 text-small text-danger-helper">Couldn&apos;t load this. Refresh the page to try again.</p>
          ) : (
            <dl className="divide-y">
              <div className="flex items-center gap-3 px-5 py-3">
                <dt className="min-w-0 flex-1">
                  <span className="block text-body">Issued, unpaid</span>
                  <span className="block text-small text-fg-muted">
                    {plural(unpaid.length, "invoice")}
                    {oldest ? ` · oldest from ${new Date(oldest).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}` : ""}
                  </span>
                </dt>
                <dd className="text-card-title">
                  <Money value={unpaidTotal} />
                </dd>
              </div>
              <div className="flex items-center gap-3 px-5 py-3">
                <dt className="min-w-0 flex-1">
                  <span className="block text-body">Paid in {monthLabel(month, "long")}</span>
                  <span className="block text-small text-fg-muted">{plural(paidInMonth.length, "invoice")}</span>
                </dt>
                <dd className="text-card-title">
                  <Money value={sumRupees(paidInMonth.map((i) => i.paidAmount ?? i.total))} />
                </dd>
              </div>
            </dl>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
