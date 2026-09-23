import { describe, it, expect } from "vitest";
import { parseExecutionSheet } from "./executionSheetParser.js";

const TEMPLATE_CSV = [
  "Fill in one row per post actually published — this is a sample, not a form to submit directly.",
  "S No,Page Name,Page Link,Followers,Date,Posted Link,Views,Likes,Comments,Shares",
  "1,ghantaa,https://instagram.com/ghantaa,8700000,10 Sept 2026,https://instagram.com/reel/example1,1207230,14600,92,594",
  '2,"Laughter Colours",https://instagram.com/laughter.colours,"4,300,000",10 Sept 2026,https://instagram.com/reel/example2,195976,4421,25,98',
  "3,@meme.mafia,,1.2M,,,,,,",
  "",
  ",TOTAL,,13000000,,,1403206,19021,117,692",
].join("\r\n");

describe("parseExecutionSheet — the attached execution sheet as posted-link rows (23 Sep)", () => {
  it("finds the header below a title band, reads one row per post, skips blank and TOTAL rows", () => {
    const { headerRow, rows } = parseExecutionSheet(TEMPLATE_CSV);
    expect(headerRow).toBe(1);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({
      rowNumber: 3,
      pageName: "ghantaa",
      pageHandle: "ghantaa",
      postUrl: "https://instagram.com/reel/example1",
      date: "10 Sept 2026",
      followers: 8700000,
    });
    // Handle comes from the Page Link (profile URL), not the display name.
    expect(rows[1].pageHandle).toBe("laughter.colours");
    expect(rows[1].followers).toBe(4300000);
  });

  it("falls back to the Page Name for the handle and leaves postUrl null when the cell isn't a URL", () => {
    const { rows } = parseExecutionSheet(TEMPLATE_CSV);
    expect(rows[2]).toMatchObject({ pageHandle: "meme.mafia", postUrl: null, followers: 1200000 });
  });

  it("matches columns by name, in any order, with common aliases", () => {
    const csv = ["Post URL,Creator,Profile\n", "https://instagram.com/p/abc,Ghantaa,@ghantaa\n"].join("");
    const { headerRow, rows } = parseExecutionSheet(csv);
    expect(headerRow).toBe(0);
    expect(rows).toEqual([{ rowNumber: 2, pageName: "Ghantaa", pageHandle: "ghantaa", postUrl: "https://instagram.com/p/abc", date: null, followers: null }]);
  });

  it("reports headerRow -1 when no row names a posted-link column", () => {
    expect(parseExecutionSheet("Name,Amount\nx,1\n")).toEqual({ headerRow: -1, rows: [] });
    expect(parseExecutionSheet("")).toEqual({ headerRow: -1, rows: [] });
  });
});
