import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../middleware/errorHandler.js";

/**
 * Creators see only their own assets; Admin/Finance see everything —
 * mirrors the scoping used across links/invoices.
 */
export async function listAssets(user) {
  const where = ["ADMIN", "FINANCE"].includes(user.role) ? {} : { ownerId: user.id };
  return prisma.asset.findMany({
    where,
    include: { rateCards: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function createAsset(user, { platform, handle }) {
  return prisma.asset.create({
    data: { ownerId: user.id, platform, handle, approvalStatus: "pending" },
  });
}

export async function setApprovalStatus(assetId, approvalStatus) {
  return prisma.asset.update({ where: { id: assetId }, data: { approvalStatus } });
}

/** Upserts each (assetId, format) rate — admin-only, versioned by effectiveFrom. */
export async function updateRateCard(assetId, rateCards) {
  const asset = await prisma.asset.findUnique({ where: { id: assetId } });
  if (!asset) throw new ApiError(404, "ASSET_NOT_FOUND", "Asset not found");

  return prisma.$transaction(
    rateCards.map((entry) =>
      prisma.rateCard.upsert({
        where: { assetId_format: { assetId, format: entry.format } },
        create: { assetId, format: entry.format, amount: entry.amount },
        update: { amount: entry.amount, effectiveFrom: new Date() },
      })
    )
  );
}
