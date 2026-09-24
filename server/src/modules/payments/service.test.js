import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApiError } from "../../middleware/errorHandler.js";

const mockPrisma = {
  link: { findMany: vi.fn(), count: vi.fn() },
  payout: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn(), delete: vi.fn(), findMany: vi.fn(), count: vi.fn() },
  $transaction: vi.fn(async (arg) => (Array.isArray(arg) ? Promise.all(arg) : arg(mockPrisma))),
};

vi.mock("../../lib/prisma.js", () => ({ prisma: mockPrisma }));
vi.mock("../notifications/service.js", () => ({ notify: vi.fn() }));
const mockCloudinary = {
  buildPayoutReceiptKey: vi.fn((id) => `payout-receipts/${id}/uuid`),
  getUploadParams: vi.fn((publicId) => ({ uploadUrl: "https://upload", apiKey: "k", timestamp: 1, signature: "s", publicId })),
  objectExists: vi.fn(async () => true),
  publicUrlFor: vi.fn((id) => `https://cdn/${id}`),
};
vi.mock("../../lib/cloudinaryClient.js", () => mockCloudinary);

const {
  computePayoutTotals,
  createPayout,
  cancelPayout,
  requestPayoutReceiptUpload,
  confirmPayoutReceipt,
  pendingLinksWhere,
  payoutsWhere,
  listPendingLinks,
  listMyPendingLinks,
  listMyPayouts,
} = await import("./service.js");

const finance = { id: "fin-1", role: "FINANCE" };

function link(overrides = {}) {
  return {
    id: "link-1",
    status: "SCREENSHOT_APPROVED",
    cost: 1000,
    invoiceItem: null,
    payoutItem: null,
    asset: { ownerId: "creator-1" },
    ...overrides,
  };
}

// confirmPayoutReceipt is a guarded updateMany (DRAFT → PAID) followed by a
// re-read; tests assert on the updateMany data and get back what it wrote.
let lastWrite = null;
beforeEach(() => {
  vi.clearAllMocks();
  lastWrite = null;
  mockPrisma.payout.create.mockImplementation(async ({ data }) => ({ ...data, id: "payout-1", items: [] }));
  mockPrisma.payout.updateMany.mockImplementation(async ({ data }) => {
    lastWrite = data;
    return { count: 1 };
  });
});
/** findUnique returns the DRAFT on the pre-check, then whatever updateMany wrote. */
function draftThenWritten(draft) {
  mockPrisma.payout.findUnique.mockImplementation(async () => (lastWrite ? { ...draft, ...lastWrite } : draft));
}

describe("computePayoutTotals — net = subtotal + GST − TDS (both off the subtotal, user decision 23 Sep)", () => {
  it("no GST, no TDS: net equals the subtotal", () => {
    expect(computePayoutTotals([link({ cost: 1000 }), link({ cost: 2000 })], false, null)).toEqual({
      subtotal: 3000,
      gstAmount: 0,
      tdsAmount: 0,
      netAmount: 3000,
    });
  });

  it("GST only: adds 18% on top", () => {
    expect(computePayoutTotals([link({ cost: 1000 })], true, null)).toEqual({ subtotal: 1000, gstAmount: 180, tdsAmount: 0, netAmount: 1180 });
  });

  it("TDS only: withheld from the subtotal", () => {
    expect(computePayoutTotals([link({ cost: 1000 })], false, 10)).toEqual({ subtotal: 1000, gstAmount: 0, tdsAmount: 100, netAmount: 900 });
  });

  it("GST and TDS together: both computed off the subtotal independently, net nets them out", () => {
    expect(computePayoutTotals([link({ cost: 1000 })], true, 10)).toEqual({ subtotal: 1000, gstAmount: 180, tdsAmount: 100, netAmount: 1080 });
  });

  it("1% and 2% TDS rates", () => {
    expect(computePayoutTotals([link({ cost: 1000 })], false, 1).tdsAmount).toBe(10);
    expect(computePayoutTotals([link({ cost: 1000 })], false, 2).tdsAmount).toBe(20);
  });
});

