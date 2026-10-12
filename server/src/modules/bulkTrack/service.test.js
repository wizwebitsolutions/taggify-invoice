import { describe, it, expect, vi, beforeEach } from "vitest";

// Bulk Tracker service + worker logic (12 Oct), ported from
// affiliate-creator-tool — the parsers, the sheet import's row/weight rules
// (bulkTrack.controller.test.js in the source), the worker's batch counters
// and status mapping. Prisma is an in-memory fake; Apify and Google are mocked.
const db = { batches: [], profiles: [], posts: [], profileSnaps: [], postSnaps: [] };
let seq = 0;
const nextId = (p) => `${p}${++seq}`;
const matches = (row, where = {}) =>
  Object.entries(where).every(([k, v]) => (v && typeof v === "object" && "in" in v ? v.in.includes(row[k]) : row[k] === v));

const mockPrisma = {
  bulkImportBatch: {
    create: vi.fn(async ({ data }) => {
      const row = { id: nextId("b"), status: "running", totalCount: 0, successCount: 0, failedCount: 0, ...data };
      db.batches.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }) => {
      const row = db.batches.find((b) => b.id === where.id);
      for (const [k, v] of Object.entries(data)) row[k] = v && typeof v === "object" && "increment" in v ? row[k] + v.increment : v;
      return row;
    }),
    findUnique: vi.fn(async ({ where }) => db.batches.find((b) => b.id === where.id) ?? null),
  },
  bulkTrackedProfile: {
    create: vi.fn(async ({ data }) => {
      const row = { id: nextId("pr"), status: "queued", pageName: null, ...data };
      db.profiles.push(row);
      return row;
    }),
    findMany: vi.fn(async ({ where }) => db.profiles.filter((p) => matches(p, where))),
    findUnique: vi.fn(async ({ where }) => db.profiles.find((p) => p.id === where.id) ?? null),
    update: vi.fn(async ({ where, data }) => Object.assign(db.profiles.find((p) => p.id === where.id), data)),
  },
  bulkTrackedPost: {
    create: vi.fn(async ({ data }) => {
      const row = { id: nextId("po"), status: "queued", ...data };
      db.posts.push(row);
      return row;
    }),
    findMany: vi.fn(async ({ where }) => db.posts.filter((p) => matches(p, where))),
    findUnique: vi.fn(async ({ where }) => db.posts.find((p) => p.id === where.id) ?? null),
    update: vi.fn(async ({ where, data }) => Object.assign(db.posts.find((p) => p.id === where.id), data)),
  },
  bulkTrackedProfileSnapshot: { create: vi.fn(async ({ data }) => db.profileSnaps.push(data)) },
  bulkTrackedPostSnapshot: { create: vi.fn(async ({ data }) => db.postSnaps.push(data)) },
  bulkImportSheetSource: { update: vi.fn(async () => ({})) },
  plan: { findFirst: vi.fn(async () => null) },
};
vi.mock("../../lib/prisma.js", () => ({ prisma: mockPrisma }));

const added = [];
vi.mock("./queue.js", () => ({ bulkTrackQueue: { add: vi.fn(async (_name, data) => added.push(data)) } }));

const fetchSheetRows = vi.fn();
vi.mock("./googleSheet.js", () => ({ fetchSheetRows: (...a) => fetchSheetRows(...a), parseSheetUrl: () => ({ sheetId: "ext1", gid: null }) }));

class PostNotFoundError extends Error {}
const getPostMetrics = vi.fn();
const getAccountMetrics = vi.fn();
vi.mock("../../lib/apifyClient.js", () => ({
  PostNotFoundError,
  ApifyInstagramProvider: { getPostMetrics: (...a) => getPostMetrics(...a), getAccountMetrics: (...a) => getAccountMetrics(...a) },
}));

process.env.BULK_TRACK_RETRY_DELAY_MS = "0";
const service = await import("./service.js");
const worker = await import("./worker.js");

beforeEach(() => {
  for (const k of Object.keys(db)) db[k] = [];
  added.length = 0;
  vi.clearAllMocks();
  process.env.APIFY_TOKEN = "test-token";
  delete process.env.BULK_TRACK_MOCK;
});

