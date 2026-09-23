import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";

import { parseImportSheet, parseCsv, normalizeHandle, parseFollowerCount, parseAmount, ImportParseError, MAX_IMPORT_ROWS } from "./importParser.js";

/**
 * Inventory "Import pages" (user request, 14 Sep) — the .xlsx/.csv parser.
 * Pure function, so every messy-sheet edge case is pinned here without a
 * DB: handles pasted as profile URLs or with "@", "1.2M" follower counts,
 * quoted CSV cells, blank/title rows above the header, a sheet with no
 * handle column at all, and the row cap.
 */

async function xlsxBuffer(rows) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Pages");
  for (const row of rows) sheet.addRow(row);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe("normalizeHandle", () => {
  it("strips @, whitespace and Instagram profile URLs down to the bare handle", () => {
    expect(normalizeHandle("@demo.page")).toBe("demo.page");
    expect(normalizeHandle("  demo_page ")).toBe("demo_page");
    expect(normalizeHandle("https://www.instagram.com/demo.page/?hl=en")).toBe("demo.page");
    expect(normalizeHandle("instagram.com/demo.page")).toBe("demo.page");
  });

  it("rejects blanks and non-Instagram links", () => {
    expect(normalizeHandle("")).toBeNull();
    expect(normalizeHandle("   ")).toBeNull();
    expect(normalizeHandle("https://youtube.com/@someone")).toBeNull();
  });
});

describe("parseFollowerCount / parseAmount", () => {
  it("reads abbreviated and formatted numbers the way analytics exports write them", () => {
    expect(parseFollowerCount("1.2M")).toBe(1_200_000);
    expect(parseFollowerCount("850k")).toBe(850_000);
    expect(parseFollowerCount("1.5L")).toBe(150_000);
    expect(parseFollowerCount("12,500")).toBe(12_500);
    expect(parseFollowerCount(9000)).toBe(9000);
    expect(parseFollowerCount("lots")).toBeNull();
    expect(parseAmount("₹12,000")).toBe(12000);
    expect(parseAmount(0)).toBeNull();
    expect(parseAmount("free")).toBeNull();
  });
});

describe("parseCsv", () => {
  it("handles quoted cells with commas, doubled quotes, CRLF and a BOM", () => {
    const rows = parseCsv('﻿handle,owner\r\n"a,b","Priya ""P"" Creator"\nlast,+91 98765 43210');
    expect(rows).toEqual([
      ["handle", "owner"],
      ["a,b", 'Priya "P" Creator'],
      ["last", "+91 98765 43210"],
    ]);
  });
});

