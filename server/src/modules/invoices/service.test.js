import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApiError } from "../../middleware/errorHandler.js";

// One mock object plays both `prisma` and the `tx` handed to
// $transaction's callback — the distinction doesn't matter for these
// tests, only that every call lands on a spy we can assert against.
const mockPrisma = {
  link: { findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  invoice: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  linkStatusEvent: { create: vi.fn(), findFirst: vi.fn() },
  $transaction: vi.fn(async (cb) => cb(mockPrisma)),
};

vi.mock("../../lib/prisma.js", () => ({ prisma: mockPrisma }));
vi.mock("../notifications/service.js", () => ({ notify: vi.fn() }));
vi.mock("../billing/service.js", () => ({ getApprovedForUser: vi.fn(async () => null) }));

const { bulkCreateInvoice, rejectInvoice } = await import("./service.js");

const admin = { id: "admin-1", role: "ADMIN" };

function link(overrides = {}) {
  return {
    id: "link-1",
    status: "SCREENSHOT_APPROVED",
    cost: 1000,
    invoiceItem: null,
    asset: { ownerId: "creator-1" },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.$transaction.mockImplementation(async (cb) => cb(mockPrisma));
  mockPrisma.invoice.create.mockImplementation(async ({ data }) => ({ ...data, id: "invoice-1", items: [] }));
});

describe("bulkCreateInvoice — eligibility (newTask.md #3: insights aren't mandatory)", () => {
  it("accepts SCREENSHOT_APPROVED and INSIGHTS_PENDING links, not just INSIGHTS_APPROVED", async () => {
    mockPrisma.link.findMany.mockResolvedValue([
      link({ id: "l1", status: "SCREENSHOT_APPROVED" }),
      link({ id: "l2", status: "INSIGHTS_PENDING" }),
    ]);

    await expect(bulkCreateInvoice(admin, { linkIds: ["l1", "l2"], dueInDays: 15, isGstInvoice: false })).resolves.toBeTruthy();
  });

  it("still rejects links that haven't even had their screenshot approved", async () => {
    mockPrisma.link.findMany.mockResolvedValue([link({ id: "l1", status: "SUBMITTED" })]);

    await expect(bulkCreateInvoice(admin, { linkIds: ["l1"], dueInDays: 15, isGstInvoice: false })).rejects.toMatchObject({
      code: "INELIGIBLE_LINKS",
    });
  });

  it("rejects a link that's already on an invoice", async () => {
    mockPrisma.link.findMany.mockResolvedValue([link({ id: "l1", invoiceItem: { id: "item-1" } })]);

    await expect(bulkCreateInvoice(admin, { linkIds: ["l1"], dueInDays: 15, isGstInvoice: false })).rejects.toBeInstanceOf(ApiError);
  });

  it("rejects links belonging to different creators in one invoice", async () => {
    mockPrisma.link.findMany.mockResolvedValue([
      link({ id: "l1", asset: { ownerId: "creator-1" } }),
      link({ id: "l2", asset: { ownerId: "creator-2" } }),
    ]);

    await expect(bulkCreateInvoice(admin, { linkIds: ["l1", "l2"], dueInDays: 15, isGstInvoice: false })).rejects.toMatchObject({
      code: "MIXED_CREATORS",
    });
  });
});

describe("bulkCreateInvoice — GST (newTask.md #4: GST invoice auto-adds 18%)", () => {
  it("non-GST invoice: amount equals the subtotal, no GST added", async () => {
    mockPrisma.link.findMany.mockResolvedValue([link({ id: "l1", cost: 1000 }), link({ id: "l2", cost: 2000 })]);

    await bulkCreateInvoice(admin, { linkIds: ["l1", "l2"], dueInDays: 15, isGstInvoice: false });

    expect(mockPrisma.invoice.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ subtotal: 3000, gstAmount: 0, amount: 3000, isGstInvoice: false }) })
    );
  });

  it("GST invoice: adds exactly 18% on top of the subtotal", async () => {
    mockPrisma.link.findMany.mockResolvedValue([link({ id: "l1", cost: 1000 }), link({ id: "l2", cost: 2000 })]);

    await bulkCreateInvoice(admin, { linkIds: ["l1", "l2"], dueInDays: 15, isGstInvoice: true });

    expect(mockPrisma.invoice.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ subtotal: 3000, gstAmount: 540, amount: 3540, isGstInvoice: true }) })
    );
  });
});

describe("rejectInvoice — restores each link's actual prior status", () => {
  const rejectedInvoice = { id: "inv-1", status: "RAISED", creatorId: "creator-1", items: [{ linkId: "l1" }] };

  it("restores to SCREENSHOT_APPROVED when that's what the link's history shows (not always INSIGHTS_APPROVED)", async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue(rejectedInvoice);
    mockPrisma.invoice.update.mockResolvedValue({ ...rejectedInvoice, status: "REJECTED" });
    mockPrisma.linkStatusEvent.findFirst.mockResolvedValue({ status: "SCREENSHOT_APPROVED" });

    await rejectInvoice("inv-1", admin, { remarks: "duplicate" });

    expect(mockPrisma.link.update).toHaveBeenCalledWith({ where: { id: "l1" }, data: { status: "SCREENSHOT_APPROVED" } });
  });

  it("restores to INSIGHTS_APPROVED when the link's history shows that instead", async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue(rejectedInvoice);
    mockPrisma.invoice.update.mockResolvedValue({ ...rejectedInvoice, status: "REJECTED" });
    mockPrisma.linkStatusEvent.findFirst.mockResolvedValue({ status: "INSIGHTS_APPROVED" });

    await rejectInvoice("inv-1", admin, { remarks: "duplicate" });

    expect(mockPrisma.link.update).toHaveBeenCalledWith({ where: { id: "l1" }, data: { status: "INSIGHTS_APPROVED" } });
  });

  it("falls back to SCREENSHOT_APPROVED when there's no prior non-INVOICED event on record", async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue(rejectedInvoice);
    mockPrisma.invoice.update.mockResolvedValue({ ...rejectedInvoice, status: "REJECTED" });
    mockPrisma.linkStatusEvent.findFirst.mockResolvedValue(null);

    await rejectInvoice("inv-1", admin, { remarks: "duplicate" });

    expect(mockPrisma.link.update).toHaveBeenCalledWith({ where: { id: "l1" }, data: { status: "SCREENSHOT_APPROVED" } });
  });

  it("refuses to reject an already-paid invoice", async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue({ ...rejectedInvoice, status: "PAID" });

    await expect(rejectInvoice("inv-1", admin, { remarks: "x" })).rejects.toMatchObject({ code: "ALREADY_PAID" });
  });
});
