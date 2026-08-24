import { z } from "zod";

export const createLinkSchema = z.object({
  campaignId: z.string().min(1),
  assetId: z.string().min(1),
  url: z.string().url(),
  format: z.enum(["reel", "story", "carousel", "collaboration", "video"]),
  customAmount: z.number().positive().optional(), // only honored for ADMIN callers
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
