"use client";

import { useState } from "react";
import { MoneyField, FieldError } from "@/components/ui/form-field";
import { CloseIcon, PlusIcon } from "@/components/icons";
import { FORMATS, FORMAT_LABELS, REQUIRED_RATE_FORMATS, isCombo, joinLabels, type Format } from "@/lib/formats";
import { cn } from "@/lib/utils";

/**
 * Page rates, entered one format at a time (16 Oct — "wherever the rate is
 * put in, type format, not just multiple horizontal lines of rates: user
 * selects a format and can add or edit the rate"). A dropdown of the formats
 * not yet priced + an amount box adds a line; each priced format is a line
 * with an editable amount and a remove button. No rate is mandatory.
 * Shared by every v1 form that creates or edits a page's rates (Inventory's
 * "Create a page" and row editor, Approvals, People's "Add user" pages, the
 * pending-assignment resolver).
 */
export type RateDraft = Record<string, string>;

/** Required formats with no positive amount typed — always empty since 16 Oct (nothing is required). */
export function missingRequiredRates(rates: RateDraft): Format[] {
  return REQUIRED_RATE_FORMATS.filter((f) => !(Number(rates[f]) > 0));
}

/** "Add the Reel rate" / "Add the Reel and Story rates" — same copy as the server's RATES_REQUIRED. */
export function missingRatesMessage(missing: readonly string[]): string | null {
  if (missing.length === 0) return null;
  return `Add the ${joinLabels(missing)} rate${missing.length > 1 ? "s" : ""}`;
}

/** The typed rates as rate-card entries (blank / zero skipped). */
export function rateCardsFrom(rates: RateDraft): { format: string; amount: number }[] {
  return FORMATS.filter((f) => Number(rates[f]) > 0).map((f) => ({ format: f, amount: Number(rates[f]) }));
}

const selectClass = "h-9 rounded-md border border-border bg-surface px-2.5 text-[0.8125rem] text-text shadow-card focus:border-ink focus:outline-none focus:ring-[3px] focus:ring-ink-10 disabled:opacity-60";

export function RateFields({
  rates,
  onChange,
  required: _required,
  showErrors,
  compact,
  idPrefix = "",
  fixed = [],
}: {
  rates: RateDraft;
  onChange: (next: RateDraft) => void;
  /** Kept for callers; nothing is required any more (16 Oct). */
  required: boolean;
  /** Show the "missing rates" error (after a submit attempt). */
  showErrors: boolean;
  /** Tighter spacing for nested cards (People's "Add user", resolver). */
  compact?: boolean;
  /** Prefixed to each field's aria-label, e.g. "@page " — keeps labels unique when a form shows several pages. */
  idPrefix?: string;
  /** Formats whose line can be edited but not removed (a rate already saved on the page — the server keeps rate cards). */
  fixed?: readonly string[];
}) {
  const missing = missingRequiredRates(rates);
  // A format is "priced" once it has any text in its box (so a line being typed into isn't dropped at ""), or a saved rate.
  const priced = FORMATS.filter((f) => (rates[f] ?? "") !== "" || fixed.includes(f));
  const available = FORMATS.filter((f) => !priced.includes(f));
  const [picking, setPicking] = useState<Format | "">("");
  const [newAmount, setNewAmount] = useState("");

  function addLine() {
    if (!picking) return;
    onChange({ ...rates, [picking]: newAmount.trim() === "" ? "0" : newAmount });
    setPicking("");
    setNewAmount("");
  }
  function removeLine(f: string) {
    const next = { ...rates };
    delete next[f];
    onChange(next);
  }

  return (
    <div className={cn("flex flex-col", compact ? "gap-1.5" : "gap-2")} data-testid="rate-fields">
      {priced.length === 0 && <p className="text-[0.75rem] text-text-faint">No rates yet — pick a format below to add one.</p>}
      {priced.map((f) => {
        const label = FORMAT_LABELS[f];
        return (
          <div key={f} className="flex items-center gap-2 rounded-md border border-border bg-surface-2 py-1 pl-2.5 pr-1" data-testid={`rate-line-${f}`}>
            <span className="min-w-0 flex-1 truncate text-[0.8125rem] font-medium text-text-2">
              {label}
              {isCombo(f) && <span className="ml-1 text-[0.7rem] font-normal text-text-faint">combo</span>}
            </span>
            <MoneyField compact value={rates[f] ?? ""} onChange={(v) => onChange({ ...rates, [f]: v })} placeholder="0" aria-label={`${idPrefix}${label} rate`} className="w-32" />
            {fixed.includes(f) ? (
              <span className="w-7" aria-hidden />
            ) : (
              <button type="button" onClick={() => removeLine(f)} aria-label={`${idPrefix}Remove ${label} rate`} className="flex h-7 w-7 items-center justify-center rounded-[6px] text-text-faint hover:bg-surface hover:text-text">
                <CloseIcon className="h-3 w-3" />
              </button>
            )}
          </div>
        );
      })}
      {available.length > 0 && (
        <div className="flex items-center gap-2" data-testid="rate-add-row">
          <select value={picking} onChange={(e) => setPicking(e.target.value as Format | "")} aria-label={`${idPrefix}Add a rate for`} className={cn(selectClass, "min-w-0 flex-1")}>
            <option value="">Add a rate for…</option>
            {available.map((f) => (
              <option key={f} value={f}>
                {FORMAT_LABELS[f]}
                {isCombo(f) ? " (combo)" : ""}
              </option>
            ))}
          </select>
          <MoneyField compact value={newAmount} onChange={setNewAmount} placeholder="Amount" aria-label={`${idPrefix}New rate amount`} className="w-32" disabled={!picking} />
          <button type="button" onClick={addLine} disabled={!picking} aria-label={`${idPrefix}Add rate`} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-text-muted shadow-card hover:text-text disabled:opacity-40">
            <PlusIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <p className="text-[0.72rem] text-text-muted">Every rate is optional. Reel + Story and Repost + Story are combos: one booking of both posts, usually cheaper than booking them separately; the price is split between the two posts.</p>
      {showErrors && <FieldError message={missingRatesMessage(missing)} />}
    </div>
  );
}
