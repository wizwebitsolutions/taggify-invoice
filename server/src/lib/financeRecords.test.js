import { describe, it, expect } from "vitest";
import { dateStr, invoiceRecord, linkRecord, financeSummary, INVOICE_COLUMNS, LINK_COLUMNS } from "./financeRecords.js";

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

  it("INVOICE_COLUMNS/LINK_COLUMNS list every key financeWorkbook.js and the Google Sheets export both rely on", () => {
    expect(INVOICE_COLUMNS.map(([key]) => key)).toEqual([
      "invoiceNumber", "creator", "phone", "subtotal", "isGstInvoice", "gstAmount", "amount", "status", "paymentStatus", "gstStatus", "dueDate", "paidAt", "createdAt",
    ]);
    expect(LINK_COLUMNS.map(([key]) => key)).toEqual([
      "campaign", "page", "creator", "format", "cost", "status", "invoiced", "postedAt", "createdAt",
    ]);
  });
});
