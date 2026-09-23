import { describe, it, expect } from "vitest";
import { dateStr, invoiceRecord, linkRecord, financeSummary, INVOICE_COLUMNS, LINK_COLUMNS, clientInvoiceRecord, CLIENT_INVOICE_COLUMNS } from "./financeRecords.js";

describe("financeRecords — shared row shaping (newTask.md #2 and its 8 Sep Google Sheets follow-up)", () => {
  it("dateStr formats a Date as YYYY-MM-DD, and blanks a null", () => {
    expect(dateStr(new Date("2026-08-20T15:30:00Z"))).toBe("2026-08-20");
    expect(dateStr(null)).toBe("");
  });

  it("invoiceRecord shapes an invoice, tolerating a missing creator", () => {
    const inv = {
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
    };
    expect(invoiceRecord(inv)).toEqual({
      invoiceNumber: "INV-1",
      creator: "Demo Creator",
      phone: "+919000000003",
      subtotal: 10000,
      isGstInvoice: "Yes",
      gstAmount: 1800,
      amount: 11800,
      status: "PAID",
      paymentStatus: "COMPLETED",
      gstStatus: "COMPLETED",
      dueDate: "2026-09-01",
      paidAt: "2026-08-28",
      createdAt: "2026-08-20",
    });

    expect(invoiceRecord({ ...inv, creator: null }).creator).toBe("");
  });

  it("linkRecord shapes a link, tolerating a missing asset/submitter", () => {
    const link = {
      campaign: { title: "Launch Week" },
      asset: { handle: "demo.page" },
      submittedBy: { name: "Demo Creator" },
      format: "reel",
      cost: 5000,
      status: "INVOICED",
      invoiceItem: { id: "item-1" },
      postedAt: new Date("2026-08-19"),
      createdAt: new Date("2026-08-18"),
    };
    expect(linkRecord(link)).toMatchObject({ campaign: "Launch Week", page: "@demo.page", creator: "Demo Creator", invoiced: "Yes" });
    expect(linkRecord({ ...link, asset: null }).page).toBe("");
    expect(linkRecord({ ...link, invoiceItem: null }).invoiced).toBe("No");
  });

  it("financeSummary totals invoiced/paid/pending across the given invoices", () => {
    const invoices = [
      { amount: 11800, status: "PAID" },
      { amount: 5000, status: "RAISED" },
    ];
    const summary = financeSummary({ invoices, links: [{ id: "l1" }] });

    expect(summary.find((r) => r.metric === "Total invoiced amount").value).toBe(16800);
    expect(summary.find((r) => r.metric === "Total paid").value).toBe(11800);
    expect(summary.find((r) => r.metric === "Total pending").value).toBe(5000);
    expect(summary.find((r) => r.metric === "Total links (all statuses)").value).toBe(1);
  });

  it("financeSummary totals receivables (23 Sep): billed excludes cancelled, collected uses paidAmount, outstanding is the gap", () => {
    const clientInvoices = [
      { total: 11800, status: "PAID", paidAmount: 11000 },
      { total: 5000, status: "ISSUED", paidAmount: null },
      { total: 9000, status: "CANCELLED", paidAmount: null },
    ];
    const summary = financeSummary({ invoices: [], links: [], clientInvoices });

    expect(summary.find((r) => r.metric === "Client invoices").value).toBe(3);
    expect(summary.find((r) => r.metric === "Total billed to clients").value).toBe(16800);
    expect(summary.find((r) => r.metric === "Total collected from clients").value).toBe(11000);
    expect(summary.find((r) => r.metric === "Total receivable (outstanding)").value).toBe(5800);
  });

  it("clientInvoiceRecord shapes a receivable, preferring the company name and tolerating a missing plan/campaign", () => {
    expect(
      clientInvoiceRecord({
        invoiceNumber: "PI-0007",
        plan: { name: "Q1 Push", clientName: "Rohit", clientCompany: null, campaign: null },
        subtotal: "10000",
        gstPercent: null,
        gstAmount: "0",
        total: "10000",
        status: "ISSUED",
        issuedAt: new Date("2026-09-20"),
        paidAt: null,
        paidAmount: null,
      })
    ).toEqual({
      invoiceNumber: "PI-0007",
      client: "Rohit",
      plan: "Q1 Push",
      campaign: "",
      subtotal: 10000,
      gstPercent: "",
      gstAmount: 0,
      total: 10000,
      status: "ISSUED",
      issuedAt: "2026-09-20",
      paidAt: "",
      paidAmount: "",
    });
    expect(clientInvoiceRecord({ invoiceNumber: "X", subtotal: 1, gstAmount: 0, total: 1, status: "ISSUED", issuedAt: null, paidAt: null }).client).toBe("");
  });

  it("INVOICE_COLUMNS/LINK_COLUMNS list every key financeWorkbook.js and the Google Sheets export both rely on", () => {
    expect(INVOICE_COLUMNS.map(([key]) => key)).toEqual([
      "invoiceNumber", "creator", "phone", "subtotal", "isGstInvoice", "gstAmount", "amount", "status", "paymentStatus", "gstStatus", "dueDate", "paidAt", "createdAt",
    ]);
    expect(LINK_COLUMNS.map(([key]) => key)).toEqual([
      "campaign", "page", "creator", "format", "cost", "status", "invoiced", "postedAt", "createdAt",
    ]);
    expect(CLIENT_INVOICE_COLUMNS.map(([key]) => key)).toEqual([
      "invoiceNumber", "client", "plan", "campaign", "subtotal", "gstPercent", "gstAmount", "total", "status", "issuedAt", "paidAt", "paidAmount",
    ]);
  });
});
