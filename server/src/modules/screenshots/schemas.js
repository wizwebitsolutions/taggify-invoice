import { z } from "zod";

export const uploadUrlRequestSchema = z.object({}).default({});

export const confirmUploadSchema = z.object({
  publicId: z.string().min(1),
});
