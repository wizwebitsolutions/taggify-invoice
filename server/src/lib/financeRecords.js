/**
 * Shared "what one row of finance data looks like" logic — extracted out of
 * financeWorkbook.js (newTask.md #2) so it, and the newer Google Sheets
 * export (newTask.md, 8 Sep), can't compute the same invoice/link/summary
 * fields two different ways. Each function returns a plain object keyed by
 * field name; each export target (ExcelJS's `addRow`, or a plain 2D array
 * for the Sheets API) reads the same keys, it just formats/lays them out
 * differently.
 */
import { formatLabel } from "./formats.js";

export function dateStr(d) {
  return d ? new Date(d).toISOString().slice(0, 10) : "";
}

export function invoiceRecord(inv) {
  return {
    invoiceNumber: inv.invoiceNumber,
    creator: inv.creator?.name ?? "",
    phone: inv.creator?.phoneNumber ?? "",
    subtotal: Number(inv.subtotal),
    isGstInvoice: inv.isGstInvoice ? "Yes" : "No",
    gstAmount: Number(inv.gstAmount),
    amount: Number(inv.amount),
    status: inv.status,
    paymentStatus: inv.paymentStatus,
    gstStatus: inv.gstStatus,
    dueDate: dateStr(inv.dueDate),
    paidAt: dateStr(inv.paidAt),
    createdAt: dateStr(inv.createdAt),
  };
}

export function linkRecord(link) {
  return {
    campaign: link.campaign?.title ?? "",
    page: link.asset ? `@${link.asset.handle}` : "",
    creator: link.submittedBy?.name ?? "",
    format: formatLabel(link.format),
    cost: Number(link.cost),
    status: link.status,
    invoiced: link.invoiceItem ? "Yes" : "No",
    postedAt: dateStr(link.postedAt),
    createdAt: dateStr(link.createdAt),
  };
}

/** Receivables (23 Sep): one row per client invoice minted on a plan. */
export function clientInvoiceRecord(ci) {
  return {
    invoiceNumber: ci.invoiceNumber,
    client: ci.plan?.clientCompany ?? ci.plan?.clientName ?? "",
    plan: ci.plan?.name ?? "",
    campaign: ci.plan?.campaign?.title ?? "",
    subtotal: Number(ci.subtotal),
    gstPercent: ci.gstPercent != null ? Number(ci.gstPercent) : "",
    gstAmount: Number(ci.gstAmount),
    total: Number(ci.total),
    status: ci.status,
    issuedAt: dateStr(ci.issuedAt),
    paidAt: dateStr(ci.paidAt),
    paidAmount: ci.paidAmount != null ? Number(ci.paidAmount) : "",
  };
}

/** Ordered metric/value pairs — an array, not an object, since display order matters and there's no natural key to dedupe on. */
export function financeSummary({ invoices, links, clientInvoices = [] }) {
  const totalInvoiced = invoices.reduce((sum, i) => sum + Number(i.amount), 0);
  const totalPaid = invoices.filter((i) => i.status === "PAID").reduce((sum, i) => sum + Number(i.amount), 0);
  // Receivables (23 Sep) — cancelled rows are closed, not owed.
  const openReceivables = clientInvoices.filter((c) => c.status !== "CANCELLED");
  const totalBilledToClients = openReceivables.reduce((sum, c) => sum + Number(c.total), 0);
  const totalCollected = clientInvoices.filter((c) => c.status === "PAID").reduce((sum, c) => sum + Number(c.paidAmount ?? c.total), 0);
  return [
    { metric: "Generated", value: new Date().toISOString() },
    { metric: "Total invoices", value: invoices.length },
    { metric: "Total invoiced amount", value: totalInvoiced },
    { metric: "Total paid", value: totalPaid },
    { metric: "Total pending", value: totalInvoiced - totalPaid },
    { metric: "Total links (all statuses)", value: links.length },
    { metric: "Client invoices", value: clientInvoices.length },
    { metric: "Total billed to clients", value: totalBilledToClients },
    { metric: "Total collected from clients", value: totalCollected },
    { metric: "Total receivable (outstanding)", value: totalBilledToClients - totalCollected },
  ];
}

// Column order/headers — shared so the workbook and the Google Sheet always
// present the same columns in the same order, even though one writes them
// via ExcelJS's `columns` config and the other as a plain header row.
export const INVOICE_COLUMNS = [
  ["invoiceNumber", "Invoice #"],
  ["creator", "Creator"],
  ["phone", "Phone"],
  ["subtotal", "Subtotal"],
  ["isGstInvoice", "GST Invoice"],
  ["gstAmount", "GST Amount"],
  ["amount", "Total Amount"],
  ["status", "Status"],
  ["paymentStatus", "Payment Status"],
  ["gstStatus", "GST Status"],
  ["dueDate", "Due Date"],
  ["paidAt", "Paid At"],
  ["createdAt", "Created At"],
];

export const CLIENT_INVOICE_COLUMNS = [
  ["invoiceNumber", "Invoice #"],
  ["client", "Client"],
  ["plan", "Plan"],
  ["campaign", "Campaign"],
  ["subtotal", "Subtotal"],
  ["gstPercent", "GST %"],
  ["gstAmount", "GST Amount"],
  ["total", "Total"],
  ["status", "Status"],
  ["issuedAt", "Issued At"],
  ["paidAt", "Paid At"],
  ["paidAmount", "Paid Amount"],
];

export const LINK_COLUMNS = [
  ["campaign", "Campaign"],
  ["page", "Page"],
  ["creator", "Creator"],
  ["format", "Format"],
  ["cost", "Cost"],
  ["status", "Status"],
  ["invoiced", "Invoiced"],
  ["postedAt", "Posted At"],
  ["createdAt", "Created At"],
];
