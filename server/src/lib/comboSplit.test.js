import { describe, it, expect } from "vitest";
import { splitComboCost } from "./comboSplit.js";

const sumPaise = ({ reel, story }) => Math.round(reel * 100) + Math.round(story * 100);

describe("splitComboCost (Reel + Story combo, 14 Oct)", () => {
  it("splits proportionally to the page's reel/story rates — the plan's money check", () => {
    const split = splitComboCost(30000, 20000, 15000);
    expect(split).toEqual({ reel: 17142.85, story: 12857.15 });
    expect(sumPaise(split)).toBe(3000000);
  });

  it("the halves always add up exactly, including odd paise", () => {
    for (const [total, r, s] of [
      [100.01, 1, 1],
      [0.03, 7, 3],
      [999.99, 333.33, 666.67],
      [12345.67, 8000, 2500.5],
      [1, 3, 3],
    ]) {
      const split = splitComboCost(total, r, s);
      expect(sumPaise(split)).toBe(Math.round(total * 100));
      expect(split.reel).toBeGreaterThanOrEqual(0);
      expect(split.story).toBeGreaterThanOrEqual(0);
    }
  });

  it("falls back to 50/50 when either rate is missing or zero (story takes the odd paisa)", () => {
    expect(splitComboCost(1000, null, 500)).toEqual({ reel: 500, story: 500 });
    expect(splitComboCost(1000, 500, undefined)).toEqual({ reel: 500, story: 500 });
    expect(splitComboCost(1000, 0, 0)).toEqual({ reel: 500, story: 500 });
    expect(splitComboCost(100.01, null, null)).toEqual({ reel: 50, story: 50.01 });
  });

  it("a zero or missing total splits into zeros", () => {
    expect(splitComboCost(0, 100, 100)).toEqual({ reel: 0, story: 0 });
    expect(splitComboCost(null, 100, 100)).toEqual({ reel: 0, story: 0 });
  });

  it("is generic: keyed by the parts passed (Repost + Story, 16 Oct) — first part gets the floored share, second the remainder", () => {
    const split = splitComboCost(10000, 3000, 4000, ["repost", "story"]);
    expect(split).toEqual({ repost: 4285.71, story: 5714.29 });
    expect(Math.round(split.repost * 100) + Math.round(split.story * 100)).toBe(1000000);
    expect(splitComboCost(100.01, null, 100, ["repost", "story"])).toEqual({ repost: 50, story: 50.01 });
    // Default parts keep the Reel + Story shape.
    expect(Object.keys(splitComboCost(100, 1, 1))).toEqual(["reel", "story"]);
  });

  it("large amounts stay exact (BigInt multiply) and Decimal-like inputs work", () => {
    const dec = (v) => ({ toString: () => String(v) });
    const split = splitComboCost(dec("9999999999.99"), dec("8888888888.88"), dec("7777777777.77"));
    expect(sumPaise(split)).toBe(999999999999);
    expect(split.reel).toBe(5333333333.32);
  });
});
