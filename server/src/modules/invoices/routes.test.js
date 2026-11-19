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
const requestAttachmentUpload = vi.fn(async () => ({ uploadUrl: "u" }));
const confirmAttachment = vi.fn(async () => ({ name: "inv.pdf" }));
const removeAttachment = vi.fn(async () => null);
vi.mock("./service.js", () => ({
  approveInvoice,
  listInvoices: vi.fn(),
  requestInvoiceReceiptUpload: vi.fn(),
  confirmInvoiceReceipt: vi.fn(),
  requestAttachmentUpload: (...a) => requestAttachmentUpload(...a),
  confirmAttachment: (...a) => confirmAttachment(...a),
  removeAttachment: (...a) => removeAttachment(...a),
}));
const listClientInvoices = vi.fn(async () => ({ items: [], total: 0 }));
const markClientInvoicePaid = vi.fn(async (id) => ({ id, status: "PAID" }));
vi.mock("./clientInvoices.js", () => ({
  listClientInvoices: (...args) => listClientInvoices(...args),
  markClientInvoicePaid: (...args) => markClientInvoicePaid(...args),
  cancelClientInvoice: vi.fn(),
  getClientInvoicePdfSource: vi.fn(),
}));
const listPlansToInvoice = vi.fn(async () => ({ items: [], total: 0 }));
const requestInvoiceAttachmentUploadForFinance = vi.fn(async () => ({ publicId: "k" }));
const confirmInvoiceAttachmentForFinance = vi.fn(async () => ({ name: "inv.pdf" }));
const removeInvoiceAttachmentForFinance = vi.fn(async () => null);
vi.mock("../plans/service.js", () => ({
  listPlansToInvoice: (...a) => listPlansToInvoice(...a),
  requestInvoiceAttachmentUploadForFinance: (...a) => requestInvoiceAttachmentUploadForFinance(...a),
  confirmInvoiceAttachmentForFinance: (...a) => confirmInvoiceAttachmentForFinance(...a),
  removeInvoiceAttachmentForFinance: (...a) => removeInvoiceAttachmentForFinance(...a),
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

// 19 Nov — Finance bills plans whose execution sheet is in, and uploads the
// client invoice PDF without plan access. Staff only: planners see their own
// plans' invoices through /plans and /client, never this cross-plan list.
describe("To invoice routes — /invoices/plans-to-invoice and /plans/:planId/final-invoice", () => {
  const pdfBody = JSON.stringify({ publicId: "plan-invoice-attachments/plan-1/uuid", fileName: "inv.pdf" });
  async function send(user, method, path, body) {
    currentUser = user;
    const res = await fetch(`${base}/invoices${path}`, { method, headers: { "content-type": "application/json" }, body });
    return res.status;
  }
  const finance = { id: "fin-1", role: "FINANCE" };
  const admin = { id: "adm-1", role: "ADMIN" };
  const viewOnlyFinance = { id: "fin-2", role: "FINANCE", permissions: { "finance.edit": false, "finance.approve": false, "finance.pay": false } };
  const refused = [
    { id: "pm-1", role: "PLAN_MAKER" },
    { id: "cr-1", role: "CREATOR" },
    { id: "tm-1", role: "TEAM_MEMBER" },
  ];

  it("GET /plans-to-invoice: Finance (even view-only) and Admin list; planners, creators and team members are refused", async () => {
    expect(await send(finance, "GET", "/plans-to-invoice")).toBe(200);
    expect(await send(viewOnlyFinance, "GET", "/plans-to-invoice")).toBe(200);
    expect(await send(admin, "GET", "/plans-to-invoice")).toBe(200);
    for (const u of refused) expect(await send(u, "GET", "/plans-to-invoice")).toBe(403);
    expect(listPlansToInvoice).toHaveBeenCalledTimes(3);
  });

  it("upload, confirm and remove: Finance with finance.edit and Admin only", async () => {
    for (const u of [finance, admin]) {
      expect(await send(u, "POST", "/plans/plan-1/final-invoice/upload-url")).toBe(200);
      expect(await send(u, "POST", "/plans/plan-1/final-invoice", pdfBody)).toBe(200);
      expect(await send(u, "DELETE", "/plans/plan-1/final-invoice")).toBe(200);
    }
    for (const u of [viewOnlyFinance, ...refused]) {
      expect(await send(u, "POST", "/plans/plan-1/final-invoice/upload-url")).toBe(403);
      expect(await send(u, "POST", "/plans/plan-1/final-invoice", pdfBody)).toBe(403);
      expect(await send(u, "DELETE", "/plans/plan-1/final-invoice")).toBe(403);
    }
    expect(requestInvoiceAttachmentUploadForFinance).toHaveBeenCalledTimes(2);
    expect(confirmInvoiceAttachmentForFinance).toHaveBeenCalledWith("plan-1", expect.objectContaining({ id: "fin-1" }), { publicId: "plan-invoice-attachments/plan-1/uuid", fileName: "inv.pdf" });
    expect(removeInvoiceAttachmentForFinance).toHaveBeenCalledTimes(2);
  });

  it("confirm only takes a PDF", async () => {
    expect(await send(finance, "POST", "/plans/plan-1/final-invoice", JSON.stringify({ publicId: "plan-invoice-attachments/plan-1/uuid", fileName: "inv.jpg" }))).toBe(400);
    expect(confirmInvoiceAttachmentForFinance).not.toHaveBeenCalled();
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

  it("403s a PLAN_MAKER with or without a stored finance grant (regression (24 Sep — own-scope roles never get global access))", async () => {
    expect(await approveAs({ id: "pm-1", role: "PLAN_MAKER" })).toBe(403);
    expect(await approveAs({ id: "pm-2", role: "PLAN_MAKER", permissions: { "finance.manage": true } })).toBe(403);
  });
});

describe("Invoice attachment routes — need finance.edit (12 Oct)", () => {
  const CONFIRM = { publicId: "invoice-attachments/inv-1/x.pdf", fileName: "inv.pdf" };
  async function attach(user) {
    currentUser = user;
    const up = await fetch(`${base}/invoices/inv-1/attachment/upload-url`, { method: "POST" });
    const confirm = await fetch(`${base}/invoices/inv-1/attachment`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(CONFIRM) });
    const del = await fetch(`${base}/invoices/inv-1/attachment`, { method: "DELETE" });
    return [up.status, confirm.status, del.status];
  }

  it("staff with only finance.view are refused on upload, confirm and remove", async () => {
    expect(await attach({ id: "fi-1", role: "FINANCE", permissions: { "finance.edit": false } })).toEqual([403, 403, 403]);
    expect(await attach({ id: "ad-2", role: "ADMIN", permissions: { "finance.edit": false } })).toEqual([403, 403, 403]);
    expect(requestAttachmentUpload).not.toHaveBeenCalled();
    expect(confirmAttachment).not.toHaveBeenCalled();
    expect(removeAttachment).not.toHaveBeenCalled();
  });

  it("a creator whose finance edit switch is off is refused; a team member never has it", async () => {
    expect(await attach({ id: "cr-1", role: "CREATOR", permissions: { "finance.edit": false } })).toEqual([403, 403, 403]);
    expect(await attach({ id: "tm-1", role: "TEAM_MEMBER" })).toEqual([403, 403, 403]);
  });

  it("finance, admin and a creator (own invoice, checked in the service) get through", async () => {
    expect(await attach({ id: "fi-2", role: "FINANCE" })).toEqual([200, 201, 204]);
    expect(await attach({ id: "ad-1", role: "ADMIN" })).toEqual([200, 201, 204]);
    expect(await attach({ id: "cr-2", role: "CREATOR" })).toEqual([200, 201, 204]);
    expect(confirmAttachment).toHaveBeenCalledWith("inv-1", expect.objectContaining({ id: "cr-2" }), CONFIRM);
  });
});
