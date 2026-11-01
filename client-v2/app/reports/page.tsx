"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, XAxis, YAxis } from "recharts";
import { CalendarDays, Download } from "lucide-react";

import { useAuth } from "@/lib/auth-context";
import { canUse, hasAccess, links as linksApi, payments as paymentsApi, type Link as Post } from "@/lib/api-client";
import { monthKeyOf, monthLabel, monthRange, recentMonths, type MonthKey } from "@/lib/finance";
import { compactNumber, money, plural } from "@/lib/format";
import { useCampaigns } from "@/lib/queries/campaigns";
import { cn } from "@/lib/utils";
import { Illustration } from "@/components/taggify/illustration";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FilterSelect } from "@/components/taggify/filter-select";
import { Money } from "@/components/taggify/money";
import { SpendMeter } from "@/components/taggify/progress-meter";
import { PlatformIcon } from "@/components/taggify/platform-icon";
import { displayHandle, PageAvatar } from "@/components/finance/identity";
import { LoadError, NoAccess } from "@/components/finance/states";
import { Rows, SectionCard } from "@/components/home/staff-home";

const rupeesShort = (n: number) => `₹${compactNumber(n)}`;

/** Same rule as the server's campaign spend (campaigns/service.js countsTowardCampaign): rejected proofs, broken links and posts beyond the booking don't count. */
const countsAsWork = (l: Pick<Post, "status" | "overQuota">) => l.status !== "SCREENSHOT_REJECTED" && l.status !== "INVALID" && !l.overQuota;

/** Client-side CSV of what's on screen (there's no export endpoint). Quotes every cell. */
function downloadCsv(name: string, header: string[], rows: (string | number)[][]) {
  // Quote every cell; a text cell starting with = + - @ gets a leading ' so spreadsheets don't run it as a formula.
  const cell = (v: string | number) => {
    const t = typeof v === "string" && /^[=+\-@]/.test(v) ? `'${v}` : String(v);
    return `"${t.replace(/"/g, '""')}"`;
  };
  const csv = [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ReportsPage() {
  return (
    <AppShell active="reports">
      <Reports />
    </AppShell>
  );
}

/**
 * Reports (spec §13: functional, not decorative). Three reports from data the API
 * already serves: payouts by month (finance.pay), campaign spend vs budget
 * (campaigns.view) and pages by posts delivered in a month (links.view). Each is
 * gated on its own permission; charts are shadcn Chart only.
 */
function Reports() {
  const { user } = useAuth();
  const staff = !!user && user.role !== "CREATOR" && user.role !== "TEAM_MEMBER" && user.role !== "PLAN_MAKER";
  const can = { pay: hasAccess(user, "finance.pay"), campaigns: canUse(user, "campaigns.view"), links: hasAccess(user, "links.view") };
  if (!staff || (!can.pay && !can.campaigns && !can.links)) return <NoAccess what="Reports" />;
  return (
    <div className="workspace-page">
      <div className="page-heading items-center">
        <div className="page-heading-copy">
          <h1 className="text-display">Reports</h1>
          <p className="mt-1 text-body text-muted-foreground">Payouts, spend and delivery, by month and by campaign. Export what you need for month-end.</p>
        </div>
        <Illustration name="analytics-01" className="hidden w-32 shrink-0 sm:block" />
      </div>
      {(can.pay || can.campaigns) && (
        <div className={cn("grid items-start gap-6", can.pay && can.campaigns && "xl:grid-cols-2")}>
          {can.pay && <PayoutsByMonth />}
          {can.campaigns && <SpendVsBudget />}
        </div>
      )}
      {can.links && <PagesDelivered />}
    </div>
  );
}

const payoutsChart = { paid: { label: "Paid to creators", color: "rgb(var(--chart-muted))" }, current: { label: "Paid to creators", color: "rgb(var(--chart-primary))" } } satisfies ChartConfig;

function PayoutsByMonth() {
  const { accessToken } = useAuth();
  const [range, setRange] = useState("6");
  const months = useMemo(() => recentMonths(Number(range)).slice().reverse(), [range]);
  const now = monthKeyOf(new Date());
  // One summary per month: the same figure Payouts shows as "Paid This Month" (net of TDS).
  const results = useQueries({
    queries: months.map((m) => ({ queryKey: ["payments", "summary", monthRange(m)], queryFn: () => paymentsApi.summary(accessToken!, monthRange(m)), enabled: !!accessToken })),
  });
  const loading = results.some((r) => r.isLoading);
  const failed = results.some((r) => r.isError);
  const data = months.map((m, i) => ({ key: m, month: monthLabel(m), long: monthLabel(m, "long"), paid: results[i]?.data?.paid.amount ?? 0, payments: results[i]?.data?.paid.payments ?? 0 }));
  const total = Math.round(data.reduce((s, d) => s + Math.round(d.paid * 100), 0)) / 100;

  return (
    <section aria-labelledby="rep-payouts">
      <Card className="ledger-panel">
        <div className="panel-heading">
          <div>
            <h2 id="rep-payouts" className="text-card-title">
              Paid to creators, by month
            </h2>
            <p className="text-small text-muted-foreground">Paid out, after TDS · {loading ? "…" : `${money(total)} over ${plural(months.length, "month")}`}</p>
          </div>
          <FilterSelect
            className="ml-auto"
            label="Range"
            icon={CalendarDays}
            value={range}
            onValueChange={setRange}
            options={[
              { value: "6", label: "Last 6 months" },
              { value: "12", label: "Last 12 months" },
            ]}
          />
          <Button variant="outline" size="sm" disabled={loading || failed} onClick={() => downloadCsv(`taggify-payouts-${months[0]}-to-${months.at(-1)}.csv`, ["Month", "Payments", "Paid out (INR, after TDS)"], data.map((d) => [d.long, d.payments, d.paid.toFixed(2)]))}>
            <Download />
            Export CSV
          </Button>
        </div>
        {failed ? (
          <LoadError onRetry={() => results.forEach((r) => r.isError && r.refetch())} what="payouts" />
        ) : loading ? (
          <div className="p-5">
            <Skeleton className="h-64 w-full" />
          </div>
        ) : (
          <div className="p-5">
            <ChartContainer config={payoutsChart} className="h-64 w-full" aria-label={`Bar chart of payouts per month. ${data.map((d) => `${d.long}: ${money(d.paid)}`).join("; ")}`} role="img">
              {/* The container is the accessible image; recharts' own keyboard layer would be a hidden widget inside it. */}
              <BarChart data={data} margin={{ top: 20, right: 8, left: 8, bottom: 0 }} accessibilityLayer={false}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} />
                <YAxis tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => rupeesShort(v)} />
                <ChartTooltip cursor content={<ChartTooltipContent labelKey="long" formatter={(v) => money(v)} />} />
                <Bar dataKey="paid" radius={6} maxBarSize={48} fill="var(--color-paid)">
                  <LabelList dataKey="paid" position="top" className="fill-foreground" formatter={(v: unknown) => (Number(v) ? rupeesShort(Number(v)) : "")} />
                  {data.map((d) => (
                    <Cell key={d.key} fill={d.key === now ? "var(--color-current)" : "var(--color-paid)"} />
                  ))}
                </Bar>
              </BarChart>
            </ChartContainer>
            <div className="mt-3 flex flex-wrap gap-4 text-small text-muted-foreground">
              <span className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-sm bg-chart-muted" aria-hidden />
                Earlier months
              </span>
              <span className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-sm bg-chart-primary" aria-hidden />
                {monthLabel(now, "long")} so far
              </span>
            </div>
          </div>
        )}
      </Card>
    </section>
  );
}

