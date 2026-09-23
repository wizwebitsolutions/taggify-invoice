import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../middleware/errorHandler.js";
import { hasPermission } from "../../lib/permissions.js";

/**
 * Billing profiles are the payout/tax identity a creator registers to
 * actually get paid — PAN, GSTIN, bank account (creator.wldd.in "Billing
 * Profiles" tab). A creator can hold several; each is approved
 * independently. "A PAN used for a billing profile cannot be removed" per
 * WLDD's own copy — we mirror that by never exposing a delete endpoint.
 */
export async function listOwn(userId) {
  return prisma.billingProfile.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
}

export async function listAll() {
  return prisma.billingProfile.findMany({
    include: { user: { select: { id: true, name: true, phoneNumber: true } } },
    orderBy: { createdAt: "desc" },
  });
}

export async function create(userId, data) {
  const existing = await prisma.billingProfile.findUnique({ where: { pan: data.pan } });
  if (existing) {
    throw new ApiError(409, "PAN_ALREADY_REGISTERED", "This PAN is already registered to a billing profile");
  }
  return prisma.billingProfile.create({ data: { ...data, userId, approvalStatus: "pending" } });
}

/**
 * Edit a profile's details (user request, 22 Sep). An Admin (or a role
 * granted finance.manage) may edit anyone's; the owner may edit their own,
 * which sends it back to "pending" — the details an admin approved are no
 * longer the ones on file. An admin's own edit keeps the status. The PAN
 * stays unique across profiles, like on create.
 */
export async function update(id, actor, data) {
  const profile = await prisma.billingProfile.findUnique({ where: { id } });
  if (!profile) throw new ApiError(404, "BILLING_PROFILE_NOT_FOUND", "Billing profile not found");
  // Same fresh-from-DB check requireAccess() makes, so a restricted
  // sub-admin or a freshly granted role is judged on today's permissions.
  const account = await prisma.user.findUnique({ where: { id: actor.id }, select: { role: true, permissions: true } });
  const isReviewer = hasPermission(account, "finance.edit");
  if (!isReviewer && profile.userId !== actor.id) {
    throw new ApiError(403, "FORBIDDEN", "You can only edit your own billing profiles");
  }
  if (data.pan && data.pan !== profile.pan) {
    const clash = await prisma.billingProfile.findUnique({ where: { pan: data.pan } });
    if (clash) throw new ApiError(409, "PAN_ALREADY_REGISTERED", "This PAN is already registered to a billing profile");
  }
  const clean = { ...data };
  if (clean.gstin === "") clean.gstin = null;
  if (clean.msme === "") clean.msme = null;
  return prisma.billingProfile.update({
    where: { id },
    data: { ...clean, ...(isReviewer ? {} : { approvalStatus: "pending" }) },
    include: { user: { select: { id: true, name: true, phoneNumber: true } } },
  });
}

export async function setApproval(id, approvalStatus) {
  const profile = await prisma.billingProfile.findUnique({ where: { id } });
  if (!profile) throw new ApiError(404, "BILLING_PROFILE_NOT_FOUND", "Billing profile not found");
  return prisma.billingProfile.update({ where: { id }, data: { approvalStatus } });
}

/** The one approved profile to show as "Bill To" on an invoice PDF, if any. */
export async function getApprovedForUser(userId) {
  return prisma.billingProfile.findFirst({ where: { userId, approvalStatus: "approved" }, orderBy: { createdAt: "desc" } });
}
