import jwt from "jsonwebtoken";
import crypto from "node:crypto";

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;
const ACCESS_EXPIRES_IN = process.env.JWT_ACCESS_EXPIRES_IN || "15m";
const REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || "30d";

export function signAccessToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, ACCESS_SECRET, {
    expiresIn: ACCESS_EXPIRES_IN,
  });
}

export function verifyAccessToken(token) {
  const payload = jwt.verify(token, ACCESS_SECRET);
  if (payload.typ) throw new Error("not an access token");
  return payload;
}

// Refresh tokens are opaque-ish JWTs too, but we also persist a hash of them
// in RefreshToken so they can be revoked/rotated without Redis.
export function signRefreshToken(user) {
  return jwt.sign({ sub: user.id }, REFRESH_SECRET, {
    expiresIn: REFRESH_EXPIRES_IN,
  });
}

export function verifyRefreshToken(token) {
  return jwt.verify(token, REFRESH_SECRET);
}

// Short-lived proof that the password step passed (email 2FA, 21 Sep) —
// handed to the client between login and the OTP step. `purpose` is
// "login-otp" or "email-setup", checked on verify so one can't be replayed
// as the other. Shares ACCESS_SECRET, so verifyAccessToken above explicitly
// rejects anything carrying `typ` — a challenge token must never pass
// requireAuth as a session.
export function signChallengeToken(user, purpose) {
  return jwt.sign({ sub: user.id, typ: "challenge", purpose }, ACCESS_SECRET, { expiresIn: "15m" });
}

export function verifyChallengeToken(token, purpose) {
  const payload = jwt.verify(token, ACCESS_SECRET);
  if (payload.typ !== "challenge" || payload.purpose !== purpose) throw new Error("wrong token type");
  return payload;
}

export function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function refreshExpiryDate() {
  const ms = parseDurationToMs(REFRESH_EXPIRES_IN);
  return new Date(Date.now() + ms);
}

function parseDurationToMs(duration) {
  const match = /^(\d+)([smhd])$/.exec(duration);
  if (!match) return 30 * 24 * 60 * 60 * 1000; // fallback: 30 days
  const value = Number(match[1]);
  const unit = match[2];
  const unitMs = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return value * unitMs[unit];
}
