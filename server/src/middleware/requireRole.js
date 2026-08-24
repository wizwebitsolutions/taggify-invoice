/**
 * RBAC guard — must run after requireAuth. Usage: requireRole('ADMIN', 'FINANCE')
 */
export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Not authenticated" } });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: { code: "FORBIDDEN", message: "Insufficient role for this action" } });
    }
    next();
  };
}
