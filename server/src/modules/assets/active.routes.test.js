import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import express from "express";
import { errorHandler } from "../../middleware/errorHandler.js";

// PUT /assets/:id/active (8 Oct) — an admin marks a page Active / Inactive.
// Auth and the service are mocked; requireRole + requireAccess run for real
// against a mocked user row, so a wrong role is refused before the service runs.
const mockPrisma = { user: { findUnique: vi.fn() } };
vi.mock("../../lib/prisma.js", () => ({ prisma: mockPrisma }));

let currentUser = { id: "admin-1", role: "ADMIN" };
let storedPermissions = null;
vi.mock("../../middleware/requireAuth.js", () => ({
  requireAuth: (req, _res, next) => {
    req.user = currentUser;
    next();
  },
}));

const setAssetActive = vi.fn(async (id, isActive) => ({ id, isActive }));
vi.mock("./service.js", () => ({ setAssetActive }));
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
  storedPermissions = null;
  mockPrisma.user.findUnique.mockImplementation(async () => ({ role: currentUser.role, permissions: storedPermissions }));
});

const put = (body) => fetch(`${base}/assets/a1/active`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("PUT /assets/:id/active", () => {
  it("an admin can mark a page inactive and active again", async () => {
    currentUser = { id: "admin-1", role: "ADMIN" };
    expect((await put({ isActive: false })).status).toBe(200);
    expect(setAssetActive).toHaveBeenLastCalledWith("a1", false);
    expect((await put({ isActive: true })).status).toBe(200);
    expect(setAssetActive).toHaveBeenLastCalledWith("a1", true);
  });

  for (const role of ["CREATOR", "TEAM_MEMBER", "FINANCE", "PLAN_MAKER"]) {
    it(`${role} is refused`, async () => {
      currentUser = { id: `${role.toLowerCase()}-1`, role };
      expect((await put({ isActive: false })).status).toBe(403);
      expect(setAssetActive).not.toHaveBeenCalled();
    });
  }

  it("a restricted admin without Creators edit access is refused", async () => {
    currentUser = { id: "admin-2", role: "ADMIN" };
    storedPermissions = { "inventory.edit": false };
    expect((await put({ isActive: false })).status).toBe(403);
    expect(setAssetActive).not.toHaveBeenCalled();
  });

  it("a body without a true/false isActive is a 400", async () => {
    currentUser = { id: "admin-1", role: "ADMIN" };
    expect((await put({ isActive: "no" })).status).toBe(400);
    expect(setAssetActive).not.toHaveBeenCalled();
  });
});
