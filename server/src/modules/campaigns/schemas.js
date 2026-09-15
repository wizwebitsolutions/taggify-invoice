import { z } from "zod";
import { formatSchema } from "../../lib/formats.js";

// One row from the attached sheet (newTask.md #8) — an admin's page/creator
// list for who this campaign should be visible to. postUrl/format/cost
// (newTask.md, 8 Sep) are optional — when a row already names a posted
// link, that link is attached directly to the matched creator's posts
// instead of waiting for them to submit it separately (see
// campaigns/service.js's autoAttachLinkIfPossible). cost falls back to the
// page's rate card server-side, same as a normal submission — a row can
// name a post without knowing/overriding its price.
export const campaignAssignmentRowSchema = z
  .object({
    handle: z.string().min(1).max(60),
    phone: z.string().min(1).max(20).optional(),
    postUrl: z.string().url().max(500).optional(),
    format: formatSchema.optional(),
    cost: z.number().min(0).optional(),
  })
  // A cost/format with no URL has nothing to attach to; requiring both
  // together (format when postUrl is given) avoids silently discarding a
  // named post because its format column was left blank.
  .refine((row) => !row.postUrl || !!row.format, {
    message: "A row with a post URL also needs its format",
    path: ["format"],
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

// newTask.md, 8 Sep — "campaign can have multiple phase if need to add 2
// post for same campaign". Only title is settable; brand/cost cap/sheet
// link are always inherited from the phase group's root (see
// campaigns/service.js's createPhase).
export const createPhaseSchema = z.object({
  title: z.string().min(1).max(150).optional(),
});

// bugs.md #6 — admin pastes a Google Sheet link (in place of downloading +
// re-uploading a CSV export) for either the New campaign assignment sheet
// or the Import work sheet; the server fetches it, the client parses the
// returned CSV with the exact same code path as a file upload.
export const importSheetUrlSchema = z.object({
  url: z.string().url().max(500),
});
