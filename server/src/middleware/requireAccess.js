import { prisma } from "../lib/prisma.js";
import { hasPermission } from "../lib/permissions.js";

/**
 * Section guard for the six admin-page clusters lib/permissions.js defines
 * (users.manage, campaigns.manage, inventory.manage, links.review,
 * finance.manage, plans.manage) — 15 Sep, "admin can give any user access
 * permissions", generalizing the sub-admin overlay so it can *grant* one of
 * these sections to any role, not just withhold it from an ADMIN.
 *
 * `bareRoles` are the route's own normal, unconditional users — an ADMIN's
 * own role check plus whichever other role(s) already used this section as
 * self-service before this phase (e.g. CREATOR posting their own asset).
 * Those roles pass straight through, completely unaffected by the overlay,
 * exactly as requireRole(...) + requirePermission(key) behaved before this
 * middleware existed. Every other role — including ADMIN itself, so a
 * restricted sub-admin still gets blocked — is let through only if their
 * own effective permissions (role baseline merged with their overlay) grant
 * `key`. A brand-new role's baseline for all six keys is false, so nothing
 * is opened up by default; only an explicit grant on that account changes
 * that.
 *
 * Reads `permissions` fresh from the DB rather than trusting anything
 * cached on `req.user` from the access token, so access is revoked (or
 * granted) the moment an admin edits it — not up to 15 minutes later when
 * their token would otherwise expire.
 */
export function requireAccess(key, ...bareRoles) {
  return async (req, res, next) => {
    try {
      if (bareRoles.includes(req.user.role)) return next();

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
