import Link from "next/link";
import type { ComponentType } from "react";

import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import type { Role, Permissions } from "@/lib/api-client";
import {
  GridIcon,
  CampaignIcon,
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
  /** Only for a destination whose entire server route is permission-gated
   *  (e.g. GET /admin/users itself requires "users.manage") — a sub-admin
   *  denied that key would otherwise land on a page that 403s immediately.
   *  Not used for anything merely *action*-gated (a page that still loads
   *  and just disables/errors on one button) — that's an acceptable
   *  error-toast fallback, not worth hiding the whole destination for. */
  permissionKey?: keyof Permissions;
};

const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  { label: "Overview", items: [{ key: "dashboard", label: "Dashboard", icon: GridIcon, href: "/dashboard" }] },
  {
    label: "Work",
    items: [
      // Plan Maker's dashboard is deliberately just "Dashboard + Inventory +
      // Plan-create" (newTask.md, 8 Sep) — they don't run Campaigns, so this
      // is the one nav item that needs an explicit allowlist rather than
      // being open to every role like Inventory below.
      { key: "campaigns", label: "Campaigns", icon: CampaignIcon, href: "/campaigns", roles: ["CREATOR", "TEAM_MEMBER", "ADMIN", "FINANCE"] },
      // Visible to every role (Pages, the former /assets content, is for
      // everyone, Plan Maker included) — Plans within it stays
      // Admin/Plan-Maker-only, gated inside the page itself rather than at
      // the nav level (newTask.md, 8 Sep: "assets tab will be removed" —
      // folded into this one instead).
      { key: "inventory", label: "Inventory", icon: InventoryIcon, href: "/inventory" },
    ],
  },
  {
    label: "Finance",
    items: [{ key: "invoices", label: "Invoices", icon: InvoiceIcon, href: "/invoices", roles: ["CREATOR", "TEAM_MEMBER", "ADMIN", "FINANCE"] }],
  },
  {
    label: "Admin",
    items: [
      // ADMIN-only server-side (admin routes: requireRole("ADMIN")), and
      // the whole route is further gated on "users.manage" — a sub-admin
      // without it would land on a page that 403s on load.
      { key: "users", label: "Users", icon: TeamIcon, href: "/users", roles: ["ADMIN"], permissionKey: "users.manage" },
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

/** Just the two auth-context fields nav visibility actually needs — accepts
 *  the full `useAuth().user` object as-is rather than a role string, so a
 *  permissionKey check has something to read. */
type NavUser = { role?: Role; permissions?: Permissions } | null | undefined;

function canSeeNavItem(item: NavItem, user: NavUser) {
  if (item.roles && (!user?.role || !item.roles.includes(user.role))) return false;
  // Absent/undefined permissions (every role but a sub-admin) reads as
  // "not restricted" — only an explicit `false` from an overlay hides it.
  if (item.permissionKey && user?.permissions?.[item.permissionKey] === false) return false;
  return true;
}

/** Same per-role/per-permission visibility as the sidebar, keyed by
 * NavItem.key, for the mobile "More" sheet (more-sheet.tsx) — a second nav
 * surface for the same destinations that can't render NavItem/NAV_GROUPS
 * directly (its own icons/labels/layout), but must not re-derive the
 * allowlist itself: that drifted silently before (e.g. Team going
 * CREATOR-only here without the sheet following). */
export function canSeeNavKey(key: string, user: NavUser) {
  const item = NAV_GROUPS.flatMap((g) => g.items).find((i) => i.key === key);
  return !item || canSeeNavItem(item, user);
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
  const visibleGroups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => canSeeNavItem(item, authUser)),
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
