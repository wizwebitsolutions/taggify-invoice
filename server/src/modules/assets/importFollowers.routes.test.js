import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import express from "express";
import { ApiError, errorHandler } from "../../middleware/errorHandler.js";

// POST /assets/import/followers + GET /assets/import/followers/:jobId (3 Nov —
// 504 in production: the Instagram lookup outlasted DigitalOcean's ~100 s
// gateway, so it became a job the modal polls). Auth and the service are
// mocked; requireAccess runs for real against a mocked user row.
const mockPrisma = { user: { findUnique: vi.fn() } };
vi.mock("../../lib/prisma.js", () => ({ prisma: mockPrisma }));

let currentUser = { id: "admin-1", role: "ADMIN" };
vi.mock("../../middleware/requireAuth.js", () => ({
  requireAuth: (req, _res, next) => {
    req.user = currentUser;
    next();
  },
}));

const startImportFollowersJob = vi.fn(() => ({ jobId: "job-1" }));
const getImportFollowersJob = vi.fn();
vi.mock("./service.js", () => ({ startImportFollowersJob, getImportFollowersJob }));
vi.mock("../../lib/importPagesTemplate.js", () => ({ buildImportPagesTemplate: vi.fn() }));

const { default: router } = await import("./routes.js");

const app = express();
app.use(express.json());
app.use("/assets", router);
app.use(errorHandler);
const server = await new Promise((resolve) => {
  const s = app.listen(0, () => resolve(s));
});
const base = `http://127.0.0.1:${server.address().port}`;
afterAll(() => server.close());

beforeEach(() => {
  vi.clearAllMocks();
  currentUser = { id: "admin-1", role: "ADMIN" };
  mockPrisma.user.findUnique.mockImplementation(async () => ({ role: currentUser.role, permissions: null }));
});

const start = (body) => fetch(`${base}/assets/import/followers`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const poll = (jobId) => fetch(`${base}/assets/import/followers/${jobId}`);

describe("follower check as a polled job", () => {
  it("starting answers 202 with a job id at once, for the caller", async () => {
    const res = await start({ handles: ["a.page", "b.page"] });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ jobId: "job-1" });
    expect(startImportFollowersJob).toHaveBeenCalledWith("admin-1", ["a.page", "b.page"]);
  });

  it("polling returns running, then the profiles", async () => {
    getImportFollowersJob.mockReturnValueOnce({ status: "running" }).mockReturnValueOnce({ status: "done", profiles: { "a.page": null } });
    expect(await (await poll("job-1")).json()).toEqual({ status: "running" });
    expect(await (await poll("job-1")).json()).toEqual({ status: "done", profiles: { "a.page": null } });
    expect(getImportFollowersJob).toHaveBeenCalledWith("admin-1", "job-1");
  });

  it("a failed or unknown job comes back as its error", async () => {
    getImportFollowersJob.mockImplementation(() => {
      throw new ApiError(502, "FOLLOWERS_FETCH_FAILED", "Instagram is down");
    });
    const res = await poll("job-1");
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe("FOLLOWERS_FETCH_FAILED");
  });

  it("an empty handles list is a 400", async () => {
    expect((await start({ handles: [] })).status).toBe(400);
    expect(startImportFollowersJob).not.toHaveBeenCalled();
  });

  for (const role of ["FINANCE", "TEAM_MEMBER"]) {
    it(`${role} is refused on both start and poll`, async () => {
      currentUser = { id: `${role.toLowerCase()}-1`, role };
      expect((await start({ handles: ["a.page"] })).status).toBe(403);
      expect((await poll("job-1")).status).toBe(403);
      expect(startImportFollowersJob).not.toHaveBeenCalled();
      expect(getImportFollowersJob).not.toHaveBeenCalled();
    });
  }
});
