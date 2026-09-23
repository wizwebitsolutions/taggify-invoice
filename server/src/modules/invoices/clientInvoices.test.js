import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  clientInvoice: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
};
vi.mock("../../lib/prisma.js", () => ({ prisma: mockPrisma }));

const mockDocument = vi.fn();
vi.mock("../plans/service.js", () => ({
  clientInvoiceDocumentForPlan: (...args) => mockDocument(...args),
  invoiceAttachmentFor: (plan) =>
    plan?.invoiceAttachmentPublicId
      ? { name: plan.invoiceAttachmentName, url: `https://cdn/${plan.invoiceAttachmentPublicId}`, uploadedAt: plan.invoiceAttachmentUploadedAt, uploadedById: plan.invoiceAttachmentUploadedById }
      : null,
}));

const { listClientInvoices, markClientInvoicePaid, cancelClientInvoice, getClientInvoicePdfSource } = await import("./clientInvoices.js");

const finance = { id: "fin-1", role: "FINANCE" };
const admin = { id: "adm-1", role: "ADMIN" };
const planMaker = { id: "pm-1", role: "PLAN_MAKER" };
const issued = (overrides = {}) => ({
  id: "ci-1",
  planId: "plan-1",
  invoiceNumber: "PI-0001",
  subtotal: 10000,
  gstAmount: 1800,
  total: 11800,
  status: "ISSUED",
  remarks: null,
  plan: { id: "plan-1", name: "Q1 Push", createdById: "pm-1" },
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.clientInvoice.findMany.mockResolvedValue([]);
  mockPrisma.clientInvoice.update.mockImplementation(async ({ data }) => ({ ...issued(), ...data }));
});

describe("listClientInvoices — receivables visibility (23 Sep)", () => {
  it("ADMIN and FINANCE see every receivable", async () => {
    await listClientInvoices(finance);
    expect(mockPrisma.clientInvoice.findMany.mock.calls[0][0].where).toEqual({});
    await listClientInvoices(admin, { status: "ISSUED" });
    expect(mockPrisma.clientInvoice.findMany.mock.calls[1][0].where).toEqual({ status: "ISSUED" });
  });

  it("a Plan Maker only sees receivables on plans they created", async () => {
    await listClientInvoices(planMaker);
    expect(mockPrisma.clientInvoice.findMany.mock.calls[0][0].where).toEqual({ plan: { createdById: "pm-1" } });
  });

  it("filters by campaign and searches invoice number, POC name, and client name/company", async () => {
    await listClientInvoices(finance, { campaignId: "camp-1", search: "pi-00" });
    expect(mockPrisma.clientInvoice.findMany.mock.calls[0][0].where).toEqual({
      campaignId: "camp-1",
      OR: [
        { invoiceNumber: { contains: "pi-00", mode: "insensitive" } },
        { plan: { createdBy: { name: { contains: "pi-00", mode: "insensitive" } } } },
        { plan: { clientName: { contains: "pi-00", mode: "insensitive" } } },
        { plan: { clientCompany: { contains: "pi-00", mode: "insensitive" } } },
      ],
    });
  });

  it("hasAttachment restricts to plans with a real (non-Proforma) invoice attached — Payments tab (tasks.md #5)", async () => {
    await listClientInvoices(finance, { hasAttachment: true });
    expect(mockPrisma.clientInvoice.findMany.mock.calls[0][0].where).toEqual({ plan: { invoiceAttachmentPublicId: { not: null } } });
  });

  it("hasAttachment combines with a Plan Maker's own-plans scope instead of replacing it", async () => {
    await listClientInvoices(planMaker, { hasAttachment: true });
    expect(mockPrisma.clientInvoice.findMany.mock.calls[0][0].where).toEqual({ plan: { createdById: "pm-1", invoiceAttachmentPublicId: { not: null } } });
  });

  it("resolves each row's plan.invoiceAttachment for the Payments tab to show/attach without a second fetch", async () => {
    mockPrisma.clientInvoice.findMany.mockResolvedValueOnce([
      issued({ plan: { id: "plan-1", name: "Q1 Push", createdById: "pm-1", invoiceAttachmentPublicId: "plan-invoice-attachments/plan-1/uuid", invoiceAttachmentName: "real-invoice.pdf" } }),
    ]);
    const { items } = await listClientInvoices(finance, {});
    expect(items[0].plan.invoiceAttachment).toMatchObject({ name: "real-invoice.pdf", url: "https://cdn/plan-invoice-attachments/plan-1/uuid" });
  });
});