describe("createPayout — eligibility and mutual exclusion with Invoice (tasks.md #5, 23 Sep)", () => {
  it("creates a DRAFT payout for eligible links", async () => {
    mockPrisma.link.findMany.mockResolvedValue([link({ id: "l1" }), link({ id: "l2" })]);

    const payout = await createPayout(finance, { creatorId: "creator-1", linkIds: ["l1", "l2"], isGstInvoice: false, tdsPercent: null });

    expect(payout.status).toBe("DRAFT");
    expect(mockPrisma.payout.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ creatorId: "creator-1", createdById: "fin-1", status: "DRAFT" }) })
    );
  });

  it("rejects a link already on an invoice", async () => {
    mockPrisma.link.findMany.mockResolvedValue([link({ id: "l1", invoiceItem: { invoiceId: "inv-1" } })]);

    await expect(createPayout(finance, { creatorId: "creator-1", linkIds: ["l1"], isGstInvoice: false, tdsPercent: null })).rejects.toMatchObject({
      code: "INELIGIBLE_LINKS",
    });
    expect(mockPrisma.payout.create).not.toHaveBeenCalled();
  });

  it("rejects a link already on another payout", async () => {
    mockPrisma.link.findMany.mockResolvedValue([link({ id: "l1", payoutItem: { payoutId: "payout-9" } })]);

    await expect(createPayout(finance, { creatorId: "creator-1", linkIds: ["l1"], isGstInvoice: false, tdsPercent: null })).rejects.toMatchObject({
      code: "INELIGIBLE_LINKS",
    });
  });

  it("rejects links from a page owned by someone other than the chosen vendor", async () => {
    mockPrisma.link.findMany.mockResolvedValue([link({ id: "l1", asset: { ownerId: "creator-2" } })]);

    await expect(createPayout(finance, { creatorId: "creator-1", linkIds: ["l1"], isGstInvoice: false, tdsPercent: null })).rejects.toMatchObject({
      code: "MIXED_CREATORS",
    });
  });

  it("rejects a status not in INVOICEABLE_STATUSES", async () => {
    mockPrisma.link.findMany.mockResolvedValue([link({ id: "l1", status: "SCREENSHOT_REJECTED" })]);

    await expect(createPayout(finance, { creatorId: "creator-1", linkIds: ["l1"], isGstInvoice: false, tdsPercent: null })).rejects.toMatchObject({
      code: "INELIGIBLE_LINKS",
    });
  });
});

describe("cancelPayout — only a DRAFT can be released", () => {
  it("deletes a draft payout", async () => {
    mockPrisma.payout.findUnique.mockResolvedValue({ id: "payout-1", status: "DRAFT" });
    await cancelPayout("payout-1", finance);
    expect(mockPrisma.payout.delete).toHaveBeenCalledWith({ where: { id: "payout-1" } });
  });

  it("refuses to cancel an already-PAID payout", async () => {
    mockPrisma.payout.findUnique.mockResolvedValue({ id: "payout-1", status: "PAID" });
    await expect(cancelPayout("payout-1", finance)).rejects.toMatchObject({ code: "INVALID_STATUS" });
    expect(mockPrisma.payout.delete).not.toHaveBeenCalled();
  });

  it("404s on an unknown payout", async () => {
    mockPrisma.payout.findUnique.mockResolvedValue(null);
    await expect(cancelPayout("nope", finance)).rejects.toMatchObject({ code: "PAYOUT_NOT_FOUND" });
  });
});

