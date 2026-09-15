import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The one "section box" in the app — every chart panel, list panel, and
 * grouped-content box renders through this. Premium system: 12px radius,
 * hairline border, 1px shadow, a 13.5px/600 title.
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
    <section className={cn("rounded-lg border border-border bg-surface p-5 shadow-card md:p-6", className)}>
      {(title || subtitle || action) && (
        <div className="mb-4 flex items-end justify-between gap-3">
          <div>
            {title && <h2 className="text-[0.875rem] font-semibold tracking-[-0.01em]">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-[0.8rem] text-text-muted">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

/** The "View all →" link every Panel header can carry. */
export function PanelAction({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} className="flex items-center gap-1 text-[0.8rem] font-medium text-blue hover:text-text">
      {children}
    </button>
  );
}

/** A thin tone-aware progress track — budget consumed, storage used, etc.
 * The fill grows in from the left on mount (animate-grow-x). */
export function ProgressBar({
  pct,
  tone = "accent",
  className,
}: {
  pct: number;
  tone?: "accent" | "rose" | "warn";
  className?: string;
}) {
  return (
    <div className={cn("h-1.5 overflow-hidden rounded-full bg-surface-2", className)}>
      <div
        className={cn(
          "h-full origin-left rounded-full motion-safe:animate-grow-x",
          tone === "rose" ? "bg-rose" : tone === "warn" ? "bg-accent-2" : "bg-ink"
        )}
        style={{ width: `${Math.min(Math.max(pct, 0), 100)}%` }}
      />
    </div>
  );
}
