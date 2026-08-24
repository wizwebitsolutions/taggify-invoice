import type { ReactNode } from "react";

import { Sidebar, type SidebarUser } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";

export function AppShell({
  active,
  user,
  searchPlaceholder,
  topbarActions,
  children,
}: {
  active: string;
  user: SidebarUser;
  searchPlaceholder: string;
  topbarActions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar active={active} user={user} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar placeholder={searchPlaceholder} user={user} hasUnread>
          {topbarActions}
        </Topbar>
        <div className="flex-1 overflow-y-auto p-8">{children}</div>
      </div>
    </div>
  );
}
