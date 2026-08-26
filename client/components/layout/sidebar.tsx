import Link from "next/link";
import type { ComponentType } from "react";

import { cn } from "@/lib/utils";
import {
  GridIcon,
  CampaignIcon,
  AssetIcon,
  InvoiceIcon,
  TeamIcon,
  ClockIcon,
  ChevronDownIcon,
} from "@/components/icons";

type NavItem = {
  key: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  href?: string; // omitted = not built yet, rendered inert
};

const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  { label: "Overview", items: [{ key: "dashboard", label: "Dashboard", icon: GridIcon, href: "/dashboard" }] },
  {
    label: "Work",
    items: [
      { key: "campaigns", label: "Campaigns", icon: CampaignIcon, href: "/campaigns" },
      { key: "assets", label: "Assets", icon: AssetIcon, href: "/assets" },
    ],
  },
  { label: "Finance", items: [{ key: "invoices", label: "Invoices", icon: InvoiceIcon, href: "/invoices" }] },
  {
    label: "Admin",
    items: [
      { key: "users", label: "Users", icon: TeamIcon, href: "/users" },
      { key: "team", label: "Team", icon: TeamIcon, href: "/team" },
      { key: "job-runs", label: "Job runs", icon: ClockIcon, href: "/job-runs" },
    ],
  },
];

export interface SidebarUser {
  initials: string;
  name: string;
  role: string;
  /** Role-color cue, e.g. Creator=emerald, Finance=blue. Defaults to emerald. */
  tone?: "emerald" | "blue";
}

export const AVATAR_TONE = {
  emerald: "bg-accent-soft text-accent",
  blue: "bg-blue-soft text-blue",
} as const;

export function Sidebar({ active, user }: { active: string; user: SidebarUser }) {
  return (
    // h-full + its own flex-col (rather than relying on the parent row to
    // stretch it) so this column can carve out a non-scrolling footer for
    // the profile card below — previously the profile card was just the
    // last item after a flex-1 spacer, so on a short viewport with several
    // nav groups it got pushed past the bottom edge and clipped by the
    // app shell's overflow-hidden instead of ever being reachable.
    <aside className="flex h-full w-[260px] shrink-0 flex-col border-r border-border bg-sidebar">
      <div className="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto p-4">
        <div className="flex items-center gap-2.5 px-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-sm font-extrabold text-accent-ink">
            T
          </div>
          <span className="text-[1rem] font-bold tracking-tight">Taggify</span>
        </div>

        {NAV_GROUPS.map((group) => (
          <nav key={group.label} className="flex flex-col gap-0.5">
            <p className="mb-2 px-3 text-[0.6875rem] font-bold uppercase tracking-[0.08em] text-text-faint">
              {group.label}
            </p>
            {group.items.map((item) => {
              const Icon = item.icon;
              const isActive = item.key === active;
              const content = (
                <span
                  className={cn(
                    "flex h-[38px] items-center gap-2.5 rounded-[10px] px-3 text-sm font-medium text-text-muted transition-colors",
                    isActive && "bg-accent-soft font-semibold text-accent",
                    item.href && !isActive && "hover:bg-surface hover:text-text",
                    !item.href && "cursor-default opacity-50"
                  )}
                >
                  <Icon className={cn("h-[18px] w-[18px] shrink-0 text-text-faint", isActive && "text-accent")} />
                  {item.label}
                </span>
              );
              return item.href ? (
                <Link key={item.key} href={item.href}>
                  {content}
                </Link>
              ) : (
                <div key={item.key} title="Coming soon">
                  {content}
                </div>
              );
            })}
          </nav>
        ))}
      </div>

      <div className="shrink-0 border-t border-border p-4">
        <Link
          href="/profile"
          className={cn(
            "flex items-center gap-2.5 rounded-xl border p-2.5 transition-colors hover:bg-surface",
            active === "profile" ? "border-accent" : "border-border"
          )}
        >
          <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[0.8125rem] font-bold", AVATAR_TONE[user.tone ?? "emerald"])}>
            {user.initials}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[0.8125rem] font-semibold">{user.name}</div>
            <div className="text-xs text-text-faint">{user.role}</div>
          </div>
          <ChevronDownIcon className="h-3.5 w-3.5 shrink-0 text-text-faint" />
        </Link>
      </div>
    </aside>
  );
}
