"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Sheet } from "@/components/ui/sheet";
import { AVATAR_TONE, canSeeNavKey, type SidebarUser } from "@/components/layout/sidebar";
import { BellIcon, TeamIcon, ClockIcon, MoonIcon, SunIcon, LogoutIcon, ChevronRightIcon } from "@/components/icons";
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme-context";
import { notifications as notificationsApi } from "@/lib/api-client";
import { cn } from "@/lib/utils";

/**
 * Mobile-only nav overflow — everything the sidebar carries that
 * doesn't fit the 5-item bottom bar (Team, Users, Job runs), plus
 * what the desktop topbar carries (notifications, theme, log out).
 * Same destinations as the desktop sidebar/topbar, just surfaced
 * through a sheet instead of always-visible chrome.
 */
export function MoreSheet({ onClose, user }: { onClose: () => void; user: SidebarUser }) {
  const { accessToken, logout, user: authUser } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const queryClient = useQueryClient();

  // "Notifications" used to be a MenuRow with href="/profile" — a
  // copy/paste leftover that silently took you to the profile page
  // instead of showing anything notification-related (caught by
  // tests/e2e/nav-links.spec.ts). It's a second view within the same
  // sheet now, mirroring the desktop topbar's dropdown, instead of a
  // dead-end navigation.
  const [view, setView] = useState<"menu" | "notifications">("menu");

  const notifQuery = useQuery({
    queryKey: ["notifications"],
    queryFn: () => notificationsApi.list(accessToken!),
    enabled: !!accessToken,
  });
  const items = notifQuery.data ?? [];
  const unreadCount = items.filter((n) => !n.readAt).length;

  const markAllMutation = useMutation({
    mutationFn: () => notificationsApi.markAllRead(accessToken!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });
  const markOneMutation = useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(accessToken!, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  if (view === "notifications") {
    return (
      <Sheet onClose={onClose} panelClassName="md:hidden" overlayClassName="md:hidden">
        <div className="flex items-center gap-2 border-b border-border px-3 pb-3">
          <button
            onClick={() => setView("menu")}
            aria-label="Back"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-text-muted active:bg-surface-2"
          >
            <ChevronRightIcon className="h-4 w-4 rotate-180" />
          </button>
          <p className="flex-1 text-[15px] font-bold">Notifications</p>
          {unreadCount > 0 && (
            <button
              onClick={() => markAllMutation.mutate()}
              disabled={markAllMutation.isPending}
              className="pr-2 text-[0.8125rem] font-semibold text-accent"
            >
              Mark all read
            </button>
          )}
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {items.length === 0 ? (
            <p className="px-5 py-10 text-center text-[0.8125rem] text-text-faint">No notifications yet.</p>
          ) : (
            items.map((n) => (
              <button
                key={n.id}
                onClick={() => !n.readAt && markOneMutation.mutate(n.id)}
                className={cn(
                  "flex w-full flex-col gap-0.5 border-b border-border px-5 py-3 text-left last:border-b-0 active:bg-surface-2",
                  !n.readAt && "bg-accent-soft/30"
                )}
              >
                <div className="flex items-center gap-2">
                  {!n.readAt && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent-2" />}
                  <span className="text-[0.8125rem] font-semibold capitalize">{n.type.replace(/_/g, " ")}</span>
                </div>
                <span className="text-[0.75rem] text-text-faint">
                  {new Date(n.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                </span>
              </button>
            ))
          )}
        </div>
        <div className="h-4 shrink-0" />
      </Sheet>
    );
  }

  return (
    <Sheet onClose={onClose} panelClassName="md:hidden" overlayClassName="md:hidden">
      <Link
        href="/profile"
        onClick={onClose}
        className="flex items-center gap-3.5 px-5 pb-4 pt-1 active:bg-surface-2"
      >
        <div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[15px] font-bold", AVATAR_TONE[user.tone ?? "emerald"])}>
          {user.initials}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14.5px] font-bold">{user.name}</p>
          <p className="text-xs text-text-faint">{user.role} · view profile</p>
        </div>
        <ChevronRightIcon className="h-3.5 w-3.5 shrink-0 text-text-faint" />
      </Link>

      <div className="h-px bg-border" />

      <button
        onClick={() => setView("notifications")}
        className="flex h-14 w-full items-center gap-3.5 px-5 text-left active:bg-surface-2"
      >
        <BellNotifIcon count={unreadCount} />
        <span className="flex-1 text-[14px] font-semibold">Notifications</span>
        {unreadCount > 0 && (
          <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent-2 px-1 text-[11px] font-extrabold text-bg">
            {unreadCount}
          </span>
        )}
        <ChevronRightIcon className="h-3.5 w-3.5 shrink-0 text-text-faint" />
      </button>
      {/* Inventory isn't here — it's one of the four primary bottom-nav
          tabs now (newTask.md, 8 Sep), not an overflow item.
          Same per-role visibility as the desktop sidebar — reuses
          sidebar.tsx's NAV_GROUPS allowlist via canSeeNavKey rather than
          re-declaring which roles see what a second time, which is exactly
          how these two nav surfaces drifted out of sync before. */}
      {canSeeNavKey("team", authUser) && (
        <MenuRow href="/team" onClose={onClose} icon={<TeamIcon className="h-4 w-4" />} label="Team" />
      )}
      {canSeeNavKey("users", authUser) && (
        <MenuRow href="/users" onClose={onClose} icon={<TeamIcon className="h-4 w-4" />} label="Users" />
      )}
      {canSeeNavKey("job-runs", authUser) && (
        <MenuRow href="/job-runs" onClose={onClose} icon={<ClockIcon className="h-4 w-4" />} label="Job runs" />
      )}

      <div className="my-1 h-px bg-border" />

      <button
        onClick={toggleTheme}
        className="flex h-14 w-full items-center gap-3.5 px-5 text-left active:bg-surface-2"
      >
        <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] bg-surface-2 text-text-muted">
          {theme === "dark" ? <MoonIcon className="h-4 w-4" /> : <SunIcon className="h-4 w-4" />}
        </span>
        <span className="flex-1 text-[14px] font-semibold">Dark mode</span>
        <span
          className={cn(
            "relative h-6 w-[42px] shrink-0 rounded-full transition-colors",
            theme === "dark" ? "bg-accent" : "bg-surface-2"
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 h-5 w-5 rounded-full bg-bg transition-transform",
              theme === "dark" ? "translate-x-[20px]" : "translate-x-0.5"
            )}
          />
        </span>
      </button>

      <button
        onClick={() => {
          onClose();
          logout();
        }}
        className="mt-1 flex h-14 w-full items-center gap-3.5 px-5 text-left active:bg-rose-soft/60"
      >
        <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] bg-rose-soft text-rose">
          <LogoutIcon className="h-4 w-4" />
        </span>
        <span className="text-[14px] font-bold text-rose">Log out</span>
      </button>

      <div className="h-4 shrink-0" />
    </Sheet>
  );
}

function BellNotifIcon({ count }: { count: number }) {
  return (
    <span className="relative flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] bg-surface-2 text-text-muted">
      <BellIcon className="h-4 w-4" />
      {count > 0 && <span className="absolute right-[7px] top-[7px] h-[7px] w-[7px] rounded-full border-2 border-surface-2 bg-accent-2" />}
    </span>
  );
}

function MenuRow({
  href,
  onClose,
  icon,
  label,
  trailing,
}: {
  href: string;
  onClose: () => void;
  icon: React.ReactNode;
  label: string;
  trailing?: string;
}) {
  return (
    <Link href={href} onClick={onClose} className="flex h-14 items-center gap-3.5 px-5 active:bg-surface-2">
      {icon}
      <span className="flex-1 text-[14px] font-semibold">{label}</span>
      {trailing && (
        <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent-2 px-1 text-[11px] font-extrabold text-bg">
          {trailing}
        </span>
      )}
      <ChevronRightIcon className="h-3.5 w-3.5 shrink-0 text-text-faint" />
    </Link>
  );
}
