import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import express from "express";

// DELETE /links/:id (12 Oct): staff with links.edit only. Auth, the DB and the
// service are mocked; what's under test is which accounts the router lets through.
const mockPrisma = { user: { findUnique: vi.fn() } };
vi.mock("../../lib/prisma.js", () => ({ prisma: mockPrisma }));

let currentUser;
vi.mock("../../middleware/requireAuth.js", () => ({
  requireAuth: (req, _res, next) => {
    req.user = currentUser;
    next();
  },
}));

const deleteLink = vi.fn(async (id) => ({ id }));
vi.mock("./service.js", () => ({ deleteLink: (...a) => deleteLink(...a) }));

const { default: router } = await import("./routes.js");
const { errorHandler } = await import("../../middleware/errorHandler.js");

const app = express();
app.use(express.json());
app.use("/links", router);
app.use(errorHandler);
const server = await new Promise((resolve) => {
  const s = app.listen(0, () => resolve(s));
});
const base = `http://127.0.0.1:${server.address().port}`;
afterAll(() => server.close());

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.user.findUnique.mockImplementation(async () => ({ role: currentUser.role, permissions: currentUser.permissions ?? null }));
});

async function del(user) {
  currentUser = user;
  const res = await fetch(`${base}/links/l1`, { method: "DELETE" });
  return res.status;
}

describe("DELETE /links/:id", () => {
  it("a creator, a team member and a planner are refused", async () => {
    expect(await del({ id: "cr-1", role: "CREATOR" })).toBe(403);
    expect(await del({ id: "tm-1", role: "TEAM_MEMBER" })).toBe(403);
    expect(await del({ id: "pm-1", role: "PLAN_MAKER" })).toBe(403);
    expect(deleteLink).not.toHaveBeenCalled();
  });

  it("finance (no links.edit) and an admin with links.edit switched off are refused", async () => {
    expect(await del({ id: "fi-1", role: "FINANCE" })).toBe(403);
    expect(await del({ id: "ad-2", role: "ADMIN", permissions: { "links.edit": false } })).toBe(403);
    expect(deleteLink).not.toHaveBeenCalled();
  });

  it("an admin, and finance granted links.edit, reach the service", async () => {
    expect(await del({ id: "ad-1", role: "ADMIN" })).toBe(200);
    expect(await del({ id: "fi-2", role: "FINANCE", permissions: { "links.edit": true } })).toBe(200);
    expect(deleteLink).toHaveBeenCalledWith("l1");
  });

  it("passes the service's 409 through", async () => {
    const { ApiError } = await import("../../middleware/errorHandler.js");
    deleteLink.mockRejectedValueOnce(new ApiError(409, "ALREADY_INVOICED", "on an invoice"));
    expect(await del({ id: "ad-1", role: "ADMIN" })).toBe(409);
  });
});
