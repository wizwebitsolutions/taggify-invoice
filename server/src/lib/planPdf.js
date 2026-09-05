import PDFDocument from "pdfkit";

/**
 * Renders a Plan (see plans/service.js's getPlan/annotatePlan — items each
 * include their asset, plus computed totalCost/budgetVariance/
 * expectedEngagement) to a PDF buffer — the client-facing pitch document
 * newTask.md #13 asks for. Pure layout, same structure as invoicePdf.js.
 */
export function buildPlanPdf(plan) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    renderPlan(doc, plan);
    doc.end();
  });
}

const money = (n) => `Rs. ${Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dateStr = (d) => (d ? new Date(d).toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric" }) : "—");

function renderPlan(doc, plan) {
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const contentWidth = right - left;

  // ── Header ──────────────────────────────────────────────────────
  doc.font("Helvetica-Bold").fontSize(20).fillColor("#111111").text(plan.name, left, 50, { width: contentWidth });
  doc.font("Helvetica").fontSize(10).fillColor("#555555").text(`Prepared ${dateStr(plan.createdAt)}`, left, 78);

  doc.moveTo(left, 100).lineTo(right, 100).strokeColor("#e5e5e5").lineWidth(1).stroke();

  // ── Client / budget ─────────────────────────────────────────────
  const infoY = 115;
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#888888").text("PREPARED FOR", left, infoY);
  doc.font("Helvetica").fontSize(12).fillColor("#111111").text(plan.clientName, left, infoY + 14);
  if (plan.clientContact) {
    doc.font("Helvetica").fontSize(9).fillColor("#555555").text(plan.clientContact, left, infoY + 32);
  }

  if (plan.budget != null) {
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#888888").text("BUDGET", left + contentWidth / 2, infoY);
    doc.font("Helvetica").fontSize(12).fillColor("#111111").text(money(plan.budget), left + contentWidth / 2, infoY + 14);
  }

  // ── Line items table ───────────────────────────────────────────
  let y = infoY + 60;
  const cols = [
    { key: "page", label: "Page", width: contentWidth * 0.24 },
    { key: "category", label: "Category", width: contentWidth * 0.18 },
    { key: "followers", label: "Followers", width: contentWidth * 0.16, align: "right" },
    { key: "format", label: "Format", width: contentWidth * 0.16 },
    { key: "cost", label: "Cost", width: contentWidth * 0.26, align: "right" },
  ];

  y = drawTableHeader(doc, left, y, cols);

  for (const item of plan.items) {
    if (y > doc.page.height - 200) {
      doc.addPage();
      y = doc.page.margins.top;
      y = drawTableHeader(doc, left, y, cols);
    }

    const asset = item.asset ?? {};
    const row = {
      page: `@${asset.handle ?? "—"}`,
      category: asset.category ?? "—",
      followers: (asset.followers ?? 0).toLocaleString("en-IN"),
      format: cap(item.format),
      cost: money(item.cost),
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

  if (plan.items.length === 0) {
    doc.font("Helvetica-Oblique").fontSize(9.5).fillColor("#888888").text("No pages added yet.", left, y);
    y += 22;
  }

  // ── Expected engagement + totals ──────────────────────────────
  y += 12;
  doc.moveTo(left, y).lineTo(right, y).strokeColor("#111111").lineWidth(1).stroke();
  y += 10;

  doc.font("Helvetica-Bold").fontSize(9).fillColor("#888888").text("EXPECTED ENGAGEMENT (AVG.)", left, y);
  y += 14;
  doc
    .font("Helvetica")
    .fontSize(10)
    .fillColor("#111111")
    .text(`${plan.expectedEngagement.likes.toLocaleString("en-IN")} likes  ·  ${plan.expectedEngagement.views.toLocaleString("en-IN")} views`, left, y);
  y += 26;

  doc.font("Helvetica-Bold").fontSize(11).fillColor("#111111").text("Total cost", left, y);
  doc.font("Helvetica-Bold").fontSize(13).fillColor("#111111").text(money(plan.totalCost), left, y - 2, { width: contentWidth, align: "right" });
  y += 20;

  if (plan.budgetVariance != null) {
    const overBudget = plan.budgetVariance < 0;
    doc
      .font("Helvetica")
      .fontSize(9.5)
      .fillColor(overBudget ? "#e11d48" : "#16a34a")
      .text(
        overBudget ? `Rs. ${Math.abs(plan.budgetVariance).toLocaleString("en-IN")} over budget` : `Rs. ${plan.budgetVariance.toLocaleString("en-IN")} under budget`,
        left,
        y,
        { width: contentWidth, align: "right" }
      );
  }

  // ── Footer ─────────────────────────────────────────────────────
  const footerY = doc.page.height - 60;
  doc
    .font("Helvetica")
    .fontSize(7.5)
    .fillColor("#999999")
    .text("Proposed pricing and reach estimates — subject to change on confirmation.", left, footerY, { width: contentWidth });
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

function cap(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
