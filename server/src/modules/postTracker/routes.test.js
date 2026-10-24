import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import express from "express";

// Post Tracker routes (24 Oct): every route is gated on the opt-in
// `postTracker.view` key — ADMIN by default, anyone else only with an
// explicit grant — and cards are scoped to the caller's own unless they're a
// full admin. Auth and the DB are mocked; the real service + permission code run.
const mockPrisma = {
  user: { findUnique: vi.fn() },
  trackedPost: { findMany: vi.fn(), findUnique: vi.fn(), count: vi.fn(), createMany: vi.fn(), updateMany: vi.fn(), update: vi.fn(), delete: vi.fn() },
};
vi.mock("../../lib/prisma.js", () => ({ prisma: mockPrisma }));

let currentUser;
vi.mock("../../middleware/requireAuth.js", () => ({
  requireAuth: (req, _res, next) => {
    req.user = currentUser;
    next();
  },
}));

const { default: router } = await import("./routes.js");
const { errorHandler } = await import("../../middleware/errorHandler.js");

const app = express();
app.use(express.json());
app.use("/post-tracker", router);
app.use(errorHandler);
const server = await new Promise((resolve) => {
  const s = app.listen(0, () => resolve(s));
});
const base = `http://127.0.0.1:${server.address().port}`;
afterAll(() => server.close());

const ADMIN = { id: "adm-1", role: "ADMIN" };
const SUB_ADMIN = { id: "adm-2", role: "ADMIN", permissions: { "users.edit": false } };
const CREATOR = { id: "cr-1", role: "CREATOR" };
const GRANTED_CREATOR = { id: "cr-2", role: "CREATOR", permissions: { "postTracker.view": true } };
const BULK_ONLY_CREATOR = { id: "cr-3", role: "CREATOR", permissions: { "bulkTrack.view": true } };
const FINANCE = { id: "fin-1", role: "FINANCE" };
const PLAN_MAKER = { id: "pm-1", role: "PLAN_MAKER" };

const REEL = "https://www.instagram.com/reel/C9xYz_12-Ab/?igsh=abc";
const card = (over = {}) => ({
  id: "tp-1",
  createdById: "cr-2",
  inputUrl: REEL,
  canonicalUrl: "https://www.instagram.com/reel/C9xYz_12-Ab/",
  shortcode: "C9xYz_12-Ab",
  kind: "reel",
  note: null,
  broken: false,
  archivedAt: null,
  createdAt: new Date("2026-10-24T10:00:00Z"),
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.user.findUnique.mockImplementation(async () => ({ role: currentUser.role, permissions: currentUser.permissions ?? null }));
  mockPrisma.trackedPost.findMany.mockResolvedValue([]);
  mockPrisma.trackedPost.count.mockResolvedValue(0);
  mockPrisma.trackedPost.createMany.mockResolvedValue({ count: 0 });
  mockPrisma.trackedPost.updateMany.mockResolvedValue({ count: 0 });
  mockPrisma.trackedPost.findUnique.mockResolvedValue(card());
  mockPrisma.trackedPost.update.mockImplementation(async ({ data }) => card(data));
  mockPrisma.trackedPost.delete.mockResolvedValue(card());
});

