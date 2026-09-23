// "Skip OTP for 7 days" (user decision, 23 Sep) — one TrustedDevice row per
// browser that has completed a real email-OTP verification. The raw token
// lives only in an httpOnly cookie (routes.js sets/reads it); only its hash
// is ever persisted, same discipline as jwt.js's refresh tokens and
// emailOtp.js's codes. Password is still checked first in every branch of
// auth/service.js's login() — this only ever shortens the *second* factor
// for a browser that already proved it once, never replaces the first.
import crypto from "node:crypto";
import { prisma } from "../prisma.js";
import { hashToken } from "./jwt.js";

export const TRUSTED_DEVICE_COOKIE = "taggify_trusted_device";
export const TRUSTED_DEVICE_DAYS = 7;

/** Issues a new trusted-device token for this user and stores its hash. Returns the raw token — the only time it ever exists outside the cookie. */
export async function issueTrustedDevice(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  await prisma.trustedDevice.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + TRUSTED_DEVICE_DAYS * 24 * 60 * 60 * 1000),
    },
  });
  return token;
}

/** True only for an unexpired, unrevoked token that was issued to this exact user. Never throws — a missing/garbled cookie is just "not trusted", not an error. */
export async function verifyTrustedDevice(userId, rawToken) {
  if (!rawToken) return false;
  const row = await prisma.trustedDevice.findUnique({ where: { tokenHash: hashToken(rawToken) } });
  if (!row || row.userId !== userId || row.revokedAt || row.expiresAt < new Date()) return false;
  return true;
}

/** Ends every device's OTP-skip for this user (password change) — same trust boundary as revoking refresh tokens. */
export async function revokeTrustedDevices(userId) {
  await prisma.trustedDevice.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
}
