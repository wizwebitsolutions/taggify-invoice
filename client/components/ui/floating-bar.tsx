import type { ReactNode } from "react";

import { CloseIcon } from "@/components/icons";

/**
 * The dark floating action bar that rises when rows are selected (mockup
 * Inventory · "3 pages selected · Add to campaign · Create plan"). Bulk
 * actions never live in a toolbar — they live here.
 */
export function FloatingBar({ label, meta, onClear, children, testId }: { label: ReactNode; meta?: ReactNode; onClear: () => void; children: ReactNode; testId?: string }) {
  return (
    <div
      data-testid={testId}
      className="fixed bottom-20 left-1/2 z-30 flex max-w-[calc(100vw-32px)] -translate-x-1/2 items-center gap-3 rounded-[12px] bg-ink py-2.5 pl-[18px] pr-3 text-ink-fg shadow-[0_12px_32px_rgba(0,0,0,.28)] motion-safe:animate-reveal-pop md:bottom-7 md:gap-4"
      style={{ marginBottom: "env(safe-area-inset-bottom)" }}
    >
      <b className="whitespace-nowrap text-[0.8375rem] font-semibold">{label}</b>
      {meta && <span className="hidden whitespace-nowrap text-[0.8125rem] tabular-nums text-[#cfcbc0] sm:inline">{meta}</span>}
      <span className="hidden h-5 w-px bg-white/20 sm:block" />
      <div className="flex items-center gap-2">{children}</div>
      <button type="button" onClick={onClear} aria-label="Dismiss selection" className="ml-1 text-[#8a8a93] transition-colors hover:text-white">
        <CloseIcon className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/** Buttons used inside FloatingBar — ghost (on dark) and inverted primary. */
export function BarButton({ primary, onClick, children, disabled, testId }: { primary?: boolean; onClick: () => void; children: ReactNode; disabled?: boolean; testId?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      className={
        primary
          ? "inline-flex h-[30px] items-center gap-1.5 rounded-[7px] bg-ink-fg px-3 text-[0.78rem] font-semibold text-ink transition-transform hover:-translate-y-px disabled:opacity-50"
          : "inline-flex h-[30px] items-center gap-1.5 rounded-[7px] px-2.5 text-[0.78rem] font-semibold text-ink-fg transition-colors hover:bg-white/10 disabled:opacity-50"
      }
    >
      {children}
    </button>
  );
}
