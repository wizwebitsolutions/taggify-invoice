import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../middleware/errorHandler.js";

/**
 * Vendor contact details from Inventory (13 Nov — "plan maker can also edit
 * but it'll go for approval first to admin, admin can edit vendor from
 * inventory"). A vendor is the CREATOR account that owns pages and is paid for
 * them. Only contact fields: the sign-in email and bank details stay in
 * Settings → People, where their own checks live.
 *
 *  - An admin (ADMIN role + inventory.edit, checked in routes) edits directly.
 *  - A plan maker's change is parked on the vendor as `pendingVendorEdit`
 *    (one at a time; a newer one replaces it) until someone with
 *    inventory.approve applies or discards it.
 *
 * Every applied change is audit-logged like People → Edit details.
 */
export const VENDOR_FIELDS = ["name", "phoneNumber", "secondaryPhone"];

const VENDOR_SELECT = { id: true, role: true, name: true, phoneNumber: true, secondaryPhone: true, pendingVendorEdit: true, pendingVendorEditById: true, pendingVendorEditAt: true };
const CLEAR_PENDING = { pendingVendorEdit: null, pendingVendorEditById: null, pendingVendorEditAt: null };

async function loadVendor(vendorId) {
  const vendor = await prisma.user.findUnique({ where: { id: vendorId }, select: VENDOR_SELECT });
  // Only vendor (creator) accounts: this route must never become a way to
  // rename an admin, finance or planner account from Inventory.
  if (!vendor || vendor.role !== "CREATOR") throw new ApiError(404, "VENDOR_NOT_FOUND", "Vendor not found");
  return vendor;
}

/** The fields in `patch` that differ from the vendor's current values, as { before, after }. */
function diff(vendor, patch) {
  const before = {};
  const after = {};
  for (const field of VENDOR_FIELDS) {
    if (!(field in patch)) continue;
    const value = patch[field] ?? null;
    if (value === (vendor[field] ?? null)) continue;
    before[field] = vendor[field] ?? null;
    after[field] = value;
  }
  return { before, after };
}

async function assertPhoneFree(vendorId, phoneNumber) {
  if (!phoneNumber) return;
  const holder = await prisma.user.findUnique({ where: { phoneNumber }, select: { id: true } });
  if (holder && holder.id !== vendorId) throw new ApiError(409, "PHONE_ALREADY_REGISTERED", "Another account already uses this phone number");
}

/**
 * Writes `after` onto the vendor plus an audit row; `extra` is merged into the update (clears a
 * suggestion). `suggestedById` (an approved suggestion) is kept in the audit row beside the approver.
 */
async function applyVendorChange(actorId, vendor, before, after, extra = {}, suggestedById = null) {
  await assertPhoneFree(vendor.id, after.phoneNumber);
  const logged = suggestedById ? { ...after, suggestedById } : after;
  try {
    const [updated] = await prisma.$transaction([
      prisma.user.update({ where: { id: vendor.id }, data: { ...after, ...extra }, select: VENDOR_SELECT }),
      ...(Object.keys(after).length ? [prisma.permissionAuditLog.create({ data: { targetId: vendor.id, actorId, action: "vendor_details_change", before, after: logged } })] : []),
    ]);
    return publicVendor(updated);
  } catch (err) {
    if (err?.code === "P2002") throw new ApiError(409, "PHONE_ALREADY_REGISTERED", "Another account already uses this phone number");
    throw err;
  }
}

function publicVendor(v) {
  return { id: v.id, name: v.name ?? null, phoneNumber: v.phoneNumber ?? null, secondaryPhone: v.secondaryPhone ?? null, pendingVendorEdit: v.pendingVendorEdit ?? null, pendingVendorEditAt: v.pendingVendorEditAt ?? null };
}

/** Admin's direct edit. A suggestion waiting on the vendor is left as it is. */
export async function editVendor(actor, vendorId, patch) {
  const vendor = await loadVendor(vendorId);
  const { before, after } = diff(vendor, patch);
  if (Object.keys(after).length === 0) return publicVendor(vendor);
  return applyVendorChange(actor.id, vendor, before, after);
}

/** A plan maker's suggestion; nothing on the vendor changes until it's approved. */
export async function proposeVendorEdit(actor, vendorId, patch) {
  // An admin edits directly — a suggestion from them would only wait on themselves.
  if (actor.role === "ADMIN") throw new ApiError(400, "USE_DIRECT_EDIT", "Admins edit vendors directly.");
  // The route lets any role holding inventory.edit through; suggesting changes
  // to someone else's contact details is a plan maker's job only.
  if (actor.role !== "PLAN_MAKER") throw new ApiError(403, "FORBIDDEN", "Only plan makers can suggest vendor changes.");
  const vendor = await loadVendor(vendorId);
  // Approvals finds suggestions through Inventory's pages, so a vendor with none would hide it forever.
  if ((await prisma.asset.count({ where: { ownerId: vendor.id } })) === 0) throw new ApiError(404, "VENDOR_NOT_FOUND", "Vendor not found");
  const { after } = diff(vendor, patch);
  if (Object.keys(after).length === 0) throw new ApiError(400, "NOTHING_TO_CHANGE", "Nothing to change.");
  // Caught now rather than when an admin approves it.
  await assertPhoneFree(vendor.id, after.phoneNumber);
  const updated = await prisma.user.update({ where: { id: vendor.id }, data: { pendingVendorEdit: after, pendingVendorEditById: actor.id, pendingVendorEditAt: new Date() }, select: VENDOR_SELECT });
  return publicVendor(updated);
}

/** Apply ("approve") or discard ("reject") a vendor's waiting suggestion. */
export async function decideVendorEdit(actor, vendorId, decision) {
  const vendor = await loadVendor(vendorId);
  const pending = vendor.pendingVendorEdit;
  if (!pending || typeof pending !== "object" || Object.keys(pending).length === 0) throw new ApiError(400, "NO_PENDING_EDIT", "This vendor has no change waiting for approval.");
  if (decision === "reject") {
    const updated = await prisma.user.update({ where: { id: vendor.id }, data: CLEAR_PENDING, select: VENDOR_SELECT });
    return publicVendor(updated);
  }
  // Re-diffed against today's values: something an admin already changed by hand isn't "changed" again.
  const allowed = Object.fromEntries(Object.entries(pending).filter(([k]) => VENDOR_FIELDS.includes(k)));
  const { before, after } = diff(vendor, allowed);
  return applyVendorChange(actor.id, vendor, before, after, CLEAR_PENDING, vendor.pendingVendorEditById);
}
