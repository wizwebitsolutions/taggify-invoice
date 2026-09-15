import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";
import { COMPANY } from "./companyDetails.js";
import { amountInWords } from "./amountInWords.js";

/**
 * The one Proforma-style invoice layout (user's sample "Sindhal
 * Technologies Private Limited PI 76.pdf", 12 Sep) rendered from a plain
 * document model, so both invoice directions share every line of layout:
 *  - invoicePdf.js: a creator's payout invoice (creator → Taggify)
 *  - clientInvoicePdf.js: a plan's client invoice (Taggify → client)
 * Each of those only decides *what* goes in each block (party lines,
 * detail rows, item rows, bank block); nothing here computes a number.
 *
 * Model shape:
 *  {
 *    title, isGst, gstRate,
 *    partyLabel, partyLines: [{ text, bold? }],
 *    detailRows: [[label, value]],
 *    rows: [{ description, quantity, rate, amount }],
 *    subtotal, gstAmount, total,
 *    bankLabel, bankRows: [[label, value]] | null, bankMissingNote,
 *    leftSignatureLabel, remark?,
 *  }
 */
export function buildTaxDocumentPdf(model) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    renderTaxDocument(doc, model);
    doc.end();
  });
}

export const ORANGE = "#e8531f";
const BAND_BG = "#fbe9e0";
const HEAD_BG = "#f4f4f4";
const INK = "#111111";
const MUTED = "#555555";
const RULE = "#222222";

export const num2 = (n) => Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// "8-Sep-26", exactly as the sample prints dates (toLocaleDateString gives "Sept" for September).
export const dateStr = (d) => {
  if (!d) return "—";
  const dt = new Date(d);
  return `${dt.getDate()}-${MONTHS[dt.getMonth()]}-${String(dt.getFullYear()).slice(-2)}`;
};
export const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/**
 * Trims `text` so it fits in `width` at the doc's current font, with an
 * ellipsis — every cell here is single-line by design (a wrapped cell
 * would spill into the row below), and pdfkit still wraps at `width` even
 * with lineBreak:false, so the trimming has to happen before drawing.
 */
function fit(doc, text, width) {
  const s = String(text ?? "");
  if (doc.widthOfString(s) <= width) return s;
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (doc.widthOfString(`${s.slice(0, mid)}…`) <= width) lo = mid;
    else hi = mid - 1;
  }
  return `${s.slice(0, lo).trimEnd()}…`;
}

/** Single-line text that never wraps: font/size set first, then trimmed to the column. */
function line(doc, text, x, y, width, { align = "left" } = {}) {
  doc.text(fit(doc, text, width), x, y, { width, align, lineBreak: false });
}

