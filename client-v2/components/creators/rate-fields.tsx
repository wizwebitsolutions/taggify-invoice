"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";

import { FORMATS, formatLabel, isCombo, REQUIRED_RATE_FORMATS, type Format } from "@/lib/formats";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** Format key → amount as typed. Only priced formats have a key. */
export type RateValues = Record<string, string>;

export const emptyRates = (): RateValues => ({});

/** Required rate formats with an empty box — always none since 16 Oct (no rate is mandatory). */
export const missingRequired = (v: RateValues) => REQUIRED_RATE_FORMATS.filter((f) => (v[f] ?? "").trim() === "");

/** The typed rates as rate-card entries (blank / zero / non-numbers skipped), in the app's format order. */
export const rateCardsFrom = (v: RateValues) => FORMATS.filter((f) => /^\d+$/.test((v[f] ?? "").trim()) && Number(v[f]) > 0).map((format) => ({ format, amount: Number(v[format]) }));

/**
 * A page's rates, one format at a time (16 Oct — "user selects a format and
 * can add or edit the rate", not ten boxes in a row). Priced formats are
 * lines with an editable amount and a remove button; "Add a rate" is a
 * format select + amount. No rate is mandatory. `fixed` formats (a rate
 * already saved on the page) can be edited but not removed: the server keeps
 * rate cards.
 */
export function RateFields({ idPrefix, values, onChange, invalid = [], fixed = [] }: { idPrefix: string; values: RateValues; onChange: (v: RateValues) => void; invalid?: readonly string[]; fixed?: readonly string[] }) {
  const priced = FORMATS.filter((f) => values[f] !== undefined || fixed.includes(f));
  const available = FORMATS.filter((f) => !priced.includes(f));
  const [picking, setPicking] = useState<Format | "">("");
  const [amount, setAmount] = useState("");

  const canAdd = !!picking && /^\d+$/.test(amount.trim()) && Number(amount) > 0;
  function add() {
    if (!canAdd) return;
    onChange({ ...values, [picking]: amount.trim() });
    setPicking("");
    setAmount("");
  }
  function remove(f: string) {
    const next = { ...values };
    delete next[f];
    onChange(next);
  }

  return (
    <div className="flex flex-col gap-3" data-testid="rate-fields">
      {priced.length === 0 ? (
        <p className="rounded-md bg-muted px-3 py-2 text-small text-muted-foreground">No rates yet. Pick a format below to add one.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {priced.map((f) => (
            <li key={f} className="flex items-center gap-2 rounded-md border bg-card py-2 pl-3 pr-2" data-testid={`rate-line-${f}`}>
              <Label htmlFor={`${idPrefix}-${f}`} className="min-w-0 flex-1 truncate">
                {formatLabel(f)}
                {isCombo(f) && <span className="font-normal text-muted-foreground"> · combo</span>}
              </Label>
              <Input id={`${idPrefix}-${f}`} inputMode="numeric" className="h-control-sm w-32" value={values[f] ?? ""} aria-invalid={invalid.includes(f) || undefined} onChange={(e) => onChange({ ...values, [f]: e.target.value })} />
              {fixed.includes(f) ? (
                <span className="w-9" aria-hidden />
              ) : (
                <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${formatLabel(f)} rate`} onClick={() => remove(f)}>
                  <X />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {available.length > 0 && (
        <div className="flex items-center gap-2" data-testid="rate-add-row">
          <Select value={picking} onValueChange={(v) => setPicking(v as Format)}>
            <SelectTrigger aria-label="Add a rate for" className="min-w-0 flex-1">
              <SelectValue placeholder="Add a rate for…" />
            </SelectTrigger>
            <SelectContent>
              {available.map((f) => (
                <SelectItem key={f} value={f}>
                  {formatLabel(f)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            inputMode="numeric"
            className="w-32"
            placeholder="₹ amount"
            aria-label="New rate amount"
            value={amount}
            disabled={!picking}
            onChange={(e) => setAmount(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
          />
          <Button type="button" variant="outline" size="icon" aria-label="Add rate" disabled={!canAdd} onClick={add}>
            <Plus />
          </Button>
        </div>
      )}
      <p className="text-caption text-muted-foreground">Every rate is optional. Reel + Story and Repost + Story are combo prices for both posts together, split between them when booked.</p>
    </div>
  );
}
