import { useState, type ReactNode } from "react";
import type { Plan, SheetFormat } from "@/lib/api-client";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** The plan sheet's two layouts (8 Oct), modelled on the two sample plans. Same names as client-v2. */
export const SHEET_FORMAT_INFO: Record<SheetFormat, { label: string; description: string }> = {
  breakdown: { label: "Category breakdown", description: "A row per page category with followers, items, cost and expected views, then GST and the total." },
  summary: { label: "Campaign summary", description: "One overview block: total followers, deliverables, expected views, cost and cost per view." },
};
export const sheetFormatOf = (p: Pick<Plan, "sheetFormat">): SheetFormat => (p.sheetFormat === "summary" ? "summary" : "breakdown");

/** Two radio cards for the plan's Google Sheet layout. Pages go in one tab per category either way. */
export function SheetFormatPicker({ value, onChange, disabled }: { value: SheetFormat; onChange: (v: SheetFormat) => void; disabled?: boolean }) {
  return (
    <div role="radiogroup" aria-label="Google Sheet format" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {(Object.keys(SHEET_FORMAT_INFO) as SheetFormat[]).map((key) => {
        const on = value === key;
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onChange(key)}
            className={cn("flex flex-col gap-1 rounded-[10px] border p-3 text-left transition-colors disabled:opacity-60", on ? "border-ink bg-surface-2" : "border-border bg-surface hover:bg-surface-2")}
          >
            <span className="flex items-center gap-2 text-[0.8125rem] font-semibold">
              <span className={cn("inline-block h-3.5 w-3.5 rounded-full border", on ? "border-[5px] border-ink" : "border-border-strong")} aria-hidden />
              {SHEET_FORMAT_INFO[key].label}
            </span>
            <span className="text-[0.75rem] text-text-muted">{SHEET_FORMAT_INFO[key].description}</span>
          </button>
        );
      })}
    </div>
  );
}

/** "News" → "News Pages", "Meme page" → "Meme Pages", none → "Other Pages" — the sheet's tab names (server lib/planSheet.js). */
export function categoryLabel(category?: string | null) {
  const c = (category ?? "").trim();
  if (!c) return "Other Pages";
  const titled = c.replace(/\s+—\s+/g, " - ").replace(/\s+/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase());
  if (/\bhandles?$/i.test(titled)) return titled;
  return /\bpages?$/i.test(titled) ? titled.replace(/\bpages?$/i, "Pages") : `${titled} Pages`;
}

/** Splits `total` across `weights` in whole numbers that add up exactly (same rule as the sheet). */
export function splitByWeight(total: number, weights: number[]) {
  const whole = Math.round(total || 0);
  const sum = weights.reduce((a, b) => a + b, 0);
  if (weights.length === 0) return [];
  const shares = weights.map((w) => (sum > 0 ? Math.floor((whole * w) / sum) : Math.floor(whole / weights.length)));
  shares[shares.length - 1] += whole - shares.reduce((a, b) => a + b, 0);
  return shares;
}

/**
 * The popup that opens on "Client sheet" (16 Oct — "user clicked client sheet,
 * it asks for 2 format selection which one to choose"). The two layouts are
 * the radio cards above; confirming hands the pick back to the caller, which
 * generates (or regenerates) the sheet in that format. Opening an already
 * generated sheet without changing its format is offered as a plain link.
 */
export function SheetFormatModal({
  planName,
  value,
  existingUrl,
  pending,
  error,
  onClose,
  onConfirm,
}: {
  planName: string;
  value: SheetFormat;
  /** The already-generated client sheet, if any — offered as "Open as is". */
  existingUrl?: string | null;
  pending?: boolean;
  error?: ReactNode;
  onClose: () => void;
  onConfirm: (format: SheetFormat) => void;
}) {
  const [format, setFormat] = useState<SheetFormat>(value);
  const changed = format !== value;
  return (
    <Sheet onClose={onClose} panelClassName="md:max-w-[520px]">
      <div className="flex flex-col gap-5 overflow-y-auto p-6 pt-1" data-testid="sheet-format-modal">
        <div className="flex flex-col gap-1">
          <h2 className="text-[1.125rem] font-semibold tracking-[-0.02em]">Client sheet format</h2>
          <p className="text-[0.8125rem] text-text-muted">
            Pick how the overview of <span className="font-medium text-text">{planName}</span> is laid out in the client&rsquo;s Google Sheet. Pages go in one tab per category either way.
          </p>
        </div>
        <SheetFormatPicker value={format} onChange={setFormat} disabled={pending} />
        {existingUrl && changed && <p className="text-[0.75rem] text-text-muted">The sheet already exists in the other format — it will be rewritten in this one.</p>}
        {error}
        <div className="flex flex-wrap items-center gap-2.5">
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          {existingUrl && !changed && (
            <a href={existingUrl} target="_blank" rel="noopener noreferrer" className="ml-auto text-[0.8125rem] font-medium text-blue hover:text-text" data-testid="sheet-format-open-existing">
              Open sheet as is ↗
            </a>
          )}
          <Button type="button" className={existingUrl && !changed ? "" : "ml-auto"} onClick={() => onConfirm(format)} disabled={pending} data-testid="sheet-format-confirm">
            {pending ? "Generating…" : existingUrl ? (changed ? "Regenerate in this format" : "Regenerate") : "Generate client sheet"}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
