"use client";

import { useState, type ComponentType } from "react";
import { useQuery } from "@tanstack/react-query";

import { CalendarIcon, ChevronDownIcon, LayersIcon, TargetIcon, WalletIcon } from "@/components/icons";
import { currentMonthKey, periodRange, recentMonths } from "@/components/payments/payments-filters";
import type { PaymentSummary, PaymentsFilters } from "@/lib/api-client";
import { money } from "@/lib/format";
import { cn } from "@/lib/utils";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Tile footnotes — shared with the creator view. */
export function pendingFoot(p: PaymentSummary["pending"] | undefined) {
  if (!p) return "Not paid yet";
  return `${plural(p.links, "link")} not paid yet${p.invoices ? ` · ${plural(p.invoices, "invoice")}` : ""}`;
}
export function paidFoot(p: PaymentSummary["paid"] | undefined) {
  if (!p) return "Paid out";
  return `${plural(p.links, "link")} · ${plural(p.payments, "payment")}`;
}

/** "September 2026" for "2026-09". */
function longMonth(key: string) {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

/**
 * The Payouts tiles. 3 Oct: Total dues / Dues for a month / Paid for a month.
 * 5 Oct redesign: one "Month" picker (top right, starts on this month) drives
 * both month tiles; Total dues stays all time. Vendor/page filters from the
 * bar narrow all three; the bar's own month only narrows the list below.
 * Keys sit under `queryKey` (a ["payments", …] prefix) so paying a vendor
 * refreshes them.
 */
export function SummaryTiles({
  queryKey,
  filters,
  load,
  testId,
}: {
  queryKey: readonly unknown[];
  /** Vendor / page filters only — the month tiles add the picked month. */
  filters: Omit<PaymentsFilters, "from" | "to">;
  load: (filters: PaymentsFilters) => Promise<PaymentSummary>;
  testId: string;
}) {
  const thisMonth = currentMonthKey();
  const [month, setMonth] = useState(thisMonth);
  const range = periodRange({ kind: "month", month });

  const total = useQuery({ queryKey: [...queryKey, "total", filters], queryFn: () => load(filters) });
  const monthly = useQuery({ queryKey: [...queryKey, "month", filters, month], queryFn: () => load({ ...filters, ...range }) });

  const isThisMonth = month === thisMonth;
  const monthName = longMonth(month);
  // Optional all the way down: an unexpected or partial totals response shows ₹0, never crashes the page.
  const paid = monthly.data?.paid;

  return (
    <div className="flex flex-col gap-3" data-testid={testId}>
      <div className="flex justify-end">
        <label className="relative inline-flex h-10 items-center gap-2 rounded-md border border-border-strong bg-surface px-3 text-[0.8125rem] shadow-card focus-within:ring-2 focus-within:ring-ink-10">
          <CalendarIcon className="h-4 w-4 text-text-muted" />
          <span className="text-text-muted">Month:</span>
          <span className="font-semibold text-text">{monthName}</span>
          <ChevronDownIcon className="h-3.5 w-3.5 text-text-muted" />
          <select aria-label="Month" value={month} onChange={(e) => setMonth(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0">
            {recentMonths().map((m) => (
              <option key={m.key} value={m.key}>
                {longMonth(m.key)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 md:gap-4">
        <Tile
          testId="tile-total-dues"
          tone="rose"
          icon={WalletIcon}
          label="Total dues"
          value={money(total.data?.pending?.amount ?? 0)}
          foot={pendingFoot(total.data?.pending)}
        />
        <Tile
          testId="tile-month-dues"
          tone="amber"
          icon={TargetIcon}
          label={isThisMonth ? "Dues this month" : `Dues in ${monthName}`}
          value={money(monthly.data?.pending?.amount ?? 0)}
          foot={monthly.data?.pending ? `${plural(monthly.data.pending.links, "link")} from ${monthName}` : `Posted in ${monthName}`}
        />
        <Tile
          testId="tile-paid"
          tone="green"
          icon={LayersIcon}
          label={isThisMonth ? "Paid this month" : `Paid in ${monthName}`}
          value={money(paid?.amount ?? 0)}
          foot={paid ? `${plural(paid.payments, "payout")} · ${plural(paid.links, "link")} · net of TDS` : "Net of TDS"}
        />
      </div>
    </div>
  );
}

const TONES = {
  rose: { card: "border-rose-line bg-rose-soft", icon: "border-rose-line text-rose" },
  amber: { card: "border-accent-2-line bg-accent-2-soft", icon: "border-accent-2-line text-accent-2" },
  green: { card: "border-accent-line bg-accent-soft", icon: "border-accent-line text-accent" },
} as const;

function Tile({
  testId,
  tone,
  icon: Icon,
  label,
  value,
  foot,
}: {
  testId: string;
  tone: keyof typeof TONES;
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
  foot: string;
}) {
  return (
    <div className={cn("flex min-w-0 items-start gap-4 rounded-lg border p-5 shadow-card", TONES[tone].card)} data-testid={testId}>
      <span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-md border bg-surface", TONES[tone].icon)}>
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-[0.8125rem] font-medium text-text-2">{label}</p>
        <p className="mt-1 truncate text-[1.75rem] font-bold leading-tight tracking-[-0.035em] text-text tabular-nums md:text-[2rem]">{value}</p>
        <p className="mt-1.5 text-[0.75rem] text-text-muted">{foot}</p>
      </div>
    </div>
  );
}
