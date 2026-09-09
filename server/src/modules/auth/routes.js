import { Router } from "express";
import rateLimit from "express-rate-limit";
import { validateBody } from "../../middleware/validate.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireRole } from "../../middleware/requireRole.js";
import { requirePermission } from "../../middleware/requirePermission.js";
import { signupSchema, loginSchema, refreshSchema, changePasswordSchema } from "./schemas.js";
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

// Admin-only — "New creators are added by an admin, no self-signup" is the
// product's own login-page copy; this was previously reachable by anyone
// unauthenticated, which let a caller mint themselves an ADMIN account.
router.post(
  "/signup",
  requireAuth,
  requireRole("ADMIN"),
  requirePermission("users.manage"),
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

router.post("/login", loginLimiter, validateBody(loginSchema), async (req, res, next) => {
  try {
    const result = await authService.login(req.body);
    res.json(result);
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
