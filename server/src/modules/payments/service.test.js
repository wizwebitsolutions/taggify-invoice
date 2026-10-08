import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApiError } from "../../middleware/errorHandler.js";

const mockPrisma = {
  link: { findMany: vi.fn(), count: vi.fn(), updateMany: vi.fn(), aggregate: vi.fn() },
  invoiceItem: { count: vi.fn(async () => 0) },
  invoice: { findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn(), aggregate: vi.fn(), count: vi.fn() },
  linkStatusEvent: { createMany: vi.fn() },
  payoutItem: { findMany: vi.fn(), count: vi.fn(async () => 0) },
  payout: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn(), delete: vi.fn(), findMany: vi.fn(), count: vi.fn(), aggregate: vi.fn() },
  $transaction: vi.fn(async (arg) => (Array.isArray(arg) ? Promise.all(arg) : arg(mockPrisma))),
};

vi.mock("../../lib/prisma.js", () => ({ prisma: mockPrisma }));
vi.mock("../notifications/service.js", () => ({ notify: vi.fn() }));
const { notify } = await import("../notifications/service.js");
const mockCloudinary = {
  buildPayoutReceiptKey: vi.fn((id) => `payout-receipts/${id}/uuid`),
  getUploadParams: vi.fn((publicId) => ({ uploadUrl: "https://upload", apiKey: "k", timestamp: 1, signature: "s", publicId })),
  objectExists: vi.fn(async () => true),
  publicUrlFor: vi.fn((id) => `https://cdn/${id}`),
};
vi.mock("../../lib/cloudinaryClient.js", () => mockCloudinary);
// The over-quota rule is tested in lib/postQuota.test.js; here only that paying re-checks it first.
vi.mock("../../lib/postQuota.js", () => ({ refreshPostQuotaForLinks: vi.fn(async () => {}) }));
const { refreshPostQuotaForLinks } = await import("../../lib/postQuota.js");

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
  pendingInvoicesWhere,
  getPaymentSummary,
  getMyPaymentSummary,
  standalonePaidInvoicesWhere,
  listPaidLedger,
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
  mockPrisma.payoutItem.findMany.mockResolvedValue([]);
  mockPrisma.invoice.findMany.mockResolvedValue([]);
  mockPrisma.invoice.count.mockResolvedValue(0);
  mockPrisma.invoice.create.mockImplementation(async ({ data }) => ({ ...data, id: "auto-inv-1" }));
  mockPrisma.invoice.updateMany.mockResolvedValue({ count: 1 });
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

  // 29 Sep — "it's creator fault not admin/finance": a post beyond what the
  // campaign booked for the page is never paid. The flags are re-derived first,
  // so a stale one can't slip an extra post onto a payout.
  it("refuses a post beyond its page's booking, re-checking the flags before paying", async () => {
    mockPrisma.link.findMany.mockResolvedValue([link({ id: "l1", url: "https://ig/p/extra", overQuota: true })]);

    await expect(createPayout(finance, { creatorId: "creator-1", linkIds: ["l1"], isGstInvoice: false, tdsPercent: null })).rejects.toMatchObject({
      code: "INELIGIBLE_LINKS",
      message: expect.stringContaining("beyond the posts booked"),
    });
    expect(refreshPostQuotaForLinks).toHaveBeenCalled();
    expect(mockPrisma.payout.create).not.toHaveBeenCalled();
  });

  it("refuses to pay off an invoice that carries posts beyond the booking — it has to be re-raised", async () => {
    mockPrisma.link.findMany.mockResolvedValue([]);
    mockPrisma.invoice.findMany.mockResolvedValue([
      { id: "inv-1", invoiceNumber: "INV-1", status: "RAISED", creatorId: "creator-1", subtotal: 2000, gstAmount: 0, items: [{ link: { id: "a", payoutItem: null, overQuota: false } }, { link: { id: "b", payoutItem: null, overQuota: true } }] },
    ]);

    await expect(createPayout(finance, { creatorId: "creator-1", invoiceIds: ["inv-1"], isGstInvoice: false, tdsPercent: null })).rejects.toMatchObject({
      code: "INELIGIBLE_INVOICES",
      message: expect.stringContaining("beyond the booking"),
    });
    expect(mockPrisma.payout.create).not.toHaveBeenCalled();
  });

  it("rejects a link already on an invoice and says to pay the invoice instead", async () => {
    mockPrisma.link.findMany.mockResolvedValue([link({ id: "l1", url: "https://ig/p/1", status: "INVOICED", invoiceItem: { invoiceId: "inv-1", invoice: { invoiceNumber: "INV-9" } } })]);

    await expect(createPayout(finance, { creatorId: "creator-1", linkIds: ["l1"], isGstInvoice: false, tdsPercent: null })).rejects.toMatchObject({
      code: "INELIGIBLE_LINKS",
      message: expect.stringContaining("pay that invoice instead"),
    });
    expect(mockPrisma.payout.create).not.toHaveBeenCalled();
  });

  it("25 Sep: can pay a raised invoice — its links go on the payout and its own GST carries into the totals", async () => {
    mockPrisma.invoice.findMany.mockResolvedValue([
      { id: "inv-1", invoiceNumber: "INV-1", creatorId: "creator-1", status: "RAISED", subtotal: 2000, gstAmount: 360, items: [{ link: { id: "il1", cost: 2000, payoutItem: null } }] },
    ]);
    mockPrisma.link.findMany.mockResolvedValue([link({ id: "l1", cost: 1000 })]);

    const payout = await createPayout(finance, { creatorId: "creator-1", linkIds: ["l1"], invoiceIds: ["inv-1"], isGstInvoice: true, tdsPercent: 10 });

    // links 1000 (+180 GST because the payout is a GST one) + invoice 2000 (+360 its own GST); TDS 10% of 3000
    expect(payout).toMatchObject({ subtotal: 3000, gstAmount: 540, tdsAmount: 300, netAmount: 3240, status: "DRAFT" });
    expect(mockPrisma.payout.create.mock.calls[0][0].data.items.create.map((i) => i.linkId)).toEqual(["l1", "il1"]);
  });

  it("rejects an invoice that is already paid, rejected, or has a link on another payout — those can't be selected", async () => {
    for (const [status, payoutItem, text] of [["PAID", null, "already paid"], ["REJECTED", null, "rejected"], ["APPROVED", { payoutId: "p9" }, "already on a payout"]]) {
      mockPrisma.invoice.findMany.mockResolvedValue([{ id: "inv-1", invoiceNumber: "INV-1", creatorId: "creator-1", status, subtotal: 1, gstAmount: 0, items: [{ link: { id: "il1", cost: 1, payoutItem } }] }]);
      await expect(createPayout(finance, { creatorId: "creator-1", invoiceIds: ["inv-1"], isGstInvoice: false, tdsPercent: null })).rejects.toMatchObject({
        code: "INELIGIBLE_INVOICES",
        message: expect.stringContaining(text),
      });
    }
    expect(mockPrisma.payout.create).not.toHaveBeenCalled();
  });

  it("rejects an invoice belonging to a different vendor", async () => {
    mockPrisma.invoice.findMany.mockResolvedValue([{ id: "inv-1", invoiceNumber: "INV-1", creatorId: "creator-2", status: "RAISED", subtotal: 1, gstAmount: 0, items: [] }]);
    await expect(createPayout(finance, { creatorId: "creator-1", invoiceIds: ["inv-1"], isGstInvoice: false, tdsPercent: null })).rejects.toMatchObject({ code: "MIXED_CREATORS" });
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

// Review finding, 29 Sep: a draft can sit for days after createPayout checked
// it, and a scrape in between can move a post on it past the booking — so the
// confirm (where money actually leaves) re-checks too.
describe("confirmPayoutReceipt — re-checks the post quota before paying", () => {
  it("refuses to pay a draft whose posts are now beyond the booking, and writes nothing", async () => {
    draftThenWritten({ id: "payout-1", status: "DRAFT", creatorId: "creator-1" });
    mockPrisma.link.findMany.mockResolvedValue([{ campaignId: "c1", assetId: "a1" }]);
    mockPrisma.payoutItem.count.mockResolvedValueOnce(1);

    await expect(confirmPayoutReceipt("payout-1", finance, { publicId: "payout-receipts/payout-1/uuid", fileName: "r.pdf" })).rejects.toMatchObject({
      code: "OVER_QUOTA",
      statusCode: 409,
    });
    expect(refreshPostQuotaForLinks).toHaveBeenCalledWith([{ campaignId: "c1", assetId: "a1" }]);
    expect(mockPrisma.payout.updateMany).not.toHaveBeenCalled();
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

describe("confirmPayoutReceipt — paying raises/settles the creator's invoice (25 Sep)", () => {
  const paidOn = new Date("2026-09-20T00:00:00.000Z");
  const receipt = { publicId: "payout-receipts/payout-1/uuid", fileName: "r.pdf", paidOn };

  it("unbilled links: raises an invoice for the creator, already PAID/COMPLETED, and marks the links INVOICED", async () => {
    draftThenWritten({ id: "payout-1", status: "DRAFT", creatorId: "creator-1", isGstInvoice: true });
    mockPrisma.payoutItem.findMany.mockResolvedValue([
      { link: { id: "l1", cost: 1000, campaignId: "c1", invoiceItem: null } },
      { link: { id: "l2", cost: 500, campaignId: "c1", invoiceItem: null } },
    ]);

    await confirmPayoutReceipt("payout-1", finance, receipt);

    const data = mockPrisma.invoice.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      creatorId: "creator-1", campaignId: "c1", status: "PAID", paymentStatus: "COMPLETED", gstStatus: "COMPLETED",
      isGstInvoice: true, subtotal: 1500, gstAmount: 270, amount: 1770, paidAt: paidOn, raisedById: "fin-1",
    });
    expect(data.items.create).toEqual([{ linkId: "l1", amount: 1000 }, { linkId: "l2", amount: 500 }]);
    expect(mockPrisma.link.updateMany).toHaveBeenCalledWith({ where: { id: { in: ["l1", "l2"] } }, data: { status: "INVOICED" } });
    expect(mockPrisma.invoice.updateMany).not.toHaveBeenCalled();
  });

  it("links on a creator invoice: pays that invoice off (no second invoice), only if still RAISED/APPROVED", async () => {
    draftThenWritten({ id: "payout-1", status: "DRAFT", creatorId: "creator-1", isGstInvoice: false });
    mockPrisma.payoutItem.findMany.mockResolvedValue([
      { link: { id: "l1", cost: 1000, invoiceItem: { invoiceId: "inv-1" } } },
      { link: { id: "l2", cost: 500, invoiceItem: { invoiceId: "inv-1" } } },
    ]);

    await confirmPayoutReceipt("payout-1", finance, receipt);

    expect(mockPrisma.invoice.create).not.toHaveBeenCalled();
    expect(mockPrisma.invoice.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["inv-1"] }, status: { in: ["RAISED", "APPROVED"] } },
      data: { status: "PAID", paymentStatus: "COMPLETED", paidAt: paidOn },
    });
    // Notification-gap fix (28 Sep): paying off an existing invoice (no
    // unbilled links, so no createdInvoice) must still notify — this is the
    // only path a creator-raised invoice ever gets paid through now that the
    // bare direct mark-paid is gone.
    expect(notify).toHaveBeenCalledWith("creator-1", "invoice_paid", { invoiceId: "inv-1", markedById: "fin-1" });
  });

  it("25 Sep review: an invoice paid/rejected meanwhile aborts the confirm (409) instead of paying it twice", async () => {
    draftThenWritten({ id: "payout-1", status: "DRAFT", creatorId: "creator-1", isGstInvoice: false });
    mockPrisma.payoutItem.findMany.mockResolvedValue([{ link: { id: "l1", cost: 1000, invoiceItem: { invoiceId: "inv-1" } } }]);
    mockPrisma.invoice.updateMany.mockResolvedValue({ count: 0 }); // already PAID in the Invoices section

    await expect(confirmPayoutReceipt("payout-1", finance, receipt)).rejects.toMatchObject({ code: "INVOICE_CHANGED" });
  });

  it("a non-GST payout leaves the auto invoice's GST status alone", async () => {
    draftThenWritten({ id: "payout-1", status: "DRAFT", creatorId: "creator-1", isGstInvoice: false });
    mockPrisma.payoutItem.findMany.mockResolvedValue([{ link: { id: "l1", cost: 1000, campaignId: "c1", invoiceItem: null } }]);
    await confirmPayoutReceipt("payout-1", finance, receipt);
    expect(mockPrisma.invoice.create.mock.calls[0][0].data).toMatchObject({ gstAmount: 0, gstStatus: "PENDING" });
  });

  it("a lost race (409) creates no invoice", async () => {
    draftThenWritten({ id: "payout-1", status: "DRAFT", creatorId: "creator-1", isGstInvoice: false });
    mockPrisma.payout.updateMany.mockResolvedValue({ count: 0 });
    await expect(confirmPayoutReceipt("payout-1", finance, receipt)).rejects.toMatchObject({ code: "INVALID_STATUS" });
    expect(mockPrisma.invoice.create).not.toHaveBeenCalled();
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
  it("with no filters: only unbilled payable links — an eligible status, on no invoice, on no payout (drafts included)", () => {
    const where = pendingLinksWhere({});
    expect(where.invoiceItem).toBeNull();
    expect(where.payoutItem).toBeNull();
    expect(where.status.in).not.toContain("INVOICED");
    expect(where.status.in).toEqual(expect.arrayContaining(["SUBMITTED", "SCREENSHOT_APPROVED"]));
    expect(where.status.in).not.toContain("SCREENSHOT_REJECTED");
    expect(where.status.in).not.toContain("INVALID");
    expect(where.asset).toBeUndefined();
    expect(where.OR).toBeUndefined();
    // 29 Sep: a post beyond its campaign booking is never owed.
    expect(where.overQuota).toBe(false);
  });

  it("an owed invoice carrying posts beyond the booking is listed but not selectable, with how many", async () => {
    mockPrisma.link.findMany.mockResolvedValue([]);
    mockPrisma.link.count.mockResolvedValue(0);
    mockPrisma.invoice.findMany.mockResolvedValue([
      { id: "clean", status: "RAISED", items: [{ link: { id: "a", payoutItem: null, overQuota: false } }] },
      { id: "over", status: "RAISED", items: [{ link: { id: "b", payoutItem: null, overQuota: false } }, { link: { id: "c", payoutItem: null, overQuota: true } }] },
    ]);

    const { invoices } = await listPendingLinks(finance, {});

    expect(invoices.map((i) => [i.id, i.selectable, i.overQuotaCount])).toEqual([
      ["clean", true, 0],
      ["over", false, 1],
    ]);
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

  it("25 Sep: lists owed invoices with their links; only an owed invoice with no link on a payout is selectable — a paid invoice never shows here any more (28 Sep fix: it lives in the Paid tab's merged ledger instead)", async () => {
    mockPrisma.link.findMany.mockResolvedValue([]);
    mockPrisma.link.count.mockResolvedValue(0);
    mockPrisma.invoice.findMany.mockResolvedValue([
      { id: "i1", status: "RAISED", items: [{ link: { id: "a", payoutItem: null } }] },
      { id: "i2", status: "APPROVED", items: [{ link: { id: "b", payoutItem: { payoutId: "p1" } } }] },
    ]);
    const { invoices } = await listPendingLinks(finance, {});
    expect(invoices.map((i) => [i.id, i.selectable])).toEqual([["i1", true], ["i2", false]]);
    expect(invoices[0].links).toEqual([{ id: "a", payoutItem: null }]);
    expect(mockPrisma.invoice.findMany.mock.calls[0][0].where.status.in).toEqual(["RAISED", "APPROVED"]);
  });

  it("invoice filters: always owed, never paid or rejected (28 Sep fix removed the paid/all switch) — vendor and page search still narrow", () => {
    expect(pendingInvoicesWhere({}).status.in).toEqual(["RAISED", "APPROVED"]);
    // A "status" filter that used to mean paid/all is simply ignored now.
    expect(pendingInvoicesWhere({ status: "all" }).status.in).toEqual(["RAISED", "APPROVED"]);
    const w = pendingInvoicesWhere({ ownerId: "creator-1", q: "@memes" });
    expect(w.creatorId).toBe("creator-1");
    expect(w.items).toEqual({ some: { link: { asset: { handle: { contains: "memes", mode: "insensitive" } } } } });
  });
});

describe("standalonePaidInvoicesWhere / listPaidLedger — the Paid tab's merged ledger (28 Sep fix)", () => {
  it("only a PAID invoice with no link on a payout — exactly getPaymentSummary's tile filter, so the two can't drift apart", () => {
    const where = standalonePaidInvoicesWhere({ creatorId: "creator-1" });
    expect(where).toMatchObject({ status: "PAID", creatorId: "creator-1", items: { none: { link: { payoutItem: { isNot: null } } } } });
  });

  it("merges real payouts with standalone-paid invoices, sorted by paidAt desc", async () => {
    mockPrisma.payout.findMany.mockResolvedValue([{ id: "p1", paidAt: new Date("2026-09-10T00:00:00Z"), items: [] }]);
    mockPrisma.payout.count.mockResolvedValue(1);
    mockPrisma.invoice.findMany.mockResolvedValue([{ id: "inv-legacy", paidAt: new Date("2026-09-20T00:00:00Z"), items: [] }]);
    mockPrisma.invoice.count.mockResolvedValue(1);

    const result = await listPaidLedger(finance, {});
    expect(result.total).toBe(2);
    // Newer (the legacy invoice, 20 Sep) sorts before the older payout (10 Sep).
    expect(result.items.map((r) => r.kind)).toEqual(["invoice", "payout"]);
    expect(result.items[0].invoice.id).toBe("inv-legacy");
    expect(result.items[1].payout.id).toBe("p1");
  });

  it("a link already on a payout excludes its invoice — paid-through-a-payout is represented once, as the payout", async () => {
    mockPrisma.payout.findMany.mockResolvedValue([]);
    mockPrisma.payout.count.mockResolvedValue(0);
    await listPaidLedger(finance, {});
    expect(mockPrisma.invoice.findMany.mock.calls[0][0].where.items).toEqual({ none: { link: { payoutItem: { isNot: null } } } });
  });

  it("total comes from a real count, not the capped findMany page — more standalone-paid invoices exist than fit on one page", async () => {
    mockPrisma.payout.findMany.mockResolvedValue([]);
    mockPrisma.payout.count.mockResolvedValue(0);
    // 150 legacy invoices exist; the capped read only returns pageSize (100).
    mockPrisma.invoice.findMany.mockResolvedValue(Array.from({ length: 100 }, (_, i) => ({ id: `inv-${i}`, paidAt: new Date(), items: [] })));
    mockPrisma.invoice.count.mockResolvedValue(150);

    const result = await listPaidLedger(finance, {});
    expect(result.total).toBe(150); // not 100 — that would silently undercount
    expect(result.items).toHaveLength(100);
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
    expect(mockPrisma.invoice.findMany.mock.calls[0][0].where.creatorId).toBe("creator-1");
  });

  it("summary: always scoped to the caller, even if another vendor's id is passed", async () => {
    mockPrisma.link.aggregate.mockResolvedValue({ _sum: { cost: null }, _count: { _all: 0 } });
    mockPrisma.payout.aggregate.mockResolvedValue({ _sum: { netAmount: null }, _count: { _all: 0 } });
    mockPrisma.invoice.aggregate.mockResolvedValue({ _sum: { amount: null }, _count: { _all: 0 } });
    await getMyPaymentSummary(creator, { ownerId: "creator-2" });
    expect(mockPrisma.link.aggregate.mock.calls[0][0].where.asset).toEqual({ ownerId: "creator-1" });
    expect(mockPrisma.invoice.aggregate.mock.calls[0][0].where.creatorId).toBe("creator-1"); // owed invoices
    expect(mockPrisma.invoice.aggregate.mock.calls[1][0].where.creatorId).toBe("creator-1"); // standalone-paid invoices
    expect(mockPrisma.payout.aggregate.mock.calls[0][0].where.creatorId).toBe("creator-1");
  });

  it("paid: forces creatorId to the caller and status to PAID (no drafts, no one else's)", async () => {
    await listMyPayouts(creator, { creatorId: "creator-2", status: "DRAFT" });
    const { where } = mockPrisma.payout.findMany.mock.calls[0][0];
    expect(where.creatorId).toBe("creator-1");
    expect(where.status).toBe("PAID");
  });
});

describe("getPaymentSummary — Pending / Paid tiles that follow the filters (2 Oct)", () => {
  beforeEach(() => {
    // Calls, in order: owed invoices, then standalone-paid invoices.
    mockPrisma.link.aggregate.mockResolvedValue({ _sum: { cost: 300 }, _count: { _all: 3 } });
    mockPrisma.invoice.aggregate
      .mockResolvedValueOnce({ _sum: { amount: 900 }, _count: { _all: 1 } })
      .mockResolvedValueOnce({ _sum: { amount: 250.5 }, _count: { _all: 1 } });
    mockPrisma.invoiceItem.count.mockResolvedValueOnce(2).mockResolvedValueOnce(1);
    mockPrisma.payout.aggregate.mockResolvedValue({ _sum: { netAmount: 1000 }, _count: { _all: 2 } });
    mockPrisma.payoutItem.count.mockResolvedValueOnce(4);
  });

  it("pending = unbilled links + owed invoices; paid = payouts' net + standalone-paid invoices, with link counts", async () => {
    const r = await getPaymentSummary(finance);
    expect(r).toEqual({
      pending: { amount: 1200, links: 5, invoices: 1 },
      paid: { amount: 1250.5, links: 5, payments: 3 },
    });
  });

  it("no 30-day due concept: an old unpaid link is pending, with no date limit unless a month is picked", async () => {
    const r = await getPaymentSummary(finance);
    expect(r).not.toHaveProperty("overdue30");
    expect(r).not.toHaveProperty("dueThisMonth");
    const { where } = mockPrisma.link.aggregate.mock.calls[0][0];
    expect(where.OR).toBeUndefined(); // no posted-date range
    expect(where).toMatchObject({ invoiceItem: null, overQuota: false });
  });

  it("a picked month narrows pending by posted date, owed invoices by raised date, and paid by paid date", async () => {
    const from = new Date("2026-09-01T00:00:00");
    const to = new Date("2026-09-30T23:59:59.999");
    await getPaymentSummary(finance, { from, to, ownerId: "creator-1", q: "memes" });
    const range = { gte: from, lte: to };
    const linkWhere = mockPrisma.link.aggregate.mock.calls[0][0].where;
    expect(linkWhere.OR).toEqual([{ postedAt: range }, { postedAt: null, createdAt: range }]);
    expect(linkWhere.asset).toEqual({ ownerId: "creator-1", handle: { contains: "memes", mode: "insensitive" } });
    expect(mockPrisma.invoice.aggregate.mock.calls[0][0].where).toMatchObject({ creatorId: "creator-1", createdAt: range });
    expect(mockPrisma.payout.aggregate.mock.calls[0][0].where).toMatchObject({ status: "PAID", creatorId: "creator-1", paidAt: range });
    expect(mockPrisma.invoice.aggregate.mock.calls[1][0].where).toMatchObject({ status: "PAID", creatorId: "creator-1", paidAt: range });
  });

  it("a link on a DRAFT payout is still pending (not paid until the receipt is in); one on a PAID payout isn't", async () => {
    await getPaymentSummary(finance);
    const { where } = mockPrisma.link.aggregate.mock.calls[0][0];
    expect(where.payoutItem).toBeUndefined();
    expect(where.AND).toEqual([{ OR: [{ payoutItem: null }, { payoutItem: { payout: { status: "DRAFT" } } }] }]);
    // invoices a payout produced/paid are already in the payout figure
    expect(mockPrisma.invoice.aggregate.mock.calls[1][0].where.items).toEqual({ none: { link: { payoutItem: { isNot: null } } } });
  });
});
