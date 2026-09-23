import { describe, it, expect } from "vitest";
import { buildClientInvoicePdf, clientInvoiceToDocument } from "./clientInvoicePdf.js";
import { taxHeads } from "./taxDocumentPdf.js";
import { gstSplitFor } from "./gstin.js";
import { clientInvoiceSchema } from "../modules/plans/schemas.js";

/**
 * Smoke tests, same convention as invoicePdf.test.js: renders a valid PDF
 * for every shape forClientInvoice() produces, plus the one mapping rule
 * worth pinning — an overridden client cost collapses to a single line so
 * the lines always add up to the total the client sees.
 */
const base = {
  name: "Q1 Meme Push",
  variantLabel: "Plan A",
  clientName: "Rohit Sharma",
  clientContact: null,
  clientCompany: "Acme Foods Pvt Ltd",
  clientGstNumber: "27ABCDE1234F1Z5",
  clientAddress: "12 MG Road, Pune 411001",
  clientPhone: "9876543210",
  clientInvoiceNumber: "CINV-1-ABCDEF",
  clientInvoiceAt: new Date("2026-09-13"),
  notes: null,
  createdAt: new Date("2026-09-01"),
  gstPercent: 18,
  itemised: true,
  overview: { totalFollowers: 100000, totalPosts: 3, expectedImpressions: 0, subtotal: 15000, gstAmount: 2700, total: 17700 },
  items: [
    { format: "reel", postsPerProfile: 2, displayCost: 5000, asset: { handle: "demo.page", category: "Meme page", followers: 100000 } },
    { format: "story", postsPerProfile: 1, displayCost: 5000, asset: { handle: "second.page", category: null, followers: 20000 } },
  ],
};

describe("clientInvoiceToDocument — Taggify → client mapping", () => {
  it("bills the client, one line per page × posts, paid into Taggify's account", () => {
    const d = clientInvoiceToDocument(base);
    expect(d.title).toBe("Proforma Invoice");
    expect(d.partyLabel).toBe("Billed to (Client)");
    expect(d.partyLines.map((l) => l.text)).toEqual(["Acme Foods Pvt Ltd", "Rohit Sharma", "Phone: 9876543210", "12 MG Road, Pune 411001", "GSTIN/UIN: 27ABCDE1234F1Z5"]);
    expect(d.rows).toEqual([
      { description: "Reel @demo.page × 2 posts", quantity: 2, rate: 5000, amount: 10000 },
      { description: "Story @second.page", quantity: 1, rate: 5000, amount: 5000 },
    ]);
    expect(d.rows.reduce((s, r) => s + r.amount, 0)).toBe(d.subtotal);
    expect(d).toMatchObject({ subtotal: 15000, gstAmount: 2700, total: 17700 });
    expect(d.bankLabel).toMatch(/pay to/);
    expect(d.bankRows.map(([k]) => k)).toEqual(["Bank Name", "Account Holder", "Account Number", "IFSC Code"]);
    expect(d.detailRows).toContainEqual(["Invoice No.:", "CINV-1-ABCDEF"]);
  });

  it("collapses to one consolidated line when the client-facing cost was overridden, so lines still add up to the subtotal", () => {
    const d = clientInvoiceToDocument({ ...base, itemised: false, overview: { ...base.overview, subtotal: 12000, gstAmount: 2160, total: 14160 } });
    expect(d.rows).toEqual([{ description: "Campaign services — Q1 Meme Push", quantity: 1, rate: 12000, amount: 12000 }]);
  });

  it("the popup's description replaces the per-page lines with one line for the whole subtotal, and carries the typed HSN/SAC", () => {
    const d = clientInvoiceToDocument({ ...base, invoiceDescription: "Influencer marketing services for Q1 campaign", hsnSac: "998361" });
    expect(d.rows).toEqual([{ description: "Influencer marketing services for Q1 campaign", quantity: 1, rate: 15000, amount: 15000 }]);
    expect(d.hsnSac).toBe("998361");
    expect(clientInvoiceToDocument(base).hsnSac).toBeNull(); // blank -> the PDF falls back to the company default
  });

  it("a non-GST plan drops the GST line and the empty GSTIN placeholder", () => {
    const d = clientInvoiceToDocument({ ...base, gstPercent: null, clientGstNumber: null, overview: { ...base.overview, gstAmount: 0, total: 15000 } });
    expect(d.isGst).toBe(false);
    expect(d.partyLines.map((l) => l.text).filter(Boolean)).not.toContain("GSTIN/UIN: —");
  });
});

