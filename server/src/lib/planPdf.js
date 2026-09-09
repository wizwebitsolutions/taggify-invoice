import PDFDocument from "pdfkit";

/**
 * Renders a Plan to a PDF buffer — the client-facing pitch document
 * newTask.md #13 asks for, reshaped 8 Sep to match a real example sheet
 * ("ICCPL <> Taggify"): an Overview block (total followers/posts/expected
 * impressions, cost + GST + total) followed by the page selection grouped
 * by category, without a per-row cost column — the sheet only ever shows
 * one aggregate cost, on the overview, not broken out per page.
 *
 * Takes ONLY what plans/service.js's forClientPdf() produces — there is no
 * `cost`/`clientCost` field anywhere in that shape, just the already-
 * resolved `displayCost`, so this module has no internal-cost field it
 * could accidentally render even by mistake. Pure layout, same structure
 * as invoicePdf.js.
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
const num = (n) => Number(n).toLocaleString("en-IN");
const dateStr = (d) => (d ? new Date(d).toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric" }) : "—");

function renderPlan(doc, plan) {
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const contentWidth = right - left;

  // ── Header ──────────────────────────────────────────────────────
  doc
    .rect(left, 40, contentWidth, 26)
    .fill("#111111")
    .font("Helvetica-Bold")
    .fontSize(12)
    .fillColor("#ffffff")
    .text("TAGGIFY", left + 12, 48);

  doc.font("Helvetica-Bold").fontSize(18).fillColor("#111111").text(plan.name, left, 82, { width: contentWidth });
  doc.font("Helvetica").fontSize(9.5).fillColor("#555555").text(`Prepared for ${plan.clientName} · ${dateStr(plan.createdAt)}`, left, 106);
  if (plan.clientContact) {
    doc.font("Helvetica").fontSize(9).fillColor("#777777").text(plan.clientContact, left, 120);
  }

  let y = 145;
  doc.moveTo(left, y).lineTo(right, y).strokeColor("#e5e5e5").lineWidth(1).stroke();
  y += 14;

  // ── Overview (matches the example sheet's "CAMPAIGN OVERVIEW" tab) ──
  const o = plan.overview;
  const overviewRows = [
    ["Total Followers Targeted Overall", num(o.totalFollowers)],
    ["Total Posts", num(o.totalPosts)],
    ["Expected Impressions", `${num(o.expectedImpressions)} (est.)`],
    ["Cost", money(o.subtotal)],
  ];
  if (plan.isGstPlan) overviewRows.push(["GST (18%)", money(o.gstAmount)]);
  overviewRows.push([plan.isGstPlan ? "Total Cost" : "Total Cost (excl. GST)", money(o.total)]);

  doc.font("Helvetica-Bold").fontSize(10).fillColor("#111111").text("CAMPAIGN OVERVIEW", left, y);
  y += 18;
  for (const [label, value] of overviewRows) {
    const isTotal = label.startsWith("Total Cost");
    doc.font(isTotal ? "Helvetica-Bold" : "Helvetica").fontSize(isTotal ? 11 : 9.5).fillColor("#222222");
    doc.text(label, left, y, { width: contentWidth * 0.6 });
    doc.text(value, left + contentWidth * 0.6, y, { width: contentWidth * 0.4, align: "right" });
    y += isTotal ? 18 : 15;
  }

  y += 6;
  doc.moveTo(left, y).lineTo(right, y).strokeColor("#e5e5e5").lineWidth(1).stroke();
  y += 16;

  // ── Pages, grouped by category (matches the example sheet's per-
  // category sections — "Amplification Pages", "Coverage Handles", etc.) ──
  const groups = new Map();
  for (const item of plan.items) {
    const key = item.asset?.category || "Pages";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }

  const cols = [
    { key: "sno", label: "S No", width: contentWidth * 0.1 },
    { key: "page", label: "Page Name", width: contentWidth * 0.34 },
    { key: "followers", label: "Followers", width: contentWidth * 0.22, align: "right" },
    { key: "format", label: "Format", width: contentWidth * 0.16 },
    { key: "posts", label: "Post Per Profile", width: contentWidth * 0.18, align: "right" },
  ];

  if (plan.items.length === 0) {
    doc.font("Helvetica-Oblique").fontSize(9.5).fillColor("#888888").text("No pages added yet.", left, y);
    y += 22;
  }

  for (const [category, items] of groups) {
    if (y > doc.page.height - 160) {
      doc.addPage();
      y = doc.page.margins.top;
    }

    doc.rect(left, y, contentWidth, 20).fill("#eef2ff");
    doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#333366").text(category, left + 8, y + 5);
    y += 20;
    y = drawTableHeader(doc, left, y, cols);

    items.forEach((item, i) => {
      if (y > doc.page.height - 100) {
        doc.addPage();
        y = doc.page.margins.top;
        y = drawTableHeader(doc, left, y, cols);
      }
      const asset = item.asset ?? {};
      const row = {
        sno: String(i + 1),
        page: `@${asset.handle ?? "—"}`,
        followers: num(asset.followers ?? 0),
        format: cap(item.format),
        posts: num(item.postsPerProfile),
      };
      let x = left;
      doc.font("Helvetica").fontSize(9.5).fillColor("#222222");
      for (const col of cols) {
        doc.text(row[col.key], x, y, { width: col.width - 8, align: col.align ?? "left" });
        x += col.width;
      }
      y += 20;
      doc.moveTo(left, y - 4).lineTo(right, y - 4).strokeColor("#f0f0f0").lineWidth(0.5).stroke();
    });
    y += 14;
  }

  // ── Notes (matches the example sheet's disclaimer block) ──────────
  if (y > doc.page.height - 140) {
    doc.addPage();
    y = doc.page.margins.top;
  }
  doc.rect(left, y, contentWidth, 18).fill("#111111");
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#ffffff").text("NOTES", left + 8, y + 4);
  y += 24;
  const notes = [
    plan.isGstPlan ? "All prices mentioned above are inclusive of GST." : "All prices mentioned above are exclusive of GST.",
    "All the mentioned accounts are subject to availability. In case any of them are unavailable at the time of execution, suitable and equivalent replacements will be provided.",
  ];
  doc.font("Helvetica").fontSize(8.5).fillColor("#444444");
  for (const note of notes) {
    doc.text(note, left, y, { width: contentWidth });
    y += doc.heightOfString(note, { width: contentWidth }) + 6;
  }

  // ── Footer ─────────────────────────────────────────────────────
  const footerY = doc.page.height - 50;
  doc
    .font("Helvetica")
    .fontSize(7.5)
    .fillColor("#999999")
    .text("Proposed pricing and reach estimates — subject to change on confirmation.", left, footerY, { width: contentWidth });
}

function drawTableHeader(doc, left, y, cols) {
  let x = left;
  doc.font("Helvetica-Bold").fontSize(8).fillColor("#888888");
  for (const col of cols) {
    doc.text(col.label.toUpperCase(), x, y, { width: col.width - 8, align: col.align ?? "left" });
    x += col.width;
  }
  y += 14;
  doc
    .moveTo(left, y)
    .lineTo(left + cols.reduce((s, c) => s + c.width, 0), y)
    .strokeColor("#cccccc")
    .lineWidth(1)
    .stroke();
  return y + 8;
}

function cap(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
