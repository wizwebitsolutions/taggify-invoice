import type { ReactNode } from "react";

import { Sidebar, type SidebarUser } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { BottomNav } from "@/components/layout/bottom-nav";
import { AmbientGlow } from "@/components/layout/ambient-glow";

export function AppShell({
  active,
  user,
  searchPlaceholder,
  topbarActions,
  fab,
  children,
}: {
  active: string;
  user: SidebarUser;
  searchPlaceholder: string;
  /** Desktop-only — rendered in the topbar. Hidden below `md` (see Topbar). */
  topbarActions?: ReactNode;
  /** Mobile-only floating action button — the topbarActions equivalent for
   *  screens narrow enough that the topbar can't carry a labeled button
   *  (Dashboard's "Upload links", Invoices' "New invoice"). Hidden at `md`+. */
  fab?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar active={active} user={user} />
      <div className="relative flex min-w-0 flex-1 flex-col">
        {/* Ambient glow — decorative only, sits behind the topbar/content
            (z-0) which get their own stacking contexts below. Clipped to its
            own inset-0 layer rather than this whole column: this column used
            to carry overflow-hidden itself, which also clipped the topbar's
            notification dropdown below on a short-enough viewport (the
            dropdown is a descendant of this column too). Pauses itself while
            the tab is backgrounded — see ambient-glow.tsx. */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <AmbientGlow />
        </div>

        {/* z-20, strictly above the content pane's z-10 (not just equal) —
            these are sibling stacking contexts, and equal z-index ties
            resolve by DOM order, so an equal z-10 here let the later
            content sibling paint over this ENTIRE subtree, including the
            notification dropdown nested inside Topbar. Its own z-50 never
            got a chance to compete: a nested z-index only wins within its
            own ancestor's stacking context, not against a sibling context
            further out. Result was the dashboard heading visibly painting
            through the open dropdown instead of being covered by it. */}
        <div className="relative z-20">
          <Topbar placeholder={searchPlaceholder} user={user} hasUnread>
            {topbarActions}
          </Topbar>
        </div>
        <div className="relative z-10 flex-1 overflow-y-auto p-4 pb-24 md:p-8 md:pb-8">{children}</div>
      </div>

      {fab && (
        <div className="fixed bottom-20 right-4 z-30 md:hidden" style={{ marginBottom: "env(safe-area-inset-bottom)" }}>
          {fab}
        </div>
      )}
      <BottomNav active={active} user={user} />
    </div>
  );
}
