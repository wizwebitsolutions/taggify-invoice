import { z } from "zod";

export const bulkInvoiceSchema = z.object({
  linkIds: z.array(z.string().min(1)).min(1),
  dueInDays: z.number().int().positive().default(15),
  // GST is not mandatory (newTask.md #4): the raiser explicitly picks a GST
  // invoice (18% auto-added, see bulkCreateInvoice's GST_RATE) or a non-GST
  // one. Defaults to non-GST rather than silently taxing someone.
  isGstInvoice: z.boolean().default(false),
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

// Step 2 of the attachment upload (see confirmAttachment) — the key the
// server minted, echoed back, plus the original file name for display.
export const confirmAttachmentSchema = z.object({
  publicId: z.string().min(1).max(300),
  fileName: z.string().min(1).max(200),
});

// Receivables (23 Sep) — see clientInvoices.js.
export const listClientInvoicesQuerySchema = z.object({
  status: z.enum(["ISSUED", "PAID", "CANCELLED"]).optional(),
  campaignId: z.string().min(1).optional(),
  search: z.string().max(60).optional(),
  // Payments tab (tasks.md #5, 23 Sep) — only rows with the real invoice attached.
  hasAttachment: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),
});

export const markClientInvoicePaidSchema = z.object({
  paidAmount: z.coerce.number().positive().optional(),
  remarks: z.string().max(500).optional(),
});

export const cancelClientInvoiceSchema = z.object({
  remarks: z.string().min(1).max(500),
});

export const listInvoicesQuerySchema = z.object({
  campaignId: z.string().min(1).optional(),
  status: z.enum(["DRAFT", "RAISED", "APPROVED", "REJECTED", "PAID"]).optional(),
  paymentStatus: z.enum(["PENDING", "COMPLETED", "CANCELLED"]).optional(),
  search: z.string().max(60).optional(), // matches Inv No, per creator.wldd.in's "Search by Invoice Number"
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
