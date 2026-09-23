import bcrypt from "bcryptjs";
import { prisma } from "../../lib/prisma.js";
import { generatePassword } from "../../lib/auth/passwordGenerator.js";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  hashToken,
  refreshExpiryDate,
  signChallengeToken,
  verifyChallengeToken,
} from "../../lib/auth/jwt.js";
import { issueOtp, consumeOtp } from "../../lib/auth/emailOtp.js";
import { issueTrustedDevice, verifyTrustedDevice, revokeTrustedDevices } from "../../lib/auth/trustedDevice.js";
import { ApiError } from "../../middleware/errorHandler.js";
import { getEffectivePermissions, sanitizePermissionsInput, computeNewAccountOverlay, assertGrantableRole, isFullAdmin } from "../../lib/permissions.js";

const BCRYPT_ROUNDS = 12;
// Phone+password logins an account gets before verifying an email becomes
// the only way forward (email 2FA, 21 Sep).
export const MAX_UNVERIFIED_LOGINS = 2;

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
  // CREATOR / TEAM_MEMBER can't carry an overlay at all (23 Sep) — see
  // lib/permissions.js's NON_GRANTABLE_ROLES for why.
  assertGrantableRole(role, requested);
  const defaultGrant = role === "ADMIN";
  // For ADMIN, always compute — even an empty request must still clamp a
  // restricted actor's own missing keys (the escalation computeNewAccountOverlay
  // guards against). For any other role, skip the extra actor lookup entirely
  // when nothing was actually requested — an ordinary signup stays a single query.
  let overlay = null;
  if (defaultGrant || Object.keys(requested).length > 0) {
    const actorRecord = actor?.id ? await prisma.user.findUnique({ where: { id: actor.id } }) : null;
    if (!actorRecord) throw new ApiError(401, "UNAUTHENTICATED", "Acting user no longer exists");
    // Creating an ADMIN-role account needs a full admin (23 Sep) — the
    // overlay clamp below can't neutralise the role's *bare* privileges
    // (every plans/service.js "role === ADMIN" branch, job-runs, invoice
    // numbering, …), so a users.manage holder could otherwise mint an admin,
    // read its password off this response and sign in as it. Same rule as
    // admin/service.js's updateUserRole for promotion.
    if (defaultGrant && !isFullAdmin(actorRecord)) {
      throw new ApiError(403, "ADMIN_ACCOUNT_RESTRICTED", "Only a full admin can create an admin account.");
    }
    const computed = computeNewAccountOverlay(actorRecord, requested, role);
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
      data: { targetId: user.id, actorId: actor.id, action: "permissions", before: null, after: overlay },
    });
  }

  return {
    user: { ...toPublicUser(user), permissions: getEffectivePermissions(user) },
    generatedPassword: plaintextPassword, // shown once — never persisted in plaintext, never logged
  };
}

/**
 * Email 2FA (21 Sep). Password is only ever step one; what comes back is a
 * `step`, and only "AUTHENTICATED" carries a session:
 *
 * - Verified account → must sign in with its *email* (the phone number
 *   stops working as an identifier once an email is verified). A code is
 *   emailed and the client gets "OTP_REQUIRED" + a challenge token to
 *   redeem at verifyLoginOtp — unless `trustedDeviceToken` (the browser's
 *   httpOnly cookie, read by routes.js) proves this same browser already
 *   passed an OTP within the last 7 days (user decision, 23 Sep — "skip
 *   OTP for 7 days"), in which case this goes straight to AUTHENTICATED,
 *   no email sent. Either way the password check above already ran, so a
 *   stolen/replayed cookie alone still isn't enough to sign in.
 * - Unverified account → still signs in by phone number. The first
 *   MAX_UNVERIFIED_LOGINS times that's a normal session (the client nags
 *   from `user.emailVerified` / `unverifiedLoginsLeft`); after that it's
 *   "EMAIL_VERIFICATION_REQUIRED" + a challenge token that only the
 *   email-setup endpoints accept — no session until an email is verified.
 *
 * Every identifier/password/state mismatch is the same INVALID_CREDENTIALS
 * until the password itself has checked out, so this can't be used to probe
 * which numbers/emails exist or which are verified.
 */