describe("link parsers", () => {
  it("extractUsername reads a profile handle and refuses post/reserved paths", () => {
    expect(service.extractUsername("https://www.instagram.com/some.page_1/")).toBe("some.page_1");
    expect(service.extractUsername("https://instagram.com/Some.Page?igsh=x")).toBe("Some.Page");
    for (const reserved of ["p/abc", "reel/abc", "reels/abc", "tv/abc", "stories/x", "explore/"]) {
      expect(service.extractUsername(`https://www.instagram.com/${reserved}`)).toBeNull();
    }
    expect(service.extractUsername("https://example.com/x")).toBeNull();
  });

  it("isPostUrl accepts /p/, /reel/ and /reels/ only", () => {
    expect(service.isPostUrl("https://www.instagram.com/p/abc/")).toBe(true);
    expect(service.isPostUrl("https://www.instagram.com/reel/abc/")).toBe(true);
    expect(service.isPostUrl("https://www.instagram.com/reels/abc/")).toBe(true);
    expect(service.isPostUrl("https://www.instagram.com/some.page/")).toBe(false);
  });

  it("parseFollowerCount strips formatting", () => {
    expect(service.parseFollowerCount("1,400,000")).toBe(1400000);
    expect(service.parseFollowerCount("2300000")).toBe(2300000);
    expect(service.parseFollowerCount("")).toBeNull();
    expect(service.parseFollowerCount("n/a")).toBeNull();
  });

  it("resolveFollowers prefers a non-zero scraped count, else the sheet cell", () => {
    expect(service.resolveFollowers({ followers: 10, profile: { snapshots: [{ followers: 500 }] } })).toBe(500);
    expect(service.resolveFollowers({ followers: 10, profile: { snapshots: [{ followers: 0 }] } })).toBe(10);
    expect(service.resolveFollowers({ followers: null })).toBeNull();
  });
});

describe("importRowsAsBatch — rows, weights and profile dedupe", () => {
  const source = { id: "s1", profileLinkCol: "Page", postLinkCol: "Post", followersCol: "Followers", pageNameCol: "Name", dateCol: "Date", fetchFollowers: true, fetchEngagement: true };
  const rows = [
    { Page: "https://www.instagram.com/alpha/", Post: "https://www.instagram.com/reel/r1/", Followers: "1,200", Name: "Alpha", Date: "9/15/2026" },
    { Page: "https://www.instagram.com/Alpha/", Post: "https://www.instagram.com/reel/r2/", Followers: "1,200", Name: "Alpha", Date: "9/16/2026" },
    { Page: "https://www.instagram.com/beta/", Post: "", Followers: "900" },
    { Page: "", Post: "" },
  ];

  it("one profile per page, totalCount = importable rows, post jobs settle their row and profile jobs only the rest", async () => {
    const result = await service.importRowsAsBatch({ source, rows, userId: "u1", sourceType: "sheet" });
    expect(result.rowCount).toBe(3);
    expect(result.profileCount).toBe(2); // alpha (case-insensitive dedupe) + beta
    expect(result.postCount).toBe(2);
    expect(db.batches[0].totalCount).toBe(3);

    const alpha = db.profiles.find((p) => p.username.toLowerCase() === "alpha");
    const beta = db.profiles.find((p) => p.username === "beta");
    // alpha's two rows are settled by their post jobs, so its profile job claims no counters.
    expect(added).toContainEqual({ kind: "profile", profileId: alpha.id });
    expect(alpha).toMatchObject({ pendingBatchId: null, pendingWeight: 0 });
    expect(beta).toMatchObject({ pendingBatchId: result.batch.id, pendingWeight: 1 });
    expect(added.filter((j) => j.kind === "post")).toHaveLength(2);
    expect(db.posts.every((p) => p.pendingBatchId === result.batch.id && p.pendingWeight === 1)).toBe(true);
    expect(db.posts[0]).toMatchObject({ followers: 1200, pageName: "Alpha", postedDate: "9/15/2026", profileId: alpha.id });
  });

  it("engagement off: post rows are stored as not_fetched and never enqueued", async () => {
    await service.importRowsAsBatch({ source: { ...source, fetchEngagement: false }, rows, userId: "u1", sourceType: "sheet" });
    expect(db.posts.every((p) => p.status === "not_fetched")).toBe(true);
    expect(added.some((j) => j.kind === "post")).toBe(false);
  });

  it("a re-import reusing done profiles settles those rows immediately and closes the batch", async () => {
    db.profiles.push({ id: "pr-old", username: "beta", sheetSourceId: "s1", status: "done" });
    const result = await service.importRowsAsBatch({ source, rows: [rows[2]], userId: "u1", sourceType: "sheet" });
    expect(result.batch.status).toBe("done");
    expect(result.batch.successCount).toBe(1);
    expect(added).toHaveLength(0);
  });

  it("checkSheetSourceForNewRows imports only rows not seen before", async () => {
    db.posts.push({ id: "po-old", permalink: rows[0].Post, sheetSourceId: "s1", profileId: "x", pageLink: rows[0].Page });
    fetchSheetRows.mockResolvedValue({ rows });
    const result = await service.checkSheetSourceForNewRows({ ...source, sheetUrl: "u", gid: "0", addedByUserId: "u1" });
    expect(result.newRowsFound).toBe(2); // r2 + beta's profile-only row
  });
});

