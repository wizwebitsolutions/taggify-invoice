import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { buildFinanceWorkbook } from "./financeWorkbook.js";

// Real round-trip: build a workbook, then re-read the actual binary output
// with the same library — proves the generated file is a genuinely valid
// .xlsx with the right data in it, not just that no exception was thrown.
describe("buildFinanceWorkbook — daily finance export (newTask.md #2)", () => {
  const invoices = [
    {
      invoiceNumber: "INV-1",
      creator: { name: "Demo Creator", phoneNumber: "+919000000003" },
      subtotal: 10000,
      isGstInvoice: true,
      gstAmount: 1800,
      amount: 11800,
      status: "PAID",
      paymentStatus: "COMPLETED",
      gstStatus: "COMPLETED",
      dueDate: new Date("2026-09-01"),
      paidAt: new Date("2026-08-28"),
      createdAt: new Date("2026-08-20"),
    },
    {
      invoiceNumber: "INV-2",
      creator: { name: "Demo Creator", phoneNumber: "+919000000003" },
      subtotal: 5000,
      isGstInvoice: false,
      gstAmount: 0,
      amount: 5000,
      status: "RAISED",
      paymentStatus: "PENDING",
      gstStatus: "PENDING",
      dueDate: null,
      paidAt: null,
      createdAt: new Date("2026-08-25"),
    },
  ];

  const links = [
    {
      campaign: { title: "Launch Week" },
      asset: { handle: "demo.page" },
      submittedBy: { name: "Demo Creator" },
      format: "reel",
      cost: 5000,
      status: "INVOICED",
      invoiceItem: { id: "item-1" },
      postedAt: new Date("2026-08-19"),
      createdAt: new Date("2026-08-18"),
    },
  ];

  it("produces a real workbook with Invoices, Links, and Summary sheets containing the right data", async () => {
    const buffer = await buildFinanceWorkbook({ invoices, links });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    const sheetNames = workbook.worksheets.map((s) => s.name);
    expect(sheetNames).toEqual(["Invoices", "Links", "Summary"]);

    // Column *keys* (used to build the sheet) don't survive a real
    // load-from-bytes round trip — only position does, since that's all an
    // actual .xlsx file stores. Position here matches financeWorkbook.js's
    // `columns` order: Invoice #, Creator, Phone, Subtotal, GST Invoice,
    // GST Amount, Total Amount, ...
    const invoiceSheet = workbook.getWorksheet("Invoices");
    expect(invoiceSheet.rowCount).toBe(3); // header + 2 invoices
    expect(invoiceSheet.getRow(2).getCell(1).value).toBe("INV-1"); // Invoice #
    expect(invoiceSheet.getRow(2).getCell(7).value).toBe(11800); // Total Amount
    expect(invoiceSheet.getRow(2).getCell(5).value).toBe("Yes"); // GST Invoice
    expect(invoiceSheet.getRow(3).getCell(5).value).toBe("No");

    // Links columns: Campaign, Page, Creator, Format, Cost, Status, Invoiced, ...
    const linksSheet = workbook.getWorksheet("Links");
    expect(linksSheet.rowCount).toBe(2); // header + 1 link
    expect(linksSheet.getRow(2).getCell(2).value).toBe("@demo.page"); // Page
    expect(linksSheet.getRow(2).getCell(7).value).toBe("Yes"); // Invoiced

    const summarySheet = workbook.getWorksheet("Summary");
    const summaryRows = summarySheet.getSheetValues().filter(Boolean);
    const totalInvoicedRow = summaryRows.find((r) => r[1] === "Total invoiced amount");
    expect(totalInvoicedRow[2]).toBe(16800); // 11800 + 5000
    const totalPaidRow = summaryRows.find((r) => r[1] === "Total paid");
    expect(totalPaidRow[2]).toBe(11800); // only INV-1 is PAID
  });

  it("still produces a valid (empty) workbook when there's no data yet", async () => {
    const buffer = await buildFinanceWorkbook({ invoices: [], links: [] });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    expect(workbook.getWorksheet("Invoices").rowCount).toBe(1); // header only
    expect(workbook.getWorksheet("Links").rowCount).toBe(1);
  });
});
