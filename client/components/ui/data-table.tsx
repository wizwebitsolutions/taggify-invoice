import type React from "react";
import type { ReactNode, HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

/**
 * The premium mockup's table: hairline rows, 11.5px/500 muted headers on a
 * faint band, 11px cell padding, right-aligned tabular money. Wrap it in a
 * Card (`rounded-lg border border-border bg-surface shadow-card
 * overflow-hidden`) — the table itself paints no outer border.
 */
export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn("w-full border-collapse text-[0.8375rem]", className)} {...props} />
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return <thead className="bg-[#fbfbfc] dark:bg-surface-2">{children}</thead>;
}

export function TH({ className, right, ...props }: ThHTMLAttributes<HTMLTableCellElement> & { right?: boolean }) {
  return (
    <th
      className={cn(
        "border-b border-border px-[18px] py-[9px] text-left text-[0.72rem] font-medium tracking-[0.02em] text-text-muted",
        right && "text-right",
        className
      )}
      {...props}
    />
  );
}

export function TR({ className, interactive, selected, onClick, onKeyDown, ...props }: HTMLAttributes<HTMLTableRowElement> & { interactive?: boolean; selected?: boolean }) {
  return (
    <tr
      tabIndex={interactive && onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        if (interactive && onClick && !e.defaultPrevented && (e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
          e.preventDefault();
          onClick(e as unknown as React.MouseEvent<HTMLTableRowElement>);
        }
      }}
      className={cn(
        "border-b border-border last:border-b-0 motion-safe:animate-reveal-up",
        interactive && "cursor-pointer transition-colors hover:bg-[#fbfbfc] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ink-30 dark:hover:bg-surface-2",
        selected && "bg-surface-2",
        className
      )}
      {...props}
    />
  );
}

export function TD({ className, right, ...props }: TdHTMLAttributes<HTMLTableCellElement> & { right?: boolean }) {
  return <td className={cn("px-[18px] py-[11px] align-middle", right && "text-right tabular-nums", className)} {...props} />;
}

/** Two-line cell: bold primary + muted secondary, as every mockup row uses. */
export function Cell2({ primary, secondary, children }: { primary: ReactNode; secondary?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-[2px]">
      <span className="truncate font-semibold text-text">{primary}</span>
      {secondary && <span className="truncate text-[0.78rem] text-text-muted">{secondary}</span>}
      {children}
    </div>
  );
}

export function Card({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("overflow-hidden rounded-lg border border-border bg-surface shadow-card", className)} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({ title, meta, action, className }: { title: ReactNode; meta?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5 border-b border-border px-[18px] py-[13px]", className)}>
      <h3 className="whitespace-nowrap text-[0.875rem] font-semibold tracking-[-0.01em]">{title}</h3>
      {meta}
      {action && <div className="ml-auto flex items-center gap-2">{action}</div>}
    </div>
  );
}

export function Thumb({ className, src, alt }: { className?: string; src?: string | null; alt?: string }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt ?? ""} className={cn("h-[38px] w-[38px] shrink-0 rounded-md object-cover", className)} />
  ) : (
    <span className={cn("block h-[38px] w-[38px] shrink-0 rounded-md bg-gradient-to-br from-surface-2 to-border-strong", className)} />
  );
}
