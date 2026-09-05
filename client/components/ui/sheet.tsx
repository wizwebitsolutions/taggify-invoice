"use client";

import type { ReactNode } from "react";
import { createPortal } from "react-dom";

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
 *
 * Portals to `document.body` rather than rendering in place. Every call
 * site lives inside AppShell's content pane, which carries its own
 * `relative z-10` (needed so the topbar's notification dropdown, at
 * z-20, reliably paints above page content — see app-shell.tsx). A
 * `position: fixed` element is still confined to the stacking context
 * of a z-indexed ancestor, so without the portal this sheet's z-50
 * only ever competed *inside* that z-10 subtree and always lost to the
 * topbar, rendering the whole dialog visually behind/merged into the
 * search bar, theme toggle, and log-out button. Portaling escapes that
 * ancestor entirely, so z-50 is compared where it's actually meant to
 * be: against the rest of the page.
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
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      data-testid="sheet-overlay"
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
    </div>,
    document.body
  );
}
