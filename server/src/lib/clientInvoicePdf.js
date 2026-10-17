import { COMPANY } from "./companyDetails.js";
import { gstSplitFor } from "./gstin.js";
import { buildTaxDocumentPdf, dateStr } from "./taxDocumentPdf.js";
import { formatLabel } from "./formats.js";

/**
 * The Taggify → client invoice for a plan (user request, 13 Sep — "on
 * clicking generate invoice, it'll ask for client details like gst,
 * company address, phone number"). Same Proforma-style layout as the
 * creator invoice (taxDocumentPdf.js), cast the other way round:
 *  - "Billed to": the client — company, contact person, phone, address,
 *    GSTIN, straight from the details the popup collected onto the Plan.
 *  - Items: one line per plan page (format @handle × posts at the
 *    client-facing rate). When Step 3 overrode the client-facing cost the
 *    lines wouldn't add up to it, so the invoice shows one consolidated
 *    "campaign services" line for the overridden subtotal instead.
 *  - Totals: the plan's `overview` — subtotal, GST at the plan's gstPercent if set, total.
 *  - "Bank Account Details": Taggify's own (COMPANY.bank) — where the
 *    client pays.
 *
 * Takes ONLY what plans/service.js's forClientInvoice() produces — like
 * forClientPdf, that shape carries no internal cost field, so nothing
 * here can reach a number the client mustn't see.
 */
export function buildClientInvoicePdf(plan) {
  return buildTaxDocumentPdf(clientInvoiceToDocument(plan));
}

export function clientInvoiceToDocument(plan) {
  const gstPercent = plan.gstPercent != null ? Number(plan.gstPercent) : 0;
  const isGst = gstPercent > 0;
  // One consolidated line once the popup's description is on the plan (17
  // Sep — "Description of goods/service ... filled by plan maker, admin");
  // plans invoiced before that keep the per-page lines.
  const rows = plan.invoiceDescription
    ? [{ description: plan.invoiceDescription, quantity: 1, rate: plan.overview.subtotal, amount: plan.overview.subtotal }]
    : plan.itemised
    ? plan.items.map((item) => {
        const handle = item.asset?.handle ? `@${item.asset.handle}` : "";
        const posts = item.postsPerProfile ?? 1;
        return {
          description: `${formatLabel(item.format) || "Post"} ${handle}`.trim() + (posts > 1 ? ` × ${posts} posts` : ""),
          quantity: posts,
          rate: item.displayCost,
          amount: item.displayCost * posts,
        };
      })
    : [{ description: `Campaign services — ${plan.name}`, quantity: 1, rate: plan.overview.subtotal, amount: plan.overview.subtotal }];

  const contactLine = plan.clientName && plan.clientName !== plan.clientCompany ? plan.clientName : "";
  return {
    title: "Proforma Invoice",
    hsnSac: plan.hsnSac || null,
    isGst,
    gstRate: gstPercent,
    // Client in our state → CGST + SGST, anywhere else → IGST (lib/gstin.js).
    taxSplit: gstSplitFor(plan.clientGstNumber),
    partyLabel: "Billed to (Client)",
    partyLines: [
      { text: plan.clientCompany || plan.clientName || "Client", bold: true },
      { text: contactLine },
      { text: plan.clientPhone ? `Phone: ${plan.clientPhone}` : "" },
      { text: plan.clientAddress ?? "" },
      { text: plan.clientGstNumber ? `GSTIN/UIN: ${plan.clientGstNumber}` : isGst ? "GSTIN/UIN: —" : "" },
    ],
    detailRows: [
      ["Invoice No.:", plan.clientInvoiceNumber],
      ["Dated:", dateStr(plan.clientInvoiceAt)],
      ["Plan:", `${plan.name}${plan.variantLabel && plan.variantLabel !== "Plan A" ? ` (${plan.variantLabel})` : ""}`],
      ["Mode/Terms of Payment:", "Bank transfer"],
    ],
    rows,
    subtotal: plan.overview.subtotal,
    // Flat discount (16 Oct), off the subtotal before GST — GST is on `taxable`.
    discount: plan.overview.discount ?? 0,
    taxable: plan.overview.taxable ?? plan.overview.subtotal,
    gstAmount: plan.overview.gstAmount,
    total: plan.overview.total,
    bankLabel: `Bank Account Details (pay to ${COMPANY.name})`,
    bankRows: [
      ["Bank Name", COMPANY.bank.name],
      ["Account Holder", COMPANY.bank.holder],
      ["Account Number", COMPANY.bank.account],
      ["IFSC Code", COMPANY.bank.ifsc],
    ],
    leftSignatureLabel: "Customer's Seal and Signature",
    remark: null,
  };
}
