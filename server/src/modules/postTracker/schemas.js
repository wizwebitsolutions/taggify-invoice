import { z } from "zod";

// Lines are checked one by one in service.js (parseInstagramPostUrl) so a bad
// line is reported back next to its text rather than failing the whole paste.
export const addPostsSchema = z.object({
  urls: z.array(z.string().max(2000)).min(1, "Paste at least one link").max(50, "Max 50 links at a time"),
  note: z.string().trim().max(200, "Note is too long").optional(),
});

export const listPostsQuerySchema = z.object({
  status: z.enum(["all", "ok", "broken", "archived"]).default("all"),
  q: z.string().trim().max(100).optional(),
  // Full admins only — anyone else is always scoped to their own cards.
  addedBy: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(60).default(24),
});

export const updatePostSchema = z
  .object({
    note: z.string().trim().max(200, "Note is too long").nullable().optional(),
    broken: z.boolean().optional(),
    archived: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "Nothing to update" });
