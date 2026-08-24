import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../middleware/errorHandler.js";
import { transitionLinkStatus } from "./statusTimeline.js";
import { refreshLinkMetrics } from "../scraping/service.js";

export async function createLink(user, { campaignId, assetId, url, format, customAmount }) {
  const asset = await prisma.asset.findUnique({ where: { id: assetId }, include: { rateCards: true } });
  if (!asset) throw new ApiError(404, "ASSET_NOT_FOUND", "Asset not found");

  // Non-admin callers get the asset's rate-card price; only an admin caller
  // may pass customAmount to override it for a negotiated deal.
  let cost;
  let customRate = false;
  if (customAmount != null && user.role === "ADMIN") {
    cost = customAmount;
    customRate = true;
  } else {
    const rateCard = asset.rateCards.find((rc) => rc.format === format);
    if (!rateCard) {
      throw new ApiError(400, "NO_RATE_CARD", `No rate card set for format "${format}" on this asset`);
    }
    cost = rateCard.amount;
  }

  const link = await prisma.link.create({
    data: { campaignId, assetId, submittedById: user.id, url, cost, customRate, status: "SUBMITTED" },
  });

  await prisma.linkStatusEvent.create({ data: { linkId: link.id, status: "SUBMITTED", actedById: user.id } });
  return link;
}

export async function listLinks(user, filters) {
  const where = {};
  if (!["ADMIN", "FINANCE"].includes(user.role)) {
    where.asset = { ownerId: user.id };
  }
  if (filters.status) where.status = filters.status;
  if (filters.campaignId) where.campaignId = filters.campaignId;
  if (filters.assetId) where.assetId = filters.assetId;
  if (filters.from || filters.to) {
    where.createdAt = {};
    if (filters.from) where.createdAt.gte = filters.from;
    if (filters.to) where.createdAt.lte = filters.to;
  }

  const [items, total] = await prisma.$transaction([
    prisma.link.findMany({
      where,
      include: { campaign: true, asset: true, screenshot: true, postSnapshots: { orderBy: { capturedAt: "desc" }, take: 1 } },
      orderBy: { createdAt: "desc" },
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
    }),
    prisma.link.count({ where }),
  ]);

  return { items, total, page: filters.page, pageSize: filters.pageSize };
}

export async function getLinkTimeline(linkId) {
  return prisma.linkStatusEvent.findMany({ where: { linkId }, orderBy: { createdAt: "asc" } });
}

/** Called after a screenshot is confirmed as uploaded. */
export async function markPendingScreenshotReview(linkId) {
  return transitionLinkStatus(linkId, "PENDING_SCREENSHOT_REVIEW");
}

/**
 * Admin reviews the screenshot. On approval, kicks off an Apify metrics
 * refresh immediately so insights review isn't stuck waiting on the next
 * cron pass.
 */
export async function reviewScreenshot(linkId, admin, { approved, note }) {
  const link = await prisma.link.findUnique({ where: { id: linkId }, include: { submittedBy: true } });
  if (!link) throw new ApiError(404, "LINK_NOT_FOUND", "Link not found");

  await prisma.screenshot.update({
    where: { linkId },
    data: { approved, reviewedById: admin.id },
  });

  if (!approved) {
    return transitionLinkStatus(linkId, "SCREENSHOT_REJECTED", {
      actedById: admin.id,
      note,
      notifyUserId: link.submittedById,
      notifyType: "screenshot_rejected",
    });
  }

  await transitionLinkStatus(linkId, "SCREENSHOT_APPROVED", { actedById: admin.id, note });

  try {
    const result = await refreshLinkMetrics(linkId);
    if (result.ok) {
      return transitionLinkStatus(linkId, "INSIGHTS_PENDING", { actedById: admin.id });
    }
    return transitionLinkStatus(linkId, "INSIGHTS_PENDING", {
      actedById: admin.id,
      note: "Auto-scrape failed; needs manual metrics refresh",
    });
  } catch {
    // Scrape failure (transient/auth/quota) shouldn't block the approval —
    // link stays SCREENSHOT_APPROVED, cron will retry the scrape later.
    return prisma.link.findUnique({ where: { id: linkId } });
  }
}

export async function approveInsights(linkId, admin) {
  const link = await prisma.link.findUnique({ where: { id: linkId } });
  if (!link) throw new ApiError(404, "LINK_NOT_FOUND", "Link not found");
  if (link.status !== "INSIGHTS_PENDING") {
    throw new ApiError(400, "INVALID_STATUS", `Link must be INSIGHTS_PENDING, is ${link.status}`);
  }

  return transitionLinkStatus(linkId, "INSIGHTS_APPROVED", {
    actedById: admin.id,
    notifyUserId: link.submittedById,
    notifyType: "insights_approved",
  });
}

export async function refreshMetricsNow(linkId) {
  return refreshLinkMetrics(linkId);
}
