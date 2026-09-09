import { prisma } from "../lib/prisma.js";
import { hasPermission } from "../lib/permissions.js";

/**
 * Permission-overlay guard — sits alongside requireRole() on a route, not
 * instead of it. Some of the routes this is chained onto also allow a
 * non-ADMIN role (e.g. POST /assets allows CREATOR too); the overlay only
 * ever exists on ADMIN accounts (see lib/permissions.js), so this is a
 * no-op for any other role — their access stays exactly what requireRole()
 * already decided, unaffected by this phase.
 *
 * Reads `permissions` fresh from the DB rather than trusting anything
 * cached on `req.user` from the access token, so a sub-admin's access is
 * revoked the moment an admin edits it — not up to 15 minutes later when
 * their token would otherwise expire.
 */
export function requirePermission(key) {
  return async (req, res, next) => {
    try {
      if (req.user.role !== "ADMIN") return next();

      const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { role: true, permissions: true } });
      if (!user) {
        return res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "User no longer exists" } });
      }
      if (!hasPermission(user, key)) {
        return res.status(403).json({ error: { code: "FORBIDDEN", message: "Your access has been restricted for this section" } });
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
