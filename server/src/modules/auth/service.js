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
import { isOtpBypassEmail } from "../../lib/auth/otpBypass.js";
import { ApiError } from "../../middleware/errorHandler.js";
import { getEffectivePermissions, getOwnCapabilities, sanitizePermissionsInput, computeNewAccountOverlay, isFullAdmin, isOwnScopeRole, ownOverlayFor } from "../../lib/permissions.js";

const BCRYPT_ROUNDS = 12;
// A valid bcrypt hash of a random string nobody knows — compared against
// when a login's email has no account, so both paths cost the same.
const DUMMY_PASSWORD_HASH = "$2a$12$Tw8/cvMQ0UV4BMJXRV3Or.Z.StoaN8RRQOzlCmlRMlVKsz2ZrIqf.";

/**
 * The caller supplies an email (required — it's the account's login, 24 Sep)
 * and optionally a phone number. The system generates the password itself
 * and returns it once in the response for the caller to relay to the new
 * user. The email isn't verified yet: the first login's emailed code does
 * that (see verifyLoginOtp).
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
export async function signup({ email, phoneNumber, name, role, permissions }, actor) {
  const normalizedEmail = normalizeEmail(email);
  if (await prisma.user.findUnique({ where: { email: normalizedEmail } })) {
    throw new ApiError(409, "EMAIL_ALREADY_REGISTERED", "An account with this email already exists");
  }
  if (phoneNumber && (await prisma.user.findUnique({ where: { phoneNumber } }))) {
    throw new ApiError(409, "PHONE_ALREADY_REGISTERED", "This phone number is already registered");
  }

  const plaintextPassword = generatePassword();
  const passwordHash = await bcrypt.hash(plaintextPassword, BCRYPT_ROUNDS);

  const requested = sanitizePermissionsInput(permissions) ?? {};
  // Defense in depth for the route's own check (routes.js requireSignupAccess):
  // even if that check is ever loosened by mistake, a plan maker can never
  // create anything but a plain creator account with no permissions overlay.
  // An ADMIN target is left to the existing isFullAdmin check just below —
  // it already 403s a PLAN_MAKER with the more specific ADMIN_ACCOUNT_RESTRICTED,
  // and short-circuiting it here would skip the actor lookup that path expects.
  if (actor?.role === "PLAN_MAKER" && role !== "ADMIN" && (role !== "CREATOR" || Object.keys(requested).length > 0)) {
    throw new ApiError(403, "FORBIDDEN", "A plan maker can only create a plain creator account, with no extra permissions.");
  }
  // CREATOR / TEAM_MEMBER / PLAN_MAKER (24 Sep): their overlay is own-content
  // switches only — any global key is a 400 (lib/permissions.js ownOverlayFor).
  const ownScope = isOwnScopeRole(role);
  const ownOverlay = ownScope ? ownOverlayFor(role, requested) : null;
  const defaultGrant = role === "ADMIN";
  // For ADMIN, always compute — even an empty request must still clamp a
  // restricted actor's own missing keys (the escalation computeNewAccountOverlay
  // guards against). For any other role, skip the extra actor lookup entirely
  // when nothing was actually requested — an ordinary signup stays a single query.
  let overlay = ownOverlay;
  if (!ownScope && (defaultGrant || Object.keys(requested).length > 0)) {
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

  const user = await prisma.user
    .create({
    data: {
      email: normalizedEmail,
      phoneNumber: phoneNumber || null,
      name,
      role,
      passwordHash,
      permissions: hasOverlay ? overlay : undefined,
      createdByAdminId: actor?.id,
    },
  })
    .catch((err) => {
      // Two admins creating the same email/phone at once: both passed the
      // checks above, the second insert trips the unique index.
      if (err?.code === "P2002") {
        const field = String(err.meta?.target ?? "");
        throw field.includes("phone")
          ? new ApiError(409, "PHONE_ALREADY_REGISTERED", "This phone number is already registered")
          : new ApiError(409, "EMAIL_ALREADY_REGISTERED", "An account with this email already exists");
      }
      throw err;
    });

  if (hasOverlay) {
    await prisma.permissionAuditLog.create({
      data: { targetId: user.id, actorId: actor.id, action: "permissions", before: null, after: overlay },
    });
  }

  return {
    user: { ...toPublicUser(user), permissions: getEffectivePermissions(user), ownAccess: getOwnCapabilities(user) },
    generatedPassword: plaintextPassword, // shown once — never persisted in plaintext, never logged
  };
}

/**
 * Email + password, then an emailed code (24 Sep — "on login only email
 * verification will be required"). Password is only ever step one; what
 * comes back is a `step`, and only "AUTHENTICATED" carries a session:
 *
 * - The account's email (set by the admin at creation) is the only login
 *   identifier — phone-number login and the old "2 logins, then add an
 *   email" grace period are gone.
 * - A code is emailed and the client gets "OTP_REQUIRED" + a challenge token
 *   to redeem at verifyLoginOtp. Redeeming it also marks the email verified
 *   the first time, since the code proves the inbox is theirs.
 * - A browser that passed a code within the last 7 days (trustedDeviceToken,
 *   the httpOnly cookie routes.js reads — user decision, 23 Sep) skips the
 *   code. Only for an already-verified email, and only after the password
 *   check, so a stolen/replayed cookie alone still isn't enough.
 *
 * Every identifier/password mismatch is the same INVALID_CREDENTIALS, so
 * this can't be used to probe which emails exist.
 */