function renderTaxDocument(doc, model) {
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const W = right - left;
  const isGst = Boolean(model.isGst);
  const gstRate = isGst ? model.gstRate ?? 18 : 0;
  let y = doc.page.margins.top;

  // ── Title band ─────────────────────────────────────────────────
  doc.rect(left, y, W, 20).fill(ORANGE);
  doc.font("Helvetica-Bold").fontSize(10.5).fillColor("#ffffff").text(model.title, left, y + 5, { width: W, align: "center" });
  y += 20;

  // ── Letterhead (Taggify, always) ───────────────────────────────
  doc.rect(left, y, W, 100).fillAndStroke(HEAD_BG, RULE);
  if (COMPANY.logoPath && existsSync(COMPANY.logoPath)) {
    doc.image(COMPANY.logoPath, left + W / 2 - 80, y + 8, { fit: [160, 44], align: "center" });
  } else {
    // Text stand-in for the image wordmark: "TAG" in ink, "GIFY" in orange.
    doc.font("Helvetica-Bold").fontSize(30);
    const w1 = doc.widthOfString("TAG");
    const w2 = doc.widthOfString("GIFY");
    const x0 = left + (W - w1 - w2) / 2;
    doc.fillColor(INK).text("TAG", x0, y + 12, { lineBreak: false });
    doc.fillColor(ORANGE).text("GIFY", x0 + w1, y + 12, { lineBreak: false });
  }
  const lh = [COMPANY.tagline, COMPANY.address, `GSTIN: ${COMPANY.gstin}   |   PAN: ${COMPANY.pan}`, `E-Mail: ${COMPANY.email}`];
  let ly = y + 54;
  lh.forEach((text, i) => {
    doc.moveTo(left, ly - 2).lineTo(right, ly - 2).lineWidth(0.5).strokeColor("#bbbbbb").stroke();
    doc.font(i === 0 ? "Helvetica-Oblique" : "Helvetica").fontSize(8.5).fillColor(INK).text(text, left, ly, { width: W, align: "center" });
    ly += 11.5;
  });
  y += 100;

  // ── Party / Invoice details ────────────────────────────────────
  const colW = W / 2;
  const partyLines = (model.partyLines ?? []).filter((l) => l.text);
  const detailRows = model.detailRows ?? [];
  const rowH = 13;
  // +1 for the header row above the values.
  const blockH = (Math.max(partyLines.length, detailRows.length) + 1) * rowH + 6;
  doc.rect(left, y, colW, blockH).lineWidth(0.8).strokeColor(RULE).stroke();
  doc.rect(left + colW, y, colW, blockH).stroke();
  doc.font("Helvetica-Bold").fontSize(8).fillColor(INK).text(model.partyLabel, left + 4, y + 3);
  doc.text("Invoice Details", left + colW + 4, y + 3);
  doc.moveTo(left, y + rowH).lineTo(right, y + rowH).stroke();
  let cy = y + rowH + 3;
  for (const l of partyLines) {
    doc.font(l.bold ? "Helvetica-Bold" : "Helvetica").fontSize(8.5).fillColor(INK);
    line(doc, l.text, left + 4, cy, colW - 8);
    cy += rowH;
  }
  let dy = y + rowH + 3;
  for (const [k, v] of detailRows) {
    doc.font("Helvetica").fontSize(8).fillColor(MUTED);
    line(doc, k, left + colW + 4, dy, 110);
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor(INK);
    line(doc, v, left + colW + 118, dy, colW - 122);
    doc.moveTo(left + colW + 114, dy - 3).lineTo(left + colW + 114, dy + rowH - 3).lineWidth(0.4).strokeColor("#999999").stroke();
    dy += rowH;
  }
  y += blockH + 12;

  // ── Items table ─────────────────────────────────────────────────
  const cols = [
    { label: "Sl\nNo.", w: 0.055, align: "center" },
    { label: "Description of Services", w: 0.395, align: "left" },
    { label: "GST\nRate", w: 0.07, align: "center" },
    { label: "Quantity", w: 0.09, align: "center" },
    { label: "Rate", w: 0.12, align: "right" },
    { label: "per", w: 0.06, align: "center" },
    { label: "Amount", w: 0.21, align: "right" },
  ].map((c) => ({ ...c, w: c.w * W }));
  const xs = [];
  let x = left;
  for (const c of cols) {
    xs.push(x);
    x += c.w;
  }
  const headH = 26;
  const drawTableHead = () => {
    doc.rect(left, y, W, headH).fillAndStroke(BAND_BG, RULE);
    cols.forEach((c, i) => {
      doc.font("Helvetica-Bold").fontSize(7.5).fillColor(INK).text(c.label, xs[i] + 2, y + 5, { width: c.w - 4, align: "center" });
      if (i > 0) doc.moveTo(xs[i], y).lineTo(xs[i], y + headH).lineWidth(0.6).strokeColor(RULE).stroke();
    });
    y += headH;
  };
  const drawRow = (cells, { bold = false, h = 15, fill = null } = {}) => {
    if (fill) doc.rect(left, y, W, h).fill(fill);
    cols.forEach((c, i) => {
      doc.moveTo(xs[i], y).lineTo(xs[i], y + h).lineWidth(0.6).strokeColor(RULE).stroke();
      const v = cells[i];
      if (v == null || v === "") return;
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(8.5).fillColor(INK);
      line(doc, v, xs[i] + 3, y + 4, c.w - 6, { align: c.align });
    });
    doc.moveTo(right, y).lineTo(right, y + h).stroke();
    y += h;
  };
  drawTableHead();
  (model.rows ?? []).forEach((row, i) => {
    if (y > doc.page.height - 260) {
      doc.moveTo(left, y).lineTo(right, y).stroke();
      doc.addPage();
      y = doc.page.margins.top;
      drawTableHead();
    }
    drawRow([i + 1, row.description, `${gstRate} %`, row.quantity ?? 1, num2(row.rate), "Nos", num2(row.amount)]);
  });
  drawRow([]);
  if (isGst) drawRow(["", "", "", "", "", "IGST", num2(model.gstAmount)], { bold: true });
  drawRow(["", "", "", "", "", "Total", num2(model.total)], { bold: true, h: 17 });
  doc.moveTo(left, y).lineTo(right, y).lineWidth(0.8).strokeColor(RULE).stroke();
  y += 14;

  // ── HSN/SAC summary (GST documents) ─────────────────────────────
  if (isGst) {
    const sw = [0.3, 0.25, 0.15, 0.15, 0.15].map((f) => f * W);
    const sx = [];
    let xx = left;
    for (const w of sw) {
      sx.push(xx);
      xx += w;
    }
    const srow = (cells, { bold = false, fill = null, h = 14 } = {}) => {
      if (fill) doc.rect(left, y, W, h).fill(fill);
      doc.rect(left, y, W, h).lineWidth(0.6).strokeColor(RULE).stroke();
      cells.forEach((v, i) => {
        if (i > 0) doc.moveTo(sx[i], y).lineTo(sx[i], y + h).stroke();
        doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(8).fillColor(INK);
        line(doc, v, sx[i] + 3, y + 3.5, sw[i] - 6, { align: i === 0 ? "center" : "right" });
      });
      y += h;
    };
    doc.rect(left, y, W, 14).fillAndStroke(BAND_BG, RULE);
    doc.font("Helvetica-Bold").fontSize(8).fillColor(INK).text("HSN/SAC Summary", left, y + 3.5, { width: W, align: "center" });
    y += 14;
    srow(["HSN/SAC", "Taxable Value", "IGST Rate", "IGST Amount", "Total Tax"], { bold: true, fill: BAND_BG });
    srow([COMPANY.sac, num2(model.subtotal), `${gstRate}%`, num2(model.gstAmount), num2(model.gstAmount)]);
    srow(["Total", num2(model.subtotal), "", num2(model.gstAmount), num2(model.gstAmount)], { bold: true });
  }
  doc.rect(left, y, W, 15).lineWidth(0.6).strokeColor(RULE).stroke();
  doc.font("Helvetica-BoldOblique").fontSize(8.5).fillColor(INK);
  line(doc, `Amount (in words): ${amountInWords(model.total)}`, left + 4, y + 4, W - 8);
  y += 26;

  // ── Bank details ────────────────────────────────────────────────
  doc.rect(left, y, W, 14).fillAndStroke(BAND_BG, RULE);
  doc.font("Helvetica-Bold").fontSize(8).fillColor(INK).text(model.bankLabel, left + 4, y + 3.5);
  y += 14;
  if (model.bankRows) {
    for (const [k, v] of model.bankRows) {
      doc.rect(left, y, W, 13).lineWidth(0.6).strokeColor(RULE).stroke();
      doc.moveTo(left + W * 0.42, y).lineTo(left + W * 0.42, y + 13).stroke();
      doc.font("Helvetica").fontSize(8).fillColor(INK);
      line(doc, k, left + 4, y + 3, W * 0.42 - 8);
      doc.font("Helvetica-Bold").fontSize(8);
      line(doc, v, left + W * 0.42 + 4, y + 3, W * 0.58 - 8);
      y += 13;
    }
  } else {
    doc.rect(left, y, W, 15).lineWidth(0.6).strokeColor(RULE).stroke();
    doc.font("Helvetica-Oblique").fontSize(8).fillColor(MUTED);
    line(doc, model.bankMissingNote ?? "Bank details to be confirmed.", left + 4, y + 4, W - 8);
    y += 15;
  }
  y += 14;

  // ── Declaration + signatory ─────────────────────────────────────
  doc.rect(left, y, W, 14).lineWidth(0.6).strokeColor(RULE).stroke();
  doc.font("Helvetica-Bold").fontSize(8).fillColor(INK).text("Declaration", left + 4, y + 3.5);
  y += 14;
  doc.font("Helvetica").fontSize(7.5).fillColor(INK).text("We declare that this invoice shows the actual price of the services described and that all particulars are true and correct.", left + 2, y + 3, { width: W - 4 });
  y += 30;
  doc.font("Helvetica").fontSize(8).fillColor(INK).text(model.leftSignatureLabel, left, y, { lineBreak: false });
  doc.text(`for ${COMPANY.name.toUpperCase()}`, right - 180, y, { width: 180, align: "right" });
  if (COMPANY.signaturePath && existsSync(COMPANY.signaturePath)) {
    doc.image(COMPANY.signaturePath, right - 120, y + 12, { fit: [100, 34] });
  }
  doc.font("Helvetica").fontSize(7.5).fillColor(MUTED).text("Authorised Signatory", right - 180, y + 50, { width: 180, align: "right" });
  y += 68;
  if (model.remark) {
    doc.font("Helvetica-Oblique").fontSize(7.5).fillColor(ORANGE).text(model.remark, left, y, { width: W, align: "center" });
    y += 12;
  }
  doc.font("Helvetica-Oblique").fontSize(7).fillColor(MUTED).text("This is a Computer Generated Invoice", left, y, { width: W, align: "center" });
}
