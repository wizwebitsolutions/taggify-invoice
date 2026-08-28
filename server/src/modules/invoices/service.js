import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../middleware/errorHandler.js";
import { notify } from "../notifications/service.js";
import { getApprovedForUser } from "../billing/service.js";
import { nanoid } from "nanoid";

// A link is invoiceable once the screenshot proof of the post is approved —
// that's the real "was the work done" gate. INSIGHTS_PENDING/INSIGHTS_APPROVED
// stay eligible too so a link that's already picked up metrics isn't blocked,
// but insights are NOT required: Apify scraping is flaky (rate limits,
// private accounts, dead links) and creators/team shouldn't be stuck waiting
// on it to get paid. Assumption, stated since the source request was
// ambiguous on this point: the screenshot-approval gate itself stays
// mandatory (it's the actual evidence the post exists) — only the
// insights/metrics step is optional now.
const INVOICEABLE_STATUSES = new Set(["SCREENSHOT_APPROVED", "INSIGHTS_PENDING", "INSIGHTS_APPROVED"]);

// Flat rate, not a lookup table — matches the source request's "automatically
// add 18% gst to amount" exactly. If GST ever needs to vary (by state,
// service category, etc.) this is the one place to generalize.
const GST_RATE = 0.18;

/**
 * Bulk-generates one invoice from a set of eligible links (per
 * recommend.md #3 — replaces one-at-a-time invoicing). Eligibility: screenshot
 * approved (see INVOICEABLE_STATUSES) and not already attached to an
 * invoice. All links must belong to the same creator (an invoice is
 * per-creator).
 *
 * `isGstInvoice` picks which of the two invoice types the raiser wants
 * (newTask.md #4): a GST invoice adds a flat 18% on top of the links'
 * subtotal, a non-GST invoice bills the subtotal as-is. `amount` (the
 * field every other part of the app already reads as "the invoice total" —
 * KPI tiles, markPaid, the PDF's Total line) is always subtotal + gstAmount,
 * so nothing downstream needed to change to understand a GST invoice.
 */
export async function bulkCreateInvoice(admin, { linkIds, dueInDays, isGstInvoice }) {
  const links = await prisma.link.findMany({
    where: { id: { in: linkIds } },
    include: { asset: true, invoiceItem: true },
  });

  if (links.length !== linkIds.length) {
    throw new ApiError(404, "LINK_NOT_FOUND", "One or more links do not exist");
  }
  const ineligible = links.filter((l) => !INVOICEABLE_STATUSES.has(l.status) || l.invoiceItem);
  if (ineligible.length > 0) {
    throw new ApiError(
      400,
      "INELIGIBLE_LINKS",
      `Links not eligible for invoicing (must have an approved screenshot and not already be invoiced): ${ineligible.map((l) => l.id).join(", ")}`
    );
  }
  const creatorIds = new Set(links.map((l) => l.asset.ownerId));
  if (creatorIds.size > 1) {
    throw new ApiError(400, "MIXED_CREATORS", "All links in one invoice must belong to the same creator");
  }
  const creatorId = [...creatorIds][0];
  const subtotal = links.reduce((sum, l) => sum + Number(l.cost), 0);
  // Rounded to paise so float drift can't leave amount !== subtotal + gstAmount by a fraction.
  const gstAmount = isGstInvoice ? Math.round(subtotal * GST_RATE * 100) / 100 : 0;
  const amount = subtotal + gstAmount;
  const dueDate = new Date(Date.now() + dueInDays * 24 * 60 * 60 * 1000);

  const invoice = await prisma.$transaction(async (tx) => {
    const created = await tx.invoice.create({
      data: {
        creatorId,
        invoiceNumber: `INV-${Date.now()}-${nanoid(6).toUpperCase()}`,
        amount,
        subtotal,
        isGstInvoice,
        gstAmount,
        status: "RAISED",
        dueDate,
        items: { create: links.map((l) => ({ linkId: l.id, amount: l.cost })) },
      },
      include: { items: true },
    });

    await tx.link.updateMany({ where: { id: { in: linkIds } }, data: { status: "INVOICED" } });
    for (const linkId of linkIds) {
      await tx.linkStatusEvent.create({ data: { linkId, status: "INVOICED", actedById: admin.id } });
    }

    return created;
  });

  await notify(creatorId, "invoice_raised", { invoiceId: invoice.id, amount });
  return invoice;
}

export async function listInvoices(user, filters) {
  const where = {};
  if (!["ADMIN", "FINANCE"].includes(user.role)) where.creatorId = user.id;
  if (filters.status) where.status = filters.status;
  if (filters.paymentStatus) where.paymentStatus = filters.paymentStatus;
  if (filters.search) where.invoiceNumber = { contains: filters.search, mode: "insensitive" };

  const [items, total] = await prisma.$transaction([
    prisma.invoice.findMany({
      where,
      // creator wasn't included here — the invoices table had nowhere to
      // read a name from and fell back to literally printing "Creator" in
      // that column for every row (see client/app/invoices/page.tsx).
      include: { creator: { select: { id: true, name: true, phoneNumber: true } }, items: { include: { link: true } } },
      orderBy: { createdAt: "desc" },
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
    }),
    prisma.invoice.count({ where }),
  ]);

  // aging indicator (recommend.md #4) computed here rather than stored
  const now = Date.now();
  const withAging = items.map((inv) => ({
    ...inv,
    overdueDays:
      inv.status !== "PAID" && inv.dueDate && inv.dueDate.getTime() < now
        ? Math.floor((now - inv.dueDate.getTime()) / (24 * 60 * 60 * 1000))
        : 0,
  }));

  return { items: withAging, total, page: filters.page, pageSize: filters.pageSize };
}

