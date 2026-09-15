"use client";

/**
 * Two series, several shared metrics, one bar-track per metric — for
 * "how do these two actually compare" rather than RankedBarList's single
 * "who's on top" ranking. Each track holds both series' bars back to back
 * (not stacked, not overlaid), each scaled against the larger of the two
 * values for that metric so a track never renders past its own bounds.
 */
export function CompareBarList({
  metrics,
  seriesA,
  seriesB,
}: {
  metrics: { key: string; label: string; formatValue?: (v: number) => string }[];
  seriesA: { label: string; color: string; values: Record<string, number> };
  seriesB: { label: string; color: string; values: Record<string, number> };
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        {metrics.map((m) => {
          const a = seriesA.values[m.key] ?? 0;
          const b = seriesB.values[m.key] ?? 0;
          const max = Math.max(1, a, b);
          const fmt = m.formatValue ?? ((v: number) => String(v));
          return (
            <div key={m.key} className="grid grid-cols-[88px_1fr_auto] items-center gap-3">
              <span className="truncate text-[0.8125rem] text-text-muted">{m.label}</span>
              <span className="flex h-2 w-full gap-[3px] overflow-hidden rounded-full bg-surface-2">
                <span
                  className="block h-full rounded-full transition-[width]"
                  style={{ width: `${Math.max(2, Math.round((a / max) * 100))}%`, backgroundColor: seriesA.color }}
                />
                <span
                  className="block h-full rounded-full transition-[width]"
                  style={{ width: `${Math.max(2, Math.round((b / max) * 100))}%`, backgroundColor: seriesB.color }}
                />
              </span>
              <span className="text-[0.8125rem] font-semibold tabular-nums text-text">
                {fmt(a)}/{fmt(b)}
              </span>
            </div>
          );
        })}
      </div>
      <div className="flex gap-4 border-t border-border pt-3">
        <span className="flex items-center gap-2 text-[0.75rem] text-text-faint">
          <span className="h-2 w-2 rounded-[2px]" style={{ backgroundColor: seriesA.color }} />
          {seriesA.label}
        </span>
        <span className="flex items-center gap-2 text-[0.75rem] text-text-faint">
          <span className="h-2 w-2 rounded-[2px]" style={{ backgroundColor: seriesB.color }} />
          {seriesB.label}
        </span>
      </div>
    </div>
  );
}
