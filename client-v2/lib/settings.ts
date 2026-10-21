import {
  canUse,
  defaultOwnAccess,
  hasAccess,
  hasOwnAccess,
  isOptInKey,
  isOwnScopeRole,
  OPT_IN_KEYS,
  OWN_CAPABILITIES,
  PERMISSION_KEYS,
  PERMISSION_SECTIONS,
  ROLE_DEFAULT_PERMISSIONS,
  type PermissionAction,
  type PermissionKey,
  type PermissionSection,
  type Permissions,
  type Role,
  type User,
} from "@/lib/api-client";

/**
 * Settings rules, mirrored from the server so the UI never offers what would 403:
 * admin/routes.js (every route's key), admin/service.js (who may touch whom),
 * auth/routes.js + auth/service.js signup (who may create what).
 */

type Actor = Pick<User, "id" | "role" | "permissions" | "ownAccess"> | null | undefined;

export const ROLES: Role[] = ["CREATOR", "TEAM_MEMBER", "PLAN_MAKER", "FINANCE", "ADMIN"];
export const ROLE_NAMES: Record<Role, string> = { CREATOR: "Creator", TEAM_MEMBER: "Team member", PLAN_MAKER: "Planner", FINANCE: "Finance", ADMIN: "Admin" };

/** Tab gates: People is users.view (edits users.edit); numbering and jobs are finance.edit (admin/routes.js). */
export const canSeePeople = (u: Actor) => hasAccess(u, "users.view");
export const canEditPeople = (u: Actor) => hasAccess(u, "users.edit");
export const canEditNumbering = (u: Actor) => hasAccess(u, "finance.edit");
export const canSeeJobs = (u: Actor) => hasAccess(u, "finance.edit");
/**
 * Own bank details: staff always pass GET/POST /billing-profiles (requireOwnAccess
 * lets non-own-scope roles through); own-scope roles need their finance switches.
 * Team members never see billing.
 */
export const canSeeOwnBilling = (u: Actor) => !!u && u.role !== "TEAM_MEMBER" && (isOwnScopeRole(u.role) ? canUse(u, "finance.view") : true);
export const canAddOwnBilling = (u: Actor) => !!u && u.role !== "TEAM_MEMBER" && (isOwnScopeRole(u.role) ? canUse(u, "finance.edit") : true);

/**
 * Everyone's bank details (billing/routes.js + service.js): GET /billing-profiles
 * returns every account's for finance.view; PUT /:id on someone else's needs
 * finance.edit (your own always passes for staff); PUT /:id/approval is finance.pay.
 * Own-scope roles never hold these keys, so they never see the tab.
 */
export const canSeeAllBilling = (u: Actor) => !!u && !isOwnScopeRole(u.role) && hasAccess(u, "finance.view");
export const canEditBillingOf = (u: Actor, ownerId: string) => !!u && !isOwnScopeRole(u.role) && (u.id === ownerId || hasAccess(u, "finance.edit"));
export const canApproveBilling = (u: Actor) => !!u && !isOwnScopeRole(u.role) && hasAccess(u, "finance.pay");

/** My team: GET/POST /users/me/team are CREATOR-only, gated on their own users.view / users.edit switches. */
export const canSeeTeam = (u: Actor) => u?.role === "CREATOR" && hasOwnAccess(u, "users.view");
export const canManageTeam = (u: Actor) => u?.role === "CREATOR" && hasOwnAccess(u, "users.edit");
/** Google account for plan sheets: /integrations/google/authorize only accepts an ADMIN session. */
export const canConnectGoogle = (u: Actor) => u?.role === "ADMIN";

/** A plain, unrestricted ADMIN (server isFullAdmin): the only actor who may touch an admin account or make one. Opt-in keys (Bulk Tracker) don't count. */
export const isFullAdmin = (u: Actor) => u?.role === "ADMIN" && !PERMISSION_KEYS.some((k) => !isOptInKey(k) && u.permissions?.[k] === false);

/** Reset password / change email: a non-full admin may only do it to creators and team members (SUB_ADMIN_RESETTABLE_ROLES). */
export const canTakeOver = (actor: Actor, target: User) => canEditPeople(actor) && (isFullAdmin(actor) || target.role === "CREATOR" || target.role === "TEAM_MEMBER");
/** Role and access edits: never yourself; an admin account only by a full admin (CANNOT_EDIT_SELF, assertActorMayTouchAdmin). */
export const canEditAccessOf = (actor: Actor, target: User) => canEditPeople(actor) && actor?.id !== target.id && (isFullAdmin(actor) || target.role !== "ADMIN");
/** Roles this actor may create: Admin only by a full admin. Signup clamps a new account's access to the creator's own (we always send it). */
export const assignableRoles = (actor: Actor) => ROLES.filter((r) => r !== "ADMIN" || isFullAdmin(actor));
/**
 * Roles this actor may move someone to. A role change resets access to the new
 * role's baseline and the server doesn't clamp it (admin/service.js updateUserRole),
 * so a restricted admin isn't offered a role that would carry access they lack.
 */