export async function login({ phoneNumber, email, password, trustedDeviceToken }) {
  const invalid = () => new ApiError(401, "INVALID_CREDENTIALS", "Invalid credentials");

  const user = email
    ? await prisma.user.findUnique({ where: { email: normalizeEmail(email) } })
    : await prisma.user.findUnique({ where: { phoneNumber } });
  if (!user) throw invalid();
  // An unverified profile email isn't a login identifier.
  if (email && !user.emailVerifiedAt) throw invalid();

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) throw invalid();

  if (user.emailVerifiedAt) {
    if (!email) {
      throw new ApiError(401, "USE_EMAIL_LOGIN", "This account signs in with its Gmail address, not the phone number");
    }
    if (await verifyTrustedDevice(user.id, trustedDeviceToken)) {
      return { step: "AUTHENTICATED", ...(await issueTokenPair(user)) };
    }
    try {
      await issueOtp({ userId: user.id, purpose: "LOGIN", email: user.email });
    } catch (err) {
      // Signing in again inside the resend cooldown (a reload or Back lost
      // the challenge token, which only lives in the login page's state):
      // a live code is already in their inbox, so hand out a new challenge
      // for it rather than a 429 that strands them for a minute.
      if (err?.code !== "OTP_RESEND_TOO_SOON") throw err;
    }
    return { step: "OTP_REQUIRED", challengeToken: signChallengeToken(user, "login-otp"), emailHint: maskEmail(user.email) };
  }

  // Conditional increment, so parallel logins can't each read "1 used" and
  // all squeeze through — whichever loses the race gets the lock-out path.
  const { count } = await prisma.user.updateMany({
    where: { id: user.id, emailVerifiedAt: null, unverifiedLoginCount: { lt: MAX_UNVERIFIED_LOGINS } },
    data: { unverifiedLoginCount: { increment: 1 } },
  });
  if (count === 0) {
    return { step: "EMAIL_VERIFICATION_REQUIRED", challengeToken: signChallengeToken(user, "email-setup") };
  }

  const updated = { ...user, unverifiedLoginCount: user.unverifiedLoginCount + 1 };
  return {
    step: "AUTHENTICATED",
    ...(await issueTokenPair(updated)),
    unverifiedLoginsLeft: Math.max(0, MAX_UNVERIFIED_LOGINS - updated.unverifiedLoginCount),
  };
}

export async function verifyLoginOtp({ challengeToken, code, remember = true }) {
  const user = await userFromChallenge(challengeToken, "login-otp");
  await consumeOtp({ userId: user.id, purpose: "LOGIN", code });
  // This browser just proved it — routes.js turns trustedDeviceToken into
  // an httpOnly cookie and strips it from the JSON body before responding;
  // it never reaches client JS. `remember` is the login page's "Remember
  // this device for 7 days" checkbox (23 Sep, checked by default) —
  // unchecked, this still signs in, just without minting a trust cookie,
  // so the next login on this browser asks for OTP again.
  return {
    step: "AUTHENTICATED",
    ...(await issueTokenPair(user)),
    trustedDeviceToken: remember ? await issueTrustedDevice(user.id) : undefined,
  };
}

export async function resendLoginOtp({ challengeToken }) {
  const user = await userFromChallenge(challengeToken, "login-otp");
  if (!user.emailVerifiedAt) throw new ApiError(401, "INVALID_CHALLENGE", "This sign-in attempt has expired — start again");
  await issueOtp({ userId: user.id, purpose: "LOGIN", email: user.email });
}

/**
 * Email setup — reachable two ways: with a session (a grace-period login
 * verifying from inside the app; `userId` from the route) or with the
 * "email-setup" challenge token a locked-out login was handed. Routes
 * resolve which; a challengeToken wins if both arrive.
 */
