"use client";

import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SearchIcon, BellIcon, SunIcon, MoonIcon, LogoutIcon } from "@/components/icons";
import { AVATAR_TONE, type SidebarUser } from "@/components/layout/sidebar";
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme-context";
import { notifications as notificationsApi } from "@/lib/api-client";

export function Topbar({
  placeholder,
  user,
  children,
}: {
  placeholder: string;
  user: SidebarUser;
  hasUnread?: boolean; // kept for compatibility; real state now comes from the notifications feed
  children?: ReactNode;
}) {
  const { accessToken, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const token = accessToken;

  const notifQuery = useQuery({
    queryKey: ["notifications"],
    queryFn: () => notificationsApi.list(token!),
    enabled: !!token,
    refetchInterval: 30_000, // polled, per system design.md — no pub/sub
  });

  const items = notifQuery.data ?? [];
  const unreadCount = items.filter((n) => !n.readAt).length;

  const queryClient = useQueryClient();
  const markAllMutation = useMutation({
    mutationFn: () => notificationsApi.markAllRead(token!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });
  const markOneMutation = useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(token!, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  return (
    <div className="flex h-[72px] shrink-0 items-center justify-between border-b border-border px-8">
      <div className="flex h-10 w-[340px] items-center gap-2.5 rounded-full border border-border bg-surface px-4 text-sm text-text-faint">
        <SearchIcon className="h-[15px] w-[15px] shrink-0" />
        {placeholder}
      </div>

      <div className="flex items-center gap-4">
        <button
          onClick={toggleTheme}
          title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          aria-label="Toggle color theme"
          className="flex h-[38px] w-[38px] items-center justify-center rounded-[10px] border border-border bg-surface text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
        >
          {theme === "dark" ? <SunIcon className="h-[18px] w-[18px]" /> : <MoonIcon className="h-[18px] w-[18px]" />}
        </button>

        <div className="relative">
          <button
            onClick={() => setOpen((v) => !v)}
            className="relative flex h-[38px] w-[38px] items-center justify-center rounded-[10px] border border-border bg-surface"
          >
            <BellIcon className="h-[18px] w-[18px] text-text-muted" />
            {unreadCount > 0 && (
              <span className="absolute right-[9px] top-2 h-[7px] w-[7px] rounded-full border-2 border-sidebar bg-accent-2" />
            )}
          </button>

          {open && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
              <div className="absolute right-0 top-[calc(100%+8px)] z-50 flex max-h-[420px] w-[360px] flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-card">
                <div className="flex items-center justify-between border-b border-border px-4 py-3">
                  <p className="text-[0.875rem] font-bold">Notifications</p>
                  {unreadCount > 0 && (
                    <button
                      onClick={() => markAllMutation.mutate()}
                      disabled={markAllMutation.isPending}
                      className="text-[0.75rem] font-semibold text-accent hover:text-accent-2"
                    >
                      Mark all as read
                    </button>
                  )}
                </div>
                <div className="flex-1 overflow-y-auto">
                  {items.length === 0 ? (
                    <p className="px-4 py-8 text-center text-[0.8125rem] text-text-faint">No notifications yet.</p>
                  ) : (
                    items.map((n) => (
                      <button
                        key={n.id}
                        onClick={() => !n.readAt && markOneMutation.mutate(n.id)}
                        className={cn(
                          "flex w-full flex-col gap-0.5 border-b border-border px-4 py-3 text-left last:border-b-0 hover:bg-surface-2",
                          !n.readAt && "bg-accent-soft/30"
                        )}
                      >
                        <div className="flex items-center gap-2">
                          {!n.readAt && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent-2" />}
                          <span className="text-[0.8125rem] font-semibold capitalize">{n.type.replace(/_/g, " ")}</span>
                        </div>
                        <span className="text-[0.75rem] text-text-faint">{new Date(n.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {children}

        <div className={cn("flex h-8 w-8 items-center justify-center rounded-full text-[0.8125rem] font-bold", AVATAR_TONE[user.tone ?? "emerald"])}>
          {user.initials}
        </div>

        {/* Present on every AppShell page (was previously duplicated —
            inconsistently — on individual pages). Highlighted (danger
            variant) since signing out is a deliberate, easy-to-miss-if-
            subtle action. */}
        <Button variant="danger" size="sm" onClick={logout}>
          <LogoutIcon className="h-3.5 w-3.5" />
          Log out
        </Button>
      </div>
    </div>
  );
}
