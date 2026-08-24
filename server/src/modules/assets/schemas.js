import { z } from "zod";

export const createAssetSchema = z.object({
  platform: z.string().default("instagram"),
  handle: z.string().min(1).max(60),
});

export const rateCardEntrySchema = z.object({
  format: z.enum(["reel", "story", "carousel", "collaboration", "video"]),
  amount: z.number().positive(),
});

export const updateRateCardSchema = z.object({
  rateCards: z.array(rateCardEntrySchema).min(1),
});
