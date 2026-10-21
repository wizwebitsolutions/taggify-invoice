import { plural } from "@/lib/format";
import type { SkippedSheetRow } from "@/lib/plan-sheet";
import { displayHandle } from "@/components/finance/identity";

/** Plan-sheet rows the pre-flight left out, in sheet order (same layout as Import posts' skipped list). */
export function SheetRowProblems({ skipped, note = "They're left out. Fix them in the sheet, then sync." }: { skipped: SkippedSheetRow[]; note?: string }) {
  if (skipped.length === 0) return null;
  return (
    <div className="flex flex-col gap-2" data-testid="sheet-row-problems">
      <p className="text-small text-muted-foreground">
        <span className="font-semibold text-foreground">{plural(skipped.length, "row")} can&apos;t be used.</span> {note}
      </p>
      <ol className="max-h-56 divide-y overflow-auto rounded-card border">
        {skipped.map((s) => (
          <li key={s.line} className="flex gap-3 px-4 py-2">
            <span className="num w-14 shrink-0 text-small text-muted-foreground">Row {s.line}</span>
            <span className="min-w-0">
              <span className="block truncate text-body-strong">{displayHandle(s.handle)}</span>
              <span className="block text-small text-muted-foreground">{s.reasons.join(". ")}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Details-tab problems that stop the send. */
export function SheetBlockers({ blockers }: { blockers: string[] }) {
  if (blockers.length === 0) return null;
  return (
    <div className="flex flex-col gap-1 rounded-md bg-danger-soft px-3 py-2 text-small text-danger-fg" role="alert">
      {blockers.map((b) => (
        <p key={b}>{b}</p>
      ))}
    </div>
  );
}
