import { describe, it, expect } from "vitest";
import { buildClientInvoicePdf, clientInvoiceToDocument } from "./clientInvoicePdf.js";

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
  isGstPlan: true,
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
    expect(d.title).toBe("Tax Invoice");
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

  it("a non-GST plan drops the GST line and the empty GSTIN placeholder", () => {
    const d = clientInvoiceToDocument({ ...base, isGstPlan: false, clientGstNumber: null, overview: { ...base.overview, gstAmount: 0, total: 15000 } });
    expect(d.title).toBe("Invoice");
    expect(d.isGst).toBe(false);
    expect(d.partyLines.map((l) => l.text).filter(Boolean)).not.toContain("GSTIN/UIN: —");
  });
});

describe("buildClientInvoicePdf — renders a valid PDF", () => {
  it("GST plan, itemised", async () => {
    const pdf = await buildClientInvoicePdf(base);
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(pdf.length).toBeGreaterThan(1500);
  });

  it("non-GST plan with no phone/company and an overridden cost", async () => {
    const pdf = await buildClientInvoicePdf({ ...base, isGstPlan: false, clientCompany: null, clientPhone: null, clientGstNumber: null, itemised: false });
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  });

  it("paginates a long plan without throwing", async () => {
    const items = Array.from({ length: 60 }, (_, i) => ({ format: "reel", postsPerProfile: 1, displayCost: 100, asset: { handle: `page${i}` } }));
    const pdf = await buildClientInvoicePdf({ ...base, items, overview: { ...base.overview, subtotal: 6000, gstAmount: 1080, total: 7080 } });
    expect(pdf.length).toBeGreaterThan(3000);
  });
});
