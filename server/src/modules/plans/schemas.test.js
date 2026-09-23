import { describe, it, expect } from "vitest";
import { confirmPlanInvoiceAttachmentSchema, createPlanSchema, updatePlanSchema, planItemSchema } from "./schemas.js";

describe("confirmPlanInvoiceAttachmentSchema — attached invoice must be a PDF (user request, 14 Sep)", () => {
  const key = "plan-invoice-attachments/plan-1/uuid";

  it("accepts a .pdf file name, case-insensitively, trimmed", () => {
    expect(confirmPlanInvoiceAttachmentSchema.parse({ publicId: key, fileName: " Signed Invoice.PDF " }).fileName).toBe("Signed Invoice.PDF");
  });

  it("rejects images and anything else that isn't a PDF", () => {
    for (const fileName of ["invoice.png", "invoice.jpg", "invoice", "invoice.pdf.exe"]) {
      expect(confirmPlanInvoiceAttachmentSchema.safeParse({ publicId: key, fileName }).success).toBe(false);
    }
  });
});

describe("Plan basics (user request, 14 Sep) — brief note mandatory, reel/story only", () => {
  it("createPlanSchema needs a non-blank brief", () => {
    expect(createPlanSchema.safeParse({ name: "Q1", clientName: "Acme" }).success).toBe(false);
    expect(createPlanSchema.safeParse({ name: "Q1", clientName: "Acme", notes: "   " }).success).toBe(false);
    expect(createPlanSchema.safeParse({ name: "Q1", clientName: "Acme", notes: "Launch week push" }).success).toBe(true);
  });

  it("updatePlanSchema can't clear the brief or the budget once set (null no longer accepted)", () => {
    expect(updatePlanSchema.safeParse({ notes: null }).success).toBe(false);
    expect(updatePlanSchema.safeParse({ budget: null }).success).toBe(false);
    expect(updatePlanSchema.safeParse({ notes: "Updated brief", budget: 50000 }).success).toBe(true);
  });

  it("plan items accept only reel or story", () => {
    expect(planItemSchema.safeParse({ assetId: "a", format: "reel" }).success).toBe(true);
    expect(planItemSchema.safeParse({ assetId: "a", format: "story" }).success).toBe(true);
    for (const format of ["carousel", "video", "collaboration", "VOXPOP"]) {
      expect(planItemSchema.safeParse({ assetId: "a", format }).success).toBe(false);
    }
  });
});

describe("gstPercent (user request, 17 Sep — replaces the old fixed-18%-or-nothing isGstPlan toggle)", () => {
  const base = { name: "Q1", clientName: "Acme", notes: "Launch week push" };

  it("accepts a percentage between 0 and 100, or null/omitted for no GST", () => {
    expect(createPlanSchema.safeParse({ ...base, gstPercent: 18 }).success).toBe(true);
    expect(createPlanSchema.safeParse({ ...base, gstPercent: 0 }).success).toBe(true);
    expect(createPlanSchema.safeParse({ ...base, gstPercent: null }).success).toBe(true);
    expect(createPlanSchema.safeParse(base).success).toBe(true);
  });

  it("rejects a percentage outside 0–100", () => {
    expect(createPlanSchema.safeParse({ ...base, gstPercent: -5 }).success).toBe(false);
    expect(createPlanSchema.safeParse({ ...base, gstPercent: 101 }).success).toBe(false);
  });

  // The wizard's field is whole-number only; a fractional rate saved through
  // the API would be mangled ("12.5" -> "125" -> capped to 100) on first edit.
  it("rejects a fractional percentage", () => {
    expect(createPlanSchema.safeParse({ ...base, gstPercent: 12.5 }).success).toBe(false);
    expect(updatePlanSchema.safeParse({ gstPercent: 12.5 }).success).toBe(false);
  });

  it("updatePlanSchema accepts the same range, also optional", () => {
    expect(updatePlanSchema.safeParse({ gstPercent: 12 }).success).toBe(true);
    expect(updatePlanSchema.safeParse({ gstPercent: null }).success).toBe(true);
    expect(updatePlanSchema.safeParse({ gstPercent: 150 }).success).toBe(false);
  });
});