export const rolesForChange = (actor: Actor) =>
  assignableRoles(actor).filter((r) => isFullAdmin(actor) || isOwnScopeRole(r) || PERMISSION_KEYS.every((k) => !ROLE_DEFAULT_PERMISSIONS[r][k] || hasAccess(actor, k)));

/** A role's starting access: staff baseline, or every own-content switch on. */
export const accessBaseline = (role: Role): Permissions => (isOwnScopeRole(role) ? defaultOwnAccess(role) : { ...ROLE_DEFAULT_PERMISSIONS[role] });
/** What this account can do now, in the same key space the editor uses. */
export const accessOf = (u: User): Permissions =>
  isOwnScopeRole(u.role)
    ? // Opt-in keys (Bulk Tracker) live on the effective map for every role, not on ownAccess.
      (Object.fromEntries(PERMISSION_KEYS.map((k) => [k, isOptInKey(k) ? u.permissions?.[k] === true : hasOwnAccess(u, k)])) as Permissions)
    : (Object.fromEntries(PERMISSION_KEYS.map((k) => [k, u.permissions?.[k] ?? ROLE_DEFAULT_PERMISSIONS[u.role][k]])) as Permissions);
export const deviates = (role: Role, value: Permissions) => PERMISSION_KEYS.some((k) => value[k] !== accessBaseline(role)[k]);
/** Own-scope roles may only be sent their own switches plus opt-in keys (anything else is a 400 OWN_SCOPE_ONLY). */
export const payloadFor = (role: Role, value: Permissions): Partial<Permissions> =>
  isOwnScopeRole(role) ? Object.fromEntries([...(OWN_CAPABILITIES[role] ?? []), ...OPT_IN_KEYS].map((k) => [k, value[k]])) : value;

type ActionMeta = { label: string; hint: string };
type SectionMeta = { label: string; view: string; actions: Partial<Record<PermissionAction, ActionMeta>> };

/** Staff wording: each key covers everyone's content. Copied from v1 components/users/access-editor.tsx. */
const SECTION_META: Record<PermissionSection, SectionMeta> = {
  users: { label: "People", view: "See every account", actions: { edit: { label: "Edit", hint: "Add people, change roles, reset passwords, edit access" } } },
  campaigns: { label: "Campaigns", view: "See every campaign and its bookings", actions: { edit: { label: "Edit", hint: "Create and edit campaigns, phases and bookings" } } },
  inventory: {
    label: "Inventory",
    view: "See every page",
    actions: { edit: { label: "Edit", hint: "Add pages for any creator, set rates, refresh, import" }, approve: { label: "Approve", hint: "Approve or reject new pages" } },
  },
  links: {
    label: "Content",
    view: "See every post",
    actions: { edit: { label: "Edit", hint: "Change costs, import posts, mark links broken" }, approve: { label: "Approve", hint: "Approve proofs and insights" } },
  },
  finance: {
    label: "Finance",
    view: "See every invoice and bank detail",
    actions: {
      edit: { label: "Edit", hint: "GST filing, invoice numbering, exports, anyone's bank details" },
      approve: { label: "Approve", hint: "Approve a creator's invoice" },
      pay: { label: "Pay", hint: "Pay vendors, reject invoices, approve bank details" },
    },
  },
  plans: {
    label: "Plans",
    view: "See every plan and saved client",
    actions: { edit: { label: "Edit", hint: "Create, edit and invoice any plan" }, approve: { label: "Approve", hint: "Approve or reject any plan" } },
  },
  // 12 Oct — opt-in for any role, off by default except Admin. Rows are always the account's own batches; only an Admin sees everyone's.
  bulkTrack: { label: "Bulk Tracker", view: "Track any Instagram profile or post for research (not tied to campaigns or payouts)", actions: {} },
};

