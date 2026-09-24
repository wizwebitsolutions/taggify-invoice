import { z } from "zod";

// TDS options are fixed to the three rates tasks.md asked for (23 Sep) —
// not a free-form percentage, so a typo can't withhold the wrong amount.
export const TDS_PERCENTS = [1, 2, 10];

export const createPayoutSchema = z.object({
  creatorId: z.string().min(1),
  linkIds: z.array(z.string().min(1)).min(1),
  isGstInvoice: z.boolean().default(false),
  tdsPercent: z.union([z.literal(1), z.literal(2), z.literal(10)]).nullable().default(null),
});

export const confirmPayoutReceiptSchema = z.object({
  publicId: z.string().min(1).max(300),
  fileName: z.string().min(1).max(200),
  // 24 Sep redesign — the date the transfer went out (defaults to now) and
  // its bank reference, both typed on the one-screen "Pay vendor" sheet.
  paidOn: z.coerce.date().optional(),
  utr: z.string().trim().max(60).optional(),
});

export const listPayoutsQuerySchema = z.object({
  creatorId: z.string().min(1).optional(),
  assetId: z.string().min(1).optional(),
  // Page-handle search (24 Sep redesign's "specific page by search" filter).
  q: z.string().trim().max(60).optional(),
  status: z.enum(["DRAFT", "PAID", "CANCELLED"]).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

// Payments tab "Pending" (24 Sep redesign): payable links across vendors.
// Unpaginated in practice (one screen of work to pay), capped at 500.
export const listPendingLinksQuerySchema = z.object({
  ownerId: z.string().min(1).optional(),
  assetId: z.string().min(1).optional(),
  q: z.string().trim().max(60).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  pageSize: z.coerce.number().int().min(1).max(500).default(200),
});

// Creator's own view — same filters minus the vendor (it's always them).
export const listMyPendingQuerySchema = listPendingLinksQuerySchema.omit({ ownerId: true });
export const listMyPayoutsQuerySchema = listPayoutsQuerySchema.omit({ creatorId: true, status: true });
