import { prisma } from "../../lib/prisma.js";
import { invoiceRecord, linkRecord, clientInvoiceRecord, financeSummary, INVOICE_COLUMNS, LINK_COLUMNS, CLIENT_INVOICE_COLUMNS } from "../../lib/financeRecords.js";
import { getAccessToken, ensureSheetTabsExist, writeSheetTab } from "../../lib/googleSheetsClient.js";

const TAB_NAMES = { invoices: "Invoices", links: "Links", clientInvoices: "Client invoices", summary: "Summary" };

/**
 * newTask.md, 8 Sep — "finance data will be saved in google sheets each
 * day" — runs alongside the existing Excel-to-GitHub export (financeExport.js),
 * not instead of it; the note's own wording ("not (or not only)") left room
 * for keeping both, and turning off a working export nobody asked to lose
 * is a bigger, less reversible call than just adding this one. Same
 * "throws a clear, specific error rather than silently no-op'ing" pattern
 * as financeExportJob — requires GOOGLE_SERVICE_ACCOUNT_EMAIL,
 * GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY, and GOOGLE_FINANCE_SPREADSHEET_ID
 * (see server/.env.example for how to get each one).
 */
export async function financeGoogleSheetExportJob() {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawPrivateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  const spreadsheetId = process.env.GOOGLE_FINANCE_SPREADSHEET_ID;
  if (!clientEmail || !rawPrivateKey || !spreadsheetId) {
    throw new Error(
      "Finance Google Sheet export not configured: set GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY, and GOOGLE_FINANCE_SPREADSHEET_ID (see server/.env.example)"
    );
  }
  // Env vars can't hold a literal newline — the key is stored with `\n`
  // escapes and un-escaped here, the standard way this gets passed around
  // (Render, Railway, etc. all documented this way for the same reason).
  const privateKey = rawPrivateKey.replace(/\\n/g, "\n");

  const [invoices, links, clientInvoices] = await Promise.all([
    prisma.invoice.findMany({
      include: { creator: { select: { name: true, phoneNumber: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.link.findMany({
      include: { campaign: true, asset: true, submittedBy: { select: { name: true } }, invoiceItem: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.clientInvoice.findMany({
      include: { plan: { select: { name: true, clientName: true, clientCompany: true, campaign: { select: { title: true } } } } },
      orderBy: { issuedAt: "desc" },
    }),
  ]);

  const invoiceRows = [INVOICE_COLUMNS.map(([, header]) => header), ...invoices.map((inv) => {
    const record = invoiceRecord(inv);
    return INVOICE_COLUMNS.map(([key]) => record[key]);
  })];
  const linkRows = [LINK_COLUMNS.map(([, header]) => header), ...links.map((link) => {
    const record = linkRecord(link);
    return LINK_COLUMNS.map(([key]) => record[key]);
  })];
  const clientInvoiceRows = [CLIENT_INVOICE_COLUMNS.map(([, header]) => header), ...clientInvoices.map((ci) => {
    const record = clientInvoiceRecord(ci);
    return CLIENT_INVOICE_COLUMNS.map(([key]) => record[key]);
  })];
  const summaryRows = [["Metric", "Value"], ...financeSummary({ invoices, links, clientInvoices }).map((r) => [r.metric, r.value])];

  const accessToken = await getAccessToken({ clientEmail, privateKey });
  await ensureSheetTabsExist({ accessToken, spreadsheetId, titles: Object.values(TAB_NAMES) });
  await writeSheetTab({ accessToken, spreadsheetId, title: TAB_NAMES.invoices, rows: invoiceRows });
  await writeSheetTab({ accessToken, spreadsheetId, title: TAB_NAMES.links, rows: linkRows });
  await writeSheetTab({ accessToken, spreadsheetId, title: TAB_NAMES.clientInvoices, rows: clientInvoiceRows });
  await writeSheetTab({ accessToken, spreadsheetId, title: TAB_NAMES.summary, rows: summaryRows });

  return { spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit` };
}
