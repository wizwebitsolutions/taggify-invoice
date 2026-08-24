import { prisma } from "../../lib/prisma.js";
import { refreshLinkMetrics, refreshAssetMetrics } from "../scraping/service.js";

/**
 * Re-scrapes metrics for links still awaiting insight approval, and
 * refreshes each active asset's follower count. Runs on a fixed interval
 * via node-cron rather than being queued per-item — acceptable at the
 * observed scale (low thousands of links), revisit if that grows.
 */
export async function instagramRescrapeJob() {
  const pendingLinks = await prisma.link.findMany({
    where: { status: { in: ["SCREENSHOT_APPROVED", "INSIGHTS_PENDING"] } },
    select: { id: true },
    take: 200, // bound a single run's Apify usage
  });

  for (const { id } of pendingLinks) {
    try {
      await refreshLinkMetrics(id);
    } catch (err) {
      console.error(`instagramRescrapeJob: link ${id} failed`, err);
    }
  }

  const assets = await prisma.asset.findMany({ where: { approvalStatus: "approved" }, select: { id: true } });
  for (const { id } of assets) {
    try {
      await refreshAssetMetrics(id);
    } catch (err) {
      console.error(`instagramRescrapeJob: asset ${id} failed`, err);
    }
  }
}
