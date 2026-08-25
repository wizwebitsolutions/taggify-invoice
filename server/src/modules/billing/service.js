import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../middleware/errorHandler.js";

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

export async function setApproval(id, approvalStatus) {
  const profile = await prisma.billingProfile.findUnique({ where: { id } });
  if (!profile) throw new ApiError(404, "BILLING_PROFILE_NOT_FOUND", "Billing profile not found");
  return prisma.billingProfile.update({ where: { id }, data: { approvalStatus } });
}

/** The one approved profile to show as "Bill To" on an invoice PDF, if any. */
export async function getApprovedForUser(userId) {
  return prisma.billingProfile.findFirst({ where: { userId, approvalStatus: "approved" }, orderBy: { createdAt: "desc" } });
}
