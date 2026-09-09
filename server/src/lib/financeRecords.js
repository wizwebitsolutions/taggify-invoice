/**
 * Shared "what one row of finance data looks like" logic — extracted out of
 * financeWorkbook.js (newTask.md #2) so it, and the newer Google Sheets
 * export (newTask.md, 8 Sep), can't compute the same invoice/link/summary
 * fields two different ways. Each function returns a plain object keyed by
 * field name; each export target (ExcelJS's `addRow`, or a plain 2D array
 * for the Sheets API) reads the same keys, it just formats/lays them out
 * differently.
 */

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
    format: link.format,
    cost: Number(link.cost),
    status: link.status,
    invoiced: link.invoiceItem ? "Yes" : "No",
    postedAt: dateStr(link.postedAt),
    createdAt: dateStr(link.createdAt),
  };
}

/** Ordered metric/value pairs — an array, not an object, since display order matters and there's no natural key to dedupe on. */
export function financeSummary({ invoices, links }) {
  const totalInvoiced = invoices.reduce((sum, i) => sum + Number(i.amount), 0);
  const totalPaid = invoices.filter((i) => i.status === "PAID").reduce((sum, i) => sum + Number(i.amount), 0);
  return [
    { metric: "Generated", value: new Date().toISOString() },
    { metric: "Total invoices", value: invoices.length },
    { metric: "Total invoiced amount", value: totalInvoiced },
    { metric: "Total paid", value: totalPaid },
    { metric: "Total pending", value: totalInvoiced - totalPaid },
    { metric: "Total links (all statuses)", value: links.length },
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
