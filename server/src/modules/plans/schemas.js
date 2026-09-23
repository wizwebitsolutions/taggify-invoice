import { z } from "zod";
import { formatSchema } from "../../lib/formats.js";
import { GSTIN_RE } from "../../lib/gstin.js";

// cost is optional — falls back to the page's rate card for that format,
// same convention as a normal link submission (see links/service.js).
// clientCost is separate and also optional (newTask.md, 8 Sep) — null
// means "show the internal cost as-is" to the client; set it only when
// this line is marked up/down from what the page actually earns.
// postsPerProfile mirrors the example sheet's "Post Per Profile" column.
export const planItemSchema = z.object({
  assetId: z.string().min(1),
  format: formatSchema,
  cost: z.number().min(0).optional(),
  clientCost: z.number().min(0).optional(),
  postsPerProfile: z.number().int().min(1).max(1000).default(1),
});

// Step 3's editable client-facing overview numbers (user request, 10 Sep).
// Each is independently optional/nullable — null clears an override back
// to "show the computed value" (see plans/service.js's annotatePlan).
const overrideFields = {
  overrideFollowers: z.number().int().min(0).nullable().optional(),
  overridePosts: z.number().int().min(0).nullable().optional(),
  overrideImpressions: z.number().int().min(0).nullable().optional(),
  overrideCost: z.number().min(0).nullable().optional(),
};

export const createPlanSchema = z.object({
  name: z.string().min(1).max(150),
  clientName: z.string().min(1).max(150),
  clientContact: z.string().max(200).optional(),
  clientCompany: z.string().max(150).optional(),
  clientGstNumber: z.string().max(40).optional(),
  clientAddress: z.string().max(300).optional(),
  // Brief is mandatory (user request, 14 Sep — "brief note will be
  // mandatory"); budget is asked on the pages step, so it's optional here.
  notes: z.string().trim().min(1, "A brief note is required").max(1000),
  budget: z.number().positive().optional(),
  // Replaces the old isGstPlan boolean — a real percentage the plan maker
  // types, not a fixed 18%-or-nothing choice. Null/omitted = no GST line.
  gstPercent: z.number().int().min(0).max(100).nullable().optional(),
  items: z.array(planItemSchema).max(200).optional(),
  ...overrideFields,
});

// `items`, when given, fully replaces the plan's line items (simplest
// correct edit model for what's still a short-lived pitch document — not
// worth a separate add/remove-one-item API surface).
export const updatePlanSchema = z.object({
  name: z.string().min(1).max(150).optional(),
  clientName: z.string().min(1).max(150).optional(),
  clientContact: z.string().max(200).nullable().optional(),
  clientCompany: z.string().max(150).nullable().optional(),
  clientGstNumber: z.string().max(40).nullable().optional(),
  clientAddress: z.string().max(300).nullable().optional(),
  notes: z.string().trim().min(1, "A brief note is required").max(1000).optional(),
  budget: z.number().positive().optional(),
  gstPercent: z.number().int().min(0).max(100).nullable().optional(),
  items: z.array(planItemSchema).max(200).optional(),
  // The execution sheet link (user request, 10 Sep — "option of attaching
  // execution sheet after plan creation"). Since 23 Sep it is read on save
  // for an approved plan — see plans/service.js's syncExecutionSheet.
  executionSheetUrl: z.string().url().max(500).nullable().optional(),
  ...overrideFields,
});

// Client invoice popup (user request, 13 Sep — "on clicking generate
// invoice, it'll ask for client details like gst, company address, phone
// number"). Company + address are what an invoice must carry; so is the
// GST number (21 Sep — "gst no. is mandatory"), GST plan or not: its state
// code is what decides CGST+SGST vs IGST on the PI (lib/gstin.js). Phone is
// optional. Empty strings become null in the service.
export const clientInvoiceSchema = z.object({
  clientCompany: z.string().trim().min(1).max(150),
  clientGstNumber: z.string().trim().toUpperCase().regex(GSTIN_RE, "Enter a valid 15-character GSTIN, e.g. 27ABCDE1234F1Z5"),
  clientAddress: z.string().trim().min(1).max(300),
  clientPhone: z.string().trim().max(20).optional(),
  // 17 Sep — the Proforma Invoice's one "Description of goods/service"
  // line, its HSN/SAC (blank = company default) and, for Admin/Finance, a
  // typed invoice number instead of the counter's next one. "/" is allowed
  // since Indian invoice series commonly use it (e.g. TAG/25-26/0012).
  invoiceDescription: z.string().trim().min(1, "Description of goods/service is required").max(300),
  hsnSac: z.string().trim().max(10).regex(/^\d*$/, "HSN/SAC is digits only").optional(),
  clientInvoiceNumber: z
    .string()
    .trim()
    .max(40)
    .regex(/^[A-Za-z0-9/._-]*$/, "Use letters, digits and / . _ - only")
    .optional(),
});

