import { prisma } from "./prisma.js";

/**
 * Re-aligns link status with the invoices they actually sit on (22 Sep).
 * A link on a live (non-rejected) invoice must be INVOICED — but a status
 * could drift back (a screenshot uploaded after invoicing, before
 * statusTimeline.js guarded it; a re-run seed; a manual fix-up), which
 * made the link show as "ready to invoice" again and fail on Generate
 * with "already on invoice INV-…". Sets those back to INVOICED with a
 * status event saying why. Idempotent; returns what it touched.
 *
 * Run once: `npm run repair:invoiced-links`, or POST /admin/repair/invoiced-links.
 */
export async function repairInvoicedLinks({ actedById = null } = {}) {
  const drifted = await prisma.link.findMany({
    where: { status: { not: "INVOICED" }, invoiceItem: { is: { invoice: { status: { not: "REJECTED" } } } } },
    select: { id: true, url: true, status: true, invoiceItem: { select: { invoice: { select: { invoiceNumber: true } } } } },
  });
  for (const link of drifted) {
    await prisma.$transaction([
      prisma.link.update({ where: { id: link.id }, data: { status: "INVOICED" } }),
      prisma.linkStatusEvent.create({
        data: { linkId: link.id, status: "INVOICED", actedById, note: `Repaired: was ${link.status} while on invoice ${link.invoiceItem.invoice.invoiceNumber}` },
      }),
    ]);
  }
  return { repaired: drifted.map((l) => ({ linkId: l.id, url: l.url, from: l.status, invoiceNumber: l.invoiceItem.invoice.invoiceNumber })) };
}
