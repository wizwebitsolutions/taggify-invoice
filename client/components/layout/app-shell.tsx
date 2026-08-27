import type { ReactNode } from "react";

import { Sidebar, type SidebarUser } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { BottomNav } from "@/components/layout/bottom-nav";

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
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar placeholder={searchPlaceholder} user={user} hasUnread>
          {topbarActions}
        </Topbar>
        <div className="flex-1 overflow-y-auto p-4 pb-24 md:p-8 md:pb-8">{children}</div>
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
