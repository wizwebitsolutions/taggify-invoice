"use client";

import { useEffect, useState } from "react";

import { SearchIcon, CloseIcon } from "@/components/icons";
import { SearchableSelect } from "@/components/ui/searchable-select";
import type { PageOwner, PaymentsFilters } from "@/lib/api-client";
import { cn } from "@/lib/utils";

/**
 * The Payments tab's filter bar (24 Sep redesign) — the same three filters on
 * Pending and Paid, for Finance and (minus the vendor) for a creator:
 *   · page owner (vendor)
 *   · a specific page, by handle search
 *   · a month, or a custom date range
 * On Pending the date means "posted in"; on Paid it means "paid in" — the
 * server decides which column, the bar only produces from/to.
 */

export type PeriodValue = { kind: "all" } | { kind: "month"; month: string } | { kind: "custom"; from: string; to: string };

export type FilterState = {
  ownerId: string;
  q: string;
  period: PeriodValue;
};

/** "2026-09" for the current month, in local time. */
export function currentMonthKey(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export const DEFAULT_FILTERS: FilterState = { ownerId: "", q: "", period: { kind: "all" } };

/** The last 12 months, newest first, as select options. */
export function recentMonths(count = 12, now = new Date()) {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    return { key: currentMonthKey(d), label: d.toLocaleDateString("en-IN", { month: "short", year: "numeric" }) };
  });
}

/** Period → ISO instants for the API: a month spans its first local midnight to its last millisecond; a custom range includes both end days. */
export function periodRange(period: PeriodValue): { from?: string; to?: string } {
  if (period.kind === "month") {
    const [y, m] = period.month.split("-").map(Number);
    return { from: new Date(y, m - 1, 1).toISOString(), to: new Date(y, m, 1, 0, 0, 0, -1).toISOString() };
  }
  if (period.kind === "custom") {
    const range: { from?: string; to?: string } = {};
    if (period.from) range.from = new Date(`${period.from}T00:00:00`).toISOString();
    if (period.to) range.to = new Date(`${period.to}T23:59:59.999`).toISOString();
    return range;
  }
  return {};
}

export function toApiFilters(state: FilterState, debouncedQ: string): PaymentsFilters {
  return { ownerId: state.ownerId || undefined, q: debouncedQ.trim() || undefined, ...periodRange(state.period) };
}

export function periodLabel(period: PeriodValue) {
  if (period.kind === "month") return recentMonths(24).find((m) => m.key === period.month)?.label ?? period.month;
  if (period.kind === "custom") return "Custom range";
  return "All time";
}

export function useDebounced<T>(value: T, ms = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

const selectClass =
  "h-10 rounded-md border border-border-strong bg-surface px-2.5 text-[0.8125rem] text-text shadow-card focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-10";

export function PaymentsFilterBar({
  state,
  onChange,
  owners,
  dateLabel,
  searchPlaceholder = "Search page, e.g. memes.daily",
  summary,
}: {
  state: FilterState;
  onChange: (next: FilterState) => void;
  /** Omit for the creator view — the vendor is always them. */
  owners?: PageOwner[];
  /** "Posted in" / "Paid in" — what the month refers to on this tab. */
  dateLabel: string;
  searchPlaceholder?: string;
  summary?: string;
}) {
  const months = recentMonths();
  const periodSelectValue = state.period.kind === "month" ? state.period.month : state.period.kind;
  const hasFilters = !!state.ownerId || !!state.q || state.period.kind !== "all";

  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-border bg-surface p-3 shadow-card" data-testid="payments-filters">
      <div className="flex flex-wrap items-center gap-2.5">
        {owners && (
          // Searchable (24 Sep): the vendor list gets long, a plain <select> doesn't scale.
          <SearchableSelect
            aria-label="Page owner"
            value={state.ownerId}
            onChange={(ownerId) => onChange({ ...state, ownerId })}
            options={owners.map((o) => ({ value: o.id, label: o.name ?? o.phoneNumber, hint: o.name ? o.phoneNumber : undefined, keywords: o.email ?? undefined }))}
            placeholder="All page owners"
            emptyText="No page owner matches."
            className="w-full sm:w-[260px]"
          />
        )}

        <label className="flex h-10 w-full items-center gap-2 rounded-md border border-border-strong bg-surface px-2.5 shadow-card sm:w-[260px]">
          <SearchIcon className="h-3.5 w-3.5 shrink-0 text-text-faint" />
          <input
            aria-label="Search page"
            value={state.q}
            onChange={(e) => onChange({ ...state, q: e.target.value.replace(/^@+/, "") })}
            placeholder={searchPlaceholder}
            className="min-w-0 flex-1 bg-transparent text-[0.8125rem] text-text outline-none placeholder:text-text-faint"
          />
          {state.q && (
            <button type="button" aria-label="Clear page search" onClick={() => onChange({ ...state, q: "" })} className="text-text-faint hover:text-text">
              <CloseIcon className="h-3 w-3" />
            </button>
          )}
        </label>

        <label className="flex items-center gap-2 text-[0.8125rem] text-text-muted">
          <span>{dateLabel}</span>
          <select
            aria-label={dateLabel}
            value={periodSelectValue}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "all") onChange({ ...state, period: { kind: "all" } });
              else if (v === "custom") onChange({ ...state, period: { kind: "custom", from: "", to: "" } });
              else onChange({ ...state, period: { kind: "month", month: v } });
            }}
            className={selectClass}
          >
            <option value="all">All time</option>
            {months.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
            <option value="custom">Custom range…</option>
          </select>
        </label>

        {state.period.kind === "custom" && (
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              aria-label="From date"
              value={state.period.from}
              onChange={(e) => onChange({ ...state, period: { kind: "custom", from: e.target.value, to: (state.period as { to: string }).to } })}
              className={selectClass}
            />
            <span className="text-[0.8125rem] text-text-faint">to</span>
            <input
              type="date"
              aria-label="To date"
              value={state.period.to}
              onChange={(e) => onChange({ ...state, period: { kind: "custom", from: (state.period as { from: string }).from, to: e.target.value } })}
              className={selectClass}
            />
          </div>
        )}

        {hasFilters && (
          <button type="button" onClick={() => onChange(DEFAULT_FILTERS)} className="text-[0.8125rem] font-medium text-blue hover:underline">
            Clear filters
          </button>
        )}

        {summary && <span className="ml-auto hidden text-[0.8125rem] text-text-muted lg:inline">{summary}</span>}
      </div>
    </div>
  );
}
