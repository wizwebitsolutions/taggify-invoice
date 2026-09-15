/**
 * Per-account permission overlay (newTask.md, 8 Sep — "Admin can create
 * Sub-admins, each with a hand-picked selection of what they can
 * see/access... the permission toggle isn't just per fixed role, it's a
 * genuine per-account permission set admin assigns at creation"; extended
 * 15 Sep so the same six keys can be *granted* to any role, not just
 * withheld from an ADMIN — "admin can give accessibility permissions to
 * user").
 *
 * Deliberately narrow: these six keys cover exactly the module clusters
 * that were `requireRole("ADMIN")`-only before this phase (see routes.js
 * files for where requireAccess()/requirePermission() below sit). Every
 * role has its own baseline (ADMIN: every key true by default; every other
 * role: every key false by default) — an overlay only ever stores
 * *deviations* from that role's own baseline, so a plain ADMIN account or a
 * plain CREATOR/TEAM_MEMBER/FINANCE/PLAN_MAKER account (permissions ===
 * null) behaves exactly as it always did. A restricted sub-admin (ADMIN
 * with a key forced false) and a granted non-admin (any other role with a
 * key forced true) are the two ways this overlay can matter.
 */
export const PERMISSION_KEYS = [
  "users.manage", // admin/users list+role+reset-password, auth/signup (create accounts, incl. sub-admins)
  "campaigns.manage", // campaigns create/update/phases/assignments/import-sheet
  "inventory.manage", // assets create/approval/rate-card (page registry + rate cards)
  "links.review", // links bulk-import/review-screenshot/refresh-metrics/approve-insights/cost/mark-invalid
  "finance.manage", // invoices mark-paid/gst-status/payment-status/reject, billing approval, finance export, job runs
  "plans.manage", // plans full CRUD + approving/rejecting any plan (Plan Maker's own-plan access is separate — see plans/service.js)
];

const ADMIN_DEFAULTS = Object.fromEntries(PERMISSION_KEYS.map((key) => [key, true]));

/**
 * Merge a user's `permissions` override onto its role's defaults. Every
 * role other than ADMIN defaults every key to false here, and an overlay
 * can turn any key on regardless of role — this is what lets requireAccess()
 * grant a non-admin account one of these six sections. Written this way
 * (rather than only defining ADMIN's map) so a permission-gated route fails
 * closed by default for a role that's never been granted anything, not open.
 */
export function getEffectivePermissions(user) {
  const defaults = user?.role === "ADMIN" ? ADMIN_DEFAULTS : {};
  const overlay = user?.permissions && typeof user.permissions === "object" ? user.permissions : null;
  const effective = { ...Object.fromEntries(PERMISSION_KEYS.map((key) => [key, defaults[key] ?? false])) };
  if (overlay) {
    for (const key of PERMISSION_KEYS) {
      if (typeof overlay[key] === "boolean") effective[key] = overlay[key];
    }
  }
  return effective;
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

/** Strips unknown keys and non-booleans out of a client-supplied permissions object before it's persisted. */
export function sanitizePermissionsInput(input) {
  if (!input || typeof input !== "object") return null;
  const clean = {};
  for (const key of PERMISSION_KEYS) {
    if (typeof input[key] === "boolean") clean[key] = input[key];
  }
  return clean;
}

/**
 * An actor can only ever hand out access up to their own — otherwise a
 * restricted sub-admin with users.manage could create or edit another
 * account with a key they themselves don't have, then use that account to
 * reach the section their own restriction was supposed to block (a real gap
 * this was added to close — see auth/service.js's signup and
 * admin/service.js's updateUserPermissions for the two places it's
 * applied). Two variants, because "unspecified" means different things in
 * each caller:
 *
 * - computeNewAccountOverlay: for a brand-new account, where there's no
 *   existing state to inherit. `defaultGrant` is the new account's own role
 *   baseline (true for ADMIN — matching a plain admin's normal experience;
 *   false for every other role — a brand-new CREATOR/TEAM_MEMBER/FINANCE/
 *   PLAN_MAKER shouldn't silently gain all six sections just because
 *   `permissions` wasn't sent). A key the caller didn't mention falls back
 *   to that baseline *unless* the actor doesn't hold that key themselves —
 *   granting a key (true) always requires the actor to hold it, regardless
 *   of the new account's baseline. Returns a minimal overlay: only the keys
 *   that deviate from `defaultGrant` (an all-baseline result is `{}`,
 *   storable as `null`).
 *
 * - clampPatchToActor: for editing an *existing* overlay via a partial
 *   patch. Only touches keys actually present in the patch — a key the
 *   caller didn't mention must fall through to the target's existing
 *   value untouched, not be silently re-derived from the actor's own
 *   permissions (that would strip a target's unrelated pre-existing grants
 *   just because the editing actor happens to lack them). Only forces a
 *   patched `true` down to `false` when the actor doesn't hold that key.
 *
 * Both are a no-op for a plain, unrestricted admin acting on another admin
 * (every key already true), so neither ever limits what a real admin can
 * hand out.
 */
export function computeNewAccountOverlay(actorUser, requestedOverlay, defaultGrant) {
  const actorEffective = getEffectivePermissions(actorUser);
  const overlay = {};
  for (const key of PERMISSION_KEYS) {
    const requestedGrant = Object.prototype.hasOwnProperty.call(requestedOverlay, key) ? requestedOverlay[key] === true : defaultGrant;
    const grant = requestedGrant && actorEffective[key] === true;
    if (grant !== defaultGrant) overlay[key] = grant;
  }
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