/** Own-content wording for creators, team members and planners: the same keys, their own content only. */
const OWN_SECTION_META: Partial<Record<Role, Partial<Record<PermissionSection, SectionMeta>>>> = {
  CREATOR: {
    users: { label: "Team", view: "See their own team", actions: { edit: { label: "Manage", hint: "Add team members to work on their pages" } } },
    campaigns: { label: "Campaigns", view: "See the campaigns their pages are booked on", actions: {} },
    inventory: { label: "Pages", view: "See their own pages", actions: { edit: { label: "Add pages", hint: "Add their own pages (an admin approves them)" } } },
    links: { label: "Posts", view: "See their own posts", actions: { edit: { label: "Submit", hint: "Submit posts and upload proofs for their pages" } } },
    finance: { label: "Money", view: "See their own invoices, payouts and bank details", actions: { edit: { label: "Raise invoices", hint: "Raise invoices and manage their bank details" } } },
  },
  TEAM_MEMBER: {
    campaigns: { label: "Campaigns", view: "See the campaigns their creator's pages are booked on", actions: {} },
    inventory: { label: "Pages", view: "See their creator's pages", actions: {} },
    links: { label: "Posts", view: "See posts", actions: { edit: { label: "Submit", hint: "Submit posts and upload proofs for their creator's pages" } } },
    finance: { label: "Money", view: "See invoices and payouts", actions: {} },
  },
  PLAN_MAKER: {
    plans: {
      label: "Plans",
      view: "See their own plans",
      actions: { edit: { label: "Edit", hint: "Create and edit their own plans and client invoices" }, approve: { label: "Approve", hint: "Approve or reject their own plans" } },
    },
    campaigns: { label: "Campaigns", view: "See campaigns made from their plans", actions: { edit: { label: "Add phases", hint: "Add phases to those campaigns" } } },
    links: { label: "Content", view: "See posts on those campaigns", actions: {} },
    finance: { label: "Finance", view: "See invoices and receivables on their own plans", actions: { edit: { label: "Attach files", hint: "Attach or remove the invoice document on those invoices" } } },
    inventory: { label: "Inventory", view: "Browse every page to build plans", actions: { edit: { label: "Add pages", hint: "Add a page under a new or existing creator (an admin approves it)" } } },
  },
};

const SECTION_ORDER = Object.keys(PERMISSION_SECTIONS) as PermissionSection[];
export const keyOf = (section: PermissionSection, action: PermissionAction) => `${section}.${action}` as PermissionKey;

/** The sections a role's editor shows. Own-scope roles see only their own capabilities, plus opt-in sections (Bulk Tracker) any role can be given. */
export function sectionsFor(role: Role): PermissionSection[] {
  if (!isOwnScopeRole(role)) return SECTION_ORDER;
  const allowed = OWN_CAPABILITIES[role] ?? [];
  return SECTION_ORDER.filter((s) => allowed.includes(keyOf(s, "view")) || isOptInKey(keyOf(s, "view")));
}
export function actionsOf(section: PermissionSection, role: Role): PermissionAction[] {
  const all = PERMISSION_SECTIONS[section].filter((a) => a !== "view") as PermissionAction[];
  if (!isOwnScopeRole(role)) return all;
  const allowed = OWN_CAPABILITIES[role] ?? [];
  return all.filter((a) => allowed.includes(keyOf(section, a)));
}
export function metaFor(section: PermissionSection, role: Role): SectionMeta {
  return (isOwnScopeRole(role) ? OWN_SECTION_META[role]?.[section] : undefined) ?? SECTION_META[section];
}

/** "View · Pay", or "Off". */
export function sectionSummary(section: PermissionSection, value: Permissions, role: Role) {
  if (!value[keyOf(section, "view")]) return "Off";
  const on = actionsOf(section, role).filter((a) => value[keyOf(section, a)]);
  return ["View", ...on.map((a) => metaFor(section, role).actions[a]?.label ?? a)].join(" · ");
}

/**
 * The tag beside the role when a staff account differs from its role's normal
 * access. Own-content roles (Creator, Planner) get none: their switches are
 * shown in the person sheet, not flagged in the list (user request, 13 Oct).
 */
export function accessTag(u: User): string | null {
  if (isOwnScopeRole(u.role) || !deviates(u.role, accessOf(u))) return null;
  return u.role === "ADMIN" ? "Restricted admin" : "Custom access";
}

/** Server password rule (auth/schemas.js strongPassword). */
export const PASSWORD_RULES: { label: string; test: (p: string) => boolean }[] = [
  { label: "8 or more characters", test: (p) => p.length >= 8 },
  { label: "An uppercase letter", test: (p) => /[A-Z]/.test(p) },
  { label: "A lowercase letter", test: (p) => /[a-z]/.test(p) },
  { label: "A number", test: (p) => /[0-9]/.test(p) },
  { label: "A symbol", test: (p) => /[^a-zA-Z0-9]/.test(p) },
];

/** Same shapes the server checks (billing/schemas.js PAN; IFSC and GSTIN by their published formats). */
export const BILLING_RULES = {
  pan: (v: string) => (/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(v) ? null : "Enter a PAN like ABCDE1234F."),
  ifsc: (v: string) => (/^[A-Z]{4}0[A-Z0-9]{6}$/.test(v) ? null : "Enter an IFSC like HDFC0001234."),
  account: (v: string) => (/^\d{9,18}$/.test(v) ? null : "Enter the account number: 9 to 18 digits."),
  gstin: (v: string) => (!v || /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/.test(v) ? null : "Enter a 15-character GSTIN like 27ABCDE1234F1Z5, or leave it empty."),
};
