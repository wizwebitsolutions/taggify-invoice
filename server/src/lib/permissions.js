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
 * as its role always did.
 *
 * Own-scope roles (24 Sep — CREATOR, TEAM_MEMBER, PLAN_MAKER): the same key
 * names mean *their own content only* ("whatever access we give, they'll
 * have access to their own content, not every"). They never hold a global
 * key — getEffectivePermissions is all-false for them no matter what's
 * stored — and their overlay toggles OWN_CAPABILITIES instead (see
 * getOwnCapabilities), all ON by default.
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
  // 12 Oct: Bulk Tracker (market-research Instagram scraping, ported from
  // affiliate-creator-tool). One key: "may use the tool" — rows are always
  // scoped to the user's own batches unless they are a full admin.
  bulkTrack: ["view"],
};

/**
 * Opt-in keys (12 Oct — "every user whom we give access to"): grantable to
 * ANY role, own-scope roles included, and OFF by default for everyone but
 * ADMIN. Unlike every other key they don't widen an own-scope account's reach
 * to someone else's data — the feature itself only ever shows the user their
 * own rows — so a CREATOR can hold one without breaking the own-scope rule.
 * Stored on the overlay as `true` when granted (absence = off).
 */
export const OPT_IN_KEYS = ["bulkTrack.view"];

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
  // Own-scope roles hold no global key at all — see OWN_CAPABILITIES.
  PLAN_MAKER: allFalse(),
  CREATOR: allFalse(),
  TEAM_MEMBER: allFalse(),
};

/**
 * Own-scope roles (24 Sep): accounts whose access only ever covers their own
 * content. Their overlay is a set of on/off switches over OWN_CAPABILITIES
 * (default ON — user decision: nothing changes until an admin removes
 * something), never a global grant.
 */
export const OWN_SCOPE_ROLES = ["CREATOR", "TEAM_MEMBER", "PLAN_MAKER"];

export function isOwnScopeRole(role) {
  return OWN_SCOPE_ROLES.includes(role);
}

/**
 * What each own-scope role can be given/removed, and what the key means for it:
 *
 * CREATOR
 *   campaigns.view  — campaigns one of their pages is in
 *   inventory.view  — their own pages;  inventory.edit — add own pages (start pending)
 *   links.view      — their own links;  links.edit — submit links + screenshots on own pages
 *   finance.view    — own invoices, payouts, billing profiles
 *   finance.edit    — raise invoices on own links, manage own billing profiles, invoice files
 *   users.view/edit — see / manage their own team
 * TEAM_MEMBER — like a creator's worker: campaigns.view, inventory.view, links.view/edit, finance.view
 * PLAN_MAKER
 *   plans.view/edit/approve — own plans (client invoice + attachments are plan actions)
 *   campaigns.view/edit     — campaigns created from own plans / add phases to them
 *   links.view              — links on those campaigns
 *   finance.view            — invoices on own plans' campaigns + own plans' receivables
 *   finance.edit            — attach / remove the invoice file on those invoices
 *   inventory.view          — the full page catalogue (planners pick pages for clients from it)
 *   inventory.edit          — 25 Sep: register a page under an existing OR brand-new creator
 *                             account (vendor onboarding while building a plan) — always
 *                             lands `pending` for admin approval, never carries a rate card,
 *                             same as a creator's own inventory.edit (createAsset.js).
 *
 * `finance.pay` is never own-scope, for any role — it means paying someone
 * else, which doesn't fit "own content" no matter how far this list grows.
 */
export const OWN_CAPABILITIES = {
  CREATOR: ["campaigns.view", "inventory.view", "inventory.edit", "links.view", "links.edit", "finance.view", "finance.edit", "users.view", "users.edit"],
  TEAM_MEMBER: ["campaigns.view", "inventory.view", "links.view", "links.edit", "finance.view"],
  PLAN_MAKER: ["plans.view", "plans.edit", "plans.approve", "campaigns.view", "campaigns.edit", "links.view", "finance.view", "finance.edit", "inventory.view", "inventory.edit"],
};

/**
 * The own-content switches for an own-scope role: every key in the role's
 * OWN_CAPABILITIES list defaults ON, the stored overlay can turn any off
 * (or back on); keys outside the list are always false. Turning a section's
 * view off takes its actions with it. Staff roles get all-false here — their
 * access is getEffectivePermissions.
 */
