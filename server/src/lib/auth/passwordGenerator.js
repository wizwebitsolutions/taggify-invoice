import crypto from "node:crypto";

// Alphabet avoids visually-ambiguous characters (0/O, 1/l/I) since this
// password is read off a screen and typed back in by a human.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";

/**
 * Generates a cryptographically random password for auto-provisioned
 * accounts (no OTP flow — user only ever supplies phone number, the system
 * assigns the password). Never derived from user input, never logged.
 */
export function generatePassword(length = 10) {
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}
