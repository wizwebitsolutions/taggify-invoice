"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, ChevronDown, LogOut, Menu, Moon, Sun, UserRound } from "lucide-react";

import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme";
import { hasAccess, notifications as notificationsApi, type Notification } from "@/lib/api-client";
import { money, personLabel, roleLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SearchField } from "@/components/taggify/search-field";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Brand } from "./brand";
import { NavList } from "./sidebar";

/**
 * Reference top bar: soft grey search with a ⌘K hint, the notification bell
 * (orange dot when something is unread) and the account chip (black initial
 * circle, name, role). Below md it also carries the menu button and wordmark.
 *
 * Search only appears for people who can use its one real destination today
 * — the vendor payouts list, filtered by what was typed. No decorative box.
 */
export function Topbar({ active }: { active: string }) {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [q, setQ] = useState("");
  const name = personLabel(user, "Account");
  const canSearchPayouts = hasAccess(user, "finance.pay");

  return (
    <header className="sticky top-0 z-30 flex h-topbar shrink-0 items-center gap-3 bg-background/60 px-4 backdrop-blur md:gap-5 md:px-8">
      <button type="button" className="grid h-10 w-10 place-items-center rounded-md text-foreground hover:bg-muted md:hidden" aria-label="Open menu" onClick={() => setMenuOpen(true)}>
        <Menu className="h-6 w-6" />
      </button>
      <Brand className="md:hidden" />

      {canSearchPayouts && (
        <form
          role="search"
          className="hidden max-w-[740px] flex-1 md:block"
          onSubmit={(e) => {
            e.preventDefault();
            router.push(`/finance/payouts${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`);
          }}
        >
          <SearchField
            variant="soft"
            label="Search vendors, pages and campaigns"
            placeholder="Search vendor, page or campaign..."
            shortcut="⌘ K"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setQ("")}
            data-global-search
          />
        </form>
      )}

      <div className="ml-auto flex items-center gap-3 md:gap-6">
        <ThemeToggle />
        <NotificationsBell />
        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-3 rounded-pill pr-1 outline-none focus-visible:ring-3 focus-visible:ring-ring-soft" aria-label="Account menu">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-avatar text-body font-bold text-avatar-foreground">{name.charAt(0).toUpperCase()}</span>
            <span className="hidden text-left md:block">
              <span className="block text-body font-semibold">{name}</span>
              <span className="block text-small leading-4 text-muted-foreground">{roleLabel(user?.role)}</span>
            </span>
            <ChevronDown className="hidden h-3.5 w-3.5 md:block" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="font-normal">
              <span className="block truncate font-semibold">{name}</span>
              <span className="block truncate text-caption text-muted-foreground">{user?.email}</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => router.push("/settings?tab=profile")}>
              <UserRound className="h-4 w-4" aria-hidden />
              My profile
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={logout}>
              <LogOut className="h-4 w-4" aria-hidden />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left" className="flex w-[280px] flex-col gap-5 p-5">
          <SheetTitle asChild>
            <div>
              <Brand />
            </div>
          </SheetTitle>
          <SheetDescription className="sr-only">Main navigation</SheetDescription>
          <NavList active={active} onNavigate={() => setMenuOpen(false)} />
        </SheetContent>
      </Sheet>
    </header>
  );
}

/** Sun/moon switch between light and dark; the choice sticks per browser (lib/theme.tsx). */
function ThemeToggle() {
  const { resolved, setChoice } = useTheme();
  const dark = resolved === "dark";
  return (
    <button
      type="button"
      onClick={() => setChoice(dark ? "light" : "dark")}
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      aria-pressed={dark}
      className="grid h-10 w-10 place-items-center rounded-md text-foreground outline-none transition-colors duration-hover hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring-soft"
    >
      {/* Icon follows data-theme in CSS, so it's right before React hydrates. */}
      <Moon className="h-6 w-6 dark:hidden" strokeWidth={1.7} aria-hidden />
      <Sun className="hidden h-6 w-6 dark:block" strokeWidth={1.7} aria-hidden />
    </button>
  );
}

