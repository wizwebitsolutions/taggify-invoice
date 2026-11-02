"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useQueries } from "@tanstack/react-query";
import { ArrowUpRight } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { hasAccess, payments } from "@/lib/api-client";
import { monthKeyOf, monthLabel, monthRange, recentMonths } from "@/lib/finance";
import { money } from "@/lib/format";
import { financeKeys } from "@/lib/queries/finance";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PayoutChart } from "@/components/taggify/payout-chart";
import { LoadError } from "./states";

/** Real payout history, only fetched for users who can access payment summaries. */
export function PayoutActivity() {
  const { accessToken, user } = useAuth();
  const canPay = hasAccess(user, "finance.pay");
  const months = useMemo(() => recentMonths(6).slice().reverse(), []);
  const results = useQueries({ queries: months.map((month) => ({
    queryKey: financeKeys.summary(monthRange(month)),
    queryFn: () => payments.summary(accessToken!, monthRange(month)),
    enabled: !!accessToken && canPay,
  })) });
  if (!canPay) return null;
  const loading = results.some((q) => q.isLoading);
  const failed = results.some((q) => q.isError);
  const data = months.map((month, i) => ({ key: month, month: monthLabel(month), long: monthLabel(month, "long"), paid: results[i].data?.paid.amount ?? 0, payments: results[i].data?.paid.payments ?? 0 }));
  const total = data.reduce((paise, row) => paise + Math.round(row.paid * 100), 0) / 100;
  return (
    <section aria-labelledby="home-payout-activity">
      <Card className="analytics-panel">
        <div className="listing-heading">
          <div><p className="page-eyebrow">Finance pulse</p><h2 id="home-payout-activity" className="text-section">Payout activity</h2></div>
          {(user?.role === "ADMIN" || user?.role === "FINANCE") && <Link href="/reports" className="ml-auto inline-flex items-center gap-2 text-small font-semibold text-brand-ink">View reports <ArrowUpRight className="h-4 w-4" aria-hidden /></Link>}
        </div>
        {failed ? <LoadError what="payout history" onRetry={() => results.forEach((q) => q.isError && q.refetch())} /> : loading ? <div className="p-6"><Skeleton className="h-72 w-full" /></div> : <PayoutChart data={data} currentMonth={monthKeyOf(new Date())} total={money(total)} />}
      </Card>
    </section>
  );
}
