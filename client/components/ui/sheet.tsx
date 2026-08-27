import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * One overlay primitive for every modal in the app. Renders as a
 * bottom sheet (slides up from the edge, rounded top corners, drag
 * handle) below the `md` breakpoint and as a centered dialog at `md`
 * and up — a single component, styled responsively, rather than two
 * maintained separately. Every existing centered-modal call site
 * (NewAssetModal, NewCampaignModal, RejectInvoiceModal, ...) renders
 * through this now.
 *
 * `overlayClassName`/`panelClassName` also make this double as the
 * "mobile-only" wrapper for a panel that's persistent, non-modal
 * content on desktop (the link/invoice detail panel): pass
 * `overlayClassName="md:hidden" panelClassName="md:hidden"` so the
 * sheet never mounts visibly at `md`+, and render the desktop version
 * separately as ordinary inline content.
 */
export function Sheet({
  onClose,
  overlayClassName,
  panelClassName,
  children,
}: {
  onClose: () => void;
  overlayClassName?: string;
  panelClassName?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex items-end justify-center bg-black/60 md:items-center md:p-6",
        overlayClassName
      )}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "flex max-h-[88vh] w-full flex-col overflow-hidden rounded-t-2xl border border-border bg-surface shadow-card md:max-h-[85vh] md:w-full md:max-w-[420px] md:rounded-lg",
          panelClassName
        )}
      >
        <div className="flex shrink-0 justify-center pb-1 pt-2.5 md:hidden">
          <div className="h-1 w-9 rounded-full bg-border-strong" />
        </div>
        {children}
      </div>
    </div>
  );
}