export async function login({ email, password, trustedDeviceToken }) {
  const invalid = () => new ApiError(401, "INVALID_CREDENTIALS", "Invalid credentials");

  const user = await prisma.user.findUnique({ where: { email: normalizeEmail(email) } });
  // Same bcrypt cost whether or not the email exists, so response time
  // doesn't reveal which emails have accounts.
  const valid = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
  if (!user?.email || !valid) throw invalid();

  // Test accounts only (OTP_BYPASS_EMAILS, unset by default — see
  // lib/auth/otpBypass.js). After the password check, so this never turns a
  // wrong password into a session; logged because skipping a second factor is
  // worth seeing in the server log rather than happening quietly.
  if (isOtpBypassEmail(user.email)) {
    console.warn(`[auth] OTP bypass used for ${user.email} (OTP_BYPASS_EMAILS)`);
    return { step: "AUTHENTICATED", ...(await issueTokenPair(user)) };
  }

  if (user.emailVerifiedAt && (await verifyTrustedDevice(user.id, trustedDeviceToken))) {
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

export async function verifyLoginOtp({ challengeToken, code, remember = true }) {
  let user = await userFromChallenge(challengeToken, "login-otp");
  const otp = await consumeOtp({ userId: user.id, purpose: "LOGIN", code });
  // The code reached their inbox — that's the email verified (first login
  // of an admin-created account). Only if it's still the address the code
  // was sent to: an email changed in between proves nothing about the new one.
  if (!user.emailVerifiedAt && otp?.email && otp.email === user.email) {
    user = await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
  }
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
  if (!user.email) throw new ApiError(401, "INVALID_CHALLENGE", "This sign-in attempt has expired — start again");
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
  // Any holder blocks the claim (24 Sep): since email became the login, an
  // unverified address is an admin-created account's only way in — taking it
  // over would lock that account out.
  if (holder && holder.id !== user.id) {
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
      // Never clear another account's address (24 Sep) — it may be an
      // admin-created account's only login.
      if (holder && holder.id !== user.id) throw new ApiError(409, "EMAIL_ALREADY_REGISTERED", "This email is already in use");
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

  return { user: { ...toPublicUser(user), permissions: getEffectivePermissions(user), ownAccess: getOwnCapabilities(user) }, accessToken, refreshToken: refreshTokenValue };
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