/** Budgeted campaigns, most of their budget used first. */
function SpendVsBudget() {
  const { user } = useAuth();
  const campaigns = useCampaigns();
  const rows = useMemo(
    () =>
      (campaigns.data ?? [])
        .filter((c) => c.costCap && Number(c.costCap) > 0)
        .map((c) => ({ c, cap: Number(c.costCap), spent: c.spent ?? 0 }))
        .sort((a, b) => b.spent / b.cap - a.spent / a.cap),
    [campaigns.data]
  );
  const unbudgeted = (campaigns.data ?? []).length - rows.length;
  const toCampaign = canUse(user, "campaigns.view");
  return (
    <SectionCard title="Campaign spend vs budget">
      <Rows loading={campaigns.isLoading} error={campaigns.isError} empty={rows.length ? null : "No campaign has a budget set yet."}>
        {rows.slice(0, 10).map(({ c, cap, spent }) => {
          const body = (
            <>
              <span className="min-w-0 flex-1 truncate text-body-strong">{c.title}</span>
              <SpendMeter spent={spent} cap={cap} label={`${c.title} spend against budget`} className="w-64 shrink-0" />
            </>
          );
          return (
            <li key={c.id}>
              {toCampaign ? (
                <Link href={`/campaigns/${c.id}`} className="flex items-center gap-3 px-5 py-3 text-foreground hover:bg-accent hover:text-foreground">
                  {body}
                </Link>
              ) : (
                <div className="flex items-center gap-3 px-5 py-3">{body}</div>
              )}
            </li>
          );
        })}
      </Rows>
      {!campaigns.isLoading && unbudgeted > 0 && <p className="border-t px-5 py-3 text-small text-muted-foreground">{plural(unbudgeted, "campaign")} without a budget {unbudgeted === 1 ? "isn't" : "aren't"} shown.</p>}
    </SectionCard>
  );
}