export async function startEmailVerification({ userId, challengeToken, email }) {
  const user = await resolveSetupUser({ userId, challengeToken });
  if (user.emailVerifiedAt) throw new ApiError(409, "EMAIL_ALREADY_VERIFIED", "This account already has a verified email");

  const normalized = normalizeEmail(email);
  const holder = await prisma.user.findUnique({ where: { email: normalized } });
  // Only a *verified* holder blocks the claim — an unverified profile email
  // on someone else's account proves nothing about who owns the inbox.
  if (holder && holder.id !== user.id && holder.emailVerifiedAt) {
    throw new ApiError(409, "EMAIL_ALREADY_REGISTERED", "This email is already in use");
  }
  await issueOtp({ userId: user.id, purpose: "VERIFY_EMAIL", email: normalized });
  return { emailHint: maskEmail(normalized) };
}

/**
 * Confirms the code and makes that email the account's login identifier.
 * Always answers with a fresh session: for the locked-out path that *is*
 * the login; for the in-app path it swaps in a `user` with
 * emailVerified: true so the client's prompt goes away without a refetch.
 */
export async function confirmEmailVerification({ userId, challengeToken, code }) {
  const user = await resolveSetupUser({ userId, challengeToken });
  if (user.emailVerifiedAt) throw new ApiError(409, "EMAIL_ALREADY_VERIFIED", "This account already has a verified email");

  const otp = await consumeOtp({ userId: user.id, purpose: "VERIFY_EMAIL", code });

  let updated;
  try {
    updated = await prisma.$transaction(async (tx) => {
      const holder = await tx.user.findUnique({ where: { email: otp.email } });
      if (holder && holder.id !== user.id) {
        if (holder.emailVerifiedAt) throw new ApiError(409, "EMAIL_ALREADY_REGISTERED", "This email is already in use");
        await tx.user.update({ where: { id: holder.id }, data: { email: null } });
      }
      // Every session from before 2FA was enrolled ends here — otherwise
      // someone already signed in with just the password keeps a
      // refreshable session that never sees an OTP.
      await tx.refreshToken.updateMany({ where: { userId: user.id, revoked: false }, data: { revoked: true } });
      return tx.user.update({ where: { id: user.id }, data: { email: otp.email, emailVerifiedAt: new Date() } });
    });
  } catch (err) {
    // Two accounts confirming the same address at once: both saw no holder,
    // the second write trips User.email's unique constraint.
    if (err?.code === "P2002") throw new ApiError(409, "EMAIL_ALREADY_REGISTERED", "This email is already in use");
    throw err;
  }

  return { step: "AUTHENTICATED", ...(await issueTokenPair(updated)) };
}

async function resolveSetupUser({ userId, challengeToken }) {
  if (challengeToken) return userFromChallenge(challengeToken, "email-setup");
  const user = userId ? await prisma.user.findUnique({ where: { id: userId } }) : null;
  if (!user) throw new ApiError(401, "UNAUTHENTICATED", "Sign in again");
  return user;
}

async function userFromChallenge(challengeToken, purpose) {
  let payload;
  try {
    payload = verifyChallengeToken(challengeToken, purpose);
  } catch {
    throw new ApiError(401, "INVALID_CHALLENGE", "This sign-in attempt has expired — start again");
  }
  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user) throw new ApiError(401, "INVALID_CHALLENGE", "This sign-in attempt has expired — start again");
  return user;
}

function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

// "de***@gmail.com" — enough to recognise your own inbox, not enough to read off someone else's.
function maskEmail(email) {
  const [local, domain] = email.split("@");
  return `${local.slice(0, 2)}***@${domain}`;
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
  // A password change should force a fresh OTP everywhere too, not just
  // sign the other devices out of their sessions (user decision, 23 Sep).
  await revokeTrustedDevices(userId);
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
    email: user.email ?? null,
    emailVerified: Boolean(user.emailVerifiedAt),
  };
}
