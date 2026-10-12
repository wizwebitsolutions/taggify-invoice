import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import express from "express";

// Bulk Tracker routes (12 Oct): every route is gated on the opt-in
// `bulkTrack.view` key — ADMIN by default, anyone else only with an explicit
// grant — and rows are scoped to the caller's own unless they're an ADMIN.
// Auth and the DB are mocked; the real service + permission code run.
const mockPrisma = {
  user: { findUnique: vi.fn() },
  bulkImportBatch: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
  bulkTrackedProfile: { findMany: vi.fn(), create: vi.fn() },
  bulkTrackedPost: { findMany: vi.fn(), create: vi.fn() },
  bulkImportSheetSource: { findMany: vi.fn(), count: vi.fn() },
  plan: { findFirst: vi.fn() },
};
vi.mock("../../lib/prisma.js", () => ({ prisma: mockPrisma }));

let currentUser;
vi.mock("../../middleware/requireAuth.js", () => ({
  requireAuth: (req, _res, next) => {
    req.user = currentUser;
    next();
  },
}));

const enqueuePost = vi.fn(async () => {});
const enqueueProfile = vi.fn(async () => {});
vi.mock("./worker.js", () => ({ enqueuePost: (...a) => enqueuePost(...a), enqueueProfile: (...a) => enqueueProfile(...a) }));

const { default: router } = await import("./routes.js");
const { errorHandler } = await import("../../middleware/errorHandler.js");

const app = express();
app.use(express.json());
app.use("/bulk-track", router);
app.use(errorHandler);
const server = await new Promise((resolve) => {
  const s = app.listen(0, () => resolve(s));
});
const base = `http://127.0.0.1:${server.address().port}`;
afterAll(() => server.close());

const ADMIN = { id: "adm-1", role: "ADMIN" };
const CREATOR = { id: "cr-1", role: "CREATOR" };
const GRANTED_CREATOR = { id: "cr-2", role: "CREATOR", permissions: { "bulkTrack.view": true } };
const FINANCE = { id: "fin-1", role: "FINANCE" };

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.user.findUnique.mockImplementation(async () => ({ role: currentUser.role, permissions: currentUser.permissions ?? null }));
  mockPrisma.bulkImportBatch.findMany.mockResolvedValue([]);
  mockPrisma.bulkTrackedPost.findMany.mockResolvedValue([]);
  mockPrisma.bulkTrackedProfile.findMany.mockResolvedValue([]);
  mockPrisma.bulkImportSheetSource.findMany.mockResolvedValue([]);
  mockPrisma.bulkImportSheetSource.count.mockResolvedValue(0);
  mockPrisma.plan.findFirst.mockResolvedValue(null);
});

