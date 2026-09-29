import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApiError } from "../../middleware/errorHandler.js";

// One mock object plays both `prisma` and the `tx` handed to
// $transaction's callback — the distinction doesn't matter for these
// tests, only that every call lands on a spy we can assert against.
const mockPrisma = {
  link: { findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  invoice: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  invoiceItem: { deleteMany: vi.fn(), count: vi.fn(async () => 0) },
  payoutItem: { count: vi.fn(async () => 0) },
  linkStatusEvent: { create: vi.fn(), createMany: vi.fn(), findFirst: vi.fn() },
  campaign: { findFirst: vi.fn() },
  user: { findUnique: vi.fn() },
  $transaction: vi.fn(async (cb) => cb(mockPrisma)),
};

vi.mock("../../lib/prisma.js", () => ({ prisma: mockPrisma }));
vi.mock("../notifications/service.js", () => ({ notify: vi.fn() }));
vi.mock("../billing/service.js", () => ({ getApprovedForUser: vi.fn(async () => null) }));
const mockCloudinary = {
  buildInvoiceAttachmentKey: vi.fn((id) => `invoice-attachments/${id}/uuid`),
  buildInvoiceReceiptKey: vi.fn((id) => `invoice-receipts/${id}/uuid`),
  getUploadParams: vi.fn((publicId) => ({ uploadUrl: "https://upload", apiKey: "k", timestamp: 1, signature: "s", publicId })),
  objectExists: vi.fn(async () => true),
  publicUrlFor: vi.fn((id) => `https://cdn/${id}`),
};
vi.mock("../../lib/cloudinaryClient.js", () => mockCloudinary);
// The over-quota rule is tested in lib/postQuota.test.js; here only that the gates call it.
vi.mock("../../lib/postQuota.js", () => ({ refreshPostQuotaForLinks: vi.fn(async () => {}) }));
const { refreshPostQuotaForLinks } = await import("../../lib/postQuota.js");

const {
  bulkCreateInvoice,
  rejectInvoice,
  approveInvoice,
  confirmAttachment,
  requestAttachmentUpload,
  removeAttachment,
  requestInvoiceReceiptUpload,
  confirmInvoiceReceipt,
} = await import("./service.js");

const admin = { id: "admin-1", role: "ADMIN" };
// The links in link() below belong to creator-1 — the actor who may raise them.
const creator = { id: "creator-1", role: "CREATOR" };
const planMaker = { id: "pm-1", role: "PLAN_MAKER" };
const finance = { id: "fin-1", role: "FINANCE" };

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
  // finance.view scoping (23 Sep, Step 3) is read fresh from the DB —
  // derive a plausible role from this file's id fixtures (admin-*/fin-*/
  // creator-*) so existing calls work without every test stubbing this.
  mockPrisma.user.findUnique.mockImplementation(async ({ where }) => ({
    role: where.id?.startsWith("admin") ? "ADMIN" : where.id?.startsWith("fin") ? "FINANCE" : where.id?.startsWith("pm") ? "PLAN_MAKER" : "CREATOR",
    permissions: null,
  }));
});

