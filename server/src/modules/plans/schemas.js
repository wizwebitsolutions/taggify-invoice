import { z } from "zod";
import { formatSchema } from "../../lib/formats.js";

// cost is optional — falls back to the page's rate card for that format,
// same convention as a normal link submission (see links/service.js).
// clientCost is separate and also optional (newTask.md, 8 Sep) — null
// means "show the internal cost as-is" to the client; set it only when
// this line is marked up/down from what the page actually earns.
// postsPerProfile mirrors the example sheet's "Post Per Profile" column.
export const planItemSchema = z.object({
  assetId: z.string().min(1),
  format: formatSchema,
  cost: z.number().min(0).optional(),
  clientCost: z.number().min(0).optional(),
  postsPerProfile: z.number().int().min(1).max(1000).default(1),
});

// Step 3's editable client-facing overview numbers (user request, 10 Sep).
// Each is independently optional/nullable — null clears an override back
// to "show the computed value" (see plans/service.js's annotatePlan).
const overrideFields = {
  overrideFollowers: z.number().int().min(0).nullable().optional(),
  overridePosts: z.number().int().min(0).nullable().optional(),
  overrideImpressions: z.number().int().min(0).nullable().optional(),
  overrideCost: z.number().min(0).nullable().optional(),
};

export const createPlanSchema = z.object({
  name: z.string().min(1).max(150),
  clientName: z.string().min(1).max(150),
  clientContact: z.string().max(200).optional(),
  clientCompany: z.string().max(150).optional(),
  clientGstNumber: z.string().max(40).optional(),
  clientAddress: z.string().max(300).optional(),
  // Brief is mandatory (user request, 14 Sep — "brief note will be
  // mandatory"); budget is asked on the pages step, so it's optional here.
  notes: z.string().trim().min(1, "A brief note is required").max(1000),
  budget: z.number().positive().optional(),
  isGstPlan: z.boolean().optional().default(false),
  items: z.array(planItemSchema).max(200).optional(),
  ...overrideFields,
});

// `items`, when given, fully replaces the plan's line items (simplest
// correct edit model for what's still a short-lived pitch document — not
// worth a separate add/remove-one-item API surface).
export const updatePlanSchema = z.object({
  name: z.string().min(1).max(150).optional(),
  clientName: z.string().min(1).max(150).optional(),
  clientContact: z.string().max(200).nullable().optional(),
  clientCompany: z.string().max(150).nullable().optional(),
  clientGstNumber: z.string().max(40).nullable().optional(),
  clientAddress: z.string().max(300).nullable().optional(),
  notes: z.string().trim().min(1, "A brief note is required").max(1000).optional(),
  budget: z.number().positive().optional(),
  isGstPlan: z.boolean().optional(),
  items: z.array(planItemSchema).max(200).optional(),
  // A pasted reference link, same convention as Campaign.sheetLink — never
  // fetched/parsed server-side, just stored (user request, 10 Sep —
  // "option of attaching execution sheet after plan creation").
  executionSheetUrl: z.string().url().max(500).nullable().optional(),
  ...overrideFields,
});

// Client invoice popup (user request, 13 Sep — "on clicking generate
// invoice, it'll ask for client details like gst, company address, phone
// number"). Company + address are what an invoice must carry; GST number
// is required only for a GST plan (checked in the service, where the plan
// is known); phone is optional. Empty strings become null in the service.
export const clientInvoiceSchema = z.object({
  clientCompany: z.string().trim().min(1).max(150),
  clientGstNumber: z.string().trim().max(40).optional(),
  clientAddress: z.string().trim().min(1).max(300),
  clientPhone: z.string().trim().max(20).optional(),
});

// "Plan B or other plan" (user request, 10 Sep) — variantLabel defaults to
// the next free letter server-side (see plans/service.js's
// createPlanVariant) when not given.
export const createVariantSchema = z.object({
  variantLabel: z.string().min(1).max(40).optional(),
});

// Same shape/convention as campaigns/schemas.js's importSheetUrlSchema —
// paste a Google Sheet link, server fetches it as CSV, client parses.
export const importSheetUrlSchema = z.object({
  url: z.string().url().max(500),
});

// One row from a plan's "attach a sheet of pages" step (user request, 10
// Sep). Unlike campaigns' assignment sheet, this can create brand-new
// Inventory pages for a handle that doesn't exist yet — cost is required
// in that case, since a freshly-created page has no rate card to fall back
// to (validated in plans/service.js's importPlanSheetPages, not here,
// since whether it's required depends on whether the handle already
// exists — a lookup, not a static shape check).
export const planSheetRowSchema = z.object({
  handle: z.string().min(1).max(60),
  category: z.string().max(60).optional(),
  followers: z.number().int().min(0).optional(),
  format: formatSchema.optional(),
  cost: z.number().min(0).optional(),
  postsPerProfile: z.number().int().min(1).max(1000).optional(),
});

export const importSheetPagesSchema = z.object({
  rows: z.array(planSheetRowSchema).min(1).max(500),
});

// Attached invoice PDF (user request, 14 Sep — "option of attaching invoice
// document in pdf format"): the client uploads straight to Cloudinary and
// posts the key + original name back here (same two-step as
// invoices/schemas.js's confirmAttachmentSchema). PDF-only is enforced on
// the file name — the bytes never pass through this server, so the name is
// the one thing it can check.
export const confirmPlanInvoiceAttachmentSchema = z.object({
  publicId: z.string().min(1).max(300),
  fileName: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .refine((name) => /\.pdf$/i.test(name), { message: "The invoice document must be a PDF" }),
});
