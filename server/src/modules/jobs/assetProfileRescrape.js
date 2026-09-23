import { prisma } from "../../lib/prisma.js";
import { refreshAssetMetrics } from "../scraping/service.js";
import { storeProfilePic } from "../assets/service.js";

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
      // Re-store the page's picture in Cloudinary right after the URL
      // refreshes (22 Sep), so the stored copy follows the current avatar.
      await storeProfilePic(id);
    } catch (err) {
      console.error(`assetProfileRescrapeJob: asset ${id} failed`, err);
    }
  }
}
