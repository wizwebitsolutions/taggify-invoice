import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import express from "express";

// Route-level check for the Google Sheet refresh (user report, 29 Sep — "on
// modifying plan after generation, in google sheet it's not updating"). Auth,
// the DB and the service are mocked; what's under test is which requests kick
// off a refresh, and that the refresh never holds up or fails the response.
const mockPrisma = { user: { findUnique: vi.fn() } };
vi.mock("../../lib/prisma.js", () => ({ prisma: mockPrisma }));

let currentUser = { id: "admin-1", role: "ADMIN" };
vi.mock("../../middleware/requireAuth.js", () => ({
  requireAuth: (req, _res, next) => {
    req.user = currentUser;
    next();
  },
}));

const updatePlan = vi.fn(async (id) => ({ id, name: "Q1 Push" }));
const syncPlanFromSheet = vi.fn(async (id) => ({ id }));
const addPendingPage = vi.fn(async (id) => ({ id }));
const importPlanSheetPages = vi.fn(async (id) => ({ id }));
const refreshGeneratedSheets = vi.fn(async () => {});
const approvePlan = vi.fn(async (id) => ({ id, status: "APPROVED" }));
const rejectPlan = vi.fn(async (id) => ({ id, status: "REJECTED" }));
vi.mock("./service.js", () => ({ updatePlan, syncPlanFromSheet, addPendingPage, importPlanSheetPages, refreshGeneratedSheets, approvePlan, rejectPlan }));
const checkProfiles = vi.fn(async (ids) => ({ results: ids.map((assetId) => ({ assetId, broken: false, fresh: true })), checked: ids.length }));
vi.mock("../assets/service.js", () => ({ checkProfiles: (...a) => checkProfiles(...a) }));
vi.mock("../campaigns/service.js", () => ({ fetchSheetCsv: vi.fn(), fetchSheetTabs: vi.fn() }));
vi.mock("../../lib/planPdf.js", () => ({ buildPlanPdf: vi.fn(), buildPlanGroupPdf: vi.fn() }));
vi.mock("../../lib/clientInvoicePdf.js", () => ({ buildClientInvoicePdf: vi.fn() }));
vi.mock("../../lib/clientInvoiceNumbering.js", () => ({ getNumbering: vi.fn() }));

const { default: router } = await import("./routes.js");

const app = express();
app.use(express.json());
app.use("/plans", router);
const server = await new Promise((resolve) => {
  const s = app.listen(0, () => resolve(s));
});
const base = `http://127.0.0.1:${server.address().port}`;
afterAll(() => server.close());

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.user.findUnique.mockImplementation(async () => ({ role: currentUser.role, permissions: null }));
});

const send = (method, path, body) =>
  fetch(`${base}/plans${path}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("editing a plan refreshes its already-generated Google Sheet (29 Sep)", () => {
  it("PUT /:id — a content edit fires a refresh after the save", async () => {
    const res = await send("PUT", "/plan-1", { name: "Q1 Push (revised)" });

    expect(res.status).toBe(200);
    expect(refreshGeneratedSheets).toHaveBeenCalledWith("plan-1", currentUser);
  });

  it("PUT /:id — swapping only the execution-sheet link changes nothing the plan sheet shows, so no refresh", async () => {
    const res = await send("PUT", "/plan-1", { executionSheetUrl: "https://docs.google.com/spreadsheets/d/abc/edit" });

    expect(res.status).toBe(200);
    expect(refreshGeneratedSheets).not.toHaveBeenCalled();
  });

  it("a failed save fires no refresh", async () => {
    updatePlan.mockRejectedValueOnce(Object.assign(new Error("nope"), { statusCode: 400 }));

    await send("PUT", "/plan-1", { name: "x" });

    expect(refreshGeneratedSheets).not.toHaveBeenCalled();
  });

  it("a slow Google refresh doesn't hold up the save's response", async () => {
    let finish;
    refreshGeneratedSheets.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));

    const res = await send("PUT", "/plan-1", { name: "Q1 Push (revised)" });

    expect(res.status).toBe(200); // answered while the refresh is still pending
    finish();
  });
});

// 29 Sep — the sheet now shows each plan as Active / Not active, so an
// approval decision changes what it shows.
describe("approving or rejecting a plan refreshes its sheet (Active / Not active)", () => {
  it("POST /:id/approve fires a refresh", async () => {
    const res = await send("POST", "/plan-1/approve", {});
    expect(res.status).toBe(200);
    expect(refreshGeneratedSheets).toHaveBeenCalledWith("plan-1", currentUser);
  });

  it("POST /:id/reject fires a refresh", async () => {
    const res = await send("POST", "/plan-1/reject", {});
    expect(res.status).toBe(200);
    expect(refreshGeneratedSheets).toHaveBeenCalledWith("plan-1", currentUser);
  });
});

describe("POST /plans/check-pages — 'are these pages still up?' (17 Oct)", () => {
  it("an admin or plan maker can run it; the ids and force flag reach the service", async () => {
    currentUser = { id: "admin-1", role: "ADMIN" };
    const res = await send("POST", "/check-pages", { assetIds: ["a1", "a2"], force: true });
    expect(res.status).toBe(200);
    expect(checkProfiles).toHaveBeenCalledWith(["a1", "a2"], { force: true });
    expect((await res.json()).checked).toBe(2);

    currentUser = { id: "pm-1", role: "PLAN_MAKER" };
    expect((await send("POST", "/check-pages", { assetIds: ["a1"] })).status).toBe(200);
    expect(checkProfiles).toHaveBeenLastCalledWith(["a1"], { force: false });
  });

  for (const role of ["CREATOR", "TEAM_MEMBER", "FINANCE"]) {
    it(`${role} is refused`, async () => {
      currentUser = { id: `${role.toLowerCase()}-1`, role };
      expect((await send("POST", "/check-pages", { assetIds: ["a1"] })).status).toBe(403);
      expect(checkProfiles).not.toHaveBeenCalled();
    });
  }

  it("an empty or oversized id list is a 400", async () => {
    currentUser = { id: "admin-1", role: "ADMIN" };
    expect((await send("POST", "/check-pages", { assetIds: [] })).status).toBe(400);
    expect((await send("POST", "/check-pages", { assetIds: Array.from({ length: 201 }, (_, i) => `a${i}`) })).status).toBe(400);
    expect(checkProfiles).not.toHaveBeenCalled();
  });
});
