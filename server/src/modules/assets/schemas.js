import { z } from "zod";

export const createAssetSchema = z.object({
  platform: z.string().default("instagram"),
  handle: z.string().min(1).max(60),
});

// Free-form format name (e.g. "VOXPOP", "Type 4") — not a fixed enum, so
// rate cards can carry custom formats the way creator.wldd.in's do.
export const rateCardEntrySchema = z.object({
  format: z.string().min(1).max(40),
  amount: z.number().positive(),
});

export const updateRateCardSchema = z.object({
  rateCards: z.array(rateCardEntrySchema).min(1),
});
