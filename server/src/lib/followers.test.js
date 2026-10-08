import { describe, it, expect } from "vitest";
import { compactFollowers } from "./followers.js";
import { parseFollowerCount } from "../modules/assets/importParser.js";

// 8 Oct — "followers should show in million or in k" (sheets, PDF, execution template).
describe("compactFollowers", () => {
  it("writes millions as M (one decimal, no trailing .0) and thousands as K", () => {
    expect(compactFollowers(8_700_000)).toBe("8.7M");
    expect(compactFollowers(13_000_000)).toBe("13M");
    expect(compactFollowers(850_000)).toBe("850K");
    expect(compactFollowers(1_250)).toBe("1K");
    expect(compactFollowers(950)).toBe("950");
    expect(compactFollowers(null)).toBe("0");
  });

  it("reads back through the sheet importer, so a filled-in execution sheet still parses", () => {
    expect(parseFollowerCount(compactFollowers(8_700_000))).toBe(8_700_000);
    expect(parseFollowerCount(compactFollowers(850_000))).toBe(850_000);
  });
});
