import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../middleware/errorHandler.js";
import { clientInvoiceDocumentForPlan, invoiceAttachmentFor } from "../plans/service.js";

/**
 * Receivables (user decision, 23 Sep): the Taggify → client invoices minted
 * on plans (plans/service.js's generateClientInvoice writes the ledger row)
 * as Finance sees and settles them in /invoices, next to the creators'
 * payables. Deliberately coarse — ISSUED → PAID or CANCELLED — because we
 * issue these ourselves; there's nothing to vet, only money to collect.
 */

export const CLIENT_INVOICE_INCLUDE = {
  plan: {
    select: {
      id: true,
      name: true,
      clientName: true,
      clientCompany: true,
      clientGstNumber: true,
      createdById: true,
      createdBy: { select: { id: true, name: true } },
      campaign: { select: { id: true, title: true, brandName: true } },
      // The real (non-Proforma) invoice document, attached from either the
      // Plan page or the Payments tab (tasks.md #5, 23 Sep) — see
      // invoiceAttachmentFor in plans/service.js.
      invoiceAttachmentPublicId: true,
      invoiceAttachmentName: true,
      invoiceAttachmentUploadedById: true,
      invoiceAttachmentUploadedAt: true,
    },
  },
  issuedBy: { select: { id: true, name: true, role: true } },
};

/** Resolves plan.invoiceAttachment* columns into the same {name,url,uploadedAt,uploadedById} shape the Plan API already returns, so the Payments tab can show/attach it without a second fetch. */
function withResolvedAttachment(row) {
  return { ...row, plan: { ...row.plan, invoiceAttachment: invoiceAttachmentFor(row.plan) } };
}

/** ADMIN / FINANCE see every receivable; a Plan Maker sees the ones on their own plans. */
function scopeFor(user) {
  if (user.role === "PLAN_MAKER") return { plan: { createdById: user.id } };
  // ADMIN, FINANCE, or any role that got past the route gate on a
  // finance.manage grant — all of finance, not a slice of it.
  return {};
}

export async function listClientInvoices(user, filters = {}) {
  const where = scopeFor(user);
  if (filters.status) where.status = filters.status;
  if (filters.campaignId) where.campaignId = filters.campaignId;
  // "Actual amount to be collected" (tasks.md #5, 23 Sep — Payments tab):
  // only rows whose plan has the real invoice attached, not just the
  // system-generated Proforma. /invoices' own Receivables tab leaves this off.
  if (filters.hasAttachment) where.plan = { ...(where.plan ?? {}), invoiceAttachmentPublicId: { not: null } };
  // Searches invoice number, POC (plan maker) name, and client name/company —
  // tasks.md #5: "searchbar of plan maker name, client name, etc".
  if (filters.search) {
    const q = filters.search;
    where.OR = [
      { invoiceNumber: { contains: q, mode: "insensitive" } },
      { plan: { createdBy: { name: { contains: q, mode: "insensitive" } } } },
      { plan: { clientName: { contains: q, mode: "insensitive" } } },
      { plan: { clientCompany: { contains: q, mode: "insensitive" } } },
    ];
  }
  const rows = await prisma.clientInvoice.findMany({ where, include: CLIENT_INVOICE_INCLUDE, orderBy: { issuedAt: "desc" } });
  const items = rows.map(withResolvedAttachment);
  return { items, total: items.length };
}

async function getVisible(id, user) {
  const row = await prisma.clientInvoice.findUnique({ where: { id }, include: CLIENT_INVOICE_INCLUDE });
  if (!row) throw new ApiError(404, "CLIENT_INVOICE_NOT_FOUND", "Client invoice not found");
  // Same not-leaking-existence shape as plans/service.js's assertCanAccessPlan.
  if (user.role === "PLAN_MAKER" && row.plan.createdById !== user.id) {
    throw new ApiError(404, "CLIENT_INVOICE_NOT_FOUND", "Client invoice not found");
  }
  return row;
}

export async function getClientInvoicePdfSource(id, user) {
  const row = await getVisible(id, user);
  return clientInvoiceDocumentForPlan(row.planId);
}

/**
 * Manual, like the payables side: the client paid by bank transfer, Finance
 * records it. `paidAmount` defaults to the total; a short payment is
 * recorded as-is with `remarks` so the gap is visible, not hidden.
 */
export async function markClientInvoicePaid(id, financeUser, { paidAmount, remarks } = {}) {
  const row = await getVisible(id, financeUser);
  if (row.status === "PAID") throw new ApiError(409, "ALREADY_PAID", "This client invoice is already marked paid");
  if (row.status === "CANCELLED") throw new ApiError(409, "INVALID_STATUS", "A cancelled client invoice can't be marked paid");
  return prisma.clientInvoice.update({
    where: { id },
    data: {
      status: "PAID",
      paidAt: new Date(),
      paidAmount: paidAmount ?? row.total,
      remarks: remarks ?? row.remarks,
    },
    include: CLIENT_INVOICE_INCLUDE,
  });
}

/** Closes an issued receivable that will never be collected (deal fell through, re-issued outside the system). Not for PAID rows. */
export async function cancelClientInvoice(id, financeUser, { remarks }) {
  const row = await getVisible(id, financeUser);
  if (row.status === "PAID") throw new ApiError(409, "ALREADY_PAID", "A paid client invoice can't be cancelled");
  if (row.status === "CANCELLED") throw new ApiError(409, "INVALID_STATUS", "This client invoice is already cancelled");
  return prisma.clientInvoice.update({ where: { id }, data: { status: "CANCELLED", remarks }, include: CLIENT_INVOICE_INCLUDE });
}
