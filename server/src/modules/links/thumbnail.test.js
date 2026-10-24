import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Post thumbnails stored in Cloudinary (22 Oct — "instagram reel thumbnail is
 * not showing": the browser hotlinked Apify's signed cdninstagram.com link,
 * which expires in about a week). storePostThumbnail copies the image right
 * after a scrape; getPostThumbnailSource (what GET /links/:id/thumbnail
 * serves) prefers that copy and proxies Instagram only until it exists.
 */
const mockPrisma = { postSnapshot: { findFirst: vi.fn(), update: vi.fn(async () => ({})) } };
vi.mock("../../lib/prisma.js", () => ({ prisma: mockPrisma }));
const uploadPostThumbnail = vi.fn();
let cloudinaryConfigured = true;
vi.mock("../../lib/cloudinaryClient.js", () => ({ uploadPostThumbnail: (...a) => uploadPostThumbnail(...a), isCloudinaryConfigured: () => cloudinaryConfigured }));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const { storePostThumbnail, getPostThumbnailSource } = await import("./thumbnail.js");

const IG = "https://scontent-cph2-1.cdninstagram.com/v/t51.82787-15/cover.jpg?oe=6ADFAC6D";
const STORED = "https://res.cloudinary.com/demo/image/upload/v1/post-thumbnails/l1.jpg";
const image = (bytes = "img") => ({ ok: true, status: 200, headers: { get: () => "image/jpeg" }, arrayBuffer: async () => new TextEncoder().encode(bytes).buffer });
const failing = (status) => ({ ok: false, status, headers: { get: () => null } });

beforeEach(() => {
  vi.clearAllMocks();
  cloudinaryConfigured = true;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("storePostThumbnail", () => {
  it("downloads the Instagram cover, uploads it under the link's fixed id, and saves the stored link on the snapshot", async () => {
    mockFetch.mockResolvedValue(image());
    uploadPostThumbnail.mockResolvedValue(STORED);

    await storePostThumbnail("s1", "l1", IG);

    expect(mockFetch).toHaveBeenCalledWith(IG, expect.anything());
    expect(uploadPostThumbnail).toHaveBeenCalledWith("l1", expect.any(Buffer));
    expect(mockPrisma.postSnapshot.update).toHaveBeenCalledWith({ where: { id: "s1" }, data: { thumbnailStoredUrl: STORED } });
  });

  it("does nothing when the scrape had no thumbnail or Cloudinary isn't configured", async () => {
    await storePostThumbnail("s1", "l1", null);
    cloudinaryConfigured = false;
    await storePostThumbnail("s1", "l1", IG);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(uploadPostThumbnail).not.toHaveBeenCalled();
  });

  it("never throws — a Cloudinary failure just leaves the snapshot without a stored copy", async () => {
    mockFetch.mockResolvedValue(image());
    uploadPostThumbnail.mockRejectedValue(new Error("cloudinary down"));

    await expect(storePostThumbnail("s1", "l1", IG)).resolves.toBeUndefined();
    expect(mockPrisma.postSnapshot.update).not.toHaveBeenCalled();
  });
});

describe("getPostThumbnailSource", () => {
  it("redirects to the stored copy when the latest snapshot has one", async () => {
    mockPrisma.postSnapshot.findFirst.mockResolvedValue({ thumbnailUrl: IG, thumbnailStoredUrl: STORED });
    await expect(getPostThumbnailSource("l1")).resolves.toEqual({ redirect: STORED });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockPrisma.postSnapshot.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { linkId: "l1", thumbnailUrl: { not: null } }, orderBy: { capturedAt: "desc" } }));
  });

  it("proxies Instagram, retrying a flaky edge response, when nothing is stored yet", async () => {
    mockPrisma.postSnapshot.findFirst.mockResolvedValue({ thumbnailUrl: IG, thumbnailStoredUrl: null });
    mockFetch.mockResolvedValueOnce(failing(503)).mockResolvedValueOnce(image("bytes"));

    const result = await getPostThumbnailSource("l2");

    expect(result.contentType).toBe("image/jpeg");
    expect(Buffer.from(result.buffer).toString()).toBe("bytes");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("404s a link no scrape has produced a thumbnail for", async () => {
    mockPrisma.postSnapshot.findFirst.mockResolvedValue(null);
    await expect(getPostThumbnailSource("l3")).rejects.toMatchObject({ statusCode: 404, code: "NO_THUMBNAIL" });
  });

  it("502s when Instagram keeps failing and nothing is stored", async () => {
    mockPrisma.postSnapshot.findFirst.mockResolvedValue({ thumbnailUrl: IG, thumbnailStoredUrl: null });
    mockFetch.mockResolvedValue(failing(403));
    await expect(getPostThumbnailSource("l4")).rejects.toMatchObject({ statusCode: 502, code: "THUMBNAIL_FETCH_FAILED" });
  });
});
