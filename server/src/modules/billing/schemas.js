import { z } from "zod";

// PAN format: 5 letters, 4 digits, 1 letter (e.g. CFUPG9064D) — same shape shown on creator.wldd.in.
const panSchema = z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, "Must be a valid PAN (e.g. ABCDE1234F)");

export const createBillingProfileSchema = z.object({
  pan: panSchema,
  name: z.string().min(1).max(150),
  gstin: z.string().max(20).optional(),
  msme: z.string().max(30).optional(),
  bankAccountNumber: z.string().min(4).max(30),
  ifscCode: z.string().min(4).max(15),
});

export const approvalSchema = z.object({
  approvalStatus: z.enum(["pending", "approved", "rejected"]),
});
