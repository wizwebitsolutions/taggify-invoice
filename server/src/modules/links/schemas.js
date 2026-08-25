import { z } from "zod";

// Free-form format string (not a fixed enum) — mirrors RateCard.format so an
// asset can carry custom format names (e.g. "VOXPOP") the way WLDD's rate
// cards do, not just the original reel/story/carousel/collaboration/video set.
const formatSchema = z.string().min(1).max(40);

export const createLinkSchema = z.object({
  campaignId: z.string().min(1),
  assetId: z.string().min(1),
  url: z.string().url(),
  format: formatSchema,
  customAmount: z.number().positive().optional(), // only honored for ADMIN callers
});

// Bulk link upload (creator.wldd.in's "Upload Links" modal): one campaign +
// asset + format, many post URLs submitted together in a single request.
export const bulkCreateLinkSchema = z.object({
  campaignId: z.string().min(1),
  assetId: z.string().min(1),
  format: formatSchema,
  urls: z.array(z.string().url()).min(1).max(200),
});

export const listLinksQuerySchema = z.object({
  status: z.string().optional(),
  campaignId: z.string().optional(),
  assetId: z.string().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const reviewScreenshotSchema = z.object({
  approved: z.boolean(),
  note: z.string().max(500).optional(),
});
