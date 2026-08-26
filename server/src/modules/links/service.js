import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../middleware/errorHandler.js";
import { transitionLinkStatus } from "./statusTimeline.js";
import { refreshLinkMetrics } from "../scraping/service.js";
import { publicUrlFor } from "../../lib/cloudinaryClient.js";

export async function createLink(user, { campaignId, assetId, url, format, customAmount }) {
  const asset = await prisma.asset.findUnique({ where: { id: assetId }, include: { rateCards: true } });
  if (!asset) throw new ApiError(404, "ASSET_NOT_FOUND", "Asset not found");

  return createOneLink(user, asset, { campaignId, assetId, url, format, customAmount });
}

/** Shared by createLink and bulkCreateLink — asset is passed in so the bulk path fetches it once, not per URL. */
async function createOneLink(user, asset, { campaignId, assetId, url, format, customAmount }) {
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
    data: { campaignId, assetId, submittedById: user.id, url, format, cost, customRate, status: "SUBMITTED" },
  });

  await prisma.linkStatusEvent.create({ data: { linkId: link.id, status: "SUBMITTED", actedById: user.id } });
  return link;
}

/**
 * Bulk link upload (creator.wldd.in's "Upload Links" modal): one
 * campaign/asset/format, many URLs submitted together. Each URL is
 * created independently — one bad/duplicate URL doesn't fail the batch,
 * it's just reported back alongside the ones that succeeded.
 */
export async function bulkCreateLink(user, { campaignId, assetId, format, urls }) {
  const asset = await prisma.asset.findUnique({ where: { id: assetId }, include: { rateCards: true } });
  if (!asset) throw new ApiError(404, "ASSET_NOT_FOUND", "Asset not found");

  // De-dupe the pasted list itself (creators commonly paste the same link twice).
  const uniqueUrls = [...new Set(urls.map((u) => u.trim()).filter(Boolean))];

  const created = [];
  const skipped = [];
  for (const url of uniqueUrls) {
    try {
      const existing = await prisma.link.findFirst({ where: { url, assetId } });
      if (existing) {
        skipped.push({ url, reason: "Already submitted for this page" });
        continue;
      }
      const link = await createOneLink(user, asset, { campaignId, assetId, url, format });
      created.push(link);
    } catch (err) {
      skipped.push({ url, reason: err instanceof ApiError ? err.message : "Couldn't submit this link" });
    }
  }

  return { created, skipped, totalSubmitted: uniqueUrls.length };
}

export async function listLinks(user, filters) {
  const where = {};
  if (!["ADMIN", "FINANCE"].includes(user.role)) {
    where.asset = { ownerId: user.id };
  }
  // A comma-separated status list (e.g. from the dashboard's "Links
  // approved" KPI tile, which spans several statuses) becomes an IN match;
  // a single status stays an equality match.
  if (filters.status) {
    where.status = filters.status.includes(",") ? { in: filters.status.split(",") } : filters.status;
  }
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

  // Screenshot only carries a publicId in the DB — the admin review panel
  // needs an actual image URL to show what was submitted, so compute it
  // here rather than leaving callers to reconstruct a Cloudinary URL.
  const withScreenshotUrls = items.map((link) => ({
    ...link,
    screenshot: link.screenshot ? { ...link.screenshot, url: publicUrlFor(link.screenshot.publicId) } : null,
  }));

  return { items: withScreenshotUrls, total, page: filters.page, pageSize: filters.pageSize };
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

/**
 * Manual "Refresh metrics" (admin-triggered retry — the cron does this
 * automatically every few hours, but a stuck link shouldn't have to wait).
 * Unlike the cron sweep, a successful scrape here also advances a
 * SCREENSHOT_APPROVED link to INSIGHTS_PENDING, matching what a
 * same-turn auto-scrape does in reviewScreenshot — otherwise a link could
 * pick up a snapshot but never become eligible for "Approve insights".
 */
export async function refreshMetricsNow(linkId, admin) {
  const link = await prisma.link.findUnique({ where: { id: linkId } });
  if (!link) throw new ApiError(404, "LINK_NOT_FOUND", "Link not found");

  const result = await refreshLinkMetrics(linkId);
  if (result.ok && link.status === "SCREENSHOT_APPROVED") {
    await transitionLinkStatus(linkId, "INSIGHTS_PENDING", { actedById: admin.id });
  }
  return result;
}
