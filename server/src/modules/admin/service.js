import bcrypt from "bcryptjs";
import { prisma } from "../../lib/prisma.js";
import { generatePassword } from "../../lib/auth/passwordGenerator.js";
import { ApiError } from "../../middleware/errorHandler.js";
import { getEffectivePermissions, sanitizePermissionsInput, clampPatchToActor } from "../../lib/permissions.js";

const BCRYPT_ROUNDS = 12;

/**
 * newTask.md #8's "admin will have password of all creators", resolved as
 * reset-and-reveal rather than storing recoverable passwords (see CLAUDE.md
 * / test.md for why): admin can reset any user's password at any moment: a
 * fresh system-generated password is returned once, exactly like account
 * creation — nothing plaintext is ever stored at rest. Existing sessions are
 * revoked, same as a self-service password change, so the old password
 * can't keep working anywhere after this.
 */
export async function resetUserPassword(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new ApiError(404, "USER_NOT_FOUND", "User not found");

  const plaintextPassword = generatePassword();
  const passwordHash = await bcrypt.hash(plaintextPassword, BCRYPT_ROUNDS);

  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
    prisma.refreshToken.updateMany({ where: { userId, revoked: false }, data: { revoked: true } }),
  ]);

  return { generatedPassword: plaintextPassword };
}

/**
 * Sets/edits a sub-admin's permission overlay (newTask.md, 8 Sep). `patch`
 * only carries the keys the caller actually sent (schemas.js's
 * updatePermissionsSchema makes every key optional) — merged onto the
 * target's *existing* overlay rather than replacing it outright, so toggling
 * one key off in the UI can't silently reset every other key back to
 * true/undefined. Only ever meaningful on an ADMIN account; every other
 * role's access comes from requireRole() alone (see lib/permissions.js).
 * Every call is written to PermissionAuditLog — the "who changed whose
 * access and when" trail newTask.md's suggested improvements asked for.
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
  if (target.role !== "ADMIN") {
    throw new ApiError(400, "NOT_AN_ADMIN_ACCOUNT", "Permissions can only be set on an Admin account — change its role first");
  }
  const actor = await prisma.user.findUnique({ where: { id: actorId } });
  if (!actor) throw new ApiError(401, "UNAUTHENTICATED", "Acting user no longer exists");

  const before = target.permissions && typeof target.permissions === "object" ? target.permissions : null;
  const clampedPatch = clampPatchToActor(actor, sanitizePermissionsInput(patch));
  const merged = { ...(before ?? {}), ...clampedPatch };

  const [updated] = await prisma.$transaction([
    prisma.user.update({ where: { id: targetId }, data: { permissions: merged } }),
    prisma.permissionAuditLog.create({ data: { targetId, actorId, before, after: merged } }),
  ]);

  return { ...updated, permissions: getEffectivePermissions(updated) };
}
