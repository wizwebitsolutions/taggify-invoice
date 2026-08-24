import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { SearchIcon, BellIcon } from "@/components/icons";
import { AVATAR_TONE, type SidebarUser } from "@/components/layout/sidebar";

export function Topbar({
  placeholder,
  user,
  hasUnread = false,
  children,
}: {
  placeholder: string;
  user: SidebarUser;
  hasUnread?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="flex h-[72px] shrink-0 items-center justify-between border-b border-border px-8">
      <div className="flex h-10 w-[340px] items-center gap-2.5 rounded-full border border-border bg-surface px-4 text-sm text-text-faint">
        <SearchIcon className="h-[15px] w-[15px] shrink-0" />
        {placeholder}
      </div>

      <div className="flex items-center gap-4">
        <div className="relative flex h-[38px] w-[38px] items-center justify-center rounded-[10px] border border-border bg-surface">
          <BellIcon className="h-[18px] w-[18px] text-text-muted" />
          {hasUnread && (
            <span className="absolute right-[9px] top-2 h-[7px] w-[7px] rounded-full border-2 border-sidebar bg-accent-2" />
          )}
        </div>

        {children}

        <div className={cn("flex h-8 w-8 items-center justify-center rounded-full text-[0.8125rem] font-bold", AVATAR_TONE[user.tone ?? "emerald"])}>
          {user.initials}
        </div>
      </div>
    </div>
  );
}
