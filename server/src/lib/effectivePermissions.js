import { prisma } from "./prisma.js";
import { getEffectivePermissions, getOwnCapabilities } from "./permissions.js";

/**
 * Fresh-from-DB effective permissions for a user id (23 Sep, Step 3 —
 * "permission-scoped reads"). Every read-scoping check in invoices/links/
 * campaigns/assets/billing used to test `["ADMIN","FINANCE",...].includes(
 * role)` — bare role, ignoring any overlay — so restricting or granting a
 * `*.view` key never actually changed what a list/detail endpoint returned,
 * only whether a write route accepted the request (a checkbox that looked
 * like it did something and didn't). Reads fresh, not from the JWT, for the
 * same reason requireAccess() does: an edit takes effect immediately, not
 * after the access token's next refresh.
 *
 * Kept out of lib/permissions.js on purpose — that module stays a pure,
 * DB-free set of functions so permissions.test.js can exercise it without
 * mocking Prisma.
 */
export async function loadEffectivePermissions(userId) {
  const user = userId ? await prisma.user.findUnique({ where: { id: userId }, select: { role: true, permissions: true } }) : null;
  return getEffectivePermissions(user);
}

/** Fresh-from-DB own-content switches (24 Sep) — for CREATOR/TEAM_MEMBER/PLAN_MAKER; all-false for staff. */
export async function loadOwnCapabilities(userId) {
  const user = userId ? await prisma.user.findUnique({ where: { id: userId }, select: { role: true, permissions: true } }) : null;
  return getOwnCapabilities(user);
}
