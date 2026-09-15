import { describe, it, expect } from "vitest";

import { averageLatestPosts, indexProfilesByHandle } from "./apifyClient.js";

/**
 * Inventory "Create page" (14 Sep) — "on creation automatic fetching of
 * followers count, avg views": the profile scrape's latestPosts are
 * averaged into profile-level engagement so a brand-new page has numbers
 * before any link goes through the app.
 */
/** Import preview's one-run batch scrape (14 Sep): items map back to the handles asked for. */
describe("indexProfilesByHandle", () => {
  it("matches items to handles case-insensitively, nulls a missing or errored profile, and never invents one", () => {
    const out = indexProfilesByHandle(
      ["Big.Page", "private.page", "gone.page"],
      [
        { username: "big.page", followersCount: 1200, postsCount: 3, latestPosts: [] },
        { username: "private.page", error: "private", errorDescription: "This account is private" },
      ]
    );
    expect(out["Big.Page"]).toMatchObject({ followers: 1200, mediaCount: 3 });
    expect(out["private.page"]).toBeNull();
    expect(out["gone.page"]).toBeNull();
  });
});

describe("averageLatestPosts", () => {
  it("averages views over video posts only, likes/comments over every post, and skips hidden (null) counts", () => {
    const result = averageLatestPosts([
      { type: "Video", videoViewCount: 1000, likesCount: 100, commentsCount: 10 },
      { type: "Video", videoPlayCount: 3000, likesCount: 300, commentsCount: null },
      { type: "Image", videoViewCount: 0, likesCount: 200, commentsCount: 20 },
    ]);
    expect(result).toEqual({ avgViews: 2000, avgLikes: 200, avgComments: 15, sampleSize: 3 });
  });

  it("takes plays when the scraper reports videoViewCount: 0 next to a real videoPlayCount (reels)", () => {
    expect(averageLatestPosts([{ type: "Video", videoViewCount: 0, videoPlayCount: 48000, likesCount: 100, commentsCount: 5 }]).avgViews).toBe(48000);
  });

  it("returns nulls (not zeros) when there are no posts or every count is hidden — and such posts don't count as a sample", () => {
    expect(averageLatestPosts(undefined)).toEqual({ avgViews: null, avgLikes: null, avgComments: null, sampleSize: 0 });
    expect(averageLatestPosts([{ type: "Image" }, { type: "Video", likesCount: null }])).toEqual({ avgViews: null, avgLikes: null, avgComments: null, sampleSize: 0 });
  });
});
