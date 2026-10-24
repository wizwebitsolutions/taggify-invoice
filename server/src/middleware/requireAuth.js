import { verifyAccessToken } from "../lib/auth/jwt.js";
import { loadUserAccess, withRequestUserCache } from "../lib/requestUser.js";

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Missing bearer token" } });
  }
  const token = header.slice("Bearer ".length);
  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    return res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Invalid or expired token" } });
  }
  // The rest of the request (access middleware, the service's own permission
  // reads) shares this one User-row read — see lib/requestUser.js.
  return withRequestUserCache(async () => {
    // A deactivated account (21 Oct) loses access on its next request, not when
    // its 15-minute token runs out. 401 so the client's refresh attempt runs and
    // fails too (refresh refuses deactivated accounts), which signs it out.
    try {
      const user = await loadUserAccess(payload.sub);
      if (user?.deactivatedAt) {
        return res.status(401).json({ error: { code: "ACCOUNT_DEACTIVATED", message: "This account has been deactivated. Contact your admin." } });
      }
    } catch (err) {
      return next(err);
    }
    req.user = { id: payload.sub, role: payload.role };
    next();
  });
}