describe("bulkCreateInvoice — eligibility (screenshot and insights are both optional proof, user request 12 Sep)", () => {
  it("accepts SCREENSHOT_APPROVED and INSIGHTS_PENDING links, not just INSIGHTS_APPROVED", async () => {
    mockPrisma.link.findMany.mockResolvedValue([
      link({ id: "l1", status: "SCREENSHOT_APPROVED" }),
      link({ id: "l2", status: "INSIGHTS_PENDING" }),
    ]);

    await expect(bulkCreateInvoice(creator, { linkIds: ["l1", "l2"], dueInDays: 15, isGstInvoice: false })).resolves.toBeTruthy();
  });

  it("accepts a bare SUBMITTED link and one still awaiting screenshot review — a screenshot is no longer a gate", async () => {
    mockPrisma.link.findMany.mockResolvedValue([
      link({ id: "l1", status: "SUBMITTED" }),
      link({ id: "l2", status: "PENDING_SCREENSHOT_REVIEW" }),
    ]);

    await expect(bulkCreateInvoice(creator, { linkIds: ["l1", "l2"], dueInDays: 15, isGstInvoice: false })).resolves.toBeTruthy();
  });

  it("still rejects a link whose screenshot was explicitly rejected", async () => {
    mockPrisma.link.findMany.mockResolvedValue([link({ id: "l1", status: "SCREENSHOT_REJECTED" })]);

    await expect(bulkCreateInvoice(creator, { linkIds: ["l1"], dueInDays: 15, isGstInvoice: false })).rejects.toMatchObject({
      code: "INELIGIBLE_LINKS",
    });
  });

  it("still rejects a link an admin marked broken (INVALID)", async () => {
    mockPrisma.link.findMany.mockResolvedValue([link({ id: "l1", status: "INVALID" })]);

    await expect(bulkCreateInvoice(creator, { linkIds: ["l1"], dueInDays: 15, isGstInvoice: false })).rejects.toMatchObject({
      code: "INELIGIBLE_LINKS",
    });
  });

  it("rejects a link that's already on an invoice", async () => {
    mockPrisma.link.findMany.mockResolvedValue([link({ id: "l1", invoiceItem: { id: "item-1" } })]);

    await expect(bulkCreateInvoice(creator, { linkIds: ["l1"], dueInDays: 15, isGstInvoice: false })).rejects.toBeInstanceOf(ApiError);
  });

  it("regression (24 Sep review): rejects a link already on a payout awaiting its receipt — a link is on an Invoice OR a Payout", async () => {
    mockPrisma.link.findMany.mockResolvedValue([link({ id: "l1", url: "https://ig/p/7", payoutItem: { payoutId: "payout-1" } })]);

    await expect(bulkCreateInvoice(creator, { linkIds: ["l1"], dueInDays: 15, isGstInvoice: false })).rejects.toMatchObject({
      code: "INELIGIBLE_LINKS",
      message: expect.stringContaining("https://ig/p/7 (already on a payout awaiting its receipt)"),
    });
    expect(mockPrisma.invoice.create).not.toHaveBeenCalled();
  });

  it("a CREATOR can only raise an invoice for their own pages", async () => {
    mockPrisma.link.findMany.mockResolvedValue([link({ id: "l1", asset: { ownerId: "creator-2" } })]);

    await expect(bulkCreateInvoice({ id: "creator-1", role: "CREATOR" }, { linkIds: ["l1"], dueInDays: 15, isGstInvoice: false })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(mockPrisma.invoice.create).not.toHaveBeenCalled();

    await expect(bulkCreateInvoice({ id: "creator-2", role: "CREATOR" }, { linkIds: ["l1"], dueInDays: 15, isGstInvoice: false })).resolves.toBeTruthy();
  });

  it("names the invoice a drifted link already sits on, rather than failing on the unique constraint", async () => {
    mockPrisma.link.findMany.mockResolvedValue([
      link({ id: "l1", status: "INSIGHTS_APPROVED", url: "https://ig/p/1", invoiceItem: { invoiceId: "inv-9", invoice: { invoiceNumber: "INV-9", status: "RAISED" } } }),
    ]);

    await expect(bulkCreateInvoice(creator, { linkIds: ["l1"], dueInDays: 15, isGstInvoice: false })).rejects.toMatchObject({
      code: "INELIGIBLE_LINKS",
      message: expect.stringContaining("https://ig/p/1 (already on invoice INV-9)"),
    });
  });

  it("rejects links belonging to different creators in one invoice", async () => {
    mockPrisma.link.findMany.mockResolvedValue([
      link({ id: "l1", asset: { ownerId: "creator-1" } }),
      link({ id: "l2", asset: { ownerId: "creator-2" } }),
    ]);

    await expect(bulkCreateInvoice(creator, { linkIds: ["l1", "l2"], dueInDays: 15, isGstInvoice: false })).rejects.toMatchObject({
      code: "MIXED_CREATORS",
    });
  });

  // 29 Sep — "it's creator fault not admin/finance": a post beyond what the
  // campaign booked for the page never goes on an invoice.
  it("refuses a post beyond its page's booking, re-deriving the flags before anything is billed", async () => {
    mockPrisma.link.findMany.mockResolvedValue([link({ id: "l1", url: "https://ig/p/extra", campaignId: "c1", assetId: "a1", overQuota: true })]);

    await expect(bulkCreateInvoice(creator, { linkIds: ["l1"], dueInDays: 15, isGstInvoice: false })).rejects.toMatchObject({
      code: "INELIGIBLE_LINKS",
      message: expect.stringContaining("https://ig/p/extra (beyond the posts booked for this page on that campaign)"),
    });
    expect(refreshPostQuotaForLinks).toHaveBeenCalled();
    expect(mockPrisma.invoice.create).not.toHaveBeenCalled();
  });
});

describe("bulkCreateInvoice — GST (newTask.md #4: GST invoice auto-adds 18%)", () => {
  it("non-GST invoice: amount equals the subtotal, no GST added", async () => {
    mockPrisma.link.findMany.mockResolvedValue([link({ id: "l1", cost: 1000 }), link({ id: "l2", cost: 2000 })]);

    await bulkCreateInvoice(creator, { linkIds: ["l1", "l2"], dueInDays: 15, isGstInvoice: false });

    expect(mockPrisma.invoice.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ subtotal: 3000, gstAmount: 0, amount: 3000, isGstInvoice: false }) })
    );
  });

  it("GST invoice: adds exactly 18% on top of the subtotal", async () => {
    mockPrisma.link.findMany.mockResolvedValue([link({ id: "l1", cost: 1000 }), link({ id: "l2", cost: 2000 })]);

    await bulkCreateInvoice(creator, { linkIds: ["l1", "l2"], dueInDays: 15, isGstInvoice: true });

    expect(mockPrisma.invoice.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ subtotal: 3000, gstAmount: 540, amount: 3540, isGstInvoice: true }) })
    );
  });
});

