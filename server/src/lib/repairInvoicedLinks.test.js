import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  link: { findMany: vi.fn(), update: vi.fn() },
  linkStatusEvent: { create: vi.fn() },
  $transaction: vi.fn(async (ops) => Promise.all(ops)),
};
vi.mock("./prisma.js", () => ({ prisma: mockPrisma }));
const { repairInvoicedLinks } = await import("./repairInvoicedLinks.js");

beforeEach(() => vi.clearAllMocks());

describe("repairInvoicedLinks — links on a live invoice must be INVOICED (22 Sep)", () => {
  it("asks only for drifted links on non-rejected invoices, sets them INVOICED with a note, and reports them", async () => {
    mockPrisma.link.findMany.mockResolvedValue([
      { id: "l1", url: "https://instagram.com/p/abc123", status: "SCREENSHOT_APPROVED", invoiceItem: { invoice: { invoiceNumber: "INV-1" } } },
    ]);
    mockPrisma.link.update.mockResolvedValue({});
    mockPrisma.linkStatusEvent.create.mockResolvedValue({});

    const result = await repairInvoicedLinks({ actedById: "admin-1" });

    expect(mockPrisma.link.findMany.mock.calls[0][0].where).toEqual({
      status: { not: "INVOICED" },
      invoiceItem: { is: { invoice: { status: { not: "REJECTED" } } } },
    });
    expect(mockPrisma.link.update).toHaveBeenCalledWith({ where: { id: "l1" }, data: { status: "INVOICED" } });
    expect(mockPrisma.linkStatusEvent.create).toHaveBeenCalledWith({
      data: { linkId: "l1", status: "INVOICED", actedById: "admin-1", note: "Repaired: was SCREENSHOT_APPROVED while on invoice INV-1" },
    });
    expect(result).toEqual({ repaired: [{ linkId: "l1", url: "https://instagram.com/p/abc123", from: "SCREENSHOT_APPROVED", invoiceNumber: "INV-1" }] });
  });

  it("is a no-op when nothing has drifted", async () => {
    mockPrisma.link.findMany.mockResolvedValue([]);
    await expect(repairInvoicedLinks()).resolves.toEqual({ repaired: [] });
    expect(mockPrisma.link.update).not.toHaveBeenCalled();
  });
});