describe("parseImportSheet — CSV", () => {
  it("maps handle / owner / category / followers / rate columns and flags bad handles per row", async () => {
    const csv = ["Handle,Owner Phone,Category,Followers,Reel,Story rate", "@big.page,+919000000001,News page,1.2M,12000,₹4000", "https://instagram.com/small.page/,Rahul,Meme page,10k,,", ",+919000000002,,,,", "bad handle!,+919000000002,,,,"].join("\n");
    const parsed = await parseImportSheet(Buffer.from(csv), "pages.csv");

    expect(parsed.hasOwnerColumn).toBe(true);
    expect(parsed.totalRows).toBe(4);
    expect(parsed.rows[0]).toMatchObject({ rowNumber: 2, handle: "big.page", ownerRef: "+919000000001", category: "News page", followers: 1_200_000, problem: null });
    expect(parsed.rows[0].rateCards).toEqual([
      { format: "reel", amount: 12000 },
      { format: "story", amount: 4000 },
    ]);
    expect(parsed.rows[1]).toMatchObject({ handle: "small.page", ownerRef: "Rahul", followers: 10_000, rateCards: [] });
    expect(parsed.rows[2]).toMatchObject({ handle: null, problem: "Missing page link." });
    expect(parsed.rows[3].problem).toMatch(/isn't a valid Instagram handle/);
  });

  it("reports when there's no owner column at all, so the UI can ask for a default account", async () => {
    const parsed = await parseImportSheet(Buffer.from("handle\nsome.page\n"), "pages.csv");
    expect(parsed.hasOwnerColumn).toBe(false);
    expect(parsed.rows[0].ownerRef).toBeNull();
  });

  it("skips a title row above the real header and blank rows in between", async () => {
    const csv = "Pages for Q3,,\n,,\nhandle,owner,\none.page,+919000000001,\n,,\ntwo.page,+919000000001,\n";
    const parsed = await parseImportSheet(Buffer.from(csv), "pages.csv");
    expect(parsed.rows.map((r) => r.handle)).toEqual(["one.page", "two.page"]);
    expect(parsed.rows[0].rowNumber).toBe(4);
  });

  it("rejects an empty file, a sheet with no handle column, and a header with no rows", async () => {
    await expect(parseImportSheet(Buffer.alloc(0), "pages.csv")).rejects.toBeInstanceOf(ImportParseError);
    await expect(parseImportSheet(Buffer.from("name,phone\nx,y"), "pages.csv")).rejects.toThrow(/"Page Link" column/);
    await expect(parseImportSheet(Buffer.from("handle,owner\n"), "pages.csv")).rejects.toThrow(/No pages found/);
  });
});

// Template columns (user request, 22 Sep): Page Name, Page Link, Followers,
// Reel Rate, Story Rate — the page is identified by its link.
describe("parseImportSheet — Page Name / Page Link template", () => {
  const TEMPLATE_HEADER = "Page Name,Page Link,Followers,Reel Rate,Story Rate";

  it("takes the handle from the link, keeps the name as pageName, and reads followers + both rates", async () => {
    const csv = [TEMPLATE_HEADER, "Laughter Colours,https://www.instagram.com/laughtercolours/?hl=en,4.3M,18000,6000"].join("\n");
    const parsed = await parseImportSheet(Buffer.from(csv), "template.csv");
    expect(parsed.rows[0]).toMatchObject({ handle: "laughtercolours", pageName: "Laughter Colours", followers: 4_300_000, problem: null });
    expect(parsed.rows[0].rateCards).toEqual([
      { format: "reel", amount: 18000 },
      { format: "story", amount: 6000 },
    ]);
    // No owner column in the template — the account is chosen in the popup.
    expect(parsed.hasOwnerColumn).toBe(false);
  });

  it("the Page Name is never mistaken for the handle", async () => {
    const parsed = await parseImportSheet(Buffer.from([TEMPLATE_HEADER, "Some Page,https://instagram.com/real.handle,,,"].join("\n")), "t.csv");
    expect(parsed.rows[0].handle).toBe("real.handle");
  });

  it("a broken or non-Instagram link, or a missing one, is flagged on its row", async () => {
    const csv = [TEMPLATE_HEADER, "Blog,https://example.com/blog,,,", "No link,,,,"].join("\n");
    const parsed = await parseImportSheet(Buffer.from(csv), "t.csv");
    expect(parsed.rows[0]).toMatchObject({ handle: null, problem: "Link broken or not an Instagram profile link." });
    expect(parsed.rows[1]).toMatchObject({ handle: null, problem: "Missing page link." });
  });

  it("a link column wins when a sheet also has an old handle column", async () => {
    const parsed = await parseImportSheet(Buffer.from("handle,page link\nold.name,https://instagram.com/from.link\n"), "t.csv");
    expect(parsed.rows[0].handle).toBe("from.link");
  });

  it("post / reel / explore links name no page; stories and _u links name the page; m.instagram.com works", async () => {
    const csv = [
      "Page Link",
      "https://www.instagram.com/p/C1abc/",
      "https://www.instagram.com/reel/C1abc/",
      "https://www.instagram.com/explore/tags/x/",
      "https://www.instagram.com/stories/story.page/123/",
      "https://instagram.com/_u/app.page",
      "https://m.instagram.com/mobile.page/",
    ].join("\n");
    const parsed = await parseImportSheet(Buffer.from(csv), "t.csv");
    expect(parsed.rows.map((r) => r.handle)).toEqual([null, null, null, "story.page", "app.page", "mobile.page"]);
    expect(parsed.rows[0].problem).toBe("Link broken or not an Instagram profile link.");
  });

  it("a row whose link isn't an Instagram profile falls back to its handle cell (old handle + website sheets)", async () => {
    const parsed = await parseImportSheet(Buffer.from("handle,link\nold.page,https://oldsite.example.com\n"), "t.csv");
    expect(parsed.rows[0]).toMatchObject({ handle: "old.page", problem: null });
  });

  it("a pre-template sheet whose only page column is headed 'Page Name' still reads it as the handle", async () => {
    const parsed = await parseImportSheet(Buffer.from("Page Name,Owner Phone\nlegacy.page,+919000000001\n"), "t.csv");
    expect(parsed.rows[0]).toMatchObject({ handle: "legacy.page", pageName: null, ownerRef: "+919000000001" });
  });

  it("a bare 'Name' column (usually the owner's name in older sheets) isn't taken as the page name", async () => {
    const parsed = await parseImportSheet(Buffer.from("handle,name\nsome.page,Priya Sharma\n"), "t.csv");
    expect(parsed.rows[0].pageName).toBeNull();
  });

  it("older handle-only sheets still import unchanged, with pageName null", async () => {
    const parsed = await parseImportSheet(Buffer.from("handle,owner phone\nsome.page,+919000000001\n"), "t.csv");
    expect(parsed.rows[0]).toMatchObject({ handle: "some.page", pageName: null, ownerRef: "+919000000001" });
  });

  it("the downloadable template itself parses back to its two example pages", async () => {
    const { buildImportPagesTemplate, IMPORT_TEMPLATE_HEADERS } = await import("../../lib/importPagesTemplate.js");
    const parsed = await parseImportSheet(await buildImportPagesTemplate(), "import-pages-template.xlsx");
    expect(IMPORT_TEMPLATE_HEADERS).toEqual(["Page Name", "Page Link", "Followers", "Reel Rate", "Story Rate"]);
    expect(parsed.rows.map((r) => [r.pageName, r.handle, r.problem])).toEqual([
      ["Example Page One", "example.page.one.replace.me", null],
      ["Example Page Two", "example.page.two.replace.me", null],
    ]);
    expect(parsed.rows[0].rateCards).toEqual([
      { format: "reel", amount: 18000 },
      { format: "story", amount: 6000 },
    ]);
  });

  it("caps the number of rows per import", async () => {
    const csv = "handle\n" + Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `page.${i}`).join("\n");
    await expect(parseImportSheet(Buffer.from(csv), "pages.csv")).rejects.toThrow(/capped at/);
  });

  it("prefers a phone column over a name column for the owner, dedupes rate columns per format, and clamps follower counts", async () => {
    const csv = "handle,owner name,phone,reel,reel rate,followers\nx.page,Priya Creator,+919000000001,5000,9999,3000M";
    const parsed = await parseImportSheet(Buffer.from(csv), "pages.csv");
    expect(parsed.rows[0].ownerRef).toBe("+919000000001");
    expect(parsed.rows[0].rateCards).toEqual([{ format: "reel", amount: 5000 }]);
    expect(parsed.rows[0].followers).toBe(2_147_483_647);
  });

  it("reads a UTF-16LE (Excel 'Unicode Text') export", async () => {
    const buffer = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("handle\tx\nuni.page\tx\n".replace(/\t/g, ","), "utf16le")]);
    const parsed = await parseImportSheet(buffer, "pages.csv");
    expect(parsed.rows[0].handle).toBe("uni.page");
  });

  it("rejects unsupported and legacy file types by extension", async () => {
    await expect(parseImportSheet(Buffer.from("x"), "pages.xls")).rejects.toThrow(/\.xls files aren't supported/);
    await expect(parseImportSheet(Buffer.from("x"), "pages.pdf")).rejects.toThrow(/Unsupported file type/);
  });
});

describe("parseImportSheet — XLSX (real round-trip through exceljs)", () => {
  it("reads the first worksheet, including numeric cells, the same way as CSV", async () => {
    const buffer = await xlsxBuffer([
      ["Page", "Account", "Type", "Followers", "reel"],
      ["@demo.page", 9000000001, "Meme page", 250000, 5000],
      ["other.page", "demo@example.com", "", "1.1M", ""],
    ]);
    const parsed = await parseImportSheet(buffer, "Pages.XLSX");
    expect(parsed.hasOwnerColumn).toBe(true);
    expect(parsed.rows[0]).toMatchObject({ handle: "demo.page", ownerRef: "9000000001", category: "Meme page", followers: 250000, rateCards: [{ format: "reel", amount: 5000 }] });
    expect(parsed.rows[1]).toMatchObject({ handle: "other.page", ownerRef: "demo@example.com", category: null, followers: 1_100_000, rateCards: [] });
  });

  it("gives a readable error for bytes that aren't a workbook", async () => {
    await expect(parseImportSheet(Buffer.from("definitely not a zip"), "pages.xlsx")).rejects.toThrow(/valid \.xlsx workbook/);
  });
});
