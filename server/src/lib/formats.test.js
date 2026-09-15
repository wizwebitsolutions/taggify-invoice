import { describe, it, expect } from "vitest";
import { FORMATS, formatSchema } from "./formats.js";
import { createLinkSchema } from "../modules/links/schemas.js";
import { rateCardEntrySchema } from "../modules/assets/schemas.js";
import { campaignAssignmentRowSchema } from "../modules/campaigns/schemas.js";

describe("reel/story are the only formats anywhere (user request, 14 Sep)", () => {
  it("the shared list is exactly reel + story", () => {
    expect(FORMATS).toEqual(["reel", "story"]);
    expect(formatSchema.safeParse("reel").success).toBe(true);
    expect(formatSchema.safeParse("carousel").success).toBe(false);
  });

  it("links, rate cards and campaign sheet rows all reject a non reel/story format", () => {
    expect(createLinkSchema.safeParse({ campaignId: "c", assetId: "a", url: "https://instagram.com/p/x", format: "video" }).success).toBe(false);
    expect(createLinkSchema.safeParse({ campaignId: "c", assetId: "a", url: "https://instagram.com/p/x", format: "story" }).success).toBe(true);
    expect(rateCardEntrySchema.safeParse({ format: "VOXPOP", amount: 100 }).success).toBe(false);
    expect(rateCardEntrySchema.safeParse({ format: "reel", amount: 100 }).success).toBe(true);
    expect(campaignAssignmentRowSchema.safeParse({ handle: "x", postUrl: "https://instagram.com/p/x", format: "carousel" }).success).toBe(false);
    expect(campaignAssignmentRowSchema.safeParse({ handle: "x", postUrl: "https://instagram.com/p/x", format: "reel" }).success).toBe(true);
  });
});