async function call(user, method, path, body) {
  currentUser = user;
  const res = await fetch(`${base}/post-tracker${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const EVERY_ROUTE = [
  ["POST", "/", { urls: [REEL] }],
  ["GET", "/"],
  ["PATCH", "/tp-1", { broken: true }],
  ["DELETE", "/tp-1"],
];

describe("access", () => {
  it.each([CREATOR, FINANCE, PLAN_MAKER, BULK_ONLY_CREATOR])("rejects $role ($id) without the postTracker.view grant on every route", async (user) => {
    for (const [method, path, body] of EVERY_ROUTE) {
      const res = await call(user, method, path, body);
      expect(res.status, `${method} ${path}`).toBe(403);
    }
    expect(mockPrisma.trackedPost.createMany).not.toHaveBeenCalled();
    expect(mockPrisma.trackedPost.delete).not.toHaveBeenCalled();
  });

  it("rejects an admin whose postTracker.view was switched off", async () => {
    const res = await call({ id: "adm-3", role: "ADMIN", permissions: { "postTracker.view": false } }, "GET", "/");
    expect(res.status).toBe(403);
  });

  it("lets an admin and a granted creator in", async () => {
    expect((await call(ADMIN, "GET", "/")).status).toBe(200);
    expect((await call(GRANTED_CREATOR, "GET", "/")).status).toBe(200);
  });
});

describe("scope", () => {
  it("a granted creator only ever lists their own cards, even when asking for someone else's", async () => {
    await call(GRANTED_CREATOR, "GET", "/?addedBy=adm-1");
    expect(mockPrisma.trackedPost.findMany.mock.calls[0][0].where.createdById).toBe("cr-2");
  });

  it("a restricted sub-admin is scoped like everyone else", async () => {
    await call(SUB_ADMIN, "GET", "/");
    expect(mockPrisma.trackedPost.findMany.mock.calls[0][0].where.createdById).toBe("adm-2");
  });

  it("a full admin sees everyone's, and can filter by who added them", async () => {
    await call(ADMIN, "GET", "/");
    expect(mockPrisma.trackedPost.findMany.mock.calls[0][0].where.createdById).toBeUndefined();
    await call(ADMIN, "GET", "/?addedBy=cr-2");
    expect(mockPrisma.trackedPost.findMany.mock.calls[1][0].where.createdById).toBe("cr-2");
  });

  it("someone else's card is a 404 for update and delete", async () => {
    mockPrisma.trackedPost.findUnique.mockResolvedValue(card({ createdById: "someone-else" }));
    expect((await call(GRANTED_CREATOR, "PATCH", "/tp-1", { broken: true })).status).toBe(404);
    expect((await call(GRANTED_CREATOR, "DELETE", "/tp-1")).status).toBe(404);
    expect(mockPrisma.trackedPost.update).not.toHaveBeenCalled();
    expect(mockPrisma.trackedPost.delete).not.toHaveBeenCalled();
  });

  it("a full admin can tidy anyone's card", async () => {
    mockPrisma.trackedPost.findUnique.mockResolvedValue(card({ createdById: "someone-else" }));
    expect((await call(ADMIN, "PATCH", "/tp-1", { archived: true })).status).toBe(200);
  });
});

describe("POST / — adding links", () => {
  it("adds valid lines, reports duplicates and rejects with reasons", async () => {
    mockPrisma.trackedPost.findMany.mockResolvedValueOnce([{ shortcode: "OLDcode123" }]);
    const res = await call(GRANTED_CREATOR, "POST", "/", {
      urls: [REEL, "https://www.instagram.com/reels/C9xYz_12-Ab/", "https://www.instagram.com/p/OLDcode123/", "https://www.instagram.com/somepage/", "nope"],
      note: "Diwali drop",
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ created: 1, existing: 2, rejected: 2 });
    expect(res.body.results.map((r) => r.result)).toEqual(["created", "existing", "existing", "rejected", "rejected"]);
    expect(res.body.results[3].reason).toMatch(/profile link/);

    const { data, skipDuplicates } = mockPrisma.trackedPost.createMany.mock.calls[0][0];
    expect(skipDuplicates).toBe(true);
    expect(data).toEqual([
      { createdById: "cr-2", inputUrl: REEL, canonicalUrl: "https://www.instagram.com/reel/C9xYz_12-Ab/", shortcode: "C9xYz_12-Ab", kind: "reel", note: "Diwali drop" },
    ]);
    // Re-pasting an archived card brings it back.
    expect(mockPrisma.trackedPost.updateMany.mock.calls[0][0]).toEqual({
      where: { createdById: "cr-2", shortcode: { in: ["OLDcode123"] }, archivedAt: { not: null } },
      data: { archivedAt: null },
    });
  });

  it("writes nothing when every line is rejected", async () => {
    const res = await call(GRANTED_CREATOR, "POST", "/", { urls: ["https://www.instagram.com/stories/x/1/"] });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ created: 0, existing: 0, rejected: 1 });
    expect(mockPrisma.trackedPost.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.trackedPost.createMany).not.toHaveBeenCalled();
  });

  it("caps a paste at 50 links", async () => {
    const res = await call(GRANTED_CREATOR, "POST", "/", { urls: Array.from({ length: 51 }, (_, i) => `https://www.instagram.com/p/code${i}xx/`) });
    expect(res.status).toBe(400);
  });
});

describe("GET / and PATCH", () => {
  it("returns cards with the embed link rebuilt from the shortcode, plus tab counts", async () => {
    mockPrisma.trackedPost.findMany.mockResolvedValue([card({ createdBy: { id: "cr-2", name: "Asha", email: "a@x.in" } })]);
    mockPrisma.trackedPost.count.mockResolvedValue(1);
    const res = await call(GRANTED_CREATOR, "GET", "/?status=broken&q=diwali");
    expect(res.status).toBe(200);
    expect(res.body.items[0]).toMatchObject({ embedUrl: "https://www.instagram.com/reel/C9xYz_12-Ab/embed/captioned/", createdBy: { id: "cr-2", name: "Asha" } });
    expect(res.body.items[0].inputUrl).toBeUndefined();
    expect(res.body.counts).toEqual({ all: 1, ok: 1, broken: 1, archived: 1 });
    const where = mockPrisma.trackedPost.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ createdById: "cr-2", archivedAt: null, broken: true });
    expect(where.OR[0]).toEqual({ note: { contains: "diwali", mode: "insensitive" } });
  });

  it("marks broken, archives and restores", async () => {
    await call(GRANTED_CREATOR, "PATCH", "/tp-1", { broken: true });
    expect(mockPrisma.trackedPost.update.mock.calls[0][0].data).toEqual({ broken: true });
    await call(GRANTED_CREATOR, "PATCH", "/tp-1", { archived: true });
    expect(mockPrisma.trackedPost.update.mock.calls[1][0].data.archivedAt).toBeInstanceOf(Date);
    await call(GRANTED_CREATOR, "PATCH", "/tp-1", { archived: false });
    expect(mockPrisma.trackedPost.update.mock.calls[2][0].data).toEqual({ archivedAt: null });
  });

  it("only deletes an archived card — a live one must be archived first", async () => {
    expect((await call(GRANTED_CREATOR, "DELETE", "/tp-1")).status).toBe(409);
    expect(mockPrisma.trackedPost.delete).not.toHaveBeenCalled();
    mockPrisma.trackedPost.findUnique.mockResolvedValue(card({ archivedAt: new Date() }));
    expect((await call(GRANTED_CREATOR, "DELETE", "/tp-1")).status).toBe(200);
    expect(mockPrisma.trackedPost.delete).toHaveBeenCalledWith({ where: { id: "tp-1" } });
  });

  it("rejects an empty update", async () => {
    expect((await call(GRANTED_CREATOR, "PATCH", "/tp-1", {})).status).toBe(400);
  });
});
