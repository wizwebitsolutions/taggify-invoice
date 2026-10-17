import ExcelJS from "exceljs";

/**
 * Inventory → Import pages → "Download template" (user request, 22 Sep —
 * "in the template as well as in import, there will page name, page link,
 * followers, reel, story rate"). The headers are exactly what
 * assets/importParser.js reads; the page is fetched from Instagram by its
 * link. Required cells since 17 Oct: IMPORT_REQUIRED_HEADERS. Vendor Name + Vendor
 * Contact (14 Oct) say who owns the page: an existing vendor is matched,
 * a new one is offered in the import popup to approve and create. Rows
 * with no vendor still get their account picked in the popup.
 */
// Ten rates (16 Oct), one per lib/formats.js FORMATS key in that order.
// Entertainment / Brand, Reel and Story are required in the import sheet (17 Oct); the rest optional.
export const IMPORT_TEMPLATE_RATE_HEADERS = [
  "Reel Rate",
  "Entertainment / Brand Rate",
  "PR Rate",
  "Political Rate",
  "Static & Carousel Rate",
  "Repost Rate",
  "Story Rate",
  "Political Story Rate",
  "Reel + Story Rate",
  "Repost + Story Rate",
];
// Grade (A/B/C) and Group Link (16 Oct) are optional columns before the rates.
export const IMPORT_TEMPLATE_HEADERS = ["Page Name", "Page Link", "Vendor Name", "Vendor Contact", "Followers", "Grade", "Group Link", ...IMPORT_TEMPLATE_RATE_HEADERS];
// Required cells (17 Oct): the page, who it belongs to and how to reach them, and the three core rates.
export const IMPORT_REQUIRED_HEADERS = ["Page Name", "Page Link", "Vendor Name", "Vendor Contact", "Entertainment / Brand Rate", "Reel Rate", "Story Rate"];
const FIRST_RATE_COLUMN = IMPORT_TEMPLATE_HEADERS.indexOf(IMPORT_TEMPLATE_RATE_HEADERS[0]) + 1;

// Deliberately not real pages: an example row left in the sheet by mistake
// then shows as "link broken / not found" instead of quietly importing
// someone's real page under the chosen account.
const EXAMPLE_ROWS = [
  // Reel, Ent./Brand, PR, Political, Static & Carousel, Repost, Story, Political Story, Reel + Story, Repost + Story
  ["Example Page One", "https://www.instagram.com/example.page.one.replace.me/", "Example Vendor", "+91 90000 00000", 450000, "A", "https://chat.whatsapp.com/replace-me", 18000, 20000, 25000, 22000, 9000, 5000, 6000, 8000, 21000, 9500],
  ["Example Page Two", "https://www.instagram.com/example.page.two.replace.me/", "Example Vendor", "vendor@example.com", 120000, "B", "", 9000, "", "", "", 4500, "", 3000, "", "", ""],
];

export async function buildImportPagesTemplate() {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Taggify";

  const ws = wb.addWorksheet("Pages");
  ws.addRow(IMPORT_TEMPLATE_HEADERS);
  for (const row of EXAMPLE_ROWS) ws.addRow(row);
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF18181B" } };
  // Required columns stand out (orange) and carry a note, so the rule is visible in the sheet itself.
  IMPORT_TEMPLATE_HEADERS.forEach((h, i) => {
    if (!IMPORT_REQUIRED_HEADERS.includes(h)) return;
    const cell = ws.getCell(1, i + 1);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4511E" } };
    cell.note = "Required — a row without this is not imported.";
  });
  // Rate columns are sized to their header (min 12).
  ws.columns = [{ width: 24 }, { width: 46 }, { width: 24 }, { width: 28 }, { width: 14 }, { width: 10 }, { width: 40 }, ...IMPORT_TEMPLATE_RATE_HEADERS.map((h) => ({ width: Math.max(12, h.length + 4) }))];
  // Vendor Contact is text, so a phone number isn't turned into 9.19E+11 or lose its "+91".
  ws.getColumn(4).numFmt = "@";
  // Followers and the ten rate columns.
  ws.getColumn(5).numFmt = "#,##0";
  for (let col = FIRST_RATE_COLUMN; col <= IMPORT_TEMPLATE_HEADERS.length; col++) ws.getColumn(col).numFmt = "#,##0";
  ws.views = [{ state: "frozen", ySplit: 1 }];

  const notes = wb.addWorksheet("How to fill");
  [
    ["One row per page. Replace the two example rows with your own."],
    [`REQUIRED (orange headers): ${IMPORT_REQUIRED_HEADERS.join(", ")}. A row missing Page Name or one of the three rates is shown as incomplete and not imported; a row with no vendor only imports once an account is picked for it in the popup.`],
    ["Page Link: the page's Instagram profile link, e.g. https://www.instagram.com/pagename/ — the page is looked up on Instagram from this."],
    ["Page Name: the page's display name. Instagram's own name replaces it once fetched."],
    ["Vendor Name + Vendor Contact (phone number; an email works for matching too): who owns the page."],
    ["A vendor already in Taggify is matched by phone, then email, then name."],
    ["A new vendor is shown in the import popup for you to approve and create — an email is needed to create their login."],
    ["Followers: optional starting count — the live count from Instagram is used when it's available."],
    ["Grade: A, B or C — optional, set by hand. Group Link: the page's WhatsApp/Telegram group link, optional."],
    [`Rates, in rupees (numbers only, or ₹12,000): ${IMPORT_TEMPLATE_RATE_HEADERS.join(", ")}.`],
    ["Entertainment / Brand, Reel and Story rates are required. The other seven are optional — leave a column blank if the page doesn't offer that format. Political / Political Story: a reel / story whose content is political. Static & Carousel: an image or carousel post."],
    ["Reel + Story Rate is a bundle price for one reel plus one story; Repost + Story Rate is a bundle price for one repost plus one story. Each is usually cheaper than the two booked separately, and is split between the two posts when booked."],
    ["Pages whose link is broken or not found on Instagram are shown in the preview and are not imported."],
    ["Rows with no vendor: you must pick (or create) the account they go under in the import popup before they import."],
    ["Only the first tab (Pages) is read. For a Google Sheet link, share it as 'Anyone with the link – Viewer'."],
  ].forEach((r) => notes.addRow(r));
  notes.getColumn(1).width = 130;
  notes.getRow(1).font = { bold: true };

  return Buffer.from(await wb.xlsx.writeBuffer());
}
