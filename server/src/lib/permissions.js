/**
 * Per-account permission overlay.
 *
 * History: newTask.md, 8 Sep — "Admin can create Sub-admins, each with a
 * hand-picked selection of what they can see/access"; 15 Sep — the same keys
 * can be *granted* to other roles; 23 Sep — six section-wide keys split into
 * per-action keys ("user selects Invoices, then checkboxes for edit, approve
 * … appear below"), because one box bundling view+edit+approve+pay let e.g.
 * a single finance grant both approve and pay the same invoice.
 *
 * Keys are `<section>.<action>`:
 *   view    — see the whole section (every row, not just your own)
 *   edit    — create / update / delete / import in that section
 *   approve — the section's sign-off step
 *   pay     — finance only: mark paid, reject, approve bank details
 * `edit`, `approve` and `pay` each imply `view` (normalised on write and on
 * read), so a section can never be "editable but invisible".
 *
 * Every role has its own baseline (ROLE_DEFAULTS); an overlay only stores
 * deviations from it. A plain account (permissions === null) behaves exactly
 * as its role always did. Two roles can't carry an overlay at all —
 * NON_GRANTABLE_ROLES below.
 *
 * Old six-key overlays (`users.manage`, …) still stored on rows are expanded
 * on read by expandLegacyOverlay(), so nothing breaks before the one-off
 * `prisma/scripts/expandPermissionKeys.js` rewrites them.
 */
import { ApiError } from "../middleware/errorHandler.js";

export const SECTIONS = {
  users: ["view", "edit"],
  campaigns: ["view", "edit"],
  inventory: ["view", "edit", "approve"],
  links: ["view", "edit", "approve"],
  finance: ["view", "edit", "approve", "pay"],
  plans: ["view", "edit", "approve"],
};

export const PERMISSION_KEYS = Object.entries(SECTIONS).flatMap(([section, actions]) => actions.map((a) => `${section}.${a}`));

/** Old key → the new keys it covered. Only consulted for rows written before 23 Sep. */
export const LEGACY_KEY_MAP = {
  "users.manage": ["users.view", "users.edit"],
  "campaigns.manage": ["campaigns.view", "campaigns.edit"],
  "inventory.manage": ["inventory.view", "inventory.edit", "inventory.approve"],
  "links.review": ["links.view", "links.edit", "links.approve"],
  "finance.manage": ["finance.view", "finance.edit", "finance.approve", "finance.pay"],
  "plans.manage": ["plans.view", "plans.edit", "plans.approve"],
};

const allTrue = () => Object.fromEntries(PERMISSION_KEYS.map((key) => [key, true]));
const allFalse = () => Object.fromEntries(PERMISSION_KEYS.map((key) => [key, false]));

/**
 * Role baselines. FINANCE's mirrors what the role could already do before
 * keys existed: approve (Finance approves and pays — invoices/routes.js, 23
 * Sep), pay/reject/gst/billing approval, and see every campaign, page and
 * link. `finance.approve` is its own key so an admin can still take the
 * sign-off away from a given Finance account. PLAN_MAKER reads Inventory;
 * its own-plans scope is role-based in plans/service.js, not a key.
 * CREATOR / TEAM_MEMBER: nothing.
 */
export const ROLE_DEFAULTS = {
  ADMIN: allTrue(),
  FINANCE: { ...allFalse(), "finance.view": true, "finance.edit": true, "finance.approve": true, "finance.pay": true, "campaigns.view": true, "inventory.view": true, "links.view": true },
  PLAN_MAKER: { ...allFalse(), "inventory.view": true },
  CREATOR: allFalse(),
  TEAM_MEMBER: allFalse(),
};

export function roleDefaults(role) {
  return ROLE_DEFAULTS[role] ?? allFalse();
}

/** Expands any legacy six-key entries into their per-action keys. New keys present alongside win. */
export function expandLegacyOverlay(overlay) {
  if (!overlay || typeof overlay !== "object") return null;
  const out = {};
  for (const [legacy, keys] of Object.entries(LEGACY_KEY_MAP)) {
    if (typeof overlay[legacy] === "boolean") for (const key of keys) out[key] = overlay[legacy];
  }
  for (const key of PERMISSION_KEYS) {
    if (typeof overlay[key] === "boolean") out[key] = overlay[key];
  }
  return out;
}

/** `edit` / `approve` / `pay` true ⇒ that section's `view` true. Mutates and returns `map`. */
export function applyViewImplication(map) {
  for (const [section, actions] of Object.entries(SECTIONS)) {
    if (actions.some((a) => a !== "view" && map[`${section}.${a}`] === true)) map[`${section}.view`] = true;
  }
  return map;
}

/**
 * Merge a user's `permissions` overlay onto its role's baseline. Written so
 * a permission-gated route fails closed for a role that's never been
 * granted anything, not open.
 */
