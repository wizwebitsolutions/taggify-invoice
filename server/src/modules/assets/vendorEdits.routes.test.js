import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import express from "express";
import { errorHandler } from "../../middleware/errorHandler.js";

// Vendor edit routes (13 Nov): who may edit directly, suggest, and decide.
// Auth and the service are mocked; requireRole/requireAccess run for real
// against a mocked user row (permissions: null = the role's defaults).
const mockPrisma = { user: { findUnique: vi.fn() } };
vi.mock("../../lib/prisma.js", () => ({ prisma: mockPrisma }));

let currentUser;
vi.mock("../../middleware/requireAuth.js", () => ({
  requireAuth: (req, _res, next) => {
    req.user = currentUser;
    next();
  },
}));

const editVendor = vi.fn(async () => ({ id: "v-1" }));
const proposeVendorEdit = vi.fn(async () => ({ id: "v-1" }));
const decideVendorEdit = vi.fn(async () => ({ id: "v-1" }));
vi.mock("./vendorEdits.js", () => ({ editVendor, proposeVendorEdit, decideVendorEdit }));
vi.mock("./service.js", () => ({}));
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

const as = (role) => {
  currentUser = { id: `${role.toLowerCase()}-1`, role };
};
beforeEach(() => {
  vi.clearAllMocks();
  as("ADMIN");
  mockPrisma.user.findUnique.mockImplementation(async () => ({ id: currentUser.id, role: currentUser.role, permissions: null, deactivatedAt: null }));
});

const put = (path, body) => fetch(`${base}/assets/vendors/v-1${path}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("PUT /assets/vendors/:id (direct edit)", () => {
  it("an admin can edit", async () => {
    expect((await put("", { name: "Riya Kapoor" })).status).toBe(200);
    expect(editVendor).toHaveBeenCalledWith(expect.objectContaining({ id: "admin-1" }), "v-1", { name: "Riya Kapoor" });
  });

  for (const role of ["PLAN_MAKER", "FINANCE", "CREATOR", "TEAM_MEMBER"]) {
    it(`${role} is refused`, async () => {
      as(role);
      expect((await put("", { name: "x" })).status).toBe(403);
      expect(editVendor).not.toHaveBeenCalled();
    });
  }

  it("rejects a badly formatted phone and unknown fields", async () => {
    expect((await put("", { phoneNumber: "98765" })).status).toBe(400);
    expect((await put("", { email: "a@b.c" })).status).toBe(400);
    expect(editVendor).not.toHaveBeenCalled();
  });
});

describe("PUT /assets/vendors/:id/propose-edit", () => {
  it("a plan maker can suggest", async () => {
    as("PLAN_MAKER");
    expect((await put("/propose-edit", { phoneNumber: "+919876543210" })).status).toBe(200);
    expect(proposeVendorEdit).toHaveBeenCalled();
  });

  for (const role of ["FINANCE", "TEAM_MEMBER"]) {
    it(`${role} is refused`, async () => {
      as(role);
      expect((await put("/propose-edit", { name: "x" })).status).toBe(403);
      expect(proposeVendorEdit).not.toHaveBeenCalled();
    });
  }
});

describe("PUT /assets/vendors/:id/edit-decision", () => {
  it("an admin can decide", async () => {
    expect((await put("/edit-decision", { decision: "approve" })).status).toBe(200);
    expect(decideVendorEdit).toHaveBeenCalledWith(expect.objectContaining({ id: "admin-1" }), "v-1", "approve");
  });

  for (const role of ["PLAN_MAKER", "FINANCE", "CREATOR"]) {
    it(`${role} is refused`, async () => {
      as(role);
      expect((await put("/edit-decision", { decision: "approve" })).status).toBe(403);
      expect(decideVendorEdit).not.toHaveBeenCalled();
    });
  }
});
