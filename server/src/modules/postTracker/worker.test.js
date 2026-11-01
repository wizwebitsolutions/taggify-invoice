import { describe, it, expect, vi, beforeEach } from "vitest";

// Capture worker (24 Oct): what each outcome of a capture does to the card.
// The browser, Cloudinary and the DB are mocked.
const mockPrisma = { trackedPost: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() } };
vi.mock("../../lib/prisma.js", () => ({ prisma: mockPrisma }));

const upload = vi.fn(async (id, name) => `https://res.cloudinary.com/x/post-tracker/${id}/${name}.png`);
vi.mock("../../lib/cloudinaryClient.js", () => ({ uploadTrackedPostImage: (...a) => upload(...a) }));
const download = vi.fn(async () => ({ buffer: Buffer.from("jpg"), contentType: "image/jpeg" }));
vi.mock("../../lib/downloadImage.js", () => ({ downloadImage: (...a) => download(...a) }));

const capture = vi.fn();
vi.mock("./capture.js", async () => {
  class PostUnavailableError extends Error {}
  class LoginWallError extends Error {}
  return { captureSnapshot: (...a) => capture(...a), PostUnavailableError, LoginWallError };
});

const { processCapture } = await import("./worker.js");
const { PostUnavailableError, LoginWallError } = await import("./capture.js");

const post = (over = {}) => ({ id: "tp-1", canonicalUrl: "https://www.instagram.com/reel/C9xYz_12-Ab/", captureStatus: "queued", captureCount: 0, archivedAt: null, coverUrl: null, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  mockPrisma.trackedPost.findUnique.mockResolvedValue(post());
  mockPrisma.trackedPost.update.mockResolvedValue({});
});

describe("processCapture", () => {
  it("stores the screenshot, the cover and the counts", async () => {
    capture.mockResolvedValue({ screenshot: Buffer.from("png"), coverImageUrl: "https://cdn.example/c.jpg", likeCount: 186, commentCount: 67, viewCount: 17200, ownerHandle: "huz", postedOn: "October 23, 2026", caption: "hi" });
    await processCapture("tp-1");
    expect(upload).toHaveBeenCalledWith("tp-1", "screen", expect.any(Buffer));
    expect(upload).toHaveBeenCalledWith("tp-1", "cover", expect.any(Buffer));
    const { data } = mockPrisma.trackedPost.update.mock.calls[0][0];
    expect(data).toMatchObject({
      captureStatus: "done",
      captureError: null,
      captureCount: 0,
      screenshotUrl: "https://res.cloudinary.com/x/post-tracker/tp-1/screen.png",
      coverUrl: "https://res.cloudinary.com/x/post-tracker/tp-1/cover.png",
      likeCount: 186,
      commentCount: 67,
      viewCount: 17200,
      ownerHandle: "huz",
      broken: false,
    });
    expect(data.capturedAt).toBeInstanceOf(Date);
  });

  it("keeps the snapshot when only the cover copy fails", async () => {
    capture.mockResolvedValue({ screenshot: Buffer.from("png"), coverImageUrl: "https://cdn.example/c.jpg", likeCount: 1, commentCount: 1, ownerHandle: "h", postedOn: null, caption: null });
    download.mockRejectedValueOnce(new Error("403"));
    await processCapture("tp-1");
    expect(mockPrisma.trackedPost.update.mock.calls[0][0].data).toMatchObject({ captureStatus: "done", coverUrl: null });
  });

  it("a deleted/private post is marked unavailable and broken, without retrying", async () => {
    capture.mockRejectedValue(new PostUnavailableError("gone"));
    await processCapture("tp-1");
    expect(mockPrisma.trackedPost.update.mock.calls[0][0].data).toEqual({ captureStatus: "unavailable", captureError: "gone", captureCount: 0, broken: true });
  });

  it("a login wall is retried later, then reported after 3 attempts", async () => {
    capture.mockRejectedValue(new LoginWallError("Instagram asked for a login instead of showing the post"));
    await processCapture("tp-1");
    expect(mockPrisma.trackedPost.update.mock.calls[0][0].data).toEqual({ captureError: "Instagram asked for a login instead of showing the post", captureCount: 1 });

    mockPrisma.trackedPost.findUnique.mockResolvedValue(post({ captureCount: 2 }));
    await processCapture("tp-1");
    expect(mockPrisma.trackedPost.update.mock.calls[1][0].data).toEqual({ captureStatus: "failed", captureError: "Instagram asked for a login instead of showing the post", captureCount: 3 });
  });

  it("skips cards that were archived, deleted or already captured", async () => {
    for (const row of [null, post({ archivedAt: new Date() }), post({ captureStatus: "done" })]) {
      mockPrisma.trackedPost.findUnique.mockResolvedValueOnce(row);
      await processCapture("tp-1");
    }
    expect(capture).not.toHaveBeenCalled();
    expect(mockPrisma.trackedPost.update).not.toHaveBeenCalled();
  });
});
