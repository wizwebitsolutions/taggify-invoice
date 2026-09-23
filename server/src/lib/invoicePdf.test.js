import { describe, it, expect } from "vitest";
import { taxHeads } from "./taxDocumentPdf.js";
import { buildInvoicePdf, invoiceToDocument } from "./invoicePdf.js";

/**
 * Smoke tests, same convention as planPdf.test.js: the 12 Sep relayout
 * (Proforma-style template) changed every line of the renderer, so
 * "renders a valid PDF for every shape getInvoiceDetail produces" is the
 * regression worth having — content assertions live in the service tests.
 */
const base = {
  invoiceNumber: "INV-1",
  status: "APPROVED",
  amount: 29500,
  subtotal: 25000,
  gstAmount: 4500,
  isGstInvoice: true,
  createdAt: new Date("2026-09-12"),
  dueDate: new Date("2026-09-27"),
  creator: { name: "Demo Creator", phoneNumber: "+919000000003", email: null },
  campaign: { title: "Launch Week", brandName: "Solmate Coffee" },
  billingProfile: { name: "Demo Creator", pan: "ABCDE1234F", gstin: "06ABCDE1234F1Z5", bankAccountNumber: "1234567890", ifscCode: "UTIB0000240" },
  items: [
    { amount: 12500, link: { format: "reel", asset: { handle: "demo.page" }, campaign: { title: "Launch Week" } } },
    { amount: 12500, link: { format: "story", asset: { handle: "demo.page" }, campaign: { title: "Launch Week" } } },
  ],
};

describe("buildInvoicePdf — Proforma-style layout doesn't crash on real shapes", () => {
  it("renders a GST invoice with billing profile", async () => {
    const pdf = await buildInvoicePdf(base);
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(pdf.length).toBeGreaterThan(1500);
  });

  it("renders a non-GST invoice with no billing profile and no campaign", async () => {
    const pdf = await buildInvoicePdf({ ...base, isGstInvoice: false, gstAmount: 0, amount: 25000, billingProfile: null, campaign: null });
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  });

  it("renders a rejected invoice with remarks and an item whose link is missing", async () => {
    const pdf = await buildInvoicePdf({ ...base, status: "REJECTED", remarks: "duplicate links", items: [{ amount: 100, link: null }] });
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  });

  it("paginates a long invoice without throwing", async () => {
    const items = Array.from({ length: 60 }, (_, i) => ({ amount: 100, link: { format: "reel", asset: { handle: `page${i}` }, campaign: { title: "Big" } } }));
    const pdf = await buildInvoicePdf({ ...base, items, amount: 7080, subtotal: 6000, gstAmount: 1080 });
    expect(pdf.length).toBeGreaterThan(3000);
  });
});

// 22 Sep — creator payout invoices get the same CGST+SGST / IGST split as
// client invoices, keyed on the creator billing profile's GSTIN state code
// against Taggify's own (COMPANY_GSTIN, state 06 in tests).
describe("invoiceToDocument — GST heads from the creator's GSTIN state", () => {
  const base = { isGstInvoice: true, subtotal: 10000, gstAmount: 1800, amount: 11800, status: "PENDING", items: [] };

  it("creator registered in another state → IGST at the full rate", () => {
    const d = invoiceToDocument({ ...base, billingProfile: { pan: "ABCDE1234F", gstin: "27ABCDE1234F1Z5", name: "C", bankAccountNumber: "1", ifscCode: "X" } });
    expect(d.taxSplit).toBe("IGST");
    expect(taxHeads(d)).toEqual([{ label: "IGST", rate: 18, amount: 1800 }]);
  });

  it("creator registered in Taggify's state → CGST + SGST, half each", () => {
    const d = invoiceToDocument({ ...base, billingProfile: { pan: "ABCDE1234F", gstin: "06ABCDE1234F1Z5", name: "C", bankAccountNumber: "1", ifscCode: "X" } });
    expect(d.taxSplit).toBe("CGST_SGST");
    expect(taxHeads(d)).toEqual([
      { label: "CGST", rate: 9, amount: 900 },
      { label: "SGST", rate: 9, amount: 900 },
    ]);
  });

  it("no billing profile / no GSTIN → IGST, as before", () => {
    expect(invoiceToDocument({ ...base, billingProfile: null }).taxSplit).toBe("IGST");
  });
});
