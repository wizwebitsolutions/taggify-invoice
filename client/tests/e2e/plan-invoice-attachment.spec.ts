import { test, expect, type Page } from "@playwright/test";

import { signIn, mockApi, API_URL } from "./fixtures";
import type { Plan } from "@/lib/api-client";

/**
 * Plans page → "Attach invoice (PDF)" on the plan card (user request,
 * 14 Sep — "in plans for admin, plan maker side, there'll be option of
 * attaching invoice document in pdf format as well"). Component:
 * components/plans/plan-invoice-attachment.tsx. Same two-step
 * direct-to-Cloudinary flow as invoice-attachment.spec.ts; here the
 * "Cloudinary" URL is a mocked endpoint. Server side (plans/service.js
 * requestInvoiceAttachmentUpload/confirmInvoiceAttachment/
 * removeInvoiceAttachment + the PDF-only schema) is covered by vitest.
 */
function plan(overrides: Record<string, unknown> = {}) {
  return {
    id: "plan-1",
    name: "Q1 Meme Push",
    clientName: "Rohit Sharma",
    clientContact: null,
    clientCompany: null,
    clientGstNumber: null,
    clientAddress: null,
    clientPhone: null,
    clientInvoiceNumber: null,
    clientInvoiceAt: null,
    notes: null,
    budget: null,
    gstPercent: null,
    isGstPlan: false,
    status: "DRAFT",
    approvedBy: null,
    approvedAt: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    createdBy: { id: "test-user-1", name: "Test User" },
    items: [],
    totalCost: 0,
    budgetVariance: null,
    expectedEngagement: { likes: 0, views: 0 },
    overview: { totalFollowers: 0, totalPosts: 0, expectedImpressions: 0, subtotal: 0, gstAmount: 0, total: 0 },
    internal: { computedFollowers: 0, computedPosts: 0, computedImpressions: 0, computedSubtotal: 0, computedGstAmount: 0, computedTotal: 0 },
    overrideFollowers: null,
    overridePosts: null,
    overrideImpressions: null,
    overrideCost: null,
    pitchGroupId: null,
    variantLabel: "Plan A",
    clientSheetUrl: null,
    internalSheetUrl: null,
    executionSheetUrl: null,
    campaignId: null,
    invoiceAttachment: null,
    ...overrides,
  };
}

const PDF = Buffer.from("%PDF-1.4\n%mock\n");

test.describe("Plans — attached invoice PDF on the plan card", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("PLAN_MAKER attaches a PDF to their own DRAFT plan: upload-url → upload → confirm, then it shows as a link", async ({ page }) => {
    await signIn(page, "PLAN_MAKER");
    await mockApi(page);
    let attached: Plan["invoiceAttachment"] = null;
    await page.route(`${API_URL}/plans`, (route) => route.fulfill({ json: [plan({ invoiceAttachment: attached })] }));
    await page.route(`${API_URL}/plans/plan-1/invoice-attachment/upload-url`, (route) =>
      route.fulfill({ json: { uploadUrl: `${API_URL}/fake-cloudinary`, apiKey: "k", timestamp: 1, signature: "s", publicId: "plan-invoice-attachments/plan-1/uuid" } })
    );
    let uploadedContentType: string | undefined;
    await page.route(`${API_URL}/fake-cloudinary`, (route) => {
      uploadedContentType = route.request().headers()["content-type"];
      return route.fulfill({ status: 200, json: { ok: true } });
    });
    let confirmBody: { publicId: string; fileName: string } | undefined;
    await page.route(`${API_URL}/plans/plan-1/invoice-attachment`, (route) => {
      confirmBody = route.request().postDataJSON();
      attached = { name: confirmBody!.fileName, url: "https://cdn/plan-1.pdf", uploadedAt: new Date().toISOString(), uploadedById: "test-user-1" };
      return route.fulfill({ status: 201, json: attached });
    });

    await page.goto("/plans?maker=all");
    const control = page.getByTestId("plan-invoice-attachment-plan-1");
    // Not gated on approval — this is a DRAFT plan with no campaign yet.
    await expect(control.getByRole("button", { name: "Attach invoice (PDF)" })).toBeVisible();

    await control.getByLabel("Attach invoice PDF for Q1 Meme Push").setInputFiles({ name: "signed-invoice.pdf", mimeType: "application/pdf", buffer: PDF });

    await expect.poll(() => confirmBody).toEqual({ publicId: "plan-invoice-attachments/plan-1/uuid", fileName: "signed-invoice.pdf" });
    expect(uploadedContentType).toContain("multipart/form-data");
    const link = control.getByRole("link", { name: "signed-invoice.pdf" });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", "https://cdn/plan-1.pdf");
    await expect(control.getByRole("button", { name: "Attach invoice (PDF)" })).toHaveCount(0);
  });

  test("a non-PDF is refused client-side before any upload request is made", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.route(`${API_URL}/plans`, (route) => route.fulfill({ json: [plan()] }));
    let uploadUrlRequested = false;
    await page.route(`${API_URL}/plans/plan-1/invoice-attachment/upload-url`, (route) => {
      uploadUrlRequested = true;
      return route.fulfill({ status: 500, json: { message: "should not be called" } });
    });

    await page.goto("/plans?maker=all");
    const control = page.getByTestId("plan-invoice-attachment-plan-1");
    await control.getByLabel("Attach invoice PDF for Q1 Meme Push").setInputFiles({ name: "invoice.png", mimeType: "image/png", buffer: Buffer.from("png") });

    await expect(control.getByText("Only PDF files can be attached as the invoice document.")).toBeVisible();
    expect(uploadUrlRequested).toBe(false);
    await expect(control.getByRole("button", { name: "Attach invoice (PDF)" })).toBeVisible();
  });

  test("an attached PDF can be removed; a Plan Maker sees no control on someone else's plan", async ({ page }) => {
    await signIn(page, "PLAN_MAKER");
    await mockApi(page);
    let attached: Plan["invoiceAttachment"] = { name: "signed-invoice.pdf", url: "https://cdn/plan-1.pdf", uploadedAt: "2026-09-14T00:00:00.000Z", uploadedById: "test-user-1" };
    await page.route(`${API_URL}/plans`, (route) =>
      route.fulfill({
        json: [
          plan({ invoiceAttachment: attached }),
          // Listed for a Plan Maker only when the API scopes wrongly — but the
          // card must still hide the write controls for a plan they don't own.
          plan({ id: "plan-2", name: "Someone else's plan", createdBy: { id: "other-user", name: "Other" } }),
        ],
      })
    );
    let deleted = false;
    await page.route(`${API_URL}/plans/plan-1/invoice-attachment`, (route) => {
      if (route.request().method() !== "DELETE") return route.fallback();
      deleted = true;
      attached = null;
      return route.fulfill({ status: 204, body: "" });
    });

    await page.goto("/plans?maker=all");
    const control = page.getByTestId("plan-invoice-attachment-plan-1");
    await expect(control.getByRole("link", { name: "signed-invoice.pdf" })).toBeVisible();
    await expect(page.getByTestId("plan-invoice-attachment-plan-2")).toHaveCount(0);

    await control.getByRole("button", { name: "Remove attached invoice for Q1 Meme Push" }).click();
    await expect.poll(() => deleted).toBe(true);
    await expect(control.getByRole("button", { name: "Attach invoice (PDF)" })).toBeVisible();
  });
});
