// Emailed one-time codes (email 2FA, 21 Sep): 6 digits, 10-minute expiry,
// 5 wrong attempts burns the code, 60s between sends. Only one live code
// per user+purpose — issuing a new one invalidates the previous.
import crypto from "node:crypto";
import { prisma } from "../prisma.js";
import { ApiError } from "../../middleware/errorHandler.js";
import { sendOtpEmail } from "../mailer.js";
import { hashToken } from "./jwt.js";

export const OTP_TTL_MINUTES = 10;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_SECONDS = 60;

// Salted with the row's own user id so equal codes don't share a hash.
function hashCode(userId, code) {
  return hashToken(`${userId}:${code}`);
}

export async function issueOtp({ userId, purpose, email }) {
  const latest = await prisma.emailOtp.findFirst({ where: { userId, purpose }, orderBy: { createdAt: "desc" } });
  // The cooldown is about not re-mailing the same inbox — a corrected typo
  // ("Use a different email") is a different inbox and shouldn't wait on it.
  if (latest && latest.email === email) {
    const waitMs = latest.createdAt.getTime() + OTP_RESEND_COOLDOWN_SECONDS * 1000 - Date.now();
    if (waitMs > 0) {
      throw new ApiError(429, "OTP_RESEND_TOO_SOON", `Wait ${Math.ceil(waitMs / 1000)}s before requesting another code`);
    }
  }

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  await prisma.emailOtp.deleteMany({ where: { userId, purpose } });
  const otp = await prisma.emailOtp.create({
    data: {
      userId,
      purpose,
      email,
      codeHash: hashCode(userId, code),
      expiresAt: new Date(Date.now() + OTP_TTL_MINUTES * 60_000),
    },
  });
  try {
    await sendOtpEmail({ to: email, code, purpose, expiresInMinutes: OTP_TTL_MINUTES });
  } catch (err) {
    // A code nobody received mustn't start the cooldown — the error tells
    // the user to try again, and that retry has to be allowed to send.
    await prisma.emailOtp.delete({ where: { id: otp.id } }).catch(() => {});
    throw err;
  }
}

/** Returns the consumed OTP row (its `email` is what was proven). Throws on anything else. */
export async function consumeOtp({ userId, purpose, code }) {
  const otp = await prisma.emailOtp.findFirst({
    where: { userId, purpose, consumedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!otp || otp.expiresAt < new Date() || otp.attempts >= OTP_MAX_ATTEMPTS) {
    throw new ApiError(400, "OTP_EXPIRED", "This code has expired — request a new one");
  }

  const expected = Buffer.from(otp.codeHash, "hex");
  const given = Buffer.from(hashCode(userId, code), "hex");
  if (!crypto.timingSafeEqual(expected, given)) {
    // Atomic increment — parallel guesses can't each read the same count.
    const updated = await prisma.emailOtp.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
    const left = OTP_MAX_ATTEMPTS - updated.attempts;
    throw new ApiError(
      400,
      left > 0 ? "OTP_INVALID" : "OTP_EXPIRED",
      left > 0 ? `Incorrect code — ${left} attempt${left === 1 ? "" : "s"} left` : "Too many incorrect attempts — request a new code"
    );
  }

  // updateMany + count guards a double-submit of the right code racing itself.
  const { count } = await prisma.emailOtp.updateMany({ where: { id: otp.id, consumedAt: null }, data: { consumedAt: new Date() } });
  if (count !== 1) throw new ApiError(400, "OTP_EXPIRED", "This code has expired — request a new one");
  return otp;
}