describe("bulkCreateInvoice — creators only (user request, 13 Sep: \"invoice will be generated by creator's only\")", () => {
  it("rejects an ADMIN, PLAN_MAKER or FINANCE actor before touching any link", async () => {
    for (const actor of [admin, planMaker, finance]) {
      await expect(bulkCreateInvoice(actor, { linkIds: ["l1"], dueInDays: 15, isGstInvoice: false })).rejects.toMatchObject({ code: "CREATOR_ONLY" });
    }
    expect(mockPrisma.link.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.invoice.create).not.toHaveBeenCalled();
  });

  it("records the creator as the raiser of their own invoice", async () => {
    mockPrisma.link.findMany.mockResolvedValue([link({ id: "l1" })]);
    await bulkCreateInvoice(creator, { linkIds: ["l1"], dueInDays: 15, isGstInvoice: false });
    expect(mockPrisma.invoice.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ creatorId: "creator-1", raisedById: "creator-1", status: "RAISED" }) })
    );
  });
});

describe("approveInvoice — admin sign-off, RAISED → APPROVED", () => {
  it("moves a RAISED invoice to APPROVED", async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue({ id: "inv-1", status: "RAISED", creatorId: "creator-1", items: [] });
    mockPrisma.invoice.update.mockImplementation(async ({ data }) => ({ id: "inv-1", ...data }));

    const result = await approveInvoice("inv-1", admin);

    expect(mockPrisma.invoice.update).toHaveBeenCalledWith({ where: { id: "inv-1" }, data: { status: "APPROVED" } });
    expect(result.status).toBe("APPROVED");
  });

  // User decision, 29 Sep: an invoice carrying posts beyond the campaign's
  // booking is flagged and blocked — rejected and re-raised, never approved
  // (or paid) for more than was booked, and never rewritten in place.
  it("refuses an invoice with posts beyond the booking, re-deriving the flags first", async () => {
    const items = [{ link: { campaignId: "c1", assetId: "a1" } }, { link: { campaignId: "c1", assetId: "a1" } }];
    mockPrisma.invoice.findUnique.mockResolvedValue({ id: "inv-1", status: "RAISED", creatorId: "creator-1", items });
    mockPrisma.invoiceItem.count.mockResolvedValue(1);

    await expect(approveInvoice("inv-1", admin)).rejects.toMatchObject({ code: "OVER_QUOTA", statusCode: 409 });
    expect(refreshPostQuotaForLinks).toHaveBeenCalledWith(items.map((i) => i.link));
    expect(mockPrisma.invoice.update).not.toHaveBeenCalled();
  });

  it.each(["APPROVED", "PAID", "REJECTED", "DRAFT"])("refuses to approve a %s invoice", async (status) => {
    mockPrisma.invoice.findUnique.mockResolvedValue({ id: "inv-1", status, creatorId: "creator-1" });

    await expect(approveInvoice("inv-1", admin)).rejects.toMatchObject({ code: "INVALID_STATUS" });
    expect(mockPrisma.invoice.update).not.toHaveBeenCalled();
  });

  it("404s on an unknown invoice", async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue(null);
    await expect(approveInvoice("nope", admin)).rejects.toMatchObject({ code: "INVOICE_NOT_FOUND" });
  });
});

