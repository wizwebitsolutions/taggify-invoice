import { z } from "zod";

export const bulkInvoiceSchema = z.object({
  linkIds: z.array(z.string().min(1)).min(1),
  dueInDays: z.number().int().positive().default(15),
});

export const gstStatusSchema = z.object({
  gstStatus: z.enum(["PENDING", "SCHEDULED", "COMPLETED"]),
});

export const paymentStatusSchema = z.object({
  paymentStatus: z.enum(["PENDING", "COMPLETED", "CANCELLED"]),
});

export const rejectInvoiceSchema = z.object({
  remarks: z.string().min(1).max(500),
});

export const listInvoicesQuerySchema = z.object({
  status: z.enum(["DRAFT", "RAISED", "APPROVED", "REJECTED", "PAID"]).optional(),
  paymentStatus: z.enum(["PENDING", "COMPLETED", "CANCELLED"]).optional(),
  search: z.string().max(60).optional(), // matches Inv No, per creator.wldd.in's "Search by Invoice Number"
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
