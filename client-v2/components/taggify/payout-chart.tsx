"use client";

import { useId } from "react";
import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { compactNumber, money } from "@/lib/format";

const config = {
  paid: { label: "Paid to creators", color: "rgb(var(--chart-muted))" },
  current: { label: "Current month", color: "rgb(var(--chart-primary))" },
} satisfies ChartConfig;

// Shared chart geometry. Both Dashboard and Reports use this presentation.
const geometry = { radius: 8, maxBar: 48, margin: { top: 16, right: 8, bottom: 0, left: 0 } };
export type PayoutPoint = { key: string; month: string; long: string; paid: number; payments: number };

export function PayoutChart({ data, currentMonth, total }: { data: PayoutPoint[]; currentMonth: string; total: string }) {
  const gradient = `payout-${useId().replace(/:/g, "")}`;
  const current = data.find((d) => d.key === currentMonth);
  const highest = data.reduce<PayoutPoint | undefined>((best, d) => !best || d.paid > best.paid ? d : best, undefined);
  const hasPayments = data.some((d) => d.paid > 0);
  return (
    <div className="analytics-body">
      <div className="analytics-summary">
        <div>
          <p className="text-small text-muted-foreground">Total paid · {data.length} months</p>
          <p className="num mt-2 text-display">{total}</p>
        </div>
        <div className="analytics-period">After TDS · INR</div>
      </div>
      {hasPayments ? (
        <ChartContainer config={config} className="payout-plot" role="img" aria-label={`Bar chart of payouts per month. ${data.map((d) => `${d.long}: ${money(d.paid)}`).join("; ")}`}>
          <BarChart data={data} margin={geometry.margin} barCategoryGap="32%" accessibilityLayer={false}>
            <defs>
              <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgb(var(--chart-primary))" />
                <stop offset="100%" stopColor="rgb(var(--chart-primary))" stopOpacity={0.5} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} strokeDasharray="4 6" />
            <XAxis dataKey="month" axisLine={false} tickLine={false} tickMargin={12} minTickGap={12} />
            <YAxis axisLine={false} tickLine={false} width={56} tickFormatter={(v: number) => `₹${compactNumber(v)}`} />
            <ChartTooltip cursor content={<ChartTooltipContent labelKey="long" formatter={(v) => money(v)} />} />
            <Bar dataKey="paid" radius={[geometry.radius, geometry.radius, 0, 0]} maxBarSize={geometry.maxBar} isAnimationActive={false}>
              {data.map((d) => <Cell key={d.key} fill={d.key === currentMonth ? `url(#${gradient})` : "var(--color-paid)"} />)}
            </Bar>
          </BarChart>
        </ChartContainer>
      ) : (
        <div className="analytics-empty"><p className="text-card-title">No payouts in this period</p><p className="text-small text-muted-foreground">Completed payouts will appear here, month by month.</p></div>
      )}
      <dl className="analytics-facts">
        <div><dt>This month</dt><dd>{money(current?.paid ?? 0)}</dd></div>
        <div><dt>Highest month</dt><dd>{hasPayments && highest ? highest.long : "—"}</dd></div>
        <div><dt>Payments in period</dt><dd>{data.reduce((sum, d) => sum + d.payments, 0)}</dd></div>
      </dl>
    </div>
  );
}
