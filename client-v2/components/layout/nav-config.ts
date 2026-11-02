import {
  BarChart3,
  CircleCheckBig,
  ClipboardCheck,
  FileText,
  House,
  IdCard,
  Radar,
  Smartphone,
  Send,
  Upload,
  Settings,
  Users,
  Wallet,
  WalletMinimal,
  type LucideIcon,
} from "lucide-react";

import { hasAccess, hasOwnAccess, isOwnScopeRole, type PermissionKey, type Role } from "@/lib/api-client";

/**
 * One nav definition for the sidebar and the mobile menu, in the order of the
 * approved reference (ux/design-ref/Taggify Vendor Payout - FINAL.png):
 * Home · Campaigns · Creators · Content · Approvals · Plans · Finance
 * (Overview / Payouts / Invoices / Receivables) · Reports · Settings.
 *
 * Visibility rules (`roles`, `permissionKey`, `permissionKeysAny`, `bareRoles`,
 * `ownKey`) are ported from client/components/layout/sidebar.tsx so v2 hides
 * exactly what v1 hides. The nav only hides UI; every route checks the role
 * server-side. Items whose v2 screen doesn't exist yet are `built: false` and
 * render as inert rows (no dead links).
 */
export type NavItem = {
  key: string;
  label: string;
  icon?: LucideIcon;
  href: string;
  built: boolean;
  /** Omitted = every role. */
  roles?: Role[];
  permissionKey?: PermissionKey;
  permissionKeysAny?: PermissionKey[];
  bareRoles?: Role[];
  ownKey?: PermissionKey;
  /** An opt-in key (api-client OPT_IN_KEYS): shows for exactly the accounts holding it, whatever their role. Overrides every rule above. */
  optInKey?: PermissionKey;
  children?: NavItem[];
};

export const NAV: NavItem[] = [
  { key: "dashboard", label: "Home", icon: House, href: "/dashboard", built: true },
  // Creator-side screens (phone-first). Creating a post needs the CREATOR/TEAM_MEMBER role server-side.
  { key: "submit", label: "Submit post", icon: Upload, href: "/submit", built: true, roles: ["CREATOR", "TEAM_MEMBER"], ownKey: "links.edit" },
  { key: "pages", label: "My pages", icon: IdCard, href: "/pages", built: true, roles: ["CREATOR", "TEAM_MEMBER"], ownKey: "inventory.view" },
  // Team members never see billing.
  { key: "money", label: "Money", icon: Wallet, href: "/money", built: true, roles: ["CREATOR"], ownKey: "finance.view" },
  { key: "campaigns", label: "Campaigns", icon: Send, href: "/campaigns", built: true, roles: ["CREATOR", "TEAM_MEMBER", "ADMIN", "FINANCE", "PLAN_MAKER"], ownKey: "campaigns.view" },
  // Creators = vendors and their pages (v1 "Inventory").
  { key: "creators", label: "Inventory", icon: Users, href: "/creators", built: true, roles: ["ADMIN", "FINANCE", "PLAN_MAKER"], permissionKey: "inventory.view", bareRoles: ["PLAN_MAKER"], ownKey: "inventory.view" },
  // Content = posts (the code's "links").
  { key: "content", label: "Content", icon: FileText, href: "/content", built: true, roles: ["ADMIN", "FINANCE", "PLAN_MAKER"], permissionKey: "links.view", bareRoles: ["PLAN_MAKER"], ownKey: "links.view" },
  {
    key: "approvals",
    label: "Approvals",
    icon: CircleCheckBig,
    href: "/approvals",
    built: true,
    roles: ["ADMIN"],
    permissionKeysAny: ["links.approve", "inventory.approve", "plans.approve", "finance.pay", "campaigns.edit"],
  },
  { key: "plans", label: "Plans", icon: ClipboardCheck, href: "/plans", built: true, roles: ["ADMIN", "PLAN_MAKER"], permissionKey: "plans.view", bareRoles: ["PLAN_MAKER"], ownKey: "plans.view" },
  {
    key: "finance",
    label: "Finance",
    icon: WalletMinimal,
    href: "/finance/payouts",
    built: true,
    children: [
      { key: "finance-overview", label: "Overview", href: "/finance", built: true, roles: ["ADMIN", "FINANCE"], permissionKey: "finance.view" },
      // Vendor payouts: the server gates every /payments route except /me/* on finance.pay.
      { key: "payouts", label: "Payouts", href: "/finance/payouts", built: true, roles: ["ADMIN", "FINANCE"], permissionKey: "finance.pay" },
      { key: "invoices", label: "Invoices", href: "/finance/invoices", built: true, roles: ["ADMIN", "FINANCE", "PLAN_MAKER"], permissionKey: "finance.view", bareRoles: ["PLAN_MAKER"], ownKey: "finance.view" },
      { key: "receivables", label: "Receivables", href: "/finance/receivables", built: true, roles: ["ADMIN", "FINANCE", "PLAN_MAKER"], permissionKey: "finance.view", bareRoles: ["PLAN_MAKER"], ownKey: "finance.view" },
    ],
  },
  { key: "reports", label: "Reports", icon: BarChart3, href: "/reports", built: true, roles: ["ADMIN", "FINANCE"] },
  // 12 Oct (v1 replaced "Job runs" with it). Opt-in: Admin by default, anyone else once granted on People → Edit access.
  { key: "bulk-track", label: "Bulk Tracker", icon: Radar, href: "/bulk-track", built: true, optInKey: "bulkTrack.view" },
  // 24 Oct. Opt-in like Bulk Tracker: paste public reel/post links, see Instagram's own embed of each.
  { key: "post-tracker", label: "Post Tracker", icon: Smartphone, href: "/post-tracker", built: true, optInKey: "postTracker.view" },
  // Everyone: My profile. The People, numbering and jobs tabs inside are gated per permission (lib/settings.ts).
  { key: "settings", label: "Settings", icon: Settings, href: "/settings", built: true },
];

