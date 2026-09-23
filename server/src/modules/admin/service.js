import bcrypt from "bcryptjs";
import { prisma } from "../../lib/prisma.js";
import { generatePassword } from "../../lib/auth/passwordGenerator.js";
import { ApiError } from "../../middleware/errorHandler.js";
import { getEffectivePermissions, sanitizePermissionsInput, clampPatchToActor, isFullAdmin, isGrantableRole, assertGrantableRole } from "../../lib/permissions.js";

const BCRYPT_ROUNDS = 12;
export const ROLES = ["CREATOR", "TEAM_MEMBER", "ADMIN", "FINANCE", "PLAN_MAKER"];

async function loadActor(actorId) {
  const actor = await prisma.user.findUnique({ where: { id: actorId } });
  if (!actor) throw new ApiError(401, "UNAUTHENTICATED", "Acting user no longer exists");
  return actor;
}

/**
 * Anything that touches an ADMIN account — or turns an account into one —
 * needs a plain, unrestricted admin behind it (23 Sep audit). Without this,
 * `users.manage` alone was a full-admin escalation: change your own role to
 * ADMIN (which drops the overlay), or reset a real admin's password, read
 * it off the response, and sign in as them.
 */
function assertActorMayTouchAdmin(actor, { target, newRole }) {
  if (isFullAdmin(actor)) return;
  if (target?.role === "ADMIN" || newRole === "ADMIN") {
    throw new ApiError(403, "ADMIN_ACCOUNT_RESTRICTED", "Only a full admin can change an admin account or make someone an admin.");
  }
}

/**
 * Password reset is a takeover of the target: whoever reads the new password
 * off the response signs in as them, with *their* role and grants. So a
 * non-full-admin may only reset accounts that can't out-rank them by
 * construction — CREATOR / TEAM_MEMBER, the roles that can never carry a
 * grant (review finding, 23 Sep: a users.manage holder could otherwise
 * reset a FINANCE account, or a Planner granted finance.manage, and sign in
 * as them — the same class of hole as the ADMIN case, one role down).
 */
function assertActorMayResetPassword(actor, target) {
  if (isFullAdmin(actor)) return;
  if (isGrantableRole(target.role)) {
    throw new ApiError(403, "ADMIN_ACCOUNT_RESTRICTED", "Only a full admin can reset an admin, finance or planner account's password.");
  }
}

/**
 * newTask.md #8's "admin will have password of all creators", resolved as
 * reset-and-reveal rather than storing recoverable passwords (see CLAUDE.md
 * / test.md for why): admin can reset any user's password at any moment: a
 * fresh system-generated password is returned once, exactly like account
 * creation — nothing plaintext is ever stored at rest. Existing sessions are
 * revoked, same as a self-service password change, so the old password
 * can't keep working anywhere after this.
 *
 * Audit-logged (action "password_reset") since it's a takeover primitive:
 * whoever holds the new password *is* that user until they change it.
 */
export async function resetUserPassword(actorId, userId) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new ApiError(404, "USER_NOT_FOUND", "User not found");
  const actor = await loadActor(actorId);
  assertActorMayResetPassword(actor, user);

  const plaintextPassword = generatePassword();
  const passwordHash = await bcrypt.hash(plaintextPassword, BCRYPT_ROUNDS);

  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
    prisma.refreshToken.updateMany({ where: { userId, revoked: false }, data: { revoked: true } }),
    prisma.permissionAuditLog.create({ data: { targetId: userId, actorId, action: "password_reset", before: null, after: {} } }),
  ]);

  return { generatedPassword: plaintextPassword };
}

/**
 * Change an account's role. Always drops whatever overlay the account
 * carried (15 Sep — overlays exist on any role) — if it's ever moved to this
 * role (or back to ADMIN) again later, it should start at that role's plain
 * baseline, not silently reappear restricted or granted by a stale set from
 * the role it just left.
 *
 * Self-changes are refused outright (the UI already disables the dropdown
 * on your own row; the server didn't check, so a granted `users.manage`
 * holder could promote themselves). Promoting to ADMIN, or changing an
 * ADMIN's role, needs a full admin — see assertActorMayTouchAdmin.
 */
