/**
 * Dummy/test accounts that skip the emailed login code (user request, 28 Sep —
 * test planner/creator accounts whose addresses are fake, so no code could ever
 * reach them).
 *
 * Deliberately env-driven rather than a column on User: an empty/unset
 * OTP_BYPASS_EMAILS means nobody bypasses, so an environment that doesn't opt
 * in is exactly as strict as before, and revoking the bypass is deleting one
 * env var — not a data migration, and not something a DB write can grant.
 *
 * It only skips the *second* factor: login still requires the right password
 * (see auth/service.js's login, which checks bcrypt before consulting this),
 * and only an exact, case-insensitive email match bypasses.
 */
export function otpBypassEmails() {
  return (process.env.OTP_BYPASS_EMAILS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

export function isOtpBypassEmail(email) {
  if (!email) return false;
  return otpBypassEmails().includes(email.trim().toLowerCase());
}
