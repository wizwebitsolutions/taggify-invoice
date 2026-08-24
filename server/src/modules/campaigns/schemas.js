import { z } from "zod";

export const createCampaignSchema = z.object({
  brandName: z.string().min(1).max(100),
  title: z.string().min(1).max(150),
});