describe("invoice attachment — the creator's own invoice document (12 Sep)", () => {
  const detail = (overrides = {}) => ({ id: "inv-1", status: "APPROVED", creatorId: "creator-1", campaignId: null, items: [], attachmentPublicId: null, ...overrides });

  it("the billed creator can request an upload key scoped to their invoice", async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue(detail());
    const params = await requestAttachmentUpload("inv-1", { id: "creator-1", role: "CREATOR" });
    expect(params.publicId).toBe("invoice-attachments/inv-1/uuid");
  });

  it("another creator gets a 404, not the key", async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue(detail());
    await expect(requestAttachmentUpload("inv-1", { id: "creator-2", role: "CREATOR" })).rejects.toMatchObject({ code: "INVOICE_NOT_FOUND" });
  });

  it("confirm stores the key + file name and returns a usable URL", async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue(detail());
    mockPrisma.invoice.update.mockImplementation(async ({ data }) => ({ ...detail(), ...data }));

    const result = await confirmAttachment("inv-1", finance, { publicId: "invoice-attachments/inv-1/uuid", fileName: "gst-invoice.pdf" });

    expect(result).toMatchObject({ name: "gst-invoice.pdf", url: "https://cdn/invoice-attachments/inv-1/uuid" });
    expect(mockPrisma.invoice.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ attachmentPublicId: "invoice-attachments/inv-1/uuid", attachmentName: "gst-invoice.pdf", attachmentUploadedById: "fin-1" }) })
    );
  });

  it("confirm rejects a key that belongs to a different invoice", async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue(detail());
    await expect(confirmAttachment("inv-1", admin, { publicId: "invoice-attachments/inv-2/uuid", fileName: "x.pdf" })).rejects.toMatchObject({ code: "KEY_MISMATCH" });
  });

  it("confirm 422s when nothing actually landed at the key", async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue(detail());
    mockCloudinary.objectExists.mockResolvedValueOnce(false);
    await expect(confirmAttachment("inv-1", admin, { publicId: "invoice-attachments/inv-1/uuid", fileName: "x.pdf" })).rejects.toMatchObject({ code: "UPLOAD_NOT_FOUND" });
  });

  it("a paid invoice's attachment is frozen", async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue(detail({ status: "PAID", attachmentPublicId: "invoice-attachments/inv-1/old" }));
    await expect(removeAttachment("inv-1", admin)).rejects.toMatchObject({ code: "ALREADY_PAID" });
    await expect(requestAttachmentUpload("inv-1", admin)).rejects.toMatchObject({ code: "ALREADY_PAID" });
  });

  it("remove clears the reference fields", async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue(detail({ attachmentPublicId: "invoice-attachments/inv-1/old" }));
    mockPrisma.invoice.update.mockResolvedValue({});
    await removeAttachment("inv-1", admin);
    expect(mockPrisma.invoice.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { attachmentPublicId: null, attachmentName: null, attachmentUploadedById: null, attachmentUploadedAt: null } })
    );
  });
});

