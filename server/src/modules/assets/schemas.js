import { z } from "zod";
import { formatSchema } from "../../lib/formats.js";

// reel/story only (14 Sep) — see lib/formats.js.
export const rateCardEntrySchema = z.object({
  format: formatSchema,
  // RateCard.amount is Decimal(12,2) — keep it representable.
  amount: z.number().positive().max(9_999_999_999),
});

export const setActiveSchema = z.object({ isActive: z.boolean() });

export const setApprovalSchema = z.object({
  approvalStatus: z.enum(["pending", "approved", "rejected"]),
});

export const createAssetSchema = z.object({
  platform: z.string().default("instagram"),
  // Strip a leading "@" (and whitespace) — the UI always prepends its own
  // "@" when displaying a handle, so a stored "@handle" renders as "@@handle".
  handle: z
    .string()
    .min(1)
    .max(60)
    .transform((h) => h.trim().replace(/^@+/, "")),
  // Free-form, e.g. "Meme page" / "News page" — see Asset.category in schema.prisma.
  category: z.string().min(1).max(40).optional(),
  // Admin-only: register a page on behalf of another user (newTask.md #6/#7 —
  // creating a user with its first page(s) in one flow). Enforced in
  // createAsset(), not here — schema just accepts the shape.
  ownerId: z.string().min(1).optional(),
  // Optional starting rate card (Inventory "Create page", 14 Sep) — reel /
  // story from the form; any format is accepted, same as updateRateCard.
  rateCards: z.array(rateCardEntrySchema).max(20).optional(),
});

export const updateRateCardSchema = z.object({
  rateCards: z.array(rateCardEntrySchema).min(1),
});

// Inventory's Edit panel (28 Sep) — category and the manual engagement
// overrides. Every field is optional (an omitted key is left untouched) and
// nullable (an explicit null clears it: no category, or that figure handed
// back to the profile scrape). Ints, since these are counts, not money.
const manualEngagementFigure = z.number().int().min(0).max(2_000_000_000).nullable().optional();

export const updateAssetDetailsSchema = z.object({
  category: z.string().trim().min(1).max(40).nullable().optional(),
  avgViews: manualEngagementFigure,
  avgLikes: manualEngagementFigure,
  avgComments: manualEngagementFigure,
});

// Inventory "Import pages" (user request, 14 Sep) — step 2's confirmed
// rows. Everything here is re-checked in assets/service.js's importAssets
// (handle validity, owner is a real CREATOR, handle not already taken);
// this is just the shape.
export const importAssetRowSchema = z.object({
  handle: z.string().trim().min(1).max(120),
  ownerId: z.string().min(1),
  category: z.string().trim().max(40).nullable().optional(),
  // The sheet's "Page Name" (22 Sep) — saved as the page's display name until Instagram's own replaces it.
  pageName: z.string().trim().max(100).nullable().optional(),
  followers: z.number().int().min(0).nullable().optional(),
  rateCards: z.array(rateCardEntrySchema).max(20).optional(),
});

// Same shape as campaigns/plans' importSheetUrlSchema — a pasted Google Sheet link.
export const importSheetUrlSchema = z.object({
  url: z.string().url().max(500),
});

// Handles from a preview whose live follower counts the modal wants (user
// request, 14 Sep). Capped per request — the client chunks bigger sheets.
export const importFollowersSchema = z.object({
  handles: z.array(z.string().trim().min(1).max(120)).min(1).max(100),
});

export const refreshProfilesSchema = z.object({
  assetIds: z.array(z.string().min(1)).min(1).max(500),
});

export const importAssetsSchema = z.object({
  rows: z.array(importAssetRowSchema).min(1).max(500),
});
