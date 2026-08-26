import { prisma } from "../../lib/prisma.js";
import { refreshAssetMetrics } from "../scraping/service.js";

/**
 * Refreshes each approved asset's Instagram profile — follower count,
 * full name, bio, and avatar — from Apify. Runs on its own 24h cron
 * (ASSET_PROFILE_RESCRAPE_CRON), separate from the 6h link-rescrape job:
 * a profile pic/bio/follower count doesn't go stale nearly as fast as
 * post engagement, so there's no need to burn Apify calls on it every 6h.
 */
export async function assetProfileRescrapeJob() {
  const assets = await prisma.asset.findMany({ where: { approvalStatus: "approved" }, select: { id: true } });

  for (const { id } of assets) {
    try {
      await refreshAssetMetrics(id);
    } catch (err) {
      console.error(`assetProfileRescrapeJob: asset ${id} failed`, err);
    }
  }
}
