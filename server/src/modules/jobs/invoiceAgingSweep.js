import { prisma } from "../../lib/prisma.js";
import { notify } from "../notifications/service.js";
import { getEffectivePermissions } from "../../lib/permissions.js";

/**
 * Finds RAISED invoices past their dueDate and not yet PAID, and notifies
 * the creator + everyone with finance.view once per sweep. Complements the
 * on-read aging calc in invoices/service.js by pushing a notification
 * rather than only surfacing it when someone opens the Invoices page.
 *
 * Used to query `role in ["ADMIN","FINANCE"]` directly — a restricted
 * Finance account (finance.view off) still got notified about invoices it
 * can no longer see, and a role explicitly granted finance.view (e.g. a
 * Plan Maker) never did (23 Sep, Step 3). Every user is loaded once and
 * filtered in JS since "does this overlay grant finance.view" isn't a plain
 * Prisma `where` clause — acceptable at this app's scale (system
 * design.md: ~1000 pages, not users).
 */
export async function invoiceAgingSweepJob() {
  const overdue = await prisma.invoice.findMany({
    where: { status: { in: ["RAISED", "APPROVED"] }, dueDate: { lt: new Date() } },
  });

  if (overdue.length === 0) return;

  const candidates = await prisma.user.findMany({ select: { id: true, role: true, permissions: true } });
  const financeUserIds = candidates.filter((u) => getEffectivePermissions(u)["finance.view"]).map((u) => u.id);

  for (const invoice of overdue) {
    const overdueDays = Math.floor((Date.now() - invoice.dueDate.getTime()) / (24 * 60 * 60 * 1000));
    await notify(invoice.creatorId, "invoice_overdue", { invoiceId: invoice.id, overdueDays });
    for (const financeUserId of financeUserIds) {
      await notify(financeUserId, "invoice_overdue", { invoiceId: invoice.id, overdueDays, creatorId: invoice.creatorId });
    }
  }
}