describe("payout receipt — attaching it marks the payout PAID (tasks.md #5)", () => {
  it("request-upload scopes the key to this payout", async () => {
    mockPrisma.payout.findUnique.mockResolvedValue({ id: "payout-1", status: "DRAFT" });
    const params = await requestPayoutReceiptUpload("payout-1", finance);
    expect(params.publicId).toBe("payout-receipts/payout-1/uuid");
  });

  it("confirming the receipt sets status PAID, paidAt, and who marked it — as a DRAFT-guarded write", async () => {
    draftThenWritten({ id: "payout-1", status: "DRAFT", creatorId: "creator-1" });

    const result = await confirmPayoutReceipt("payout-1", finance, { publicId: "payout-receipts/payout-1/uuid", fileName: "receipt.pdf" });

    expect(result.status).toBe("PAID");
    expect(result.receipt).toMatchObject({ name: "receipt.pdf", url: "https://cdn/payout-receipts/payout-1/uuid" });
    expect(mockPrisma.payout.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "payout-1", status: "DRAFT" },
        data: expect.objectContaining({ status: "PAID", markedPaidById: "fin-1", receiptPublicId: "payout-receipts/payout-1/uuid", receiptName: "receipt.pdf" }),
      })
    );
  });

  it("regression (24 Sep review): a confirm that loses a race (payout completed/cancelled meanwhile) is a 409, not a second PAID", async () => {
    mockPrisma.payout.findUnique.mockResolvedValue({ id: "payout-1", status: "DRAFT", creatorId: "creator-1" });
    mockPrisma.payout.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(confirmPayoutReceipt("payout-1", finance, { publicId: "payout-receipts/payout-1/uuid", fileName: "r.pdf" })).rejects.toMatchObject({
      code: "INVALID_STATUS",
    });
  });

  it("rejects a receipt key that belongs to a different payout", async () => {
    mockPrisma.payout.findUnique.mockResolvedValue({ id: "payout-1", status: "DRAFT" });
    await expect(confirmPayoutReceipt("payout-1", finance, { publicId: "payout-receipts/payout-2/uuid", fileName: "x.pdf" })).rejects.toMatchObject({
      code: "KEY_MISMATCH",
    });
  });

  it("422s when nothing actually landed at the key", async () => {
    mockPrisma.payout.findUnique.mockResolvedValue({ id: "payout-1", status: "DRAFT" });
    mockCloudinary.objectExists.mockResolvedValueOnce(false);
    await expect(confirmPayoutReceipt("payout-1", finance, { publicId: "payout-receipts/payout-1/uuid", fileName: "x.pdf" })).rejects.toMatchObject({
      code: "UPLOAD_NOT_FOUND",
    });
  });

  it("can't attach a receipt to an already-PAID payout", async () => {
    mockPrisma.payout.findUnique.mockResolvedValue({ id: "payout-1", status: "PAID" });
    await expect(requestPayoutReceiptUpload("payout-1", finance)).rejects.toMatchObject({ code: "INVALID_STATUS" });
    await expect(confirmPayoutReceipt("payout-1", finance, { publicId: "payout-receipts/payout-1/uuid", fileName: "x.pdf" })).rejects.toMatchObject({
      code: "INVALID_STATUS",
    });
  });
});

describe("confirmPayoutReceipt — paid-on date and UTR (24 Sep redesign)", () => {
  beforeEach(() => {
    draftThenWritten({ id: "payout-1", status: "DRAFT", creatorId: "creator-1" });
  });

  it("stores the typed paid-on date as paidAt and a trimmed UTR", async () => {
    const paidOn = new Date("2026-09-20T00:00:00.000Z");
    await confirmPayoutReceipt("payout-1", finance, { publicId: "payout-receipts/payout-1/uuid", fileName: "r.pdf", paidOn, utr: "  4521 8890  " });
    expect(mockPrisma.payout.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ paidAt: paidOn, utr: "4521 8890" }) }));
  });

  it("defaults paidAt to now and utr to null when neither is given", async () => {
    await confirmPayoutReceipt("payout-1", finance, { publicId: "payout-receipts/payout-1/uuid", fileName: "r.pdf" });
    const { data } = mockPrisma.payout.updateMany.mock.calls[0][0];
    expect(data.paidAt).toBeInstanceOf(Date);
    expect(Math.abs(data.paidAt.getTime() - Date.now())).toBeLessThan(5000);
    expect(data.utr).toBeNull();
  });

  it("refuses a paid-on date in the future", async () => {
    const paidOn = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    await expect(confirmPayoutReceipt("payout-1", finance, { publicId: "payout-receipts/payout-1/uuid", fileName: "r.pdf", paidOn })).rejects.toMatchObject({
      code: "PAID_ON_IN_FUTURE",
    });
    expect(mockPrisma.payout.updateMany).not.toHaveBeenCalled();
  });
});

