import PDFDocument from "pdfkit";
import { compactFollowers } from "./followers.js";
import { formatLabel } from "./formats.js";

/**
 * Renders a Plan to a PDF buffer — the client-facing pitch document
 * newTask.md #13 asks for, reshaped 8 Sep to match a real example sheet
 * ("ICCPL <> Taggify"): an Overview block (total followers/posts/expected
 * impressions, cost + GST + total) followed by the page selection grouped
 * by category, without a per-row cost column — the sheet only ever shows
 * one aggregate cost, on the overview, not broken out per page.
 *
 * Takes ONLY what plans/service.js's forClientPdf() produces by default —
 * there is no `cost`/`clientCost` field anywhere in that shape, just the
 * already-resolved `displayCost`, so this module has no internal-cost
 * field it could accidentally render even by mistake. Pure layout, same
 * structure as invoicePdf.js.
 *
 * `{ internal: true }` (user request, 10 Sep — "internal plan in which
 * actual things will be there") switches to the OTHER shape instead: the
 * full annotated plan straight from plans/service.js's getPlan (has raw
 * `items[].cost`, `totalCost`, `internal.computed*`) — real numbers,
 * ignoring any client-facing override, with a header band making it
 * unmistakably not the client document.
 */
export function buildPlanPdf(plan, { internal = false } = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    renderPlan(doc, plan, { internal });
    doc.end();
  });
}

/**
 * The combined "Plan A + Plan B" download once a pitch group exists (user
 * request, 10 Sep — "option of making plan b or other plan"). One page
 * break between variants; every plan renders through the exact same
 * renderPlan used for a single-plan download — no second visual system.
 */
export function buildPlanGroupPdf(plans, { internal = false } = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    plans.forEach((plan, i) => {
      if (i > 0) doc.addPage();
      renderPlan(doc, plan, { internal });
    });
    doc.end();
  });
}