export function getOwnCapabilities(user) {
  const out = allFalse();
  const allowed = OWN_CAPABILITIES[user?.role];
  if (!allowed) return out;
  const overlay = ownStoredOverlay(user.role, user.permissions);
  for (const key of allowed) out[key] = typeof overlay[key] === "boolean" ? overlay[key] : true;
  for (const [section, actions] of Object.entries(SECTIONS)) {
    if (out[`${section}.view`] === false) for (const a of actions) out[`${section}.${a}`] = false;
  }
  Object.assign(out, optInGrants(user.permissions));
  return out;
}

/** {key: true} for each opt-in key the stored overlay grants — off when absent. */
export function optInGrants(stored) {
  const out = {};
  if (!stored || typeof stored !== "object") return out;
  for (const key of OPT_IN_KEYS) if (stored[key] === true) out[key] = true;
  return out;
}

export function hasOwnCapability(user, key) {
  return getOwnCapabilities(user)[key] === true;
}

/**
 * The own-content switches actually stored for an own-scope user. An overlay
 * written by ownOverlayFor is only ever {ownKey: false, ...}; anything else —
 * legacy six-key entries, a `true`, a key outside the role's list — was
 * written by the old global-grant model, where `false` meant "not granted
 * globally", not "switched off". Such an overlay is ignored (everything on)
 * rather than silently taking a planner's own sections away.
 */
export function ownStoredOverlay(role, stored) {
  const allowed = OWN_CAPABILITIES[role] ?? [];
  if (!stored || typeof stored !== "object") return {};
  // Opt-in grants live alongside the off-switches; they aren't part of the shape check.
  const entries = Object.entries(stored).filter(([k]) => !OPT_IN_KEYS.includes(k));
  const ownShape = entries.every(([k, v]) => allowed.includes(k) && v === false);
  return ownShape ? Object.fromEntries(entries) : {};
}

/**
 * An own-scope role's stored overlay may only name that role's own
 * capabilities (true or false) — anything else would be an attempt to hand
 * out global access (400 OWN_SCOPE_ONLY). Returns the minimal overlay to
 * store: only keys switched OFF (ON is the default), or null.
 */
export function ownOverlayFor(role, requested, existing = null) {
  const allowed = OWN_CAPABILITIES[role] ?? [];
  const bad = Object.keys(requested ?? {}).filter((k) => !allowed.includes(k) && !OPT_IN_KEYS.includes(k) && requested[k] === true);
  if (bad.length > 0) {
    throw new ApiError(400, "OWN_SCOPE_ONLY", `These can't be given to this role: ${bad.join(", ")}. A ${role.toLowerCase().replace("_", " ")} only ever gets access to their own content.`);
  }
  const current = ownStoredOverlay(role, existing);
  const merged = {};
  for (const key of allowed) {
    const value = typeof requested?.[key] === "boolean" ? requested[key] : typeof current[key] === "boolean" ? current[key] : true;
    if (value === false) merged[key] = false;
  }
  for (const key of OPT_IN_KEYS) {
    const value = typeof requested?.[key] === "boolean" ? requested[key] : existing?.[key] === true;
    if (value === true) merged[key] = true;
  }
  return Object.keys(merged).length > 0 ? merged : null;
}

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
  // Own-scope roles never hold a global key, whatever an old or tampered
  // overlay says — their switches are getOwnCapabilities.
  // The only exception is an opt-in key (OPT_IN_KEYS) an admin granted them.
  if (isOwnScopeRole(user?.role)) return { ...allFalse(), ...optInGrants(user.permissions) };
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
 * Roles that can hold *global* keys (staff). Own-scope roles are the rest —
 * they get own-content switches instead (see ownOverlayFor).
 */
export function isGrantableRole(role) {
  return !isOwnScopeRole(role);
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

/**
 * Opt-in grants for an own-scope target go through ownOverlayFor, which has
 * no actor — so clamp them here first: an actor can only hand out an opt-in
 * key they hold themselves (same rule clampPatchToActor applies to staff).
 */
export function clampOptInToActor(actorUser, requested) {
  const actorEffective = getEffectivePermissions(actorUser);
  const out = { ...(requested ?? {}) };
  for (const key of OPT_IN_KEYS) if (out[key] === true && actorEffective[key] !== true) out[key] = false;
  return out;
}

export function clampPatchToActor(actorUser, requestedPatch) {
  const actorEffective = getEffectivePermissions(actorUser);
  const clamped = { ...requestedPatch };
  for (const key of Object.keys(clamped)) {
    if (clamped[key] === true && actorEffective[key] !== true) clamped[key] = false;
  }
  return clamped;
}
