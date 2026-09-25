import { prisma } from "../lib/prisma.js";
import { hasOwnCapability, isOwnScopeRole } from "../lib/permissions.js";

/**
 * Own-content switch guard (24 Sep) for self-service routes a staff role can
 * also reach (lists, detail pages) — CREATOR / TEAM_MEMBER / PLAN_MAKER pass
 * only if the admin hasn't turned `key` off for them; staff roles pass
 * straight through to whatever gate/scoping the route already has. Reads
 * fresh from the DB so a change applies at once, like requireAccess.
 */
export function requireOwnAccess(key) {
  return async (req, res, next) => {
    try {
      if (!isOwnScopeRole(req.user?.role)) return next();
      const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { role: true, permissions: true } });
      if (!user) return res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "User no longer exists" } });
      if (!hasOwnCapability(user, key)) {
        return res.status(403).json({ error: { code: "ACCESS_REMOVED", message: "Your admin has turned this off for your account" } });
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
