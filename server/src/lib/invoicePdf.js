import { gstSplitFor } from "./gstin.js";
import { buildTaxDocumentPdf, cap, dateStr } from "./taxDocumentPdf.js";

/**
 * Renders an Invoice (with creator, campaign, billingProfile and
 * items[].link[.asset/.campaign] included — the shape getInvoiceDetail
 * returns) to a PDF buffer, in the Proforma-style layout of the user's
 * sample (12 Sep). Layout lives in taxDocumentPdf.js, shared with the
 * plan's client invoice; this file only maps an Invoice onto it.
 *
 * Content mapping (stated assumption — the sample is Taggify → client,
 * this document is a creator's payout invoice, so the roles are cast as):
 *  - Letterhead: Taggify, always (COMPANY in companyDetails.js).
 *  - "Billed by": the creator — name/phone from the User, PAN/GSTIN from
 *    their approved BillingProfile when there is one.
 *  - "Bank Account Details": the creator's account (that's where Finance
 *    pays), falling back to a "no approved billing profile" note.
 *  - GST lines/summary only on a GST invoice; a non-GST invoice keeps the
 *    same layout minus the tax rows.
 * Pure layout — no tax computation here (amounts come from the row).
 */
export function buildInvoicePdf(invoice) {
  return buildTaxDocumentPdf(invoiceToDocument(invoice));
}

export function invoiceToDocument(invoice) {
  const isGst = Boolean(invoice.isGstInvoice);
  const bp = invoice.billingProfile ?? null;
  const campaign = invoice.campaign ?? invoice.items?.[0]?.link?.campaign ?? null;
  const rows = (invoice.items ?? []).map((item) => {
    const link = item.link ?? {};
    const handle = link.asset?.handle ? `@${link.asset.handle}` : "";
    // The campaign is named in the details block already — only repeat it
    // per line when an invoice mixes campaigns (a creator-raised bulk one).
    const showCampaign = link.campaign?.title && link.campaign.id !== campaign?.id;
    const description = `${cap(link.format ?? "post")} ${handle}`.trim() + (showCampaign ? ` — ${link.campaign.title}` : "");
    return { description, quantity: 1, rate: item.amount, amount: item.amount };
  });
  // BillingProfile has no bank-name column today — the row appears only if one is ever added.
  const bankRows = bp
    ? [bp.bankName ? ["Bank Name", bp.bankName] : null, ["Account Holder", bp.name], ["Account Number", bp.bankAccountNumber], ["IFSC Code", bp.ifscCode]].filter(Boolean)
    : null;

  return {
    title: isGst ? "Tax Invoice" : "Invoice",
    isGst,
    gstRate: 18,
    // Creator in our state → CGST + SGST, elsewhere → IGST, from their
    // billing profile's GSTIN state code (22 Sep — same rule as the client
    // invoice, lib/gstin.js). Only the GST heads change; amounts don't.
    taxSplit: gstSplitFor(bp?.gstin),
    partyLabel: "Billed by (Creator)",
    partyLines: [
      { text: bp?.name || invoice.creator?.name || "Creator", bold: true },
      { text: invoice.creator?.phoneNumber ?? "" },
      { text: invoice.creator?.email ?? "" },
      { text: bp ? `PAN: ${bp.pan}` : "PAN: —" },
      { text: bp?.gstin ? `GSTIN/UIN: ${bp.gstin}` : isGst ? "GSTIN/UIN: —" : "" },
    ],
    detailRows: [
      ["Invoice No.:", invoice.invoiceNumber],
      ["Dated:", dateStr(invoice.createdAt)],
      ["Due:", dateStr(invoice.dueDate)],
      ["Status:", cap(String(invoice.status).toLowerCase())],
      ["Campaign:", campaign ? `${campaign.title}${campaign.brandName ? ` (${campaign.brandName})` : ""}` : "—"],
      ["Mode/Terms of Payment:", "Bank transfer"],
    ],
    rows,
    subtotal: invoice.subtotal,
    gstAmount: invoice.gstAmount,
    total: invoice.amount,
    bankLabel: "Bank Account Details (payout to creator)",
    bankRows,
    bankMissingNote: "No approved billing profile on file for this creator — bank details to be confirmed before payment.",
    leftSignatureLabel: "Creator's Seal and Signature",
    remark: invoice.status === "REJECTED" && invoice.remarks ? `Rejected: ${invoice.remarks}` : null,
  };
}