// Admin/Finance numbering settings (see lib/clientInvoiceNumbering.js).
export const invoiceNumberingSchema = z.object({
  // Not empty: with no prefix every all-digit typed number ("2026") would
  // count as part of the series and drag the counter along with it.
  prefix: z.string().trim().min(1, "A prefix is required").max(20).regex(/^[A-Za-z0-9/._-]+$/, "Use letters, digits and / . _ - only").optional(),
  nextNumber: z.number().int().min(1).max(99999999).optional(),
});

// "Plan B or other plan" (user request, 10 Sep) — variantLabel defaults to
// the next free letter server-side (see plans/service.js's
// createPlanVariant) when not given.
export const createVariantSchema = z.object({
  variantLabel: z.string().min(1).max(40).optional(),
});

// Same shape/convention as campaigns/schemas.js's importSheetUrlSchema —
// paste a Google Sheet link, server fetches it as CSV, client parses.
export const importSheetUrlSchema = z.object({
  url: z.string().url().max(500),
});

// One row from a plan's "attach a sheet of pages" step (user request, 10
// Sep). Unlike campaigns' assignment sheet, this can create brand-new
// Inventory pages for a handle that doesn't exist yet — cost is required
// in that case, since a freshly-created page has no rate card to fall back
// to (validated in plans/service.js's importPlanSheetPages, not here,
// since whether it's required depends on whether the handle already
// exists — a lookup, not a static shape check).
export const planSheetRowSchema = z.object({
  handle: z.string().min(1).max(60),
  // The page's actual Instagram link (22 Sep) — informational; the handle is
  // what's matched. Kept on a pending row so Add to inventory can show it.
  pageUrl: z.string().url().max(300).optional(),
  category: z.string().max(60).optional(),
  followers: z.number().int().min(0).optional(),
  format: formatSchema.optional(),
  cost: z.number().min(0).optional(),
  clientCost: z.number().min(0).optional(),
  postsPerProfile: z.number().int().min(1).max(1000).optional(),
});

export const importSheetPagesSchema = z.object({
  rows: z.array(planSheetRowSchema).min(1).max(500),
});

// "Upload plan" from a whole-plan Google Sheet (user request, 22 Sep). The
// client parses the sheet (lib/parseAssignmentSheet.ts's parsePlanSheet)
// into the plan-level fields it found plus the page rows; blank cells are
// simply absent here. Only name + client name have to be there to create
// the row (DB non-null) — the popup asks for those two first when the sheet
// lacks them; everything else is collected afterwards, in steps, on the
// plan itself (PUT /plans/:id).
const sheetFields = {
  name: z.string().trim().min(1).max(150).optional(),
  clientName: z.string().trim().min(1).max(150).optional(),
  clientContact: z.string().trim().min(1).max(200).optional(),
  clientCompany: z.string().trim().min(1).max(150).optional(),
  clientGstNumber: z.string().trim().min(1).max(40).optional(),
  clientAddress: z.string().trim().min(1).max(300).optional(),
  notes: z.string().trim().min(1).max(1000).optional(),
  budget: z.number().positive().optional(),
  gstPercent: z.number().int().min(0).max(100).optional(),
};
const sheetRows = z.array(planSheetRowSchema).max(500);
export const planFromSheetSchema = z.object({
  sourceSheetUrl: z.string().url().max(500),
  fields: z.object({ ...sheetFields, name: z.string().trim().min(1).max(150), clientName: z.string().trim().min(1).max(150) }),
  rows: sheetRows,
});
// Refresh: same sheet, re-fetched and re-parsed — the stored sourceSheetUrl
// is used, never a new link.
export const planSheetSyncSchema = z.object({
  fields: z.object(sheetFields),
  rows: sheetRows,
});
// One-click "Add to inventory" for a pending sheet row. ownerId is only
// honoured for an Admin (assets/service.js createAsset's rule).
export const addPendingPageSchema = z.object({
  handle: z.string().trim().min(1).max(60),
  ownerId: z.string().min(1).optional(),
});

// Attached invoice PDF (user request, 14 Sep — "option of attaching invoice
// document in pdf format"): the client uploads straight to Cloudinary and
// posts the key + original name back here (same two-step as
// invoices/schemas.js's confirmAttachmentSchema). PDF-only is enforced on
// the file name — the bytes never pass through this server, so the name is
// the one thing it can check.
export const confirmPlanInvoiceAttachmentSchema = z.object({
  publicId: z.string().min(1).max(300),
  fileName: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .refine((name) => /\.pdf$/i.test(name), { message: "The invoice document must be a PDF" }),
});
