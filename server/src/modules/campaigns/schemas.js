import { z } from "zod";

// One row from the attached sheet (newTask.md #8) — an admin's page/creator
// list for who this campaign should be visible to.
export const campaignAssignmentRowSchema = z.object({
  handle: z.string().min(1).max(60),
  phone: z.string().min(1).max(20).optional(),
});

export const createCampaignSchema = z.object({
  brandName: z.string().min(1).max(100),
  title: z.string().min(1).max(150),
  deadline: z.coerce.date().optional(),
  costCap: z.number().positive().optional(),
  sheetLink: z.string().url().max(500).optional(),
  assignments: z.array(campaignAssignmentRowSchema).max(500).optional(),
});

export const updateCampaignSchema = z.object({
  brandName: z.string().min(1).max(100).optional(),
  title: z.string().min(1).max(150).optional(),
  deadline: z.coerce.date().nullable().optional(),
  costCap: z.number().positive().nullable().optional(),
});

export const resolveAssignmentSchema = z.object({
  assetId: z.string().min(1),
});
