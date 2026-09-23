import type { ReactNode } from "react";

import { Sidebar, type SidebarUser } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { BottomNav } from "@/components/layout/bottom-nav";
import { EmailVerifyBanner } from "@/components/auth/email-verify-banner";

export function AppShell({
  active,
  user,
  searchPlaceholder,
  topbarActions,
  fab,
  hideEmailVerifyBanner,
  children,
}: {
  active: string;
  user: SidebarUser;
  searchPlaceholder: string;
  /** Desktop-only — rendered in the topbar. Hidden below `md` (see Topbar). */
  topbarActions?: ReactNode;
  /** Mobile-only floating action button — the topbarActions equivalent for
   *  screens narrow enough that the topbar can't carry a labeled button. */
  fab?: ReactNode;
  /** /verify-email itself — the banner would just link to the page it is on. */
  hideEmailVerifyBanner?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex h-screen overflow-hidden bg-bg">
      <Sidebar active={active} user={user} />
      <div className="relative flex min-w-0 flex-1 flex-col">
        {/* z-20, strictly above the content pane's z-10 so the topbar's
            notification dropdown paints over page content. */}
        <div className="relative z-20">
          <Topbar placeholder={searchPlaceholder} user={user} hasUnread>
            {topbarActions}
          </Topbar>
        </div>
        {/* `page-stagger` (globals.css) fades each top-level block of the
            page up in sequence — every screen gets the same entrance. */}
        <div className="page-stagger relative z-10 flex-1 overflow-y-auto p-4 pb-24 md:p-7 md:pb-8">
          <EmailVerifyBanner hidden={hideEmailVerifyBanner} />
          {children}
        </div>
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
