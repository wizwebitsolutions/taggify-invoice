import ExcelJS from "exceljs";

/**
 * Builds the daily finance export workbook (newTask.md #2: "all finance
 * data ... stored in excel sheet"). Three sheets: every Invoice, every
 * Link's cost/status (the underlying committed spend, including work not
 * yet invoiced), and a Summary — together, "all finance data".
 */
export async function buildFinanceWorkbook({ invoices, links }) {
  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date();

  const invoiceSheet = workbook.addWorksheet("Invoices");
  invoiceSheet.columns = [
    { header: "Invoice #", key: "invoiceNumber", width: 24 },
    { header: "Creator", key: "creator", width: 22 },
    { header: "Phone", key: "phone", width: 16 },
    { header: "Subtotal", key: "subtotal", width: 14 },
    { header: "GST Invoice", key: "isGstInvoice", width: 12 },
    { header: "GST Amount", key: "gstAmount", width: 14 },
    { header: "Total Amount", key: "amount", width: 14 },
    { header: "Status", key: "status", width: 12 },
    { header: "Payment Status", key: "paymentStatus", width: 16 },
    { header: "GST Status", key: "gstStatus", width: 14 },
    { header: "Due Date", key: "dueDate", width: 14 },
    { header: "Paid At", key: "paidAt", width: 14 },
    { header: "Created At", key: "createdAt", width: 14 },
  ];
  for (const inv of invoices) {
    invoiceSheet.addRow({
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
    });
  }
  invoiceSheet.getRow(1).font = { bold: true };

  const linksSheet = workbook.addWorksheet("Links");
  linksSheet.columns = [
    { header: "Campaign", key: "campaign", width: 26 },
    { header: "Page", key: "page", width: 20 },
    { header: "Creator", key: "creator", width: 22 },
    { header: "Format", key: "format", width: 12 },
    { header: "Cost", key: "cost", width: 12 },
    { header: "Status", key: "status", width: 20 },
    { header: "Invoiced", key: "invoiced", width: 10 },
    { header: "Posted At", key: "postedAt", width: 14 },
    { header: "Created At", key: "createdAt", width: 14 },
  ];
  for (const link of links) {
    linksSheet.addRow({
      campaign: link.campaign?.title ?? "",
      page: link.asset ? `@${link.asset.handle}` : "",
      creator: link.submittedBy?.name ?? "",
      format: link.format,
      cost: Number(link.cost),
      status: link.status,
      invoiced: link.invoiceItem ? "Yes" : "No",
      postedAt: dateStr(link.postedAt),
      createdAt: dateStr(link.createdAt),
    });
  }
  linksSheet.getRow(1).font = { bold: true };

  const summarySheet = workbook.addWorksheet("Summary");
  summarySheet.columns = [
    { header: "Metric", key: "metric", width: 26 },
    { header: "Value", key: "value", width: 20 },
  ];
  const totalInvoiced = invoices.reduce((sum, i) => sum + Number(i.amount), 0);
  const totalPaid = invoices.filter((i) => i.status === "PAID").reduce((sum, i) => sum + Number(i.amount), 0);
  summarySheet.addRows([
    { metric: "Generated", value: new Date().toISOString() },
    { metric: "Total invoices", value: invoices.length },
    { metric: "Total invoiced amount", value: totalInvoiced },
    { metric: "Total paid", value: totalPaid },
    { metric: "Total pending", value: totalInvoiced - totalPaid },
    { metric: "Total links (all statuses)", value: links.length },
  ]);
  summarySheet.getRow(1).font = { bold: true };

  return workbook.xlsx.writeBuffer();
}

function dateStr(d) {
  return d ? new Date(d).toISOString().slice(0, 10) : "";
}
