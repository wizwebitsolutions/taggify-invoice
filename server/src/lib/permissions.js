/**
 * Sub-admin permission overlay (newTask.md, 8 Sep — "Admin can create
 * Sub-admins, each with a hand-picked selection of what they can
 * see/access... the permission toggle isn't just per fixed role, it's a
 * genuine per-account permission set admin assigns at creation").
 *
 * Deliberately narrow: these six keys cover exactly the module clusters
 * that were `requireRole("ADMIN")`-only before this phase (see routes.js
 * files for where requirePermission() below is now chained alongside that
 * same requireRole("ADMIN") check). A plain ADMIN account (permissions ===
 * null) gets every key true — identical behavior to before this phase
 * existed. Only a sub-admin (an ADMIN account with an explicit overlay) can
 * ever see a key resolve to false; no other role reads this module at all
 * today, since FINANCE/CREATOR/TEAM_MEMBER/PLAN_MAKER's existing
 * requireRole() gates weren't touched.
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
 * role other than ADMIN defaults every key to false here — harmless, since
 * requirePermission() is only ever chained after requireRole("ADMIN"), so
 * those roles never reach a check that reads this map. Written this way
 * (rather than only defining ADMIN's map) so a future permission-gated
 * route for another role fails closed by default, not open.
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
 * A sub-admin can only ever hand out access up to their own — otherwise a
 * restricted sub-admin with users.manage could create or edit another
 * ADMIN account with a key they themselves don't have, then use that
 * account to reach the section their own restriction was supposed to
 * block (a real gap this was added to close — see auth/service.js's
 * signup and admin/service.js's updateUserPermissions for the two places
 * it's applied). Two variants, because "unspecified" means different
 * things in each caller:
 *
 * - computeNewAdminOverlay: for a brand-new account, where there's no
 *   existing state to inherit. A key the caller didn't mention defaults to
 *   "full grant" (matching a plain admin's normal experience) *unless* the
 *   actor doesn't hold that key themselves, in which case it's forced off
 *   regardless — otherwise simply not sending `permissions` would be
 *   enough to mint an unrestricted peer. Returns a minimal overlay (only
 *   the `false` keys — an all-true result is `{}`, storable as `null`).
 *
 * - clampPatchToActor: for editing an *existing* overlay via a partial
 *   patch. Only touches keys actually present in the patch — a key the
 *   caller didn't mention must fall through to the target's existing
 *   value untouched, not be silently re-derived from the actor's own
 *   permissions (that would strip a target's unrelated pre-existing grants
 *   just because the editing actor happens to lack them). Only forces a
 *   patched `true` down to `false` when the actor doesn't hold that key.
 *
 * Both are a no-op for a plain, unrestricted admin (every key already
 * true), so neither ever limits what a real admin can hand out.
 */
export function computeNewAdminOverlay(actorUser, requestedOverlay) {
  const actorEffective = getEffectivePermissions(actorUser);
  const overlay = {};
  for (const key of PERMISSION_KEYS) {
    const requestedGrant = Object.prototype.hasOwnProperty.call(requestedOverlay, key) ? requestedOverlay[key] === true : true;
    if (!(requestedGrant && actorEffective[key] === true)) overlay[key] = false;
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
