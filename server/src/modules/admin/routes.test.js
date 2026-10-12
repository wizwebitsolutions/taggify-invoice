import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import express from "express";

// The two People → Edit details routes (12 Oct): a wrong-role request is
// rejected before the service ever runs (CLAUDE.md: every new route needs
// this test). The full-admin-only rule itself is covered in service.test.js.
const mockPrisma = { user: { findUnique: vi.fn() } };
vi.mock("../../lib/prisma.js", () => ({ prisma: mockPrisma }));

let currentUser;
vi.mock("../../middleware/requireAuth.js", () => ({
  requireAuth: (req, _res, next) => {
    req.user = currentUser;
    next();
  },
}));

const updateUserDetails = vi.fn(async () => ({ id: "cr-1" }));
const createBillingProfileFor = vi.fn(async () => ({ id: "bp-1" }));
vi.mock("./service.js", () => ({ updateUserDetails: (...a) => updateUserDetails(...a), createBillingProfileFor: (...a) => createBillingProfileFor(...a) }));
vi.mock("../jobs/financeExport.js", () => ({ financeExportJob: vi.fn() }));
vi.mock("../jobs/financeGoogleSheetExport.js", () => ({ financeGoogleSheetExportJob: vi.fn() }));

const { default: router } = await import("./routes.js");
const { errorHandler } = await import("../../middleware/errorHandler.js");

const app = express();
app.use(express.json());
app.use("/admin", router);
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

async function call(user, method, path, body) {
  currentUser = user;
  const res = await fetch(`${base}/admin${path}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}

const BILLING = { pan: "ABCDE1234F", name: "Some One", bankAccountNumber: "123456789", ifscCode: "HDFC0001234" };
const ADMIN = { id: "adm-1", role: "ADMIN" };

describe("PUT /admin/users/:id/details and POST /admin/users/:id/billing-profiles", () => {
  it("a CREATOR (no users.edit) is rejected on both", async () => {
    const a = await call({ id: "cr-9", role: "CREATOR" }, "PUT", "/users/cr-1/details", { name: "X" });
    const b = await call({ id: "cr-9", role: "CREATOR" }, "POST", "/users/cr-1/billing-profiles", BILLING);
    expect([a.status, b.status]).toEqual([403, 403]);
    expect(updateUserDetails).not.toHaveBeenCalled();
    expect(createBillingProfileFor).not.toHaveBeenCalled();
  });

  it("an ADMIN reaches the service with the validated body", async () => {
    const res = await call(ADMIN, "PUT", "/users/cr-1/details", { name: "New", pincode: "" });
    expect(res.status).toBe(200);
    expect(updateUserDetails).toHaveBeenCalledWith("adm-1", "cr-1", { name: "New", pincode: "" });
    expect((await call(ADMIN, "POST", "/users/cr-1/billing-profiles", BILLING)).status).toBe(201);
  });

  it("rejects bad input and unknown fields (email can't sneak in here)", async () => {
    expect((await call(ADMIN, "PUT", "/users/cr-1/details", { phoneNumber: "12345" })).status).toBe(400);
    expect((await call(ADMIN, "PUT", "/users/cr-1/details", { pincode: "12" })).status).toBe(400);
    expect((await call(ADMIN, "PUT", "/users/cr-1/details", { email: "x@y.z" })).status).toBe(400);
    expect((await call(ADMIN, "PUT", "/users/cr-1/details", {})).status).toBe(400);
    expect(updateUserDetails).not.toHaveBeenCalled();
  });
});
