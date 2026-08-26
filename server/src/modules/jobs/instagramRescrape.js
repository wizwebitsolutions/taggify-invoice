import { prisma } from "../../lib/prisma.js";
import { refreshLinkMetrics } from "../scraping/service.js";

/**
 * Re-scrapes metrics for links still awaiting insight approval. Runs on a
 * fixed interval via node-cron rather than being queued per-item —
 * acceptable at the observed scale (low thousands of links), revisit if
 * that grows.
 *
 * Asset-level profile/follower refresh used to run here too, but now has
 * its own 24h cron (see assetProfileRescrape.js) — post engagement goes
 * stale much faster than a follower count or a profile pic, so the two are
 * scraped on separate schedules instead of both riding this 6h job.
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
}
