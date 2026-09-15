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
import { getEffectivePermissions, sanitizePermissionsInput, computeNewAccountOverlay } from "../../lib/permissions.js";

const BCRYPT_ROUNDS = 12;

/**
 * No OTP: the caller only ever supplies a phone number. The system
 * generates the password itself and returns it once in the response for
 * the caller to relay to the new user (WhatsApp/SMS delivery channel is a
 * later integration, not required for this to function).
 *
 * `actor` is the admin performing the creation. `permissions` makes this
 * doubly the sub-admin/granted-access creation flow newTask.md (and its
 * 15 Sep follow-up, "admin can give any user access permissions") asked
 * for: an ADMIN account created with a restricted overlay *is* a sub-admin;
 * any other role created with a granted overlay gets that overlay's keys
 * on top of its normal role-gated access. Either way it's tagged with who
 * created it and logged to PermissionAuditLog for the same "who changed
 * whose access" trail an edit gets (see admin/service.js's
 * updateUserPermissions).
 *
 * Whatever `permissions` asks for is run through computeNewAccountOverlay
 * against the *actor's own* effective permissions before it's stored —
 * otherwise a restricted sub-admin with users.manage could create a
 * brand-new, unrestricted ADMIN account (simply not sending `permissions`
 * used to mean "full admin", regardless of the actor's own restrictions),
 * see its one-time generated password in this very response, and log in as
 * an account with none of their own restrictions. The new account's own
 * role baseline (ADMIN defaults every key true; every other role defaults
 * every key false) is passed through as `defaultGrant` — a no-op for an
 * unrestricted admin creating another admin (every key already true), and
 * for any role when `permissions` isn't sent at all (a brand-new
 * CREATOR/TEAM_MEMBER/FINANCE/PLAN_MAKER stays exactly as unprivileged as
 * before this phase existed), so this never limits what a real admin can
 * hand out and never grants more than what's explicitly requested.
 */
export async function signup({ phoneNumber, name, role, permissions }, actor) {
  const existing = await prisma.user.findUnique({ where: { phoneNumber } });
  if (existing) {
    throw new ApiError(409, "PHONE_ALREADY_REGISTERED", "This phone number is already registered");
  }

  const plaintextPassword = generatePassword();
  const passwordHash = await bcrypt.hash(plaintextPassword, BCRYPT_ROUNDS);

  const requested = sanitizePermissionsInput(permissions) ?? {};
  const defaultGrant = role === "ADMIN";
  // For ADMIN, always compute — even an empty request must still clamp a
  // restricted actor's own missing keys (the escalation computeNewAccountOverlay
  // guards against). For any other role, skip the extra actor lookup entirely
  // when nothing was actually requested — an ordinary signup stays a single query.
  let overlay = null;
  if (defaultGrant || Object.keys(requested).length > 0) {
    const actorRecord = actor?.id ? await prisma.user.findUnique({ where: { id: actor.id } }) : null;
    if (!actorRecord) throw new ApiError(401, "UNAUTHENTICATED", "Acting user no longer exists");
    const computed = computeNewAccountOverlay(actorRecord, requested, defaultGrant);
    overlay = Object.keys(computed).length > 0 ? computed : null;
  }
  const hasOverlay = overlay != null;

  const user = await prisma.user.create({
    data: {
      phoneNumber,
      name,
      role,
      passwordHash,
      permissions: hasOverlay ? overlay : undefined,
      createdByAdminId: actor?.id,
    },
  });

  if (hasOverlay) {
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
