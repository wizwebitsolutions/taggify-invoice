import Link from "next/link";
import type { ComponentType } from "react";

import { cn } from "@/lib/utils";
import { Logo } from "@/components/ui/logo";
import { useAuth } from "@/lib/auth-context";
import { hasAccess, type Role, type Permissions, type PermissionKey } from "@/lib/api-client";
import {
  GridIcon,
  CampaignIcon,
  InvoiceIcon,
  InventoryIcon,
  AssetIcon,
  TeamIcon,
  ClockIcon,
  ChevronDownIcon,
  CheckCircleIcon,
} from "@/components/icons";

type NavItem = {
  key: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  href?: string; // omitted = not built yet, rendered inert
  /** Omitted = every role. Matched against the signed-in user's raw role
   *  (not the humanized `SidebarUser.role` label) — see canSeeNavItem. */
  roles?: Role[];
  /** For a destination whose entire server route is permission-gated (e.g.
   *  GET /admin/users itself requires "users.manage"). Cuts both ways
   *  (15 Sep): a sub-admin denied that key is hidden even though their role
   *  is in `roles`, and — the actual grant path — a role *not* in `roles`
   *  but explicitly granted this key sees the item anyway. Not used for
   *  anything merely *action*-gated (a page that still loads and just
   *  disables/errors on one button) — that's an acceptable error-toast
   *  fallback, not worth hiding the whole destination for. */
  permissionKey?: PermissionKey;
  /** Like `permissionKey`, but visible if ANY of these keys is held — for a
   *  destination that bundles several independent approve actions (e.g.
   *  Approvals: links.approve, inventory.approve, plans.approve,
   *  finance.pay each open a different queue on that one page). */
  permissionKeysAny?: PermissionKey[];
  /** Roles the server lets through the keyed route *without* the key (its
   *  own self-service users, e.g. PLAN_MAKER on /plans). */
  bareRoles?: Role[];
};

const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Overview",
    items: [
      { key: "dashboard", label: "Home", icon: GridIcon, href: "/dashboard" },
      // The decision queue (premium mockup 03) — one row per approval,
      // list-left / detail-right. Bundles four independent approve actions
      // (screenshots/insights, plans, pages, billing profiles); visible if
      // ADMIN or any one of those keys is held (23 Sep) — a plain Finance
      // account holds none of them by baseline, so this stays effectively
      // Admin-only until one is explicitly granted.
      {
        key: "approvals",
        label: "Approvals",
        icon: CheckCircleIcon,
        href: "/approvals",
        roles: ["ADMIN"],
        permissionKeysAny: ["links.approve", "inventory.approve", "plans.approve", "finance.pay"],
      },
    ],
  },
  {
    label: "Work",
    items: [
      // Plan Maker sees Campaigns (and Invoices, below) since 12 Sep — but
      // only the campaigns spawned from their own approved plans, scoped
      // server-side (see server/src/lib/campaignAccess.js), so they can
      // generate per-creator invoices from a campaign page. Every role is
      // on the list now; kept explicit rather than open like Inventory so
      // the allowlist stays the single place to read "who sees Campaigns".
      { key: "campaigns", label: "Campaigns", icon: CampaignIcon, href: "/campaigns", roles: ["CREATOR", "TEAM_MEMBER", "ADMIN", "FINANCE", "PLAN_MAKER"] },
      // Visible to every role (Pages, the former /assets content, is for
      // everyone, Plan Maker included) — newTask.md, 8 Sep: "assets tab
      // will be removed" — folded into this one instead.
      { key: "inventory", label: "Inventory", icon: InventoryIcon, href: "/inventory" },
      // Split back out into its own nav tab (newTask.md, 9 Sep: "plan will
      // be in separate nav tab") — was a second tab inside Inventory,
      // gated the same way (Admin + Plan Maker) but now at the nav level
      // too, matching Campaigns' allowlist pattern above. permissionKey
      // lets a granted non-ADMIN/PLAN_MAKER role in too (15 Sep).
      { key: "plans", label: "Plans", icon: AssetIcon, href: "/plans", roles: ["ADMIN", "PLAN_MAKER"], permissionKey: "plans.view", bareRoles: ["PLAN_MAKER"] },
    ],
  },
  {
    label: "Finance",
    items: [
      { key: "invoices", label: "Invoices", icon: InvoiceIcon, href: "/invoices", roles: ["CREATOR", "TEAM_MEMBER", "ADMIN", "FINANCE", "PLAN_MAKER"] },
    ],
  },
  {
    label: "Admin",
    items: [
      // ADMIN-only server-side (admin routes: requireRole("ADMIN")), and
      // the whole route is further gated on "users.manage" — a sub-admin
      // without it would land on a page that 403s on load.
      { key: "users", label: "People", icon: TeamIcon, href: "/users", roles: ["ADMIN"], permissionKey: "users.view" },
      // CREATOR-only — this is a creator managing their own team, not an
      // admin function despite living in this group (see team/page.tsx's
      // "Team management is available to Creator accounts" fallback and
      // users routes: GET/POST /users/me/team both requireRole("CREATOR")).
      { key: "team", label: "Team", icon: TeamIcon, href: "/team", roles: ["CREATOR"] },
      // Gated on finance.edit server-side (23 Sep) — a plain Finance
      // account holds it by baseline, matching the route.
      { key: "job-runs", label: "Job runs", icon: ClockIcon, href: "/job-runs", roles: ["ADMIN"], permissionKey: "finance.edit" },
    ],
  },
];