type PageRow = { assetId: string; handle: string; platform: string; posts: number; views: number[]; earned: number };

/** Posts submitted in a month, per page (broken links excluded), with average views and what they earned. */
function PagesDelivered() {
  const { accessToken } = useAuth();
  const [month, setMonth] = useState<MonthKey>(monthKeyOf(new Date()));
  const posts = useQuery({
    queryKey: ["links", "reports", month],
    queryFn: async () => {
      // The list caps at 100 a page; read up to 500 posts for the month.
      const items: Post[] = [];
      let total = 0;
      for (let page = 1; page <= 5; page++) {
        const r = await linksApi.list(accessToken!, { ...monthRange(month), page, pageSize: 100 });
        total = r.total;
        items.push(...r.items);
        if (items.length >= r.total || r.items.length === 0) break;
      }
      return { items, total };
    },
    enabled: !!accessToken,
  });
  const rows = useMemo(() => {
    const map = new Map<string, PageRow>();
    for (const l of posts.data?.items ?? []) {
      if (!countsAsWork(l)) continue;
      const r = map.get(l.assetId) ?? { assetId: l.assetId, handle: l.asset?.handle ?? "—", platform: l.asset?.platform ?? "instagram", posts: 0, views: [], earned: 0 };
      r.posts++;
      r.earned = Math.round(r.earned * 100 + Math.round(Number(l.cost) * 100)) / 100;
      const v = l.postSnapshots?.[0]?.videoViews;
      if (v != null && v > 0) r.views.push(v);
      map.set(l.assetId, r);
    }
    return [...map.values()].sort((a, b) => b.posts - a.posts || b.earned - a.earned);
  }, [posts.data]);
  const avg = (v: number[]) => (v.length ? Math.round(v.reduce((s, x) => s + x, 0) / v.length) : null);
  const truncated = (posts.data?.total ?? 0) > (posts.data?.items.length ?? 0);

  return (
    <section aria-labelledby="rep-pages" aria-describedby="rep-pages-note">
      <Card className="ledger-panel">
        <div className="panel-heading">
          <h2 id="rep-pages" className="text-card-title">
            Pages by posts submitted
          </h2>
          <FilterSelect className="ml-auto" label="Month" value={month} onValueChange={(v) => setMonth(v as MonthKey)} options={recentMonths(12).map((m) => ({ value: m, label: monthLabel(m, "long") }))} />
          <Button variant="outline" size="sm" disabled={!rows.length} onClick={() => downloadCsv(`taggify-pages-${month}.csv`, ["Page", "Platform", "Posts", "Avg views", "Earned (INR)"], rows.map((r) => [r.handle, r.platform, r.posts, avg(r.views) ?? "", r.earned.toFixed(2)]))}>
            <Download />
            Export CSV
          </Button>
        </div>
        {posts.isError ? (
          <LoadError onRetry={() => posts.refetch()} what="posts" />
        ) : posts.isLoading ? (
          <div className="p-5">
            <Skeleton className="h-40 w-full" />
          </div>
        ) : rows.length === 0 ? (
          <p className="px-5 py-6 text-small text-muted-foreground">No posts submitted in {monthLabel(month, "long")}.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Page</TableHead>
                <TableHead className="text-right">Posts</TableHead>
                <TableHead className="text-right">Avg views</TableHead>
                <TableHead className="text-right">Earned</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.slice(0, 15).map((r) => (
                <TableRow key={r.assetId}>
                  <TableCell>
                    <span className="flex items-center gap-2">
                      <PageAvatar assetId={r.assetId} handle={r.handle} size="sm" />
                      <PlatformIcon platform={r.platform} size={16} />
                      <span className="font-medium">{displayHandle(r.handle, r.platform)}</span>
                    </span>
                  </TableCell>
                  <TableCell className="text-right">{r.posts}</TableCell>
                  <TableCell className="text-right">{avg(r.views) != null ? compactNumber(avg(r.views)!) : "—"}</TableCell>
                  <TableCell className="text-right font-semibold">
                    <Money value={r.earned} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <p id="rep-pages-note" className="border-t px-5 py-3 text-small text-muted-foreground">
          Posts submitted in {monthLabel(month, "long")} that count as work (not rejected, broken or over booking).
          {rows.length > 15 ? ` Top 15 of ${rows.length} pages shown; the CSV has all.` : ""}
          {truncated ? ` Read the first ${posts.data?.items.length} of ${posts.data?.total} posts.` : ""}
        </p>
      </Card>
    </section>
  );
}
