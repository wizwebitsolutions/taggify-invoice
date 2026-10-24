import { AsyncLocalStorage } from "node:async_hooks";
import { prisma } from "./prisma.js";

/**
 * One user-row read per request (22 Oct — "on clicking anything it delays").
 *
 * requireAuth (deactivatedAt), requireAccess / requireOwnAccess (role +
 * permissions overlay) and the services' loadEffectivePermissions /
 * loadOwnCapabilities each read the caller's User row "fresh from the DB" so
 * an admin's permission edit applies at once. They were each doing their own
 * findUnique, so every API call paid for three or four identical round trips
 * before any real work — ~50 ms each against the hosted Postgres.
 *
 * This keeps that freshness guarantee at request granularity: requireAuth
 * opens an AsyncLocalStorage scope, and every read of the same user inside
 * that scope shares one query. The next request reads again. Outside a
 * scope (cron jobs, unit tests calling a service directly) it just queries.
 */
const scope = new AsyncLocalStorage();

export const USER_ACCESS_SELECT = { role: true, permissions: true, deactivatedAt: true };

/** Runs `fn` with a fresh per-request cache; what it returns is returned. */
export function withRequestUserCache(fn) {
  return scope.run(new Map(), fn);
}

/** The caller's `{ role, permissions, deactivatedAt }`, or null when the row is gone — memoised for the current request. */
export function loadUserAccess(userId) {
  if (!userId) return Promise.resolve(null);
  const cache = scope.getStore();
  if (!cache) return prisma.user.findUnique({ where: { id: userId }, select: USER_ACCESS_SELECT });
  let pending = cache.get(userId);
  if (!pending) {
    pending = prisma.user.findUnique({ where: { id: userId }, select: USER_ACCESS_SELECT });
    cache.set(userId, pending);
  }
  return pending;
}