describe("markClientInvoicePaid — manual settlement, like the payables side", () => {
  it("ISSUED → PAID, defaulting paidAmount to the total and stamping paidAt", async () => {
    mockPrisma.clientInvoice.findUnique.mockResolvedValue(issued());

    const result = await markClientInvoicePaid("ci-1", finance, {});

    expect(result.status).toBe("PAID");
    const { data } = mockPrisma.clientInvoice.update.mock.calls[0][0];
    expect(data.paidAmount).toBe(11800);
    expect(data.paidAt).toBeInstanceOf(Date);
  });

  it("records a short payment as-is with the remark, so the gap stays visible", async () => {
    mockPrisma.clientInvoice.findUnique.mockResolvedValue(issued());
    await markClientInvoicePaid("ci-1", finance, { paidAmount: 11000, remarks: "TDS deducted" });
    expect(mockPrisma.clientInvoice.update.mock.calls[0][0].data).toMatchObject({ paidAmount: 11000, remarks: "TDS deducted" });
  });

  it("refuses an already-paid or cancelled row", async () => {
    mockPrisma.clientInvoice.findUnique.mockResolvedValue(issued({ status: "PAID" }));
    await expect(markClientInvoicePaid("ci-1", finance, {})).rejects.toMatchObject({ code: "ALREADY_PAID" });
    mockPrisma.clientInvoice.findUnique.mockResolvedValue(issued({ status: "CANCELLED" }));
    await expect(markClientInvoicePaid("ci-1", finance, {})).rejects.toMatchObject({ code: "INVALID_STATUS" });
    expect(mockPrisma.clientInvoice.update).not.toHaveBeenCalled();
  });

  it("404s (not 403) a Plan Maker on someone else's plan, and a missing row", async () => {
    mockPrisma.clientInvoice.findUnique.mockResolvedValue(issued({ plan: { id: "plan-2", createdById: "someone-else" } }));
    await expect(markClientInvoicePaid("ci-1", planMaker, {})).rejects.toMatchObject({ code: "CLIENT_INVOICE_NOT_FOUND" });
    mockPrisma.clientInvoice.findUnique.mockResolvedValue(null);
    await expect(markClientInvoicePaid("nope", finance, {})).rejects.toMatchObject({ code: "CLIENT_INVOICE_NOT_FOUND" });
  });
});

describe("cancelClientInvoice", () => {
  it("ISSUED → CANCELLED with the reason; never a PAID row", async () => {
    mockPrisma.clientInvoice.findUnique.mockResolvedValue(issued());
    const result = await cancelClientInvoice("ci-1", finance, { remarks: "Deal fell through" });
    expect(result.status).toBe("CANCELLED");
    expect(mockPrisma.clientInvoice.update.mock.calls[0][0].data).toEqual({ status: "CANCELLED", remarks: "Deal fell through" });

    mockPrisma.clientInvoice.findUnique.mockResolvedValue(issued({ status: "PAID" }));
    await expect(cancelClientInvoice("ci-1", finance, { remarks: "x" })).rejects.toMatchObject({ code: "ALREADY_PAID" });
  });
});

describe("getClientInvoicePdfSource — Finance downloads the PDF without plan access", () => {
  it("resolves the row, then hands the plan id to plans/service for the document", async () => {
    mockPrisma.clientInvoice.findUnique.mockResolvedValue(issued());
    mockDocument.mockResolvedValue({ clientInvoiceNumber: "PI-0001" });
    await expect(getClientInvoicePdfSource("ci-1", finance)).resolves.toEqual({ clientInvoiceNumber: "PI-0001" });
    expect(mockDocument).toHaveBeenCalledWith("plan-1");
  });
});