/** Plain-language line for each notification type the server sends. */
function describe(n: Notification): string {
  const p = n.payload as Record<string, unknown>;
  const amount = typeof p.amount === "string" || typeof p.amount === "number" ? money(p.amount) : null;
  switch (n.type) {
    case "payout_paid":
      return amount ? `A payout of ${amount} was marked paid` : "A payout was marked paid";
    case "invoice_raised":
      return `Invoice ${p.invoiceNumber ?? ""} was raised`.replace("  ", " ");
    case "invoice_approved":
      return `Invoice ${p.invoiceNumber ?? ""} was approved`.replace("  ", " ");
    case "invoice_rejected":
      return `Invoice ${p.invoiceNumber ?? ""} was rejected`.replace("  ", " ");
    case "invoice_paid":
      return `Invoice ${p.invoiceNumber ?? ""} was paid`.replace("  ", " ");
    case "invoice_overdue":
      return `Invoice ${p.invoiceNumber ?? ""} is overdue`.replace("  ", " ");
    case "screenshot_reminder":
      return "A post is waiting for its screenshot";
    default:
      return n.type.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
  }
}

function NotificationsBell() {
  const { accessToken } = useAuth();
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ["notifications"],
    queryFn: () => notificationsApi.list(accessToken!),
    enabled: !!accessToken,
    refetchInterval: 60_000,
  });
  const markAll = useMutation({
    mutationFn: () => notificationsApi.markAllRead(accessToken!),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
  // One notification: marked read when it's picked (v1 topbar). Shown read at once; the refetch confirms it.
  const markOne = useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(accessToken!, id),
    onMutate: async (id) => {
      // Stops an in-flight poll from writing the unread dot back.
      await qc.cancelQueries({ queryKey: ["notifications"] });
      qc.setQueryData<Notification[]>(["notifications"], (old) => old?.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
  const items = list.data ?? [];
  const unread = items.filter((n) => !n.readAt).length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="relative grid h-10 w-10 place-items-center rounded-md text-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring-soft"
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
      >
        <Bell className="h-6 w-6" strokeWidth={1.7} />
        {unread > 0 && <span className="absolute right-2 top-2 h-2 w-2 rounded-full border-2 border-background bg-brand" aria-hidden />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between px-4 py-3">
          <span className="font-semibold">Notifications</span>
          {unread > 0 && (
            <button type="button" className="text-small font-semibold text-brand-ink hover:underline" onClick={() => markAll.mutate()}>
              Mark all as read
            </button>
          )}
        </div>
        <DropdownMenuSeparator className="m-0" />
        {list.isError ? (
          <p className="px-4 py-6 text-small text-muted-foreground">Couldn&apos;t load notifications. They&apos;ll retry in a minute.</p>
        ) : items.length === 0 ? (
          <p className="px-4 py-6 text-small text-muted-foreground">{list.isLoading ? "Loading…" : "You're all caught up."}</p>
        ) : (
          <ul className="max-h-80 overflow-y-auto py-1">
            {items.slice(0, 12).map((n) => {
              const body = (
                <>
                  <span className={cn("mt-2 h-2 w-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-brand")} aria-hidden />
                  <span>
                    <span className="block text-foreground">{describe(n)}</span>
                    <span className="block text-caption text-muted-foreground">
                      {new Date(n.createdAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
                      {!n.readAt && <span className="sr-only"> · unread, select to mark as read</span>}
                    </span>
                  </span>
                </>
              );
              return (
                <li key={n.id}>
                  {/* Read rows stay menu items so keyboard focus isn't dropped when one is marked read. Stays open so several can be read in a row. */}
                  <DropdownMenuItem
                    className={cn("flex items-start gap-3 rounded-none px-4 py-3 text-small", n.readAt ? "cursor-default" : "cursor-pointer bg-brand-50")}
                    onSelect={(e) => {
                      e.preventDefault();
                      if (!n.readAt) markOne.mutate(n.id);
                    }}
                  >
                    {body}
                  </DropdownMenuItem>
                </li>
              );
            })}
          </ul>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