export function getEffectivePermissions(user) {
  const effective = { ...roleDefaults(user?.role) };
  const overlay = expandLegacyOverlay(user?.permissions);
  if (overlay) {
    for (const key of PERMISSION_KEYS) {
      if (typeof overlay[key] === "boolean") effective[key] = overlay[key];
    }
  }
  return applyViewImplication(effective);
}

export function hasPermission(user, key) {
  return getEffectivePermissions(user)[key] === true;
}

/** True only for an ADMIN-role account whose overlay turns at least one default-true key off. */
export function isRestrictedSubAdmin(user) {
  if (user?.role !== "ADMIN" || !user?.permissions) return false;
  const effective = getEffectivePermissions(user);
  return PERMISSION_KEYS.some((key) => effective[key] !== true);
}

/**
 * A plain, unrestricted ADMIN — the only actor allowed to touch another
 * ADMIN account (role, overlay, password), to promote or create an ADMIN,
 * or to reset a FINANCE / PLAN_MAKER password (23 Sep audit: a granted
 * `users.edit` holder could otherwise turn that one grant into full admin
 * by promoting themselves or signing in as someone with more access).
 */
export function isFullAdmin(user) {
  return user?.role === "ADMIN" && !isRestrictedSubAdmin(user);
}

/**
 * Roles an overlay may be stored on. CREATOR and TEAM_MEMBER are excluded
 * (user decision, 23 Sep): every list they can reach is scoped to their own
 * rows, so any section grant only ever let them approve/price/pay *their
 * own* links, pages and invoices. A Creator who needs ops access gets a
 * different role, not a grant.
 */
export const NON_GRANTABLE_ROLES = ["CREATOR", "TEAM_MEMBER"];

export function isGrantableRole(role) {
  return !NON_GRANTABLE_ROLES.includes(role);
}

/**
 * 400 when a caller tries to *grant* (any key true) on a CREATOR/TEAM_MEMBER
 * account. All-false is tolerated as the no-op it is — their baseline is
 * already every key false, so an all-false overlay changes nothing.
 */
export function assertGrantableRole(role, requestedOverlay) {
  if (isGrantableRole(role)) return;
  if (requestedOverlay && Object.values(requestedOverlay).some((v) => v === true)) {
    throw new ApiError(400, "ROLE_NOT_GRANTABLE", "Creator and Team member accounts can't be given admin sections — change their role instead.");
  }
}

/**
 * Strips unknown keys and non-booleans out of a client-supplied permissions
 * object before it's persisted; legacy keys are accepted and expanded.
 * Turning a section's `view` off also turns its other actions off (they'd
 * be re-implied otherwise), so "uncheck the section" means what it says.
 */
export function sanitizePermissionsInput(input) {
  if (!input || typeof input !== "object") return null;
  const clean = expandLegacyOverlay(input) ?? {};
  for (const [section, actions] of Object.entries(SECTIONS)) {
    if (clean[`${section}.view`] === false) for (const a of actions) if (a !== "view") clean[`${section}.${a}`] = false;
  }
  return applyViewImplication(clean);
}

/**
 * An actor can only ever hand out access up to their own — otherwise a
 * restricted sub-admin with users.edit could create or edit another
 * account with a key they themselves don't have, then use that account to
 * reach the section their own restriction was supposed to block (see
 * auth/service.js's signup and admin/service.js's updateUserPermissions).
 * Two variants, because "unspecified" means different things in each:
 *
 * - computeNewAccountOverlay: for a brand-new account of `role`. A key the
 *   caller didn't mention falls back to that role's baseline *unless* the
 *   actor doesn't hold it — granting (true) always requires the actor to
 *   hold the key. Returns a minimal overlay: only the keys that deviate
 *   from the baseline (an all-baseline result is `{}`, storable as `null`).
 *
 * - clampPatchToActor: for editing an *existing* overlay via a partial
 *   patch. Only touches keys actually present in the patch — a key the
 *   caller didn't mention must fall through to the target's existing value
 *   untouched. Only forces a patched `true` down to `false` when the actor
 *   doesn't hold that key.
 *
 * Both are a no-op for a plain, unrestricted admin (every key already true).
 */
export function computeNewAccountOverlay(actorUser, requestedOverlay, role) {
  const actorEffective = getEffectivePermissions(actorUser);
  const defaults = roleDefaults(role);
  const wanted = {};
  for (const key of PERMISSION_KEYS) {
    const requestedGrant = Object.prototype.hasOwnProperty.call(requestedOverlay, key) ? requestedOverlay[key] === true : defaults[key];
    wanted[key] = requestedGrant && actorEffective[key] === true;
  }
  applyViewImplication(wanted);
  const overlay = {};
  for (const key of PERMISSION_KEYS) if (wanted[key] !== defaults[key]) overlay[key] = wanted[key];
  return overlay;
}

export function clampPatchToActor(actorUser, requestedPatch) {
  const actorEffective = getEffectivePermissions(actorUser);
  const clamped = { ...requestedPatch };
  for (const key of Object.keys(clamped)) {
    if (clamped[key] === true && actorEffective[key] !== true) clamped[key] = false;
  }
  return clamped;
}
