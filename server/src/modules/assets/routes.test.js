import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import express from "express";
import { ApiError, errorHandler } from "../../middleware/errorHandler.js";

// GET /assets/:id/profile-pic caching (design-fix #5, 7 Oct — page photos are
// on nearly every screen, so they must not be re-fetched from the API each
// time). The service is mocked; what's under test is the redirect to the
// stored copy, the proxy fallback, the cache headers, and that the route
// stays public (an <img> can't send our Authorization header).
const requireAuthSpy = vi.fn((_req, res) => res.status(401).json({ error: { code: "UNAUTHENTICATED" } }));
vi.mock("../../middleware/requireAuth.js", () => ({ requireAuth: requireAuthSpy }));
vi.mock("../../lib/prisma.js", () => ({ prisma: {} }));

const getProfilePicSource = vi.fn();
vi.mock("./service.js", () => ({ getProfilePicSource }));
vi.mock("../../lib/importPagesTemplate.js", () => ({ buildImportPagesTemplate: vi.fn() }));

const { default: router } = await import("./routes.js");

const app = express();
app.use("/assets", router);
app.use(errorHandler);
const server = await new Promise((resolve) => {
  const s = app.listen(0, () => resolve(s));
});
const base = `http://127.0.0.1:${server.address().port}`;
afterAll(() => server.close());

beforeEach(() => vi.clearAllMocks());

const get = (id) => fetch(`${base}/assets/${id}/profile-pic`, { redirect: "manual" });

describe("GET /assets/:id/profile-pic", () => {
  it("redirects to the stored Cloudinary copy, cached for a day, without auth", async () => {
    getProfilePicSource.mockResolvedValue({ redirect: "https://res.cloudinary.com/demo/image/upload/v1/profile-pics/a1.jpg" });

    const res = await get("a1");

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://res.cloudinary.com/demo/image/upload/v1/profile-pics/a1.jpg");
    expect(res.headers.get("cache-control")).toBe("public, max-age=86400");
    expect(res.headers.get("cross-origin-resource-policy")).toBe("cross-origin");
    expect(requireAuthSpy).not.toHaveBeenCalled();
  });

  it("falls back to proxying the picture bytes when nothing is stored yet", async () => {
    getProfilePicSource.mockResolvedValue({ buffer: Buffer.from([1, 2, 3]), contentType: "image/png" });

    const res = await get("a2");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("public, max-age=86400");
    expect(Buffer.from(await res.arrayBuffer())).toEqual(Buffer.from([1, 2, 3]));
  });

  it("a page with no picture yet is a 404 cached for 10 minutes, so lists don't re-ask on every render", async () => {
    getProfilePicSource.mockRejectedValue(new ApiError(404, "NO_PROFILE_PIC", "This page has no profile picture yet"));

    const res = await get("a3");

    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("public, max-age=600");
  });

  it("a failed fetch (502) is not cached", async () => {
    getProfilePicSource.mockRejectedValue(new ApiError(502, "PROFILE_PIC_FETCH_FAILED", "boom"));

    const res = await get("a4");

    expect(res.status).toBe(502);
    expect(res.headers.get("cache-control")).toBeNull();
  });
});
