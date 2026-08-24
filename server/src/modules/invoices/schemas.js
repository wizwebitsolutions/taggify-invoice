import { z } from "zod";

export const bulkInvoiceSchema = z.object({
  linkIds: z.array(z.string().min(1)).min(1),
  dueInDays: z.number().int().positive().default(15),
});

export const gstStatusSchema = z.object({
  gstStatus: z.enum(["PENDING", "SCHEDULED", "COMPLETED"]),
});

export const listInvoicesQuerySchema = z.object({
  status: z.enum(["DRAFT", "RAISED", "APPROVED", "PAID"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
