import { z } from "zod";

export const createCampaignSchema = z.object({
  brandName: z.string().min(1).max(100),
  title: z.string().min(1).max(150),
  deadline: z.coerce.date().optional(),
});

export const updateCampaignSchema = z.object({
  brandName: z.string().min(1).max(100).optional(),
  title: z.string().min(1).max(150).optional(),
  deadline: z.coerce.date().nullable().optional(),
});
