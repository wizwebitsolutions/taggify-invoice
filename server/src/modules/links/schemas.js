import { z } from "zod";

// reel/story only (14 Sep) — see lib/formats.js.
import { formatSchema } from "../../lib/formats.js";

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

// Admin bulk-import of already-done work from a sheet (newTask.md #8's
// second sheet-upload: "which page posted it, their finance part"). Keyed by
// campaign title + page handle (what a sheet actually has), not IDs — the
// service resolves those, or reports the row as skipped if either is
// unrecognized. cost is optional (falls back to the page's rate card, same
// as a normal link submission) so "their finance part" doesn't have to be
// filled in for every row if the sheet doesn't carry it.
export const bulkImportRowSchema = z.object({
  campaignTitle: z.string().min(1).max(150),
  pageHandle: z.string().min(1).max(60),
  url: z.string().url(),
  format: formatSchema,
  cost: z.number().positive().optional(),
});

export const bulkImportLinksSchema = z.object({
  rows: z.array(bulkImportRowSchema).min(1).max(500),
});

// Admin revises what a single submitted post is billed at (newTask.md #10 —
// "campaigns can have cost revise ... for individual pages"). Zero is a
// legitimate revision (e.g. a make-good/comped post), just not negative.
export const reviseCostSchema = z.object({
  cost: z.number().min(0),
  note: z.string().max(500).optional(),
});

// Admin marks a submitted post dead/broken (newTask.md, 8 Sep — "posted
// link not working"). Required, unlike reviseCostSchema's note — this
// removes the link from active work, so whoever reads the timeline later
// needs to know why.
export const markInvalidSchema = z.object({
  note: z.string().min(1).max(500),
});
