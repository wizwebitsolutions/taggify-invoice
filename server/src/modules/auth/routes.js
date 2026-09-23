import { Router } from "express";
import rateLimit from "express-rate-limit";
import { validateBody } from "../../middleware/validate.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireAccess } from "../../middleware/requireAccess.js";
import {
  signupSchema,
  loginSchema,
  refreshSchema,
  changePasswordSchema,
  verifyLoginOtpSchema,
  resendLoginOtpSchema,
  startEmailVerificationSchema,
  confirmEmailVerificationSchema,
} from "./schemas.js";
import { verifyAccessToken } from "../../lib/auth/jwt.js";
import { TRUSTED_DEVICE_COOKIE, TRUSTED_DEVICE_DAYS } from "../../lib/auth/trustedDevice.js";
import * as authService from "./service.js";

const router = Router();

// Blunts brute-force against auto-generated passwords. In-memory store is
// fine at single-instance scale (no Redis dependency by design).
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

// OTP guessing/sending is already capped per code (lib/auth/emailOtp.js);
// this caps it per IP on top, and keeps the send endpoints from being used
// to spray mail.
const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

// Email setup accepts either a session or a locked-out login's challenge
// token (see auth/service.js's startEmailVerification). A body
// challengeToken wins; otherwise a valid bearer token is required.
function emailSetupIdentity(req, res, next) {
  if (req.body?.challengeToken) return next();
  const header = req.headers.authorization;
  try {
    if (!header?.startsWith("Bearer ")) throw new Error("missing");
    req.user = { id: verifyAccessToken(header.slice("Bearer ".length)).sub };
    next();
  } catch {
    res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Sign in again" } });
  }
}

// Admin-only by default — "New creators are added by an admin, no
// self-signup" is the product's own login-page copy; this was previously
// reachable by anyone unauthenticated, which let a caller mint themselves
// an ADMIN account. requireAccess("users.edit") also lets a non-admin
// role explicitly granted that section create accounts (15 Sep).
router.post(
  "/signup",
  requireAuth,
  requireAccess("users.edit"),
  validateBody(signupSchema),
  async (req, res, next) => {
    try {
      const result = await authService.signup(req.body, req.user);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }
);

// "Skip OTP for 7 days" (user decision, 23 Sep): a returning browser sends
// its trusted-device cookie here; service.js's login() only trusts it after
// the password itself checks out.
router.post("/login", loginLimiter, validateBody(loginSchema), async (req, res, next) => {
  try {
    const result = await authService.login({ ...req.body, trustedDeviceToken: req.cookies?.[TRUSTED_DEVICE_COOKIE] });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post("/login/verify-otp", otpLimiter, validateBody(verifyLoginOtpSchema), async (req, res, next) => {
  try {
    // The raw token lives only in this httpOnly cookie — stripped from the
    // JSON body below so it never reaches client JS (path scoped to /auth
    // so it's only ever sent back to these routes, not on every API call).
    // Absent when the "Remember this device" checkbox was unchecked
    // (req.body.remember: false) — nothing to set then.
    const { trustedDeviceToken, ...result } = await authService.verifyLoginOtp(req.body);
    if (trustedDeviceToken) {
      res.cookie(TRUSTED_DEVICE_COOKIE, trustedDeviceToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: TRUSTED_DEVICE_DAYS * 24 * 60 * 60 * 1000,
        path: "/api/auth",
      });
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post("/login/resend-otp", otpLimiter, validateBody(resendLoginOtpSchema), async (req, res, next) => {
  try {
    await authService.resendLoginOtp(req.body);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

router.post("/email/start", otpLimiter, validateBody(startEmailVerificationSchema), emailSetupIdentity, async (req, res, next) => {
  try {
    res.json(await authService.startEmailVerification({ ...req.body, userId: req.user?.id }));
  } catch (err) {
    next(err);
  }
});

router.post("/email/confirm", otpLimiter, validateBody(confirmEmailVerificationSchema), emailSetupIdentity, async (req, res, next) => {
  try {
    res.json(await authService.confirmEmailVerification({ ...req.body, userId: req.user?.id }));
  } catch (err) {
    next(err);
  }
});

router.post("/refresh", validateBody(refreshSchema), async (req, res, next) => {
  try {
    const result = await authService.refresh(req.body);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post("/change-password", requireAuth, validateBody(changePasswordSchema), async (req, res, next) => {
  try {
    await authService.changePassword(req.user.id, req.body);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

router.post("/logout", validateBody(refreshSchema), async (req, res, next) => {
  try {
    await authService.logout(req.body);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