export async function updateUserRole(actorId, targetId, role) {
  if (!ROLES.includes(role)) throw new ApiError(400, "VALIDATION_ERROR", "Invalid role");
  if (actorId === targetId) throw new ApiError(403, "CANNOT_EDIT_SELF", "You can't change your own role — ask another admin.");

  const target = await prisma.user.findUnique({ where: { id: targetId } });
  if (!target) throw new ApiError(404, "USER_NOT_FOUND", "User not found");
  const actor = await loadActor(actorId);
  assertActorMayTouchAdmin(actor, { target, newRole: role });

  // Sessions are revoked as well: the access token carries `role`, so
  // without this a demoted ADMIN keeps every requireRole("ADMIN") route until
  // it expires (review finding, 23 Sep). Same as reset-password does.
  const [row] = await prisma.$transaction([
    prisma.user.update({ where: { id: targetId }, data: { role, permissions: null } }),
    prisma.refreshToken.updateMany({ where: { userId: targetId, revoked: false }, data: { revoked: true } }),
    prisma.permissionAuditLog.create({
      data: { targetId, actorId, action: "role", before: { role: target.role, permissions: target.permissions ?? null }, after: { role, permissions: null } },
    }),
  ]);
  // Never echo the hash back (the old inline route did) — the Users page
  // only needs the row's public fields plus its new effective permissions.
  const { passwordHash: _omit, ...updated } = row;
  return { ...updated, permissions: getEffectivePermissions(updated) };
}

/**
 * Sets/edits a user's permission overlay (newTask.md, 8 Sep for the ADMIN
 * sub-admin case; extended 15 Sep so any grantable role can be given the
 * same sections — "admin can give any user access permissions"; narrowed 23
 * Sep so CREATOR/TEAM_MEMBER can't carry one at all — see
 * lib/permissions.js's NON_GRANTABLE_ROLES). `patch` only carries the keys
 * the caller actually sent (schemas.js's updatePermissionsSchema makes every
 * key optional) — merged onto the target's *existing* overlay rather than
 * replacing it, so toggling one key off in the UI can't silently reset every
 * other key back to its role's baseline. Every call is written to
 * PermissionAuditLog — the "who changed whose access and when" trail
 * newTask.md's suggested improvements asked for.
 *
 * The patch (only the keys actually sent — not the target's whole existing
 * overlay) is clamped to the *actor's own* effective permissions before
 * merging — otherwise a restricted sub-admin with users.manage could grant
 * some other account a key they don't hold themselves (or re-grant
 * themselves, if the caller weren't already blocked from self-edits at the
 * route layer), handing out more access than they were ever entrusted
 * with. Clamping only the patch — not the whole merged result — matters:
 * a key the actor isn't touching must fall through from the target's
 * existing overlay untouched, not get silently reset just because the
 * *editing* actor happens to lack it themselves. A no-op for an
 * unrestricted admin (every key already true).
 */
export async function updateUserPermissions(actorId, targetId, patch) {
  const target = await prisma.user.findUnique({ where: { id: targetId } });
  if (!target) throw new ApiError(404, "USER_NOT_FOUND", "User not found");
  const actor = await loadActor(actorId);
  // Editing an ADMIN's overlay is itself an admin-account change: a
  // non-full-admin could otherwise PUT every key false on every real admin
  // and lock the whole system out of full-admin status (review finding, 23 Sep).
  assertActorMayTouchAdmin(actor, { target });

  const requested = sanitizePermissionsInput(patch) ?? {};
  assertGrantableRole(target.role, requested);

  const before = target.permissions && typeof target.permissions === "object" ? target.permissions : null;
  const clampedPatch = clampPatchToActor(actor, requested);
  const merged = { ...(before ?? {}), ...clampedPatch };

  const [row] = await prisma.$transaction([
    prisma.user.update({ where: { id: targetId }, data: { permissions: merged } }),
    prisma.permissionAuditLog.create({ data: { targetId, actorId, action: "permissions", before, after: merged } }),
  ]);

  const { passwordHash: _omit, ...updated } = row;
  return { ...updated, permissions: getEffectivePermissions(updated) };
}