/** Just the two auth-context fields nav visibility actually needs — accepts
 *  the full `useAuth().user` object as-is rather than a role string, so a
 *  permissionKey check has something to read. */
type NavUser = { role?: Role; permissions?: Permissions } | null | undefined;

function canSeeNavItem(item: NavItem, user: NavUser) {
  const roleAllowed = !item.roles || (!!user?.role && item.roles.includes(user.role));
  // A destination whose whole route is keyed: the key decides, whatever the
  // role — a sub-admin denied it is hidden, a granted Finance/Planner sees
  // it. Same answer the server's requireAccess() gives (hasAccess mirrors
  // getEffectivePermissions, including legacy six-key sessions).
  if (item.permissionKey) {
    if (hasAccess(user, item.permissionKey)) return true;
    // PLAN_MAKER is a bare role on /plans (own plans only) — its own role
    // list still lets it in even without the key.
    return roleAllowed && !!item.bareRoles?.includes(user?.role as Role);
  }
  if (item.permissionKeysAny) {
    if (item.permissionKeysAny.some((key) => hasAccess(user, key))) return true;
    return roleAllowed;
  }
  return roleAllowed;
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
  emerald: "bg-surface-2 text-text-2 ring-1 ring-inset ring-border",
  blue: "bg-blue-soft text-blue ring-1 ring-inset ring-blue-line",
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
    <aside className="hidden h-full w-[232px] shrink-0 flex-col border-r border-border bg-sidebar md:flex">
      <div className="no-scrollbar flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-3">
        <div className="flex items-center px-2.5 pt-2">
          <Logo className="h-[22px]" />
        </div>

        {visibleGroups.map((group) => (
          <nav key={group.label} className="flex flex-col gap-px">
            <p className="mb-1.5 px-2.5 text-[0.68rem] font-medium uppercase tracking-[0.06em] text-text-faint">
              {group.label}
            </p>
            {group.items.map((item) => {
              const Icon = item.icon;
              const isActive = item.key === active;
              const content = (
                <span
                  className={cn(
                    "flex h-[34px] items-center gap-2.5 rounded-[7px] px-2.5 text-[0.8375rem] font-medium text-text-2 transition-colors duration-150",
                    isActive && "bg-surface-2 font-semibold text-text shadow-[inset_0_0_0_1px_var(--border)]",
                    item.href && !isActive && "hover:bg-surface-2 hover:text-text",
                    !item.href && "cursor-default opacity-50"
                  )}
                >
                  <Icon className={cn("h-[17px] w-[17px] shrink-0 text-text-muted", isActive && "text-text")} />
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

      <div className="shrink-0 border-t border-border p-3">
        <Link
          href="/profile"
          className={cn(
            "flex items-center gap-2.5 rounded-[10px] border bg-surface p-2 shadow-card transition-colors hover:bg-surface-2",
            active === "profile" ? "border-ink" : "border-border"
          )}
        >
          <div className={cn("flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full text-[0.72rem] font-semibold", AVATAR_TONE[user.tone ?? "emerald"])}>
            {user.initials}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[0.8rem] font-semibold">{user.name}</div>
            <div className="text-[0.72rem] text-text-muted">{user.role}</div>
          </div>
          <ChevronDownIcon className="h-3.5 w-3.5 shrink-0 text-text-faint" />
        </Link>
      </div>
    </aside>
  );
}
