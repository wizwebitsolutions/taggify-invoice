import { z } from "zod";

// Same rules as affiliate-creator-tool's routes/bulkTrack.routes.js.
const igUrl = z
  .string()
  .url("Must be a valid URL")
  .refine((url) => /instagram\.com\//i.test(url), "Must be an Instagram URL");

export const manualBatchSchema = z.object({
  profileLinks: z.array(igUrl).max(50, "Max 50 profile links per batch").optional(),
  postLinks: z.array(igUrl).max(50, "Max 50 post links per batch").optional(),
});

export const sheetPreviewSchema = z.object({
  sheetUrl: z.string().url("Must be a valid URL"),
  gid: z.string().optional(),
});

export const sheetSourceSchema = z
  .object({
    sheetUrl: z.string().url("Must be a valid URL"),
    gid: z.string().optional(),
    name: z.string().max(100, "Name is too long").optional(),
    profileLinkCol: z.string().optional(),
    postLinkCol: z.string().optional(),
    categoryCol: z.string().optional(),
    followersCol: z.string().optional(),
    dateCol: z.string().optional(),
    pageNameCol: z.string().optional(),
    // What to scrape from Apify — anything unticked comes from the sheet only.
    fetchFollowers: z.boolean().default(true),
    fetchEngagement: z.boolean().default(true),
  })
  .refine((d) => d.fetchFollowers || d.fetchEngagement, {
    message: "Pick at least one of followers or post engagement to fetch",
    path: ["fetchFollowers"],
  });

export const listPostsQuerySchema = z.object({
  source: z.enum(["internal", "sheet"]).default("internal"),
  sheetSourceId: z.string().optional(),
});

// Connected Sheets panel: last 5 by default; "See more" pages 20 at a time.
export const listSheetSourcesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(20).default(5),
});