const money = (n) => `Rs. ${Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num = (n) => Number(n).toLocaleString("en-IN");
const dateStr = (d) => (d ? new Date(d).toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric" }) : "—");

function renderPlan(doc, plan, { internal = false } = {}) {
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

  // "internal plan in which actual things will be there" (user request, 10
  // Sep) — this band is the only thing standing between an admin and
  // accidentally sending the real-cost PDF to a client, so it's loud.
  if (internal) {
    doc.rect(right - 150, 40, 150, 26).fill("#b91c1c");
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#ffffff").text("INTERNAL — NOT FOR CLIENT", right - 150, 49, { width: 150, align: "center" });
  }

  const titleLine = plan.variantLabel && plan.variantLabel !== "Plan A" ? `${plan.name} — ${plan.variantLabel}` : plan.name;
  doc.font("Helvetica-Bold").fontSize(18).fillColor("#111111").text(titleLine, left, 82, { width: contentWidth });
  doc.font("Helvetica").fontSize(9.5).fillColor("#555555").text(`Prepared for ${plan.clientName} · ${dateStr(plan.createdAt)}`, left, 106);
  let y = 120;
  if (plan.clientContact) {
    doc.font("Helvetica").fontSize(9).fillColor("#777777").text(plan.clientContact, left, y);
    y += 13;
  }
  // Client-details block (user request, 10 Sep — "client details ... company
  // name, gst number, address etc"). Only takes space when actually filled in.
  const clientDetails = [plan.clientCompany, plan.clientGstNumber && `GSTIN: ${plan.clientGstNumber}`, plan.clientAddress].filter(Boolean);
  if (clientDetails.length > 0) {
    doc.font("Helvetica").fontSize(8.5).fillColor("#888888").text(clientDetails.join(" · "), left, y, { width: contentWidth });
    y += 13;
  }

  y = Math.max(y, 145);
  doc.moveTo(left, y).lineTo(right, y).strokeColor("#e5e5e5").lineWidth(1).stroke();
  y += 14;

  // ── Overview (matches the example sheet's "CAMPAIGN OVERVIEW" tab) ──
  // Client mode reads the already-resolved `overview` (any Step 3 override
  // baked in); internal mode always reads the real computed numbers,
  // ignoring overrides entirely — the whole point of this document.
  const o = internal ? plan.internal : plan.overview;
  const subtotal = internal ? plan.internal.computedSubtotal : plan.overview.subtotal;
  const gstAmount = internal ? plan.internal.computedGstAmount : plan.overview.gstAmount;
  const total = internal ? plan.internal.computedTotal : plan.overview.total;
  // Flat discount (16 Oct), off the cost before GST — rows only when there is one.
  const discount = Number(internal ? plan.internal.computedDiscount : plan.overview.discount) || 0;
  const taxable = internal ? plan.internal.computedTaxable : plan.overview.taxable;
  const overviewRows = [
    ["Total Followers Targeted Overall", compactFollowers(internal ? o.computedFollowers : o.totalFollowers)],
    ["Total Posts", num(internal ? o.computedPosts : o.totalPosts)],
    ["Expected Impressions", `${num(internal ? o.computedImpressions : o.expectedImpressions)} (est.)`],
    [internal ? "Internal Cost" : "Cost", money(subtotal)],
  ];
  if (discount > 0) {
    overviewRows.push(["Discount", `- ${money(discount)}`]);
    overviewRows.push(["After Discount", money(taxable ?? Math.max(0, subtotal - discount))]);
  }
  if (plan.isGstPlan) overviewRows.push([`GST (${num(plan.gstPercent)}%)`, money(gstAmount)]);
  overviewRows.push([plan.isGstPlan ? "Total Cost" : "Total Cost (excl. GST)", money(total)]);
  if (internal && plan.budgetVariance != null) {
    overviewRows.push([plan.budgetVariance < 0 ? "Over Budget" : "Under Budget", money(Math.abs(plan.budgetVariance))]);
  }

  doc.font("Helvetica-Bold").fontSize(10).fillColor("#111111").text(internal ? "INTERNAL OVERVIEW" : "CAMPAIGN OVERVIEW", left, y);
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

  // ── Pages — one flat list, same as the Google Sheet (user request,
  // 14 Sep — "all pages will display", not per category). ──

  const cols = [
    { key: "sno", label: "S No", width: contentWidth * (internal ? 0.08 : 0.1) },
    { key: "page", label: "Page Name", width: contentWidth * (internal ? 0.28 : 0.34) },
    { key: "followers", label: "Followers", width: contentWidth * (internal ? 0.18 : 0.22), align: "right" },
    { key: "format", label: "Format", width: contentWidth * (internal ? 0.13 : 0.16) },
    { key: "posts", label: "Post Per Profile", width: contentWidth * (internal ? 0.15 : 0.18), align: "right" },
    ...(internal ? [{ key: "cost", label: "Cost/Post", width: contentWidth * 0.18, align: "right" }] : []),
  ];

  if (plan.items.length === 0) {
    doc.font("Helvetica-Oblique").fontSize(9.5).fillColor("#888888").text("No pages added yet.", left, y);
    y += 22;
  }

  if (plan.items.length > 0) {
    if (y > doc.page.height - 160) {
      doc.addPage();
      y = doc.page.margins.top;
    }
    y = drawTableHeader(doc, left, y, cols);

    plan.items.forEach((item, i) => {
      if (y > doc.page.height - 100) {
        doc.addPage();
        y = doc.page.margins.top;
        y = drawTableHeader(doc, left, y, cols);
      }
      const asset = item.asset ?? {};
      const row = {
        sno: String(i + 1),
        page: asset.handle ?? "—",
        followers: compactFollowers(asset.followers ?? 0),
        format: formatLabel(item.format),
        posts: num(item.postsPerProfile),
        // Real per-post cost — only ever drawn when `internal` is true (see
        // `cols` above, which doesn't even define this column otherwise).
        cost: internal ? money(item.cost) : undefined,
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
  // Only the brief typed on Step 1 (user request, 14 Sep — no boilerplate).
  const notes = plan.notes ? [plan.notes] : [];
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