describe("pendingLinksWhere — the Pending tab's list (24 Sep redesign)", () => {
  it("with no filters: only payable links — an eligible status, not on an invoice, not on any payout (drafts included)", () => {
    const where = pendingLinksWhere({});
    expect(where.invoiceItem).toBeNull();
    expect(where.payoutItem).toBeNull();
    expect(where.status.in).toEqual(expect.arrayContaining(["SUBMITTED", "SCREENSHOT_APPROVED"]));
    expect(where.status.in).not.toContain("SCREENSHOT_REJECTED");
    expect(where.status.in).not.toContain("INVALID");
    expect(where.asset).toBeUndefined();
    expect(where.OR).toBeUndefined();
  });

  it("vendor, page and page search all narrow via the link's page", () => {
    const where = pendingLinksWhere({ ownerId: "creator-1", assetId: "asset-1", q: " @Memes " });
    expect(where.asset).toEqual({ ownerId: "creator-1", handle: { contains: "Memes", mode: "insensitive" } });
    expect(where.assetId).toBe("asset-1");
  });

  it("a date range matches on posted date, falling back to submitted date for links not yet posted", () => {
    const from = new Date("2026-09-01T00:00:00.000Z");
    const to = new Date("2026-09-30T23:59:59.999Z");
    expect(pendingLinksWhere({ from, to }).OR).toEqual([{ postedAt: { gte: from, lte: to } }, { postedAt: null, createdAt: { gte: from, lte: to } }]);
  });

  it("listPendingLinks resolves screenshot URLs", async () => {
    mockPrisma.link.findMany.mockResolvedValue([{ id: "l1", screenshot: { publicId: "shots/l1" } }, { id: "l2", screenshot: null }]);
    mockPrisma.link.count.mockResolvedValue(2);
    const result = await listPendingLinks(finance, {});
    expect(result.total).toBe(2);
    expect(result.items[0].screenshot.url).toBe("https://cdn/shots/l1");
    expect(result.items[1].screenshot).toBeNull();
  });
});

describe("payoutsWhere — the Paid tab's filters (24 Sep redesign)", () => {
  const from = new Date("2026-09-01T00:00:00.000Z");
  const to = new Date("2026-09-30T23:59:59.999Z");

  it("the Paid list is ordered by paid date (a backdated payment sorts where its date says)", async () => {
    mockPrisma.payout.findMany.mockResolvedValue([]);
    mockPrisma.payout.count.mockResolvedValue(0);
    await listMyPayouts({ id: "creator-1", role: "CREATOR" }, {});
    expect(mockPrisma.payout.findMany.mock.calls[0][0].orderBy).toEqual([{ paidAt: "desc" }, { createdAt: "desc" }]);
  });

  it("the month filter on PAID payouts goes by paid date, not created date", () => {
    const where = payoutsWhere({ status: "PAID", from, to });
    expect(where.paidAt).toEqual({ gte: from, lte: to });
    expect(where.createdAt).toBeUndefined();
  });

  it("drafts (no paidAt yet) still filter by created date", () => {
    expect(payoutsWhere({ status: "DRAFT", from }).createdAt).toEqual({ gte: from });
  });

  it("page and page search match payouts containing at least one such link", () => {
    expect(payoutsWhere({ assetId: "asset-1", q: "memes" }).items).toEqual({
      some: { link: { assetId: "asset-1", asset: { handle: { contains: "memes", mode: "insensitive" } } } },
    });
  });
});

describe("creator's own Payments view — scoped to the caller, whatever the query says (24 Sep)", () => {
  const creator = { id: "creator-1", role: "CREATOR" };

  beforeEach(() => {
    mockPrisma.link.findMany.mockResolvedValue([]);
    mockPrisma.link.count.mockResolvedValue(0);
    mockPrisma.payout.findMany.mockResolvedValue([]);
    mockPrisma.payout.count.mockResolvedValue(0);
  });

  it("pending: forces ownerId to the caller even if another vendor's id is passed", async () => {
    await listMyPendingLinks(creator, { ownerId: "creator-2" });
    expect(mockPrisma.link.findMany.mock.calls[0][0].where.asset.ownerId).toBe("creator-1");
    expect(mockPrisma.link.count.mock.calls[0][0].where.asset.ownerId).toBe("creator-1");
  });

  it("paid: forces creatorId to the caller and status to PAID (no drafts, no one else's)", async () => {
    await listMyPayouts(creator, { creatorId: "creator-2", status: "DRAFT" });
    const { where } = mockPrisma.payout.findMany.mock.calls[0][0];
    expect(where.creatorId).toBe("creator-1");
    expect(where.status).toBe("PAID");
  });
});
