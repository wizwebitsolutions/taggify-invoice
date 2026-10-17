import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";

import { parseImportSheet, parseCsv, normalizeHandle, parseFollowerCount, parseAmount, classifyContact, parseGroupLink, ImportParseError, MAX_IMPORT_ROWS, rateFormatFromHeader } from "./importParser.js";
import { FORMATS } from "../../lib/formats.js";

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
    expect(IMPORT_TEMPLATE_HEADERS).toEqual([
      "Page Name",
      "Page Link",
      "Vendor Name",
      "Vendor Contact",
      "Followers",
      "Grade",
      "Group Link",
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
    ]);
    // One rate column per format, in FORMATS order.
    expect(IMPORT_TEMPLATE_HEADERS.slice(7).map(rateFormatFromHeader)).toEqual(FORMATS);
    // Grade + Group Link (16 Oct) come through, and neither is mistaken for a rate column.
    expect(parsed.rows.map((r) => [r.grade, r.groupLink])).toEqual([
      ["A", "https://chat.whatsapp.com/replace-me"],
      ["B", null],
    ]);
    expect(parsed.rows.map((r) => [r.pageName, r.handle, r.problem])).toEqual([
      ["Example Page One", "example.page.one.replace.me", null],
      ["Example Page Two", "example.page.two.replace.me", null],
    ]);
    expect(parsed.hasOwnerColumn).toBe(true);
    expect(parsed.rows.map((r) => [r.vendorName, r.vendorPhone, r.vendorEmail])).toEqual([
      ["Example Vendor", "+919000000000", null],
      ["Example Vendor", null, "vendor@example.com"],
    ]);
    expect(parsed.rows[0].followers).toBe(450000);
    // All ten rates (16 Oct); the second example fills only some, including the required Reel and Story.
    expect(parsed.rows[0].rateCards).toEqual([
      { format: "reel", amount: 18000 },
      { format: "entertainment", amount: 20000 },
      { format: "pr", amount: 25000 },
      { format: "political_reel", amount: 22000 },
      { format: "post", amount: 9000 },
      { format: "repost", amount: 5000 },
      { format: "story", amount: 6000 },
      { format: "political_story", amount: 8000 },
      { format: "reel_story", amount: 21000 },
      { format: "repost_story", amount: 9500 },
    ]);
    expect(parsed.rows[1].rateCards).toEqual([
      { format: "reel", amount: 9000 },
      { format: "post", amount: 4500 },
      { format: "story", amount: 3000 },
    ]);
  });

  it("rate headers are read through formatFromText: Static / Carousel, Political, Reel + Story and their aliases (14 Oct)", async () => {
    const csv = ["Page Link,Reel,Stories Rate,Static,Political Reel Price,Reel & Story Cost,Carousel Rate,Video price", "https://instagram.com/x.page,1000,500,800,1500,1300,999,77"].join("\n");
    const parsed = await parseImportSheet(Buffer.from(csv), "pages.csv");
    // A bare "Static" isn't a rate column (16 Oct), so "Carousel Rate" is the Static / Carousel price; "Video price" is ignored.
    expect(parsed.rows[0].rateCards).toEqual([
      { format: "reel", amount: 1000 },
      { format: "story", amount: 500 },
      { format: "political_reel", amount: 1500 },
      { format: "reel_story", amount: 1300 },
      { format: "post", amount: 999 },
    ]);
  });

  it("the 16 Oct rate headers: PR, Entertainment / Brand, Political Story, Repost, Repost + Story — and a longer name never reads as its prefix", async () => {
    const csv = [
      "Page Link,Political Story Rate,Political Rate,Repost + Story Rate,Repost Rate,PR Rate,Entertainment / Brand Rate,Static & Carousel Rate",
      "https://instagram.com/x.page,700,1500,1300,600,2500,2000,800",
    ].join("\n");
    const parsed = await parseImportSheet(Buffer.from(csv), "pages.csv");
    expect(parsed.rows[0].rateCards).toEqual([
      { format: "political_story", amount: 700 },
      { format: "political_reel", amount: 1500 },
      { format: "repost_story", amount: 1300 },
      { format: "repost", amount: 600 },
      { format: "pr", amount: 2500 },
      { format: "entertainment", amount: 2000 },
      { format: "post", amount: 800 },
    ]);
  });

  // Review fix (14 Oct): bare plurals are usually post-count columns, not prices.
  it('a bare header is a rate column only when it\'s an exact singular alias; plurals, "Image" and (16 Oct) bare "Post", "Static", "Carousel", "PR", "Combo" need a rate/cost/price/amount suffix', () => {
    for (const [header, format] of [
      ["Reel", "reel"],
      ["Story", "story"],
      ["Static / Carousel", "post"],
      ["Political reel", "political_reel"],
      ["Political", "political_reel"],
      ["Political Story", "political_story"],
      ["Static & Carousel", "post"],
      ["Repost", "repost"],
      ["Repost + Story", "repost_story"],
      ["Entertainment / Brand", "entertainment"],
      ["Reel + Story", "reel_story"],
      ["Brand rate", "entertainment"],
      ["Political Story Rate", "political_story"],
      ["Repost + Story Rate", "repost_story"],
      ["Reels rate", "reel"],
      ["Stories cost", "story"],
      ["Posts price", "post"],
      ["Images amount", "post"],
      ["Image rate", "post"],
      ["Post rate", "post"],
      ["Static cost", "post"],
      ["PR price", "pr"],
      ["Combo rate", "reel_story"],
    ]) {
      expect(rateFormatFromHeader(header), header).toBe(format);
    }
    for (const header of ["Reels", "Posts", "Stories", "Images", "Image", "Brand", "Reposts", "Political reels", "Political stories", "Post URL", "Post link", "Posted link", "Video price", "Post", "Static", "Carousel", "PR", "Combo", ""]) {
      expect(rateFormatFromHeader(header), header).toBeNull();
    }
  });

  it("count columns (Reels / Stories / Posts) don't become rate cards or satisfy the required rates", async () => {
    const csv = ["Page Link,Reels,Stories,Posts,Images,Post URL", "https://instagram.com/x.page,3,2,1,4,https://instagram.com/p/abc"].join("\n");
    const parsed = await parseImportSheet(Buffer.from(csv), "pages.csv");
    expect(parsed.rows[0].rateCards).toEqual([]);
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

// Vendor columns (14 Oct): who owns the page, so the preview can match an
// existing vendor or flag a new one to approve and create.
describe("classifyContact", () => {
  it("an email (lowercased, trimmed); a phone as +/digits only (10–15 digits); both from one cell; anything else is ignored", () => {
    expect(classifyContact("  Vendor@Example.COM ")).toEqual({ phone: null, email: "vendor@example.com" });
    expect(classifyContact("+91 98765 43210")).toEqual({ phone: "+919876543210", email: null });
    // Labels and punctuation never reach a login's phone (14 Oct review).
    expect(classifyContact("Ph: 98765-43210")).toEqual({ phone: "9876543210", email: null });
    expect(classifyContact("98765 43210 / Sales@Acme.in")).toEqual({ phone: "9876543210", email: "sales@acme.in" });
    expect(classifyContact(9876543210)).toEqual({ phone: "9876543210", email: null });
    expect(classifyContact("call me")).toEqual({ phone: null, email: null });
    expect(classifyContact("12345")).toEqual({ phone: null, email: null });
    expect(classifyContact("not@anemail")).toEqual({ phone: null, email: null });
    expect(classifyContact("")).toEqual({ phone: null, email: null });
    // A long cell keeps its first phone-shaped run, ≤20 chars.
    expect(classifyContact("98765 43210 / 91234 56789").phone).toBe("9876543210");
  });
});

describe("parseImportSheet — vendor columns", () => {
  const HEADER = "Page Name,Page Link,Vendor Name,Vendor Contact,Followers,Reel Rate,Story Rate";

  it("reads vendor name + a contact cell holding a phone or an email, and matches the owner on phone ?? email ?? name", async () => {
    const csv = [
      HEADER,
      "One,https://instagram.com/one.page,Meme Co,+91 98765 43210,10k,5000,2000",
      "Two,https://instagram.com/two.page,Meme Co,Sales@MemeCo.in,,,",
      "Three,https://instagram.com/three.page,Only Name Media,,,,",
      "Four,https://instagram.com/four.page,,,,,",
    ].join("\n");
    const parsed = await parseImportSheet(Buffer.from(csv), "v.csv");
    expect(parsed.hasOwnerColumn).toBe(true);
    expect(parsed.rows[0]).toMatchObject({ vendorName: "Meme Co", vendorPhone: "+919876543210", vendorEmail: null, ownerRef: "+919876543210", followers: 10_000 });
    expect(parsed.rows[1]).toMatchObject({ vendorName: "Meme Co", vendorPhone: null, vendorEmail: "sales@memeco.in", ownerRef: "sales@memeco.in" });
    expect(parsed.rows[2]).toMatchObject({ vendorName: "Only Name Media", vendorPhone: null, vendorEmail: null, ownerRef: "Only Name Media" });
    expect(parsed.rows[3]).toMatchObject({ vendorName: null, vendorPhone: null, vendorEmail: null, ownerRef: null });
  });

  it("vendor/contact columns never become rate cards; reel/story rates still read", async () => {
    const csv = ["Page Link,Vendor,Contact Number,Contact Details,Reel Rate,Story Rate", "https://instagram.com/x.page,V,9876543210,,7000,3000"].join("\n");
    const parsed = await parseImportSheet(Buffer.from(csv), "v.csv");
    expect(parsed.rows[0].rateCards).toEqual([
      { format: "reel", amount: 7000 },
      { format: "story", amount: 3000 },
    ]);
    expect(parsed.rows[0]).toMatchObject({ vendorName: "V", vendorPhone: "9876543210" });
  });

  it("explicit vendor phone / email columns are read, and fill in alongside a contact cell", async () => {
    const csv = ["Page Link,Vendor's Name,Vendor Phone,Vendor Email,Contact", "https://instagram.com/x.page,Acme,+91 90000 11111,Owner@Acme.com,other@acme.com", "https://instagram.com/y.page,Acme,,,90000 22222 ext"].join("\n");
    const parsed = await parseImportSheet(Buffer.from(csv), "v.csv");
    expect(parsed.rows[0]).toMatchObject({ vendorName: "Acme", vendorPhone: "+919000011111", vendorEmail: "owner@acme.com", ownerRef: "+919000011111" });
    expect(parsed.rows[1]).toMatchObject({ vendorPhone: "9000022222", vendorEmail: null });
  });

  it("a vendor name is trimmed and capped at 100 characters", async () => {
    const parsed = await parseImportSheet(Buffer.from(`Page Link,Vendor Name\nhttps://instagram.com/x.page,  ${"a".repeat(150)}  \n`), "v.csv");
    expect(parsed.rows[0].vendorName).toHaveLength(100);
  });

  it("legacy owner columns keep working: a plain 'phone' is still the owner's phone, and with vendor columns it's the vendor's phone too", async () => {
    const legacy = await parseImportSheet(Buffer.from("handle,phone\nsome.page,+919000000001\n"), "t.csv");
    expect(legacy.rows[0]).toMatchObject({ ownerRef: "+919000000001", vendorName: null, vendorPhone: null, vendorEmail: null });
    expect(legacy.hasOwnerColumn).toBe(true);

    const mixed = await parseImportSheet(Buffer.from("handle,owner phone,vendor name\na.page,+919000000001,\nb.page,+919000000001,New Vendor\n"), "t.csv");
    expect(mixed.rows[0].ownerRef).toBe("+919000000001");
    // A "Vendor | Phone" sheet: the phone column is the vendor's contact, so matching uses it (14 Oct review).
    expect(mixed.rows[1]).toMatchObject({ ownerRef: "+919000000001", vendorName: "New Vendor", vendorPhone: "+919000000001" });

    const withEmail = await parseImportSheet(Buffer.from(["Page Link,Vendor,Mobile,Email", "https://instagram.com/c.page,Chai Co,98000 00011,Chai@Co.in"].join("\n")), "t.csv");
    expect(withEmail.rows[0]).toMatchObject({ vendorName: "Chai Co", vendorPhone: "9800000011", vendorEmail: "chai@co.in", ownerRef: "9800000011" });
  });

  it("vendor columns in an .xlsx (numeric phone cell) parse the same as CSV", async () => {
    const buffer = await xlsxBuffer([
      ["Page Link", "Vendor Name", "Vendor Contact", "Reel Rate"],
      ["https://instagram.com/x.page", "Acme", 9876543210, 4000],
    ]);
    const parsed = await parseImportSheet(buffer, "v.xlsx");
    expect(parsed.rows[0]).toMatchObject({ vendorName: "Acme", vendorPhone: "9876543210", rateCards: [{ format: "reel", amount: 4000 }] });
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

describe("parseImportSheet — Grade and Group Link columns (16 Oct)", () => {
  it("reads A/B/C (any case, with or without the word 'Grade') and ignores anything else", async () => {
    const csv = "Page Link,Grade,Group Link\nhttps://instagram.com/one,a,https://chat.whatsapp.com/abc\nhttps://instagram.com/two,Grade B,chat.whatsapp.com/def\nhttps://instagram.com/three,premium,not a link\nhttps://instagram.com/four,,\n";
    const parsed = await parseImportSheet(Buffer.from(csv), "pages.csv");
    expect(parsed.rows.map((r) => [r.handle, r.grade, r.groupLink])).toEqual([
      ["one", "A", "https://chat.whatsapp.com/abc"],
      ["two", "B", "https://chat.whatsapp.com/def"],
      ["three", null, null],
      ["four", null, null],
    ]);
  });

  it("a 'Grade' or 'Group Link' header is never read as a rate column", async () => {
    const parsed = await parseImportSheet(Buffer.from("Page Link,Grade,Group Link,Reel Rate\nhttps://instagram.com/one,A,https://t.me/x,5000\n"), "pages.csv");
    expect(parsed.rows[0].rateCards).toEqual([{ format: "reel", amount: 5000 }]);
  });

  it("parseGroupLink accepts http(s) URLs, adds https:// to a bare host, and rejects everything else", () => {
    expect(parseGroupLink("https://chat.whatsapp.com/abc")).toBe("https://chat.whatsapp.com/abc");
    expect(parseGroupLink("t.me/joinchat/xyz")).toBe("https://t.me/joinchat/xyz");
    expect(parseGroupLink("ftp://files.example.com/x")).toBeNull();
    expect(parseGroupLink("just words")).toBeNull();
    expect(parseGroupLink("")).toBeNull();
    expect(parseGroupLink(null)).toBeNull();
  });
});
