import ExcelJS from "exceljs";
import { invoiceRecord, linkRecord, clientInvoiceRecord, financeSummary, INVOICE_COLUMNS, LINK_COLUMNS, CLIENT_INVOICE_COLUMNS } from "./financeRecords.js";

/**
 * Builds the daily finance export workbook (newTask.md #2: "all finance
 * data ... stored in excel sheet"). Three sheets: every Invoice, every
 * Link's cost/status (the underlying committed spend, including work not
 * yet invoiced), and a Summary — together, "all finance data". Row
 * shaping (which fields, in what order) lives in financeRecords.js,
 * shared with the newer Google Sheets export (newTask.md, 8 Sep) so the
 * two can't disagree on what "the same finance data" actually contains.
 */
export async function buildFinanceWorkbook({ invoices, links, clientInvoices = [] }) {
  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date();

  // Widths are Excel-display cosmetics only, tuned by hand for this sheet —
  // not derived from INVOICE_COLUMNS/LINK_COLUMNS since the Google Sheets
  // export (newTask.md, 8 Sep) has no equivalent concept and doesn't need one.
  const INVOICE_WIDTHS = [24, 22, 16, 14, 12, 14, 14, 12, 16, 14, 14, 14, 14];
  const LINK_WIDTHS = [26, 20, 22, 12, 12, 20, 10, 14, 14];
  const CLIENT_INVOICE_WIDTHS = [18, 26, 24, 24, 14, 8, 14, 14, 12, 14, 14, 14];

  const invoiceSheet = workbook.addWorksheet("Invoices");
  invoiceSheet.columns = INVOICE_COLUMNS.map(([key, header], i) => ({ key, header, width: INVOICE_WIDTHS[i] }));
  for (const inv of invoices) invoiceSheet.addRow(invoiceRecord(inv));
  invoiceSheet.getRow(1).font = { bold: true };

  const linksSheet = workbook.addWorksheet("Links");
  linksSheet.columns = LINK_COLUMNS.map(([key, header], i) => ({ key, header, width: LINK_WIDTHS[i] }));
  for (const link of links) linksSheet.addRow(linkRecord(link));
  linksSheet.getRow(1).font = { bold: true };

  // Receivables (23 Sep) — the other direction of money, same workbook.
  const clientSheet = workbook.addWorksheet("Client invoices");
  clientSheet.columns = CLIENT_INVOICE_COLUMNS.map(([key, header], i) => ({ key, header, width: CLIENT_INVOICE_WIDTHS[i] }));
  for (const ci of clientInvoices) clientSheet.addRow(clientInvoiceRecord(ci));
  clientSheet.getRow(1).font = { bold: true };

  const summarySheet = workbook.addWorksheet("Summary");
  summarySheet.columns = [
    { header: "Metric", key: "metric", width: 26 },
    { header: "Value", key: "value", width: 20 },
  ];
  summarySheet.addRows(financeSummary({ invoices, links, clientInvoices }));
  summarySheet.getRow(1).font = { bold: true };

  return workbook.xlsx.writeBuffer();
}
