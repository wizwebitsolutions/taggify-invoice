import { z } from "zod";

export const uploadUrlRequestSchema = z.object({
  contentType: z.enum(["image/jpeg", "image/png", "image/webp"]).default("image/jpeg"),
});

export const confirmUploadSchema = z.object({
  r2Key: z.string().min(1),
});
