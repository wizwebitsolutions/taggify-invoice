import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The one "section box" in the app — every chart panel, list panel, and
 * grouped-content box on every screen renders through this instead of each
 * hand-repeating `rounded-lg border border-border bg-surface p-6
 * shadow-card` plus its own title/subtitle header markup (that exact string
 * was copy-pasted 47 times across 12 files before this existed — see
 * frontend.md §3's rule that repeated markup lives in one place). Doesn't
 * cover the grid-of-cards patterns (KpiCard, campaign/asset cards) — those
 * are their own components with their own hover/tone behavior.
 */
export function Panel({
  title,
  subtitle,
  action,
  className,
  bodyClassName,
  children,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  /** Right-aligned, next to the title — typically a "View all" link. */
  action?: ReactNode;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("rounded-lg border border-border bg-surface p-6 shadow-card", className)}>
      {(title || subtitle || action) && (
        <div className="mb-5 flex items-end justify-between gap-3">
          <div>
            {title && <h2 className="text-[0.9375rem] font-bold">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-[0.8125rem] text-text-faint">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

/** The "View all →" link every Panel header can carry — one place for its
 * styling instead of the same three classes re-typed on every page. */
export function PanelAction({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} className="flex items-center gap-1 text-[0.8125rem] font-semibold text-accent hover:text-accent-2">
      {children}
    </button>
  );
}

/** A thin tone-aware progress track — budget consumed, storage used, etc.
 * `pct` isn't clamped to 100 on the caller's number (an over-budget spend
 * can genuinely exceed it) but the filled bar itself always clamps visually
 * so it never renders past the track. */
export function ProgressBar({
  pct,
  tone = "accent",
  className,
}: {
  pct: number;
  tone?: "accent" | "rose";
  className?: string;
}) {
  return (
    <div className={cn("h-[7px] overflow-hidden rounded-full bg-surface-2", className)}>
      <div
        className={cn("h-full rounded-full", tone === "rose" ? "bg-rose" : "bg-accent")}
        style={{ width: `${Math.min(Math.max(pct, 0), 100)}%` }}
      />
    </div>
  );
}
