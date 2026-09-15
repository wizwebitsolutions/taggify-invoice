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
// A batch of profiles takes longer than one; still bounded so a preview
// never hangs a request indefinitely.
const BATCH_WAIT_SECS = 240;
const BATCH_CHUNK_SIZE = 25;
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
  // call() resolves once waitSecs is up even if the run is still going —
  // reading a half-finished dataset would report every profile that
  // hadn't been reached yet as "not found". Abort it and fail instead, so
  // callers treat it as a transient error (retried later), not as data.
  if (run.status !== "SUCCEEDED") {
    await client.run(run.id).abort().catch(() => {});
    throw new Error(`Apify run ${String(run.status).toLowerCase()} — didn't finish within ${waitSecs}s`);
  }
  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  return items;
}

/**
 * Avg. views / likes / comments over the profile's `latestPosts` (the
 * details scrape returns up to ~12 recent posts inline) — so a page just
 * added to Inventory shows engagement immediately, before any link has
 * been submitted through the app (user request, 14 Sep). Views only exist
 * on video posts, so avgViews averages over those alone; a count Apify
 * hides comes back null and is left out rather than dragging the average
 * to zero. Exported for the unit test.
 */
export function averageLatestPosts(latestPosts) {
  const posts = Array.isArray(latestPosts) ? latestPosts : [];
  const numeric = (v) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
  const avg = (values) => (values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null);
  // Instagram stopped exposing "views" for reels — the scraper often returns
  // videoViewCount: 0 next to a real videoPlayCount — so take the larger of
  // the two, and only for video posts (an image carrying videoViewCount: 0
  // must not drag the average down).
  const isVideo = (p) => p.type === "Video" || p.productType === "clips" || p.isVideo === true;
  const views = posts
    .filter(isVideo)
    .map((p) => {
      const a = numeric(p.videoViewCount);
      const b = numeric(p.videoPlayCount ?? p.playCount);
      return a === null && b === null ? null : Math.max(a ?? 0, b ?? 0);
    })
    .filter((v) => v !== null);
  const likes = posts.map((p) => numeric(p.likesCount)).filter((v) => v !== null);
  const comments = posts.map((p) => numeric(p.commentsCount)).filter((v) => v !== null);
  // Posts that contributed at least one number — so a scrape where every
  // count was hidden doesn't count as a "sample".
  const sampleSize = posts.filter((p) => (isVideo(p) && (numeric(p.videoViewCount) !== null || numeric(p.videoPlayCount ?? p.playCount) !== null)) || numeric(p.likesCount) !== null || numeric(p.commentsCount) !== null).length;
  return { avgViews: avg(views), avgLikes: avg(likes), avgComments: avg(comments), sampleSize };
}

/** One scraped profile item → the metrics shape the rest of the app stores. */
function profileToMetrics(profile) {
  return {
    followers: profile.followersCount ?? 0,
    mediaCount: profile.postsCount ?? 0,
    fullName: profile.fullName ?? null,
    biography: profile.biography ?? null,
    profilePicUrl: profile.profilePicUrl ?? null,
    ...averageLatestPosts(profile.latestPosts),
  };
}

/**
 * Maps a batch run's items back to the handles that were asked for
 * (case-insensitive on `username`; an item with `error` counts as "not
 * found"). Exported for the unit test.
 */
export function indexProfilesByHandle(handles, items) {
  const byUsername = new Map();
  for (const item of items ?? []) {
    const username = String(item?.username ?? item?.inputUrl?.match(/instagram\.com\/([^/?#]+)/)?.[1] ?? "").toLowerCase();
    if (username) byUsername.set(username, item);
  }
  const out = {};
  for (const handle of handles) {
    const item = byUsername.get(handle.toLowerCase());
    out[handle] = item && !item.error ? profileToMetrics(item) : null;
  }
  return out;
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

    return profileToMetrics(profile);
  },

  /**
   * Profile metrics for many handles in ONE actor run (Inventory import
   * preview, 14 Sep — "on preview it should also fetch followers"): the
   * scraper accepts a list of profile URLs and returns one item per
   * profile, so 50 pages cost roughly one page's wait rather than fifty.
   * Returns { [handle]: metrics | null } — null for a private/missing
   * profile, without failing the others.
   */
  async getAccountMetricsBatch(handles) {
    if (handles.length === 0) return {};
    // Smaller parallel runs rather than one huge one: each stays well
    // inside its wait budget, and one chunk timing out only leaves *its*
    // handles unknown (absent from the result) instead of failing all.
    const chunks = [];
    for (let i = 0; i < handles.length; i += BATCH_CHUNK_SIZE) chunks.push(handles.slice(i, i + BATCH_CHUNK_SIZE));
    const settled = await Promise.allSettled(
      chunks.map((chunk) =>
        runActor(IG_ACTOR_ID, { directUrls: chunk.map((h) => `https://www.instagram.com/${h}/`), resultsType: "details", resultsLimit: 1 }, BATCH_WAIT_SECS).then((items) => indexProfilesByHandle(chunk, items))
      )
    );
    if (settled.every((r) => r.status === "rejected")) throw settled[0].reason;
    const out = {};
    for (const r of settled) if (r.status === "fulfilled") Object.assign(out, r.value);
    return out;
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
      thumbnailUrl: extractThumbnailUrl(post),
      caption: extractCaption(post),
    };
  },
};

// The exact field names data-slayer/instagram-post-details returns for the
// cover image and caption weren't confirmed against a live scrape when this
// was written (no reachable Apify credentials in that session) — this tries
// every field name that IG-post-detail scrapers commonly use, in priority
// order, and falls back to null rather than guessing wrong. If the campaign
// card ends up with no thumbnail/caption in practice, log one real `post`
// payload and add its actual field name here.
function extractThumbnailUrl(post) {
  return (
    post.thumbnail_url ??
    post.display_url ??
    post.image_versions2?.candidates?.[0]?.url ??
    post.thumbnail_src ??
    null
  );
}

function extractCaption(post) {
  const raw = post.caption?.text ?? post.caption ?? post.edge_media_to_caption?.edges?.[0]?.node?.text ?? null;
  return typeof raw === "string" ? raw : null;
}
