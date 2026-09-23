import ExcelJS from "exceljs";

/**
 * Inventory → Import pages → "Download template" (user request, 22 Sep —
 * "in the template as well as in import, there will page name, page link,
 * followers, reel, story rate"). The headers are exactly what
 * assets/importParser.js reads; the page is fetched from Instagram by its
 * link, so Page Link is the one required column. Which account the pages
 * go under is chosen in the import popup, not in the sheet.
 */
export const IMPORT_TEMPLATE_HEADERS = ["Page Name", "Page Link", "Followers", "Reel Rate", "Story Rate"];

// Deliberately not real pages: an example row left in the sheet by mistake
// then shows as "link broken / not found" instead of quietly importing
// someone's real page under the chosen account.
const EXAMPLE_ROWS = [
  ["Example Page One", "https://www.instagram.com/example.page.one.replace.me/", 450000, 18000, 6000],
  ["Example Page Two", "https://www.instagram.com/example.page.two.replace.me/", 120000, 9000, 3000],
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
  ws.columns = [{ width: 24 }, { width: 46 }, { width: 14 }, { width: 12 }, { width: 12 }];
  ws.getColumn(3).numFmt = "#,##0";
  ws.getColumn(4).numFmt = "#,##0";
  ws.getColumn(5).numFmt = "#,##0";
  ws.views = [{ state: "frozen", ySplit: 1 }];

  const notes = wb.addWorksheet("How to fill");
  [
    ["One row per page. Replace the two example rows with your own."],
    ["Page Link (required): the page's Instagram profile link, e.g. https://www.instagram.com/pagename/ — the page is looked up on Instagram from this."],
    ["Page Name: the page's display name. Instagram's own name replaces it once fetched."],
    ["Followers: optional starting count — the live count from Instagram is used when it's available."],
    ["Reel Rate / Story Rate: the rate card, in rupees (numbers only, or ₹12,000)."],
    ["Pages whose link is broken or not found on Instagram are shown in the preview and are not imported."],
    ["You pick (or create) the account the pages go under in the import popup."],
    ["Only the first tab (Pages) is read. For a Google Sheet link, share it as 'Anyone with the link – Viewer'."],
  ].forEach((r) => notes.addRow(r));
  notes.getColumn(1).width = 130;
  notes.getRow(1).font = { bold: true };

  return Buffer.from(await wb.xlsx.writeBuffer());
}