describe("worker — counters and status mapping", () => {
  it("a post job saves a snapshot (with -1 'unknown' counts stored as 0), marks done and completes the batch", async () => {
    const batch = await mockPrisma.bulkImportBatch.create({ data: { totalCount: 1 } });
    const post = await mockPrisma.bulkTrackedPost.create({ data: { permalink: "https://www.instagram.com/p/x/", batchId: batch.id, pendingBatchId: batch.id, pendingWeight: 1 } });
    getPostMetrics.mockResolvedValue({ videoPlayCount: 0, likeCount: 12, commentsCount: -1, shares: -1, reposts: -1, saves: 3, postType: "post", pageName: "X" });

    await worker.processPost(post.id);
    expect(post).toMatchObject({ pendingBatchId: null, pendingWeight: 0 });
    expect(db.postSnaps[0]).toMatchObject({ views: 0, likes: 12, comments: 0, shares: 0, reposts: 0, saves: 3, pageName: "X" });
    expect(post).toMatchObject({ status: "done", postType: "post" });
    expect(batch).toMatchObject({ successCount: 1, status: "done" });
  });

  it("PostNotFoundError marks the post broken; any other error marks it failed — both count as failed rows", async () => {
    const batch = await mockPrisma.bulkImportBatch.create({ data: { totalCount: 2 } });
    const a = await mockPrisma.bulkTrackedPost.create({ data: { permalink: "a", pendingBatchId: batch.id, pendingWeight: 1 } });
    const b = await mockPrisma.bulkTrackedPost.create({ data: { permalink: "b", pendingBatchId: batch.id, pendingWeight: 1 } });
    // Broken: not retried. Transient: retried once, then fails for good.
    getPostMetrics.mockRejectedValueOnce(new PostNotFoundError("gone")).mockRejectedValueOnce(new Error("quota")).mockRejectedValueOnce(new Error("quota"));

    await worker.processPost(a.id);
    expect(batch.status).toBe("running");
    await worker.processPost(b.id);
    expect(getPostMetrics).toHaveBeenCalledTimes(3);
    expect(a).toMatchObject({ status: "broken", failureReason: "gone" });
    expect(b).toMatchObject({ status: "failed", failureReason: "quota" });
    expect(batch).toMatchObject({ failedCount: 2, status: "done" });
  });

  it("a refresh (no countBatchId) never touches the counters", async () => {
    const batch = await mockPrisma.bulkImportBatch.create({ data: { totalCount: 1, successCount: 1, status: "done" } });
    const post = await mockPrisma.bulkTrackedPost.create({ data: { permalink: "a", batchId: batch.id } });
    getPostMetrics.mockResolvedValue({ videoPlayCount: 50, likeCount: 1, commentsCount: 1, postType: "reel" });
    await worker.processPost(post.id);
    expect(batch.successCount).toBe(1);
  });

  it("a transient error that succeeds on retry counts once, as a success", async () => {
    const batch = await mockPrisma.bulkImportBatch.create({ data: { totalCount: 1 } });
    const post = await mockPrisma.bulkTrackedPost.create({ data: { permalink: "a", pendingBatchId: batch.id, pendingWeight: 1 } });
    getPostMetrics.mockRejectedValueOnce(new Error("rate limited")).mockResolvedValueOnce({ videoPlayCount: 9, likeCount: 1, commentsCount: 1, postType: "reel" });
    await worker.processPost(post.id);
    expect(post.status).toBe("done");
    expect(batch).toMatchObject({ successCount: 1, failedCount: 0, status: "done" });
  });

  it("regression (review, 12 Oct): after a restart a multi-row profile claim is recovered exactly and the batch completes", async () => {
    // One page settling 5 sheet rows (followers-only sheet), interrupted mid-scrape.
    const batch = await mockPrisma.bulkImportBatch.create({ data: { totalCount: 5 } });
    const profile = await mockPrisma.bulkTrackedProfile.create({ data: { username: "alpha", status: "queued", pendingBatchId: batch.id, pendingWeight: 5 } });
    await worker.recoverQueuedRows();
    expect(added).toEqual([{ kind: "profile", profileId: profile.id }]);
    getAccountMetrics.mockResolvedValue({ followers: 10, fullName: null });
    await worker.processProfile(profile.id);
    expect(batch).toMatchObject({ successCount: 5, status: "done" });
  });

  it("enqueue without a batch (refresh) clears any stale claim", async () => {
    const post = await mockPrisma.bulkTrackedPost.create({ data: { permalink: "a", pendingBatchId: "old", pendingWeight: 1 } });
    await worker.enqueuePost(post.id);
    expect(post).toMatchObject({ pendingBatchId: null, pendingWeight: 0 });
  });

  it("a profile job stores followers and the page name", async () => {
    const profile = await mockPrisma.bulkTrackedProfile.create({ data: { username: "alpha" } });
    getAccountMetrics.mockResolvedValue({ followers: 4200, fullName: "Alpha Page" });
    await worker.processProfile(profile.id);
    expect(getAccountMetrics).toHaveBeenCalledWith("alpha");
    expect(db.profileSnaps[0]).toMatchObject({ followers: 4200 });
    expect(profile).toMatchObject({ status: "done", pageName: "Alpha Page" });
  });

  it("count() turns unknown/negative values into 0", () => {
    expect(worker.count(-1)).toBe(0);
    expect(worker.count(null)).toBe(0);
    expect(worker.count(7)).toBe(7);
  });
});
