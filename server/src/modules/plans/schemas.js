import { z } from "zod";

// cost is optional — falls back to the page's rate card for that format,
// same convention as a normal link submission (see links/service.js).
// clientCost is separate and also optional (newTask.md, 8 Sep) — null
// means "show the internal cost as-is" to the client; set it only when
// this line is marked up/down from what the page actually earns.
// postsPerProfile mirrors the example sheet's "Post Per Profile" column.
export const planItemSchema = z.object({
  assetId: z.string().min(1),
  format: z.string().min(1).max(40),
  cost: z.number().min(0).optional(),
  clientCost: z.number().min(0).optional(),
  postsPerProfile: z.number().int().min(1).max(1000).default(1),
});

export const createPlanSchema = z.object({
  name: z.string().min(1).max(150),
  clientName: z.string().min(1).max(150),
  clientContact: z.string().max(200).optional(),
  budget: z.number().positive().optional(),
  isGstPlan: z.boolean().optional().default(false),
  items: z.array(planItemSchema).max(200).optional(),
});

// `items`, when given, fully replaces the plan's line items (simplest
// correct edit model for what's still a short-lived pitch document — not
// worth a separate add/remove-one-item API surface).
export const updatePlanSchema = z.object({
  name: z.string().min(1).max(150).optional(),
  clientName: z.string().min(1).max(150).optional(),
  clientContact: z.string().max(200).nullable().optional(),
  budget: z.number().positive().nullable().optional(),
  isGstPlan: z.boolean().optional(),
  items: z.array(planItemSchema).max(200).optional(),
});
