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

const BCRYPT_ROUNDS = 12;

/**
 * No OTP: the caller only ever supplies a phone number. The system
 * generates the password itself and returns it once in the response for
 * the caller to relay to the new user (WhatsApp/SMS delivery channel is a
 * later integration, not required for this to function).
 */
export async function signup({ phoneNumber, name, role }) {
  const existing = await prisma.user.findUnique({ where: { phoneNumber } });
  if (existing) {
    throw new ApiError(409, "PHONE_ALREADY_REGISTERED", "This phone number is already registered");
  }

  const plaintextPassword = generatePassword();
  const passwordHash = await bcrypt.hash(plaintextPassword, BCRYPT_ROUNDS);

  const user = await prisma.user.create({
    data: { phoneNumber, name, role, passwordHash },
  });

  return {
    user: toPublicUser(user),
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

  return { user: toPublicUser(user), accessToken, refreshToken: refreshTokenValue };
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
