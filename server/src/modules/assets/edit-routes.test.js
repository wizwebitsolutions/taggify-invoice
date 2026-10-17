import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import express from "express";
import { errorHandler } from "../../middleware/errorHandler.js";

// 16 Oct — three Inventory routes:
//   DELETE /assets/:id                 admin only (role + inventory.edit)
//   PUT    /assets/:id/propose-edit    a planner's suggested edit (own inventory.edit switch)
//   PUT    /assets/:id/edit-decision   admin applies / discards it (inventory.approve)
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

const deleteAsset = vi.fn(async (id) => ({ id }));
const proposeAssetEdit = vi.fn(async (_user, id, fields) => ({ id, pendingEdit: fields }));
const decideAssetEdit = vi.fn(async (id, decision) => ({ id, decision }));
vi.mock("./service.js", () => ({ deleteAsset, proposeAssetEdit, decideAssetEdit }));
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

const del = () => fetch(`${base}/assets/a1`, { method: "DELETE" });
const propose = (body) => fetch(`${base}/assets/a1/propose-edit`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const decide = (body) => fetch(`${base}/assets/a1/edit-decision`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("DELETE /assets/:id", () => {
  it("an admin can delete a page", async () => {
    currentUser = { id: "admin-1", role: "ADMIN" };
    expect((await del()).status).toBe(200);
    expect(deleteAsset).toHaveBeenCalledWith("a1");
  });

  for (const role of ["CREATOR", "TEAM_MEMBER", "FINANCE", "PLAN_MAKER"]) {
    it(`${role} is refused`, async () => {
      currentUser = { id: `${role.toLowerCase()}-1`, role };
      expect((await del()).status).toBe(403);
      expect(deleteAsset).not.toHaveBeenCalled();
    });
  }

  it("a restricted admin without Inventory edit access is refused", async () => {
    currentUser = { id: "admin-2", role: "ADMIN" };
    storedPermissions = { "inventory.edit": false };
    expect((await del()).status).toBe(403);
    expect(deleteAsset).not.toHaveBeenCalled();
  });
});

describe("PUT /assets/:id/propose-edit", () => {
  it("a plan maker can propose an edit; the body is validated and passed through", async () => {
    currentUser = { id: "pm-1", role: "PLAN_MAKER" };
    const res = await propose({ grade: "b", category: "News page", rateCards: [{ format: "reel", amount: 7000 }] });
    expect(res.status).toBe(200);
    expect(proposeAssetEdit).toHaveBeenCalledWith(currentUser, "a1", { grade: "B", category: "News page", rateCards: [{ format: "reel", amount: 7000 }] });
  });

  it("a plan maker whose admin switched Inventory edit off is refused", async () => {
    currentUser = { id: "pm-2", role: "PLAN_MAKER" };
    storedPermissions = { "inventory.edit": false };
    expect((await propose({ grade: "A" })).status).toBe(403);
    expect(proposeAssetEdit).not.toHaveBeenCalled();
  });

  for (const role of ["CREATOR", "TEAM_MEMBER", "FINANCE"]) {
    it(`${role} is refused`, async () => {
      currentUser = { id: `${role.toLowerCase()}-1`, role };
      expect((await propose({ grade: "A" })).status).toBe(403);
      expect(proposeAssetEdit).not.toHaveBeenCalled();
    });
  }

  it("an empty body, a bad grade or a non-URL group link is a 400", async () => {
    currentUser = { id: "pm-1", role: "PLAN_MAKER" };
    expect((await propose({})).status).toBe(400);
    expect((await propose({ grade: "Z" })).status).toBe(400);
    expect((await propose({ groupLink: "not a link" })).status).toBe(400);
    expect(proposeAssetEdit).not.toHaveBeenCalled();
  });
});

describe("PUT /assets/:id/edit-decision", () => {
  it("an admin can approve or reject", async () => {
    currentUser = { id: "admin-1", role: "ADMIN" };
    expect((await decide({ decision: "approve" })).status).toBe(200);
    expect(decideAssetEdit).toHaveBeenLastCalledWith("a1", "approve");
    expect((await decide({ decision: "reject" })).status).toBe(200);
    expect(decideAssetEdit).toHaveBeenLastCalledWith("a1", "reject");
  });

  for (const role of ["CREATOR", "TEAM_MEMBER", "FINANCE", "PLAN_MAKER"]) {
    it(`${role} is refused`, async () => {
      currentUser = { id: `${role.toLowerCase()}-1`, role };
      expect((await decide({ decision: "approve" })).status).toBe(403);
      expect(decideAssetEdit).not.toHaveBeenCalled();
    });
  }

  it("a Finance account granted inventory.approve may decide", async () => {
    currentUser = { id: "fin-1", role: "FINANCE" };
    storedPermissions = { "inventory.approve": true };
    expect((await decide({ decision: "reject" })).status).toBe(200);
  });

  it("anything but approve/reject is a 400", async () => {
    currentUser = { id: "admin-1", role: "ADMIN" };
    expect((await decide({ decision: "maybe" })).status).toBe(400);
    expect(decideAssetEdit).not.toHaveBeenCalled();
  });
});