// 21 Sep — "compare by gst no. of client and our gst": Taggify's GSTIN is
// Haryana (06…), so an 06 client is intra-state and anyone else inter-state.
describe("CGST + SGST vs IGST, from the client's GSTIN state code", () => {
  it("a client in another state is charged IGST at the full rate", () => {
    const d = clientInvoiceToDocument(base); // 27 — Maharashtra
    expect(d.taxSplit).toBe("IGST");
    expect(taxHeads(d)).toEqual([{ label: "IGST", rate: 18, amount: 2700 }]);
  });

  it("a client in Taggify's own state is charged CGST + SGST, half the rate each", () => {
    const d = clientInvoiceToDocument({ ...base, clientGstNumber: "06ABCDE1234F1Z5" });
    expect(d.taxSplit).toBe("CGST_SGST");
    expect(taxHeads(d)).toEqual([
      { label: "CGST", rate: 9, amount: 1350 },
      { label: "SGST", rate: 9, amount: 1350 },
    ]);
  });

  it("an odd-paisa GST amount still splits into two heads that add back exactly", () => {
    const heads = taxHeads({ taxSplit: "CGST_SGST", gstRate: 5, gstAmount: 100.25 });
    expect(heads.map((h) => h.rate)).toEqual([2.5, 2.5]);
    expect(Math.round((heads[0].amount + heads[1].amount) * 100)).toBe(10025);
  });

  it("no / unreadable GSTIN, or a document that never set a split (creator invoices), stays IGST", () => {
    expect(gstSplitFor(null)).toBe("IGST");
    expect(gstSplitFor("GST123")).toBe("IGST");
    expect(gstSplitFor(" 06abcde1234f1z5 ")).toBe("CGST_SGST");
    expect(taxHeads({ gstRate: 18, gstAmount: 180 })).toEqual([{ label: "IGST", rate: 18, amount: 180 }]);
  });

  it("the client invoice schema rejects a missing or malformed GSTIN and upper-cases a valid one", () => {
    const body = { clientCompany: "Acme", clientAddress: "Pune", invoiceDescription: "Services" };
    expect(clientInvoiceSchema.safeParse(body).success).toBe(false);
    expect(clientInvoiceSchema.safeParse({ ...body, clientGstNumber: "" }).success).toBe(false);
    expect(clientInvoiceSchema.safeParse({ ...body, clientGstNumber: "GST123" }).success).toBe(false);
    expect(clientInvoiceSchema.parse({ ...body, clientGstNumber: "27abcde1234f1z5" }).clientGstNumber).toBe("27ABCDE1234F1Z5");
  });
});

describe("buildClientInvoicePdf — renders a valid PDF", () => {
  it("intra-state GST plan (CGST + SGST summary columns)", async () => {
    const pdf = await buildClientInvoicePdf({ ...base, clientGstNumber: "06ABCDE1234F1Z5" });
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  });

  it("GST plan, itemised", async () => {
    const pdf = await buildClientInvoicePdf(base);
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(pdf.length).toBeGreaterThan(1500);
  });

  it("non-GST plan with no phone/company and an overridden cost", async () => {
    const pdf = await buildClientInvoicePdf({ ...base, gstPercent: null, clientCompany: null, clientPhone: null, clientGstNumber: null, itemised: false });
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  });

  it("a long description wraps instead of throwing", async () => {
    const pdf = await buildClientInvoicePdf({ ...base, invoiceDescription: "Influencer marketing and content amplification services across meme, news and entertainment pages for the Q1 launch campaign. ".repeat(2).trim() });
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  });

  it("paginates a long plan without throwing", async () => {
    const items = Array.from({ length: 60 }, (_, i) => ({ format: "reel", postsPerProfile: 1, displayCost: 100, asset: { handle: `page${i}` } }));
    const pdf = await buildClientInvoicePdf({ ...base, items, overview: { ...base.overview, subtotal: 6000, gstAmount: 1080, total: 7080 } });
    expect(pdf.length).toBeGreaterThan(3000);
  });
});