async function call(user, method, path, body) {
  currentUser = user;
  const res = await fetch(`${base}/bulk-track${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const EVERY_ROUTE = [
  ["POST", "/batches", { postLinks: ["https://www.instagram.com/reel/abc/"] }],
  ["GET", "/batches"],
  ["GET", "/batches/b1"],
  ["GET", "/batches/b1/export"],
  ["POST", "/batches/b1/refresh"],
  ["DELETE", "/batches/b1"],
  ["GET", "/posts"],
  ["POST", "/posts/refresh"],
  ["POST", "/sheet-sources/preview", { sheetUrl: "https://docs.google.com/spreadsheets/d/abc/edit" }],
  ["POST", "/sheet-sources", { sheetUrl: "https://docs.google.com/spreadsheets/d/abc/edit", postLinkCol: "Link" }],
  ["GET", "/sheet-sources"],
  ["POST", "/sheet-sources/s1/check"],
  ["DELETE", "/sheet-sources/s1"],
];

describe("access — bulkTrack.view gates every route", () => {
  it.each(EVERY_ROUTE)("a CREATOR without the grant gets 403 on %s %s", async (method, path, body) => {
    const res = await call(CREATOR, method, path, body);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("a plain FINANCE account (not granted) is rejected too", async () => {
    expect((await call(FINANCE, "GET", "/batches")).status).toBe(403);
  });

  it("an ADMIN whose bulkTrack.view was switched off is rejected", async () => {
    expect((await call({ ...ADMIN, permissions: { "bulkTrack.view": false } }, "GET", "/batches")).status).toBe(403);
  });

  it("an ADMIN (default) and a granted CREATOR get in", async () => {
    expect((await call(ADMIN, "GET", "/batches")).status).toBe(200);
    expect((await call(GRANTED_CREATOR, "GET", "/batches")).status).toBe(200);
  });
});

describe("scope — non-admins only ever see their own rows", () => {
  it("ADMIN lists every batch; a granted creator lists only their own", async () => {
    await call(ADMIN, "GET", "/batches");
    expect(mockPrisma.bulkImportBatch.findMany.mock.calls[0][0].where).toEqual({});

    await call(GRANTED_CREATOR, "GET", "/batches");
    expect(mockPrisma.bulkImportBatch.findMany.mock.calls[1][0].where).toEqual({ createdByUserId: "cr-2" });
  });

  it("posts and sheet sources are scoped the same way", async () => {
    await call(GRANTED_CREATOR, "GET", "/posts");
    expect(mockPrisma.bulkTrackedPost.findMany.mock.calls[0][0].where).toEqual({ addedByUserId: "cr-2", sheetSourceId: null });
    await call(GRANTED_CREATOR, "GET", "/sheet-sources");
    expect(mockPrisma.bulkImportSheetSource.findMany.mock.calls[0][0].where).toEqual({ addedByUserId: "cr-2" });
  });

  it("a restricted sub-admin (granted, but not a full admin) only sees their own rows", async () => {
    await call({ id: "sub-1", role: "ADMIN", permissions: { "finance.pay": false } }, "GET", "/batches");
    expect(mockPrisma.bulkImportBatch.findMany.mock.calls[0][0].where).toEqual({ createdByUserId: "sub-1" });
  });

  it("someone else's batch is a 403; a missing one is a 404", async () => {
    mockPrisma.bulkImportBatch.findUnique.mockResolvedValueOnce({ id: "b1", createdByUserId: "someone-else" });
    expect((await call(GRANTED_CREATOR, "GET", "/batches/b1")).status).toBe(403);

    mockPrisma.bulkImportBatch.findUnique.mockResolvedValueOnce(null);
    expect((await call(GRANTED_CREATOR, "GET", "/batches/b1")).status).toBe(404);

    mockPrisma.bulkImportBatch.findUnique.mockResolvedValueOnce({ id: "b1", createdByUserId: "someone-else" });
    expect((await call(ADMIN, "GET", "/batches/b1")).status).toBe(200);
  });
});

describe("POST /batches — manual paste", () => {
  it("queues valid links, skips invalid ones, and counts only valid rows", async () => {
    mockPrisma.bulkImportBatch.create.mockResolvedValue({ id: "b9" });
    mockPrisma.bulkTrackedProfile.create.mockImplementation(async ({ data }) => ({ id: `pr-${data.username}`, ...data }));
    mockPrisma.bulkTrackedPost.create.mockImplementation(async ({ data }) => ({ id: "po-1", ...data }));

    const res = await call(GRANTED_CREATOR, "POST", "/batches", {
      profileLinks: ["https://www.instagram.com/some.page/", "https://www.instagram.com/reel/notaprofile/"],
      postLinks: ["https://www.instagram.com/reel/abc123/", "https://www.instagram.com/some.page/"],
    });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ batchId: "b9", queued: { profiles: 1, posts: 1 }, skipped: { profiles: 1, posts: 1 } });
    expect(mockPrisma.bulkImportBatch.create).toHaveBeenCalledWith({ data: { createdByUserId: "cr-2", sourceType: "manual", totalCount: 2 } });
    expect(enqueueProfile).toHaveBeenCalledWith("pr-some.page", { countBatchId: "b9", weight: 1 });
    expect(enqueuePost).toHaveBeenCalledWith("po-1", { countBatchId: "b9", weight: 1 });
  });

  it("400s when nothing pasted is a usable Instagram link", async () => {
    const res = await call(ADMIN, "POST", "/batches", { profileLinks: ["https://www.instagram.com/explore/"] });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/None of the links you pasted/);
    expect(mockPrisma.bulkImportBatch.create).not.toHaveBeenCalled();
  });

  it("rejects non-Instagram URLs and more than 50 links at validation", async () => {
    expect((await call(ADMIN, "POST", "/batches", { postLinks: ["https://example.com/p/abc"] })).status).toBe(400);
    const tooMany = Array.from({ length: 51 }, (_, i) => `https://www.instagram.com/reel/r${i}/`);
    expect((await call(ADMIN, "POST", "/batches", { postLinks: tooMany })).status).toBe(400);
  });
});

describe("sheet sources: internal sheets are refused", () => {
  it("the finance export spreadsheet and internal plan sheets can't be previewed", async () => {
    process.env.GOOGLE_FINANCE_SPREADSHEET_ID = "fin123";
    const fin = await call(GRANTED_CREATOR, "POST", "/sheet-sources/preview", { sheetUrl: "https://docs.google.com/spreadsheets/d/fin123/edit" });
    expect(fin.status).toBe(403);
    expect(fin.body.error.code).toBe("INTERNAL_SHEET");

    mockPrisma.plan.findFirst.mockResolvedValueOnce({ id: "plan-1" });
    const plan = await call(ADMIN, "POST", "/sheet-sources/preview", { sheetUrl: "https://docs.google.com/spreadsheets/d/planSheet9/edit#gid=0" });
    expect(plan.status).toBe(403);
    expect(mockPrisma.plan.findFirst.mock.calls[0][0].where).toEqual({ internalSheetUrl: { contains: "/d/planSheet9" } });
  });
});
