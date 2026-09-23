import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import express from "express";

// Route-level gate test for POST /invoices/:id/approve — Finance approves
// and pays (user decision, 23 Sep). Auth, the DB, and the service are all
// mocked; what's under test is which roles the router lets through.
const mockPrisma = { user: { findUnique: vi.fn() } };
vi.mock("../../lib/prisma.js", () => ({ prisma: mockPrisma }));

let currentUser;
vi.mock("../../middleware/requireAuth.js", () => ({
  requireAuth: (req, _res, next) => {
    req.user = currentUser;
    next();
  },
}));

const approveInvoice = vi.fn(async (id) => ({ id, status: "APPROVED" }));
vi.mock("./service.js", () => ({ approveInvoice, listInvoices: vi.fn(), markPaid: vi.fn() }));
const listClientInvoices = vi.fn(async () => ({ items: [], total: 0 }));
const markClientInvoicePaid = vi.fn(async (id) => ({ id, status: "PAID" }));
vi.mock("./clientInvoices.js", () => ({
  listClientInvoices: (...args) => listClientInvoices(...args),
  markClientInvoicePaid: (...args) => markClientInvoicePaid(...args),
  cancelClientInvoice: vi.fn(),
  getClientInvoicePdfSource: vi.fn(),
}));
vi.mock("../../lib/invoicePdf.js", () => ({ buildInvoicePdf: vi.fn() }));
vi.mock("../../lib/clientInvoicePdf.js", () => ({ buildClientInvoicePdf: vi.fn() }));

const { default: router } = await import("./routes.js");

const app = express();
app.use(express.json());
app.use("/invoices", router);
const server = await new Promise((resolve) => {
  const s = app.listen(0, () => resolve(s));
});
const base = `http://127.0.0.1:${server.address().port}`;
afterAll(() => server.close());

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.user.findUnique.mockImplementation(async () => ({ role: currentUser.role, permissions: currentUser.permissions ?? null }));
});

async function approveAs(user) {
  currentUser = user;
  const res = await fetch(`${base}/invoices/inv-1/approve`, { method: "POST" });
  return res.status;
}

async function call(user, method, path) {
  currentUser = user;
  const res = await fetch(`${base}/invoices${path}`, { method, headers: { "content-type": "application/json" }, body: method === "POST" ? "{}" : undefined });
  return res.status;
}

describe("Receivables routes — /invoices/client (23 Sep)", () => {
  it("GET /client: ADMIN, FINANCE and PLAN_MAKER read; CREATOR is refused", async () => {
    expect(await call({ id: "adm-1", role: "ADMIN" }, "GET", "/client")).toBe(200);
    expect(await call({ id: "fin-1", role: "FINANCE" }, "GET", "/client")).toBe(200);
    expect(await call({ id: "pm-1", role: "PLAN_MAKER" }, "GET", "/client")).toBe(200);
    expect(await call({ id: "cr-1", role: "CREATOR" }, "GET", "/client")).toBe(403);
    expect(listClientInvoices).toHaveBeenCalledTimes(3);
  });

  it("POST /client/:id/mark-paid: FINANCE and ADMIN settle; a PLAN_MAKER can look but not settle", async () => {
    expect(await call({ id: "fin-1", role: "FINANCE" }, "POST", "/client/ci-1/mark-paid")).toBe(200);
    expect(await call({ id: "adm-1", role: "ADMIN" }, "POST", "/client/ci-1/mark-paid")).toBe(200);
    expect(await call({ id: "pm-1", role: "PLAN_MAKER" }, "POST", "/client/ci-1/mark-paid")).toBe(403);
    expect(markClientInvoicePaid).toHaveBeenCalledTimes(2);
  });

  it("the /client prefix is never read as an invoice id by the /:id routes", async () => {
    expect(await call({ id: "fin-1", role: "FINANCE" }, "GET", "/client")).toBe(200);
    expect(approveInvoice).not.toHaveBeenCalled();
  });
});

describe("POST /invoices/:id/approve — who may sign off", () => {
  it("lets a plain FINANCE account approve (no finance.manage grant needed) — Finance approves and pays, 23 Sep", async () => {
    expect(await approveAs({ id: "fin-1", role: "FINANCE" })).toBe(200);
    expect(approveInvoice).toHaveBeenCalledWith("inv-1", expect.objectContaining({ id: "fin-1" }));
  });

  it("lets ADMIN approve", async () => {
    expect(await approveAs({ id: "adm-1", role: "ADMIN" })).toBe(200);
  });

  it("403s a CREATOR", async () => {
    expect(await approveAs({ id: "cr-1", role: "CREATOR" })).toBe(403);
    expect(approveInvoice).not.toHaveBeenCalled();
  });

  it("403s a PLAN_MAKER without a finance.manage grant, 200s one with it", async () => {
    expect(await approveAs({ id: "pm-1", role: "PLAN_MAKER" })).toBe(403);
    expect(await approveAs({ id: "pm-2", role: "PLAN_MAKER", permissions: { "finance.manage": true } })).toBe(200);
  });
});