/** Payments are manual — Finance confirms outside the system, then records it here. No gateway/webhook involved. */
export async function markPaid(invoiceId, financeUser) {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) throw new ApiError(404, "INVOICE_NOT_FOUND", "Invoice not found");
  if (invoice.status === "PAID") {
    throw new ApiError(409, "ALREADY_PAID", "Invoice is already marked paid");
  }

  const updated = await prisma.invoice.update({
    where: { id: invoiceId },
    data: { status: "PAID", paymentStatus: "COMPLETED", paidAt: new Date() },
  });

  await notify(invoice.creatorId, "invoice_paid", { invoiceId, markedById: financeUser.id });
  return updated;
}

export async function updateGstStatus(invoiceId, gstStatus) {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) throw new ApiError(404, "INVOICE_NOT_FOUND", "Invoice not found");
  return prisma.invoice.update({ where: { id: invoiceId }, data: { gstStatus } });
}

export async function updatePaymentStatus(invoiceId, paymentStatus) {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) throw new ApiError(404, "INVOICE_NOT_FOUND", "Invoice not found");
  return prisma.invoice.update({ where: { id: invoiceId }, data: { paymentStatus } });
}

/**
 * Reject an invoice with a reason (creator.wldd.in shows this happening
 * regularly — "duplicate links", "cost difference", "date mismatch").
 * The links that were rolled into it go back to whatever status they
 * actually held right before this invoice picked them up — not always
 * INSIGHTS_APPROVED, since invoicing no longer requires insights (see
 * INVOICEABLE_STATUSES above): a link invoiced straight from
 * SCREENSHOT_APPROVED must return to SCREENSHOT_APPROVED, not silently gain
 * an insights approval it never had.
 */
export async function rejectInvoice(invoiceId, admin, { remarks }) {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId }, include: { items: true } });
  if (!invoice) throw new ApiError(404, "INVOICE_NOT_FOUND", "Invoice not found");
  if (invoice.status === "PAID") {
    throw new ApiError(409, "ALREADY_PAID", "A paid invoice can't be rejected");
  }
  if (invoice.status === "REJECTED") {
    throw new ApiError(409, "ALREADY_REJECTED", "Invoice is already rejected");
  }

  const linkIds = invoice.items.map((i) => i.linkId);

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.invoice.update({
      where: { id: invoiceId },
      data: { status: "REJECTED", paymentStatus: "CANCELLED", remarks },
    });
    for (const linkId of linkIds) {
      const priorEvent = await tx.linkStatusEvent.findFirst({
        where: { linkId, status: { not: "INVOICED" } },
        orderBy: { createdAt: "desc" },
      });
      const priorStatus = priorEvent?.status ?? "SCREENSHOT_APPROVED";
      await tx.link.update({ where: { id: linkId }, data: { status: priorStatus } });
      await tx.linkStatusEvent.create({
        data: { linkId, status: priorStatus, actedById: admin.id, note: `Invoice rejected: ${remarks}` },
      });
    }
    return result;
  });

  await notify(invoice.creatorId, "invoice_rejected", { invoiceId, remarks });
  return updated;
}

/** Plain list of post URLs on an invoice — creator.wldd.in's "Download Links" action, separate from the PDF. */
export async function getInvoiceLinksList(invoiceId, user) {
  const invoice = await getInvoiceDetail(invoiceId, user);
  return invoice.items.map((item) => item.link?.url).filter(Boolean);
}

/**
 * Fetches one invoice with everything the PDF needs (creator, and each
 * item's link → asset/campaign). Same visibility rule as listInvoices:
 * ADMIN/FINANCE see any invoice, everyone else only their own.
 */
export async function getInvoiceDetail(invoiceId, user) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      creator: true,
      items: { include: { link: { include: { asset: true, campaign: true } } } },
    },
  });
  if (!invoice) throw new ApiError(404, "INVOICE_NOT_FOUND", "Invoice not found");
  if (!["ADMIN", "FINANCE"].includes(user.role) && invoice.creatorId !== user.id) {
    throw new ApiError(404, "INVOICE_NOT_FOUND", "Invoice not found");
  }

  const now = Date.now();
  const overdueDays =
    invoice.status !== "PAID" && invoice.dueDate && invoice.dueDate.getTime() < now
      ? Math.floor((now - invoice.dueDate.getTime()) / (24 * 60 * 60 * 1000))
      : 0;

  // Approved billing profile (PAN/GSTIN/bank details) powers the PDF's "Bill To"
  // block, if the creator has registered and been approved for one.
  const billingProfile = await getApprovedForUser(invoice.creatorId);

  return { ...invoice, overdueDays, billingProfile };
}
