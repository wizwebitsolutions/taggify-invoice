import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../middleware/errorHandler.js";
import { notify } from "../notifications/service.js";
import { nanoid } from "nanoid";

/**
 * Bulk-generates one invoice from a set of eligible links (per
 * recommend.md #3 — replaces one-at-a-time invoicing). Eligibility:
 * INSIGHTS_APPROVED and not already attached to an invoice. All links must
 * belong to the same creator (an invoice is per-creator).
 */
export async function bulkCreateInvoice(admin, { linkIds, dueInDays }) {
  const links = await prisma.link.findMany({
    where: { id: { in: linkIds } },
    include: { asset: true, invoiceItem: true },
  });

  if (links.length !== linkIds.length) {
    throw new ApiError(404, "LINK_NOT_FOUND", "One or more links do not exist");
  }
  const ineligible = links.filter((l) => l.status !== "INSIGHTS_APPROVED" || l.invoiceItem);
  if (ineligible.length > 0) {
    throw new ApiError(
      400,
      "INELIGIBLE_LINKS",
      `Links not eligible for invoicing (must be INSIGHTS_APPROVED and uninvoiced): ${ineligible.map((l) => l.id).join(", ")}`
    );
  }
  const creatorIds = new Set(links.map((l) => l.asset.ownerId));
  if (creatorIds.size > 1) {
    throw new ApiError(400, "MIXED_CREATORS", "All links in one invoice must belong to the same creator");
  }
  const creatorId = [...creatorIds][0];
  const amount = links.reduce((sum, l) => sum + Number(l.cost), 0);
  const dueDate = new Date(Date.now() + dueInDays * 24 * 60 * 60 * 1000);

  const invoice = await prisma.$transaction(async (tx) => {
    const created = await tx.invoice.create({
      data: {
        creatorId,
        invoiceNumber: `INV-${Date.now()}-${nanoid(6).toUpperCase()}`,
        amount,
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

  const [items, total] = await prisma.$transaction([
    prisma.invoice.findMany({
      where,
      include: { items: { include: { link: true } } },
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
    data: { status: "PAID", paidAt: new Date() },
  });

  await notify(invoice.creatorId, "invoice_paid", { invoiceId, markedById: financeUser.id });
  return updated;
}

export async function updateGstStatus(invoiceId, gstStatus) {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) throw new ApiError(404, "INVOICE_NOT_FOUND", "Invoice not found");
  return prisma.invoice.update({ where: { id: invoiceId }, data: { gstStatus } });
}
