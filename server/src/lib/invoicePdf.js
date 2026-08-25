import PDFDocument from "pdfkit";

/**
 * Renders an Invoice (with creator + items.link.{asset,campaign} included)
 * to a PDF buffer. Pure layout — no tax computation: GST status here is the
 * same manually-tracked workflow field as everywhere else in the app
 * (system design.md §2.7), not a computed tax invoice.
 */
export function buildInvoicePdf(invoice) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    renderInvoice(doc, invoice);
    doc.end();
  });
}

const money = (n) =>
  `Rs. ${Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const dateStr = (d) => (d ? new Date(d).toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric" }) : "—");

function renderInvoice(doc, invoice) {
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const contentWidth = right - left;

  // ── Header ──────────────────────────────────────────────────────
  doc.font("Helvetica-Bold").fontSize(20).fillColor("#111111").text("INVOICE", left, 50);
  doc
    .font("Helvetica")
    .fontSize(10)
    .fillColor("#555555")
    .text(invoice.invoiceNumber, left, 76);

  doc
    .font("Helvetica")
    .fontSize(9)
    .fillColor("#555555")
    .text(`Raised ${dateStr(invoice.createdAt)}`, left, 92)
    .text(
      invoice.status === "PAID" ? `Paid ${dateStr(invoice.paidAt)}` : `Due ${dateStr(invoice.dueDate)}`,
      left,
      106
    );

  // status pills, top right
  const pillY = 50;
  drawPill(doc, right - 90, pillY, 90, invoice.status, statusColor(invoice.status));
  drawPill(doc, right - 90, pillY + 22, 90, `GST: ${invoice.gstStatus}`, gstColor(invoice.gstStatus));
  if (invoice.status !== "PAID" && invoice.overdueDays > 0) {
    drawPill(doc, right - 90, pillY + 44, 90, `Overdue ${invoice.overdueDays}d`, "#e11d48");
  }
  if (invoice.status === "REJECTED" && invoice.remarks) {
    doc.font("Helvetica-Oblique").fontSize(8).fillColor("#e11d48").text(`Rejected: ${invoice.remarks}`, right - 200, pillY + 44, {
      width: 200,
      align: "right",
    });
  }

  doc.moveTo(left, 135).lineTo(right, 135).strokeColor("#e5e5e5").lineWidth(1).stroke();

  // ── Billed by / to ─────────────────────────────────────────────
  const infoY = 150;
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#888888").text("BILLED BY", left, infoY);
  doc
    .font("Helvetica")
    .fontSize(11)
    .fillColor("#111111")
    .text(invoice.creator?.name || "Creator", left, infoY + 14);
  doc
    .font("Helvetica")
    .fontSize(9)
    .fillColor("#555555")
    .text(invoice.creator?.phoneNumber ?? "", left, infoY + 30);

  const brandNames = [...new Set(invoice.items.map((it) => it.link?.campaign?.brandName).filter(Boolean))];
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#888888").text("BILLED TO", left + contentWidth / 2, infoY);
  doc
    .font("Helvetica")
    .fontSize(11)
    .fillColor("#111111")
    .text(brandNames.length ? brandNames.join(", ") : "—", left + contentWidth / 2, infoY + 14, {
      width: contentWidth / 2,
    });

  // ── Billing profile (PAN/GSTIN/bank) ────────────────────────────
  // Only rendered once the creator has an admin-approved BillingProfile
  // (creator.wldd.in's "Bill To" block) — omitted entirely otherwise so an
  // unregistered creator's invoice doesn't show blank tax fields.
  let billingY = infoY + 44;
  if (invoice.billingProfile) {
    const bp = invoice.billingProfile;
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#888888").text("BILLING PROFILE", left, billingY);
    doc.font("Helvetica").fontSize(9).fillColor("#555555").text(
      `${bp.name}  ·  PAN ${bp.pan}${bp.gstin ? `  ·  GSTIN ${bp.gstin}` : ""}`,
      left,
      billingY + 13,
      { width: contentWidth }
    );
    doc.text(`A/C ${bp.bankAccountNumber}  ·  IFSC ${bp.ifscCode}`, left, billingY + 26);
    billingY += 44;
  }

  // ── Line items table ───────────────────────────────────────────
  let y = Math.max(infoY + 60, billingY);
  const cols = [
    { key: "page", label: "Page / Format", width: contentWidth * 0.32 },
    { key: "campaign", label: "Campaign", width: contentWidth * 0.28 },
    { key: "posted", label: "Posted", width: contentWidth * 0.16 },
    { key: "amount", label: "Amount", width: contentWidth * 0.24, align: "right" },
  ];

  y = drawTableHeader(doc, left, y, cols);

  for (const item of invoice.items) {
    if (y > doc.page.height - 160) {
      doc.addPage();
      y = doc.page.margins.top;
      y = drawTableHeader(doc, left, y, cols);
    }

    const link = item.link ?? {};
    const asset = link.asset ?? {};
    const row = {
      page: `@${asset.handle ?? "—"}${link.format ? `  ·  ${cap(link.format)}` : ""}`,
      campaign: link.campaign?.title ?? "—",
      posted: dateStr(link.postedAt),
      amount: money(item.amount),
    };

    let x = left;
    doc.font("Helvetica").fontSize(9.5).fillColor("#222222");
    for (const col of cols) {
      doc.text(row[col.key], x, y, { width: col.width - 8, align: col.align ?? "left" });
      x += col.width;
    }
    y += 22;
    doc.moveTo(left, y - 4).lineTo(right, y - 4).strokeColor("#f0f0f0").lineWidth(0.5).stroke();
  }

  // ── Total ──────────────────────────────────────────────────────
  y += 12;
  doc.moveTo(left, y).lineTo(right, y).strokeColor("#111111").lineWidth(1).stroke();
  y += 10;
  doc.font("Helvetica-Bold").fontSize(11).fillColor("#111111").text("Total", left, y);
  doc.font("Helvetica-Bold").fontSize(13).fillColor("#111111").text(money(invoice.amount), left, y - 2, {
    width: contentWidth,
    align: "right",
  });

  // ── Footer ─────────────────────────────────────────────────────
  const footerY = doc.page.height - 70;
  doc
    .font("Helvetica")
    .fontSize(7.5)
    .fillColor("#999999")
    .text(
      "System-generated invoice. Payment status and GST status are tracked manually and settled outside this system (bank transfer). This document is not a computed tax invoice.",
      left,
      footerY,
      { width: contentWidth }
    );
}

function drawTableHeader(doc, left, y, cols) {
  let x = left;
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#888888");
  for (const col of cols) {
    doc.text(col.label.toUpperCase(), x, y, { width: col.width - 8, align: col.align ?? "left" });
    x += col.width;
  }
  y += 16;
  doc
    .moveTo(left, y)
    .lineTo(left + cols.reduce((s, c) => s + c.width, 0), y)
    .strokeColor("#cccccc")
    .lineWidth(1)
    .stroke();
  return y + 10;
}

function drawPill(doc, x, y, width, label, color) {
  doc.roundedRect(x, y, width, 16, 8).fillColor(color).fillOpacity(0.12).fill();
  doc
    .fillOpacity(1)
    .font("Helvetica-Bold")
    .fontSize(7.5)
    .fillColor(color)
    .text(label, x, y + 4, { width, align: "center" });
}

function statusColor(status) {
  return (
    { DRAFT: "#888888", RAISED: "#2563eb", APPROVED: "#7c3aed", REJECTED: "#e11d48", PAID: "#16a34a" }[status] ??
    "#555555"
  );
}
function gstColor(status) {
  return { PENDING: "#d97706", SCHEDULED: "#2563eb", COMPLETED: "#16a34a" }[status] ?? "#555555";
}
function cap(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
