import bcrypt from "bcryptjs";
import { prisma } from "../../lib/prisma.js";
import { generatePassword } from "../../lib/auth/passwordGenerator.js";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  hashToken,
  refreshExpiryDate,
} from "../../lib/auth/jwt.js";
import { ApiError } from "../../middleware/errorHandler.js";
import { getEffectivePermissions, sanitizePermissionsInput, computeNewAdminOverlay } from "../../lib/permissions.js";

const BCRYPT_ROUNDS = 12;

/**
 * No OTP: the caller only ever supplies a phone number. The system
 * generates the password itself and returns it once in the response for
 * the caller to relay to the new user (WhatsApp/SMS delivery channel is a
 * later integration, not required for this to function).
 *
 * `actor` is the admin performing the creation. `permissions` (only ever
 * meaningful when role is ADMIN — silently ignored otherwise, since no
 * other role's access comes from an overlay) makes this doubly the
 * sub-admin creation flow newTask.md asked for: an ADMIN account created
 * with a restricted overlay *is* a sub-admin, tagged with who created it
 * and logged to PermissionAuditLog for the same "who changed whose access"
 * trail an edit gets (see admin/service.js's updateUserPermissions).
 *
 * Whatever `permissions` asks for is run through computeNewAdminOverlay
 * against the *actor's own* effective permissions before it's stored —
 * otherwise a restricted sub-admin with users.manage could create a
 * brand-new, unrestricted ADMIN account (simply not sending `permissions`
 * used to mean "full admin", regardless of the actor's own restrictions),
 * see its one-time generated password in this very response, and log in as
 * an account with none of their own restrictions. A no-op for an
 * unrestricted admin (every key already true), so this never limits what a
 * real admin can hand out.
 */
export async function signup({ phoneNumber, name, role, permissions }, actor) {
  const existing = await prisma.user.findUnique({ where: { phoneNumber } });
  if (existing) {
    throw new ApiError(409, "PHONE_ALREADY_REGISTERED", "This phone number is already registered");
  }

  const plaintextPassword = generatePassword();
  const passwordHash = await bcrypt.hash(plaintextPassword, BCRYPT_ROUNDS);

  let overlay = null;
  if (role === "ADMIN") {
    const requested = sanitizePermissionsInput(permissions) ?? {};
    const actorRecord = actor?.id ? await prisma.user.findUnique({ where: { id: actor.id } }) : null;
    if (!actorRecord) throw new ApiError(401, "UNAUTHENTICATED", "Acting user no longer exists");
    const computed = computeNewAdminOverlay(actorRecord, requested);
    overlay = Object.keys(computed).length > 0 ? computed : null;
  }
  const isSubAdmin = role === "ADMIN" && overlay != null;

  const user = await prisma.user.create({
    data: {
      phoneNumber,
      name,
      role,
      passwordHash,
      permissions: isSubAdmin ? overlay : undefined,
      createdByAdminId: actor?.id,
    },
  });

  if (isSubAdmin) {
    await prisma.permissionAuditLog.create({
      data: { targetId: user.id, actorId: actor.id, before: null, after: overlay },
    });
  }

  return {
    user: { ...toPublicUser(user), permissions: getEffectivePermissions(user) },
    generatedPassword: plaintextPassword, // shown once — never persisted in plaintext, never logged
  };
}

export async function login({ phoneNumber, password }) {
  const user = await prisma.user.findUnique({ where: { phoneNumber } });
  if (!user) {
    throw new ApiError(401, "INVALID_CREDENTIALS", "Invalid phone number or password");
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    throw new ApiError(401, "INVALID_CREDENTIALS", "Invalid phone number or password");
  }

  return issueTokenPair(user);
}

export async function refresh({ refreshToken }) {
  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw new ApiError(401, "INVALID_REFRESH_TOKEN", "Refresh token is invalid or expired");
  }

  const tokenHash = hashToken(refreshToken);
  const stored = await prisma.refreshToken.findFirst({
    where: { userId: payload.sub, tokenHash, revoked: false },
  });
  if (!stored || stored.expiresAt < new Date()) {
    throw new ApiError(401, "INVALID_REFRESH_TOKEN", "Refresh token is invalid or expired");
  }

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user) {
    throw new ApiError(401, "INVALID_REFRESH_TOKEN", "User no longer exists");
  }

  // rotate: revoke the used refresh token, issue a new pair
  await prisma.refreshToken.update({ where: { id: stored.id }, data: { revoked: true } });
  return issueTokenPair(user);
}

/**
 * Self-service password change (per-request context: creator.wldd.in has
 * this even though our default onboarding is admin-generated passwords —
 * see system design.md §2.4). Revokes all existing refresh tokens so other
 * sessions are signed out once the password changes.
 */
export async function changePassword(userId, { currentPassword, newPassword }) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new ApiError(404, "USER_NOT_FOUND", "User not found");

  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) {
    throw new ApiError(401, "INVALID_CREDENTIALS", "Current password is incorrect");
  }

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
    prisma.refreshToken.updateMany({ where: { userId, revoked: false }, data: { revoked: true } }),
  ]);
}

export async function logout({ refreshToken }) {
  const tokenHash = hashToken(refreshToken);
  await prisma.refreshToken.updateMany({
    where: { tokenHash, revoked: false },
    data: { revoked: true },
  });
}

async function issueTokenPair(user) {
  const accessToken = signAccessToken(user);
  const refreshTokenValue = signRefreshToken(user);

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(refreshTokenValue),
      expiresAt: refreshExpiryDate(),
    },
  });

  return { user: { ...toPublicUser(user), permissions: getEffectivePermissions(user) }, accessToken, refreshToken: refreshTokenValue };
}

function toPublicUser(user) {
  return {
    id: user.id,
    phoneNumber: user.phoneNumber,
    name: user.name,
    role: user.role,
    whatsappVerified: user.whatsappVerified,
  };
}
