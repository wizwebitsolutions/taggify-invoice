import { prisma } from "../../lib/prisma.js";
import { notify } from "../notifications/service.js";

/**
 * Finds RAISED invoices past their dueDate and not yet PAID, and notifies
 * the creator + all ADMIN/FINANCE users once per sweep. Complements the
 * on-read aging calc in invoices/service.js by pushing a notification
 * rather than only surfacing it when someone opens the Invoices page.
 */
export async function invoiceAgingSweepJob() {
  const overdue = await prisma.invoice.findMany({
    where: { status: { in: ["RAISED", "APPROVED"] }, dueDate: { lt: new Date() } },
  });

  if (overdue.length === 0) return;

  const financeUsers = await prisma.user.findMany({
    where: { role: { in: ["ADMIN", "FINANCE"] } },
    select: { id: true },
  });

  for (const invoice of overdue) {
    const overdueDays = Math.floor((Date.now() - invoice.dueDate.getTime()) / (24 * 60 * 60 * 1000));
    await notify(invoice.creatorId, "invoice_overdue", { invoiceId: invoice.id, overdueDays });
    for (const { id: financeUserId } of financeUsers) {
      await notify(financeUserId, "invoice_overdue", { invoiceId: invoice.id, overdueDays, creatorId: invoice.creatorId });
    }
  }
}