export type NavUser = { role?: Role; permissions?: Record<string, boolean>; ownAccess?: Partial<Record<string, boolean>> } | null | undefined;

export function canSeeNavItem(item: NavItem, user: NavUser): boolean {
  if (item.children) return item.children.some((c) => canSeeNavItem(c, user));
  if (item.optInKey) return hasAccess(user, item.optInKey);
  const roleAllowed = !item.roles || (!!user?.role && item.roles.includes(user.role));
  // Own-scope roles: their role list plus their own-content switch, never a global key.
  if (isOwnScopeRole(user?.role)) return roleAllowed && (!item.ownKey || hasOwnAccess(user, item.ownKey));
  if (item.permissionKey) {
    if (hasAccess(user, item.permissionKey)) return true;
    return roleAllowed && !!item.bareRoles?.includes(user?.role as Role);
  }
  if (item.permissionKeysAny) {
    if (item.permissionKeysAny.some((key) => hasAccess(user, key))) return true;
    return roleAllowed;
  }
  return roleAllowed;
}

/** The nav this user may see; a group keeps only its visible children and links to the first built one. */
export function visibleNav(user: NavUser): NavItem[] {
  return NAV.filter((i) => canSeeNavItem(i, user)).map((i) => {
    if (!i.children) return i;
    const children = i.children.filter((c) => canSeeNavItem(c, user));
    const firstBuilt = children.find((c) => c.built);
    return { ...i, children, href: firstBuilt?.href ?? i.href, built: !!firstBuilt };
  });
}

/** True when `active` is this item or one of its children. */
export function isActiveItem(item: NavItem, active: string) {
  return item.key === active || !!item.children?.some((c) => c.key === active);
}

/** Whether the screen behind a nav key exists yet — links to unbuilt screens render as plain text, never a 404. */
export function isBuilt(key: string): boolean {
  for (const item of NAV) {
    if (item.key === key) return item.built;
    const child = item.children?.find((c) => c.key === key);
    if (child) return child.built;
  }
  return false;
}