describe("requestInvoiceReceiptUpload / confirmInvoiceReceipt — Finance backfilling proof of payment onto a legacy standalone-paid invoice (28 Sep fix)", () => {
  const standalonePaid = { id: "inv-1", status: "PAID", creatorId: "creator-1", items: [{ link: { payoutItem: null } }] };
  const paidViaPayout = { id: "inv-1", status: "PAID", creatorId: "creator-1", items: [{ link: { payoutItem: { payoutId: "payout-1" } } }] };

  it("mints an upload key for a standalone-paid invoice", async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue(standalonePaid);
    const params = await requestInvoiceReceiptUpload("inv-1");
    expect(params.publicId).toBe("invoice-receipts/inv-1/uuid");
  });

  it("refuses to mint an upload key for an invoice paid through a payout — that receipt lives on the payout instead", async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue(paidViaPayout);
    await expect(requestInvoiceReceiptUpload("inv-1")).rejects.toMatchObject({ code: "PAID_VIA_PAYOUT" });
  });

  it("refuses an invoice that isn't paid yet", async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue({ ...standalonePaid, status: "APPROVED" });
    await expect(requestInvoiceReceiptUpload("inv-1")).rejects.toMatchObject({ code: "INVALID_STATUS" });
  });

  it("confirms the receipt once the object exists at the expected key", async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue(standalonePaid);
    mockPrisma.invoice.update.mockImplementation(async ({ data }) => ({ ...standalonePaid, ...data }));

    const receipt = await confirmInvoiceReceipt("inv-1", finance, { publicId: "invoice-receipts/inv-1/uuid", fileName: "receipt.pdf" });
    expect(receipt.name).toBe("receipt.pdf");
    expect(mockPrisma.invoice.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ receiptPublicId: "invoice-receipts/inv-1/uuid", receiptName: "receipt.pdf", receiptUploadedById: finance.id }) })
    );
  });

  it("rejects a key that doesn't belong to this invoice", async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue(standalonePaid);
    await expect(confirmInvoiceReceipt("inv-1", finance, { publicId: "invoice-receipts/inv-2/uuid", fileName: "receipt.pdf" })).rejects.toMatchObject({ code: "KEY_MISMATCH" });
  });

  it("rejects when the upload never actually completed", async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue(standalonePaid);
    mockCloudinary.objectExists.mockResolvedValueOnce(false);
    await expect(confirmInvoiceReceipt("inv-1", finance, { publicId: "invoice-receipts/inv-1/uuid", fileName: "receipt.pdf" })).rejects.toMatchObject({ code: "UPLOAD_NOT_FOUND" });
  });
});

describe("rejectInvoice — restores each link's actual prior status", () => {
  const rejectedInvoice = { id: "inv-1", status: "RAISED", creatorId: "creator-1", items: [{ linkId: "l1" }] };

  it("releases the links by deleting the invoice's items, so they can be invoiced again (InvoiceItem.linkId is unique)", async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue(rejectedInvoice);
    mockPrisma.invoice.update.mockResolvedValue({ ...rejectedInvoice, status: "REJECTED" });
    mockPrisma.linkStatusEvent.findFirst.mockResolvedValue({ status: "SUBMITTED" });

    await rejectInvoice("inv-1", admin, { remarks: "duplicate" });

    expect(mockPrisma.invoiceItem.deleteMany).toHaveBeenCalledWith({ where: { invoiceId: "inv-1" } });
  });

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

  it("restores to SUBMITTED for a link that was invoiced straight from submission (no screenshot ever uploaded)", async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue(rejectedInvoice);
    mockPrisma.invoice.update.mockResolvedValue({ ...rejectedInvoice, status: "REJECTED" });
    mockPrisma.linkStatusEvent.findFirst.mockResolvedValue({ status: "SUBMITTED" });

    await rejectInvoice("inv-1", admin, { remarks: "duplicate" });

    expect(mockPrisma.link.update).toHaveBeenCalledWith({ where: { id: "l1" }, data: { status: "SUBMITTED" } });
  });

  it("falls back to SUBMITTED when there's no prior non-INVOICED event on record", async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue(rejectedInvoice);
    mockPrisma.invoice.update.mockResolvedValue({ ...rejectedInvoice, status: "REJECTED" });
    mockPrisma.linkStatusEvent.findFirst.mockResolvedValue(null);

    await rejectInvoice("inv-1", admin, { remarks: "duplicate" });

    expect(mockPrisma.link.update).toHaveBeenCalledWith({ where: { id: "l1" }, data: { status: "SUBMITTED" } });
  });

  it("refuses to reject an already-paid invoice", async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue({ ...rejectedInvoice, status: "PAID" });

    await expect(rejectInvoice("inv-1", admin, { remarks: "x" })).rejects.toMatchObject({ code: "ALREADY_PAID" });
  });

  it("25 Sep review: refuses to reject an invoice whose links are on a payout awaiting its receipt", async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue(rejectedInvoice);
    mockPrisma.payoutItem.count.mockResolvedValueOnce(1);

    await expect(rejectInvoice("inv-1", admin, { remarks: "x" })).rejects.toMatchObject({ code: "ON_PAYOUT" });
    expect(mockPrisma.invoice.update).not.toHaveBeenCalled();
  });
});
