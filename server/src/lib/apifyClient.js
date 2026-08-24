import { ApifyClient } from "apify-client";

/**
 * ApifyInstagramProvider — public-data Instagram scraping via Apify.
 * No Meta OAuth/Graph API involved. Two actors, following the pattern
 * reviewed in wizwebitsolutions/affiliate-creator-tool:
 *   - apify~instagram-scraper (IG_ACTOR_ID) — profile scraping only.
 *     MUST be called with `directUrls: ["https://www.instagram.com/<user>/"]`,
 *     NOT `usernames: [...]` — the latter queues 0 requests and always
 *     returns {error:"no_items"} regardless of validity.
 *   - data-slayer/instagram-post-details (POST_ACTOR_ID) — single post/reel
 *     scrape, one call per link (no batching), called with `postUrls: [url]`.
 */

const IG_ACTOR_ID = process.env.APIFY_IG_ACTOR_ID ?? "apify~instagram-scraper";
const POST_ACTOR_ID = process.env.APIFY_REEL_ACTOR_ID ?? "data-slayer/instagram-post-details";

export class PostNotFoundError extends Error {}

function getClient() {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error("APIFY_TOKEN is not set");
  return new ApifyClient({ token });
}

async function runActor(actorId, input, waitSecs = 120) {
  const client = getClient();
  const run = await client.actor(actorId).call(input, { waitSecs });
  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  return items;
}

export const ApifyInstagramProvider = {
  /** Profile metrics for an Asset (followers, media count, ...). */
  async getAccountMetrics(handle) {
    const items = await runActor(IG_ACTOR_ID, {
      directUrls: [`https://www.instagram.com/${handle}/`],
      resultsType: "details",
      resultsLimit: 1,
    });

    const profile = items[0];
    if (!profile || profile.error) {
      throw new Error(
        `Apify: no profile for handle "${handle}" (${profile?.errorDescription ?? "no data"})`
      );
    }

    return {
      followers: profile.followersCount ?? 0,
      mediaCount: profile.postsCount ?? 0,
      fullName: profile.fullName ?? null,
      biography: profile.biography ?? null,
      profilePicUrl: profile.profilePicUrl ?? null,
    };
  },

  /**
   * Metrics for a single submitted post/reel link.
   * Throws PostNotFoundError when Apify returns no item at all (dead,
   * deleted, or private link) so callers can label that distinctly from a
   * transient/auth/quota failure, which should be retried instead.
   */
  async getPostMetrics(url) {
    const items = await runActor(POST_ACTOR_ID, { postUrls: [url] });

    const post = items[0];
    if (!post || !post.metrics || !post.pk) {
      throw new PostNotFoundError(`Broken link: no data for URL "${url}" (deleted, private, or invalid)`);
    }

    const m = post.metrics;
    const playCount = m.play_count ?? m.ig_play_count ?? 0;

    return {
      // Null engagement fields map to -1 ("unknown"), never coerced to 0 —
      // a null from Apify (hidden count, or field absent on that scrape)
      // must never read downstream as "engagement dropped to zero".
      likeCount: m.like_count ?? -1,
      commentsCount: m.comment_count ?? -1,
      videoViews: m.view_count ?? playCount,
      videoPlayCount: playCount,
      saves: m.save_count ?? -1,
      shares: m.share_count ?? -1,
      reposts: m.repost_count ?? -1,
      postedAt: post.taken_at_date ? new Date(post.taken_at_date) : null,
    };
  },
};
