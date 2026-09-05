import Link from "next/link";
import type { ComponentType } from "react";

import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import type { Role } from "@/lib/api-client";
import {
  GridIcon,
  CampaignIcon,
  AssetIcon,
  InvoiceIcon,
  InventoryIcon,
  TeamIcon,
  ClockIcon,
  ChevronDownIcon,
} from "@/components/icons";

type NavItem = {
  key: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  href?: string; // omitted = not built yet, rendered inert
  /** Omitted = every role. Matched against the signed-in user's raw role
   *  (not the humanized `SidebarUser.role` label) — see canSeeNavItem. */
  roles?: Role[];
};

const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  { label: "Overview", items: [{ key: "dashboard", label: "Dashboard", icon: GridIcon, href: "/dashboard" }] },
  {
    label: "Work",
    items: [
      { key: "campaigns", label: "Campaigns", icon: CampaignIcon, href: "/campaigns" },
      { key: "assets", label: "Assets", icon: AssetIcon, href: "/assets" },
      // ADMIN-only server-side (plans routes: requireRole("ADMIN")) and the
      // page itself renders nothing for anyone else — see inventory/page.tsx.
      { key: "inventory", label: "Inventory", icon: InventoryIcon, href: "/inventory", roles: ["ADMIN"] },
    ],
  },
  { label: "Finance", items: [{ key: "invoices", label: "Invoices", icon: InvoiceIcon, href: "/invoices" }] },
  {
    label: "Admin",
    items: [
      // ADMIN-only server-side (admin routes: requireRole("ADMIN")).
      { key: "users", label: "Users", icon: TeamIcon, href: "/users", roles: ["ADMIN"] },
      // CREATOR-only — this is a creator managing their own team, not an
      // admin function despite living in this group (see team/page.tsx's
      // "Team management is available to Creator accounts" fallback and
      // users routes: GET/POST /users/me/team both requireRole("CREATOR")).
      { key: "team", label: "Team", icon: TeamIcon, href: "/team", roles: ["CREATOR"] },
      // ADMIN-only server-side (admin routes: requireRole("ADMIN")).
      { key: "job-runs", label: "Job runs", icon: ClockIcon, href: "/job-runs", roles: ["ADMIN"] },
    ],
  },
];

function canSeeNavItem(item: NavItem, role: Role | undefined) {
  return !item.roles || (!!role && item.roles.includes(role));
}

/** Same per-role visibility as the sidebar, keyed by NavItem.key, for the
 * mobile "More" sheet (more-sheet.tsx) — a second nav surface for the same
 * destinations that can't render NavItem/NAV_GROUPS directly (its own
 * icons/labels/layout), but must not re-derive the roles allowlist itself:
 * that drifted silently before (e.g. Team going CREATOR-only here without
 * the sheet following). */
export function canSeeNavKey(key: string, role: Role | undefined) {
  const item = NAV_GROUPS.flatMap((g) => g.items).find((i) => i.key === key);
  return !item || canSeeNavItem(item, role);
}

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
  // The `user` prop only carries a humanized label ("Admin") built per
  // call-site via roleLabel() — pull the raw role straight from auth
  // state here rather than threading it through every page that renders
  // AppShell (Topbar does the same for logout/accessToken).
  const { user: authUser } = useAuth();
  const role = authUser?.role;
  const visibleGroups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => canSeeNavItem(item, role)),
  })).filter((group) => group.items.length > 0);

  return (
    // h-full + its own flex-col (rather than relying on the parent row to
    // stretch it) so this column can carve out a non-scrolling footer for
    // the profile card below — previously the profile card was just the
    // last item after a flex-1 spacer, so on a short viewport with several
    // nav groups it got pushed past the bottom edge and clipped by the
    // app shell's overflow-hidden instead of ever being reachable.
    <aside className="hidden h-full w-[260px] shrink-0 flex-col border-r border-border bg-sidebar md:flex">
      <div className="no-scrollbar flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto p-4">
        <div className="flex items-center gap-2.5 px-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-sm font-extrabold text-accent-ink">
            T
          </div>
          <span className="text-[1rem] font-bold tracking-tight">Taggify</span>
        </div>

        {visibleGroups.map((group) => (
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
                    "flex h-[38px] items-center gap-2.5 rounded-full px-3 text-sm font-medium text-text-muted transition-colors",
                    isActive && "bg-accent-soft font-semibold text-accent shadow-[inset_0_0_0_1px_var(--accent-soft)]",
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
