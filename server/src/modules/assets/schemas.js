import { z } from "zod";

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
