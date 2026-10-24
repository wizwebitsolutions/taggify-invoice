import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import express from "express";
import { ApiError, errorHandler } from "../../middleware/errorHandler.js";

// GET /links/:id/thumbnail (22 Oct) — the post cover an <img> tag hotlinks.
// The service is mocked; what's under test is the redirect to the stored
// copy, the proxy fallback, the cache headers, and that the route stays
// public (an <img> can't send our Authorization header) while every other
// links route still goes through requireAuth.
const requireAuthSpy = vi.fn((_req, res) => res.status(401).json({ error: { code: "UNAUTHENTICATED" } }));
vi.mock("../../middleware/requireAuth.js", () => ({ requireAuth: requireAuthSpy }));
vi.mock("../../lib/prisma.js", () => ({ prisma: {} }));

const getPostThumbnailSource = vi.fn();
vi.mock("./thumbnail.js", () => ({ getPostThumbnailSource }));
vi.mock("./service.js", () => ({}));

const { default: router } = await import("./routes.js");

const app = express();
app.use("/links", router);
app.use(errorHandler);
const server = await new Promise((resolve) => {
  const s = app.listen(0, () => resolve(s));
});
const base = `http://127.0.0.1:${server.address().port}`;
afterAll(() => server.close());

beforeEach(() => vi.clearAllMocks());

const get = (id) => fetch(`${base}/links/${id}/thumbnail`, { redirect: "manual" });

describe("GET /links/:id/thumbnail", () => {
  it("redirects to the stored Cloudinary copy, cached for a day, without auth", async () => {
    getPostThumbnailSource.mockResolvedValue({ redirect: "https://res.cloudinary.com/demo/image/upload/v1/post-thumbnails/l1.jpg" });

    const res = await get("l1");

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://res.cloudinary.com/demo/image/upload/v1/post-thumbnails/l1.jpg");
    expect(res.headers.get("cache-control")).toBe("public, max-age=86400");
    expect(res.headers.get("cross-origin-resource-policy")).toBe("cross-origin");
    expect(requireAuthSpy).not.toHaveBeenCalled();
  });

  it("falls back to proxying the image bytes when nothing is stored yet", async () => {
    getPostThumbnailSource.mockResolvedValue({ buffer: Buffer.from([1, 2, 3]), contentType: "image/png" });

    const res = await get("l2");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cross-origin-resource-policy")).toBe("cross-origin");
    expect(Buffer.from(await res.arrayBuffer())).toEqual(Buffer.from([1, 2, 3]));
  });

  it("404s briefly-cached for a link with no thumbnail yet", async () => {
    getPostThumbnailSource.mockRejectedValue(new ApiError(404, "NO_THUMBNAIL", "This post has no thumbnail yet"));

    const res = await get("l3");

    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("public, max-age=600");
  });

  it("leaves every other links route behind requireAuth", async () => {
    const res = await fetch(`${base}/links/l1/timeline`);
    expect(res.status).toBe(401);
    expect(requireAuthSpy).toHaveBeenCalled();
  });
});
