import { test, expect, type Page } from "@playwright/test";

import { signIn, mockApi, API_URL } from "./fixtures";

/**
 * Plans page → "Generate invoice" popup (user request, 13 Sep — "on
 * clicking generate invoice, it'll ask for client details like gst,
 * company address, phone number etc ... in separate ui popup").
 * Component: components/plans/client-invoice-modal.tsx, opened from the
 * plan card in app/plans/page.tsx. Server side (plans/service.js
 * generateClientInvoice + lib/clientInvoicePdf.js) is covered by vitest.
 */
function plan(overrides: Record<string, unknown> = {}) {
  return {
    id: "plan-1",
    name: "Q1 Meme Push",
    clientName: "Rohit Sharma",
    clientContact: null,
    clientCompany: "Acme Foods Pvt Ltd",
    clientGstNumber: "27ABCDE1234F1Z5",
    clientAddress: "12 MG Road, Pune",
    clientPhone: "+919876543210",
    clientInvoiceNumber: null,
    clientInvoiceAt: null,
    invoiceDescription: "Influencer marketing services",
    hsnSac: null,
    notes: null,
    budget: null,
    gstPercent: 18,
    isGstPlan: true,
    status: "APPROVED",
    approvedBy: null,
    approvedAt: "2026-09-10T00:00:00.000Z",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    createdBy: { id: "test-user-1", name: "Test User" },
    items: [],
    totalCost: 8000,
    budgetVariance: null,
    expectedEngagement: { likes: 0, views: 0 },
    overview: { totalFollowers: 0, totalPosts: 2, expectedImpressions: 0, subtotal: 10000, gstAmount: 1800, total: 11800 },
    internal: { computedFollowers: 0, computedPosts: 2, computedImpressions: 0, computedSubtotal: 10000, computedGstAmount: 1800, computedTotal: 11800 },
    overrideFollowers: null,
    overridePosts: null,
    overrideImpressions: null,
    overrideCost: null,
    pitchGroupId: null,
    variantLabel: "Plan A",
    clientSheetUrl: null,
    internalSheetUrl: null,
    executionSheetUrl: null,
    campaignId: "campaign-1",
    ...overrides,
  };
}

const PDF = Buffer.from("%PDF-1.4\n%mock\n");

async function mockPlans(page: Page, plans: unknown[]) {
  await page.route(`${API_URL}/plans`, (route) => route.fulfill({ json: plans }));
  await page.route(`${API_URL}/plans/client-invoice-numbering`, (route) =>
    route.fulfill({ json: { prefix: "TAG/", nextNumber: 7, suggestion: "TAG/0007", defaultHsnSac: "998397", companyStateCode: "06" } })
  );
}

test.describe("Plans — Generate invoice popup (client invoice)", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("an approved plan's Generate invoice opens a popup prefilled with the plan's client details", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await mockPlans(page, [plan()]);

    await page.goto("/plans?maker=all");
    // A button now, not the old deep-link into the campaign page.
    await expect(page.getByRole("link", { name: "Generate invoice" })).toHaveCount(0);
    await page.getByRole("button", { name: "Generate invoice" }).click();

    const modal = page.getByTestId("client-invoice-modal");
    await expect(modal.getByRole("heading", { name: "Generate invoice" })).toBeVisible();
    await expect(modal).toContainText("₹11,800");
    await expect(modal.locator('input[name="clientCompany"]')).toHaveValue("Acme Foods Pvt Ltd");
    await expect(modal.locator('input[name="clientGstNumber"]')).toHaveValue("27ABCDE1234F1Z5");
    await expect(modal.locator('textarea[name="clientAddress"]')).toHaveValue("12 MG Road, Pune");
    // Stored as +91XXXXXXXXXX, shown as the 10 national digits next to the +91 prefix.
    await expect(modal.locator('input[name="clientPhone"]')).toHaveValue("9876543210");
  });

  test("submitting posts the details, then downloads the PDF and shows the invoice number", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await mockPlans(page, [plan({ clientCompany: null, clientGstNumber: null, clientAddress: null, clientPhone: null, invoiceDescription: null })]);
    let posted: Record<string, unknown> | null = null;
    let pdfFetched = false;
    await page.route(`${API_URL}/plans/plan-1/client-invoice`, (route) => {
      posted = route.request().postDataJSON();
      return route.fulfill({ json: plan({ ...(posted as object), clientInvoiceNumber: "CINV-1-ABCDEF", clientInvoiceAt: "2026-09-13T00:00:00.000Z" }) });
    });
    await page.route(`${API_URL}/plans/plan-1/client-invoice.pdf`, (route) => {
      pdfFetched = true;
      return route.fulfill({ status: 200, contentType: "application/pdf", body: PDF });
    });

    await page.goto("/plans?maker=all");
    await page.getByRole("button", { name: "Generate invoice" }).click();
    const modal = page.getByTestId("client-invoice-modal");
    await modal.locator('input[name="clientCompany"]').fill("Acme Foods Pvt Ltd");
    await modal.locator('input[name="clientGstNumber"]').fill("27abcde1234f1z5");
    await modal.locator('textarea[name="clientAddress"]').fill("12 MG Road, Pune");
    await modal.locator('input[name="clientPhone"]').fill("9876543210");
    // 17 Sep — the counter's next number and the company HSN/SAC are prefilled; the description is typed.
    await expect(modal.locator('input[name="clientInvoiceNumber"]')).toHaveValue("TAG/0007");
    await expect(modal.locator('input[name="hsnSac"]')).toHaveValue("998397");
    await modal.locator('textarea[name="invoiceDescription"]').fill("Influencer marketing services");
    await modal.getByRole("button", { name: "Generate invoice" }).click();

    await expect(page.getByTestId("client-invoice-generated")).toContainText("CINV-1-ABCDEF");
    expect(posted).toEqual({
      clientCompany: "Acme Foods Pvt Ltd",
      clientGstNumber: "27ABCDE1234F1Z5",
      clientAddress: "12 MG Road, Pune",
      clientPhone: "+919876543210",
      invoiceDescription: "Influencer marketing services",
      hsnSac: "998397",
      clientInvoiceNumber: "TAG/0007",
    });
    // The PDF fetch starts right after the generate succeeds.
    await expect.poll(() => pdfFetched).toBe(true);
  });

  // 21 Sep — "gst no. is mandatory": a non-GST plan used to label it "(optional)" and submit without one.
  test("won't submit without the client's GST number — even on a non-GST plan; company and address are always required", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await mockPlans(page, [plan({ clientCompany: null, clientGstNumber: null, clientAddress: null, clientPhone: null, invoiceDescription: null, gstPercent: null, isGstPlan: false })]);
    let posted = false;
    await page.route(`${API_URL}/plans/plan-1/client-invoice`, (route) => {
      posted = true;
      return route.fulfill({ json: plan() });
    });

    await page.goto("/plans?maker=all");
    await page.getByRole("button", { name: "Generate invoice" }).click();
    const modal = page.getByTestId("client-invoice-modal");
    await modal.getByRole("button", { name: "Generate invoice" }).click();

    await expect(modal).toContainText("Company name is required.");
    await expect(modal).toContainText("GST number is required.");
    await expect(modal.getByText("GST number (optional)")).toHaveCount(0);
    await expect(modal).toContainText("Billing address is required.");
    await expect(modal).toContainText("Description of goods/service is required.");
    expect(posted).toBe(false);

    // A malformed number is refused too.
    await modal.locator('input[name="clientGstNumber"]').fill("GST123");
    await expect(modal).toContainText("GSTIN is 15 characters");
    await modal.getByRole("button", { name: "Generate invoice" }).click();
    expect(posted).toBe(false);
  });

  test("the GST number's state code against Taggify's tells the user which tax the invoice charges", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await mockPlans(page, [plan()]); // 27… client, company state 06
    await page.goto("/plans?maker=all");
    await page.getByRole("button", { name: "Generate invoice" }).click();
    const modal = page.getByTestId("client-invoice-modal");
    const note = modal.getByTestId("client-invoice-tax-note");

    await expect(note).toContainText("IGST 18%");
    await modal.locator('input[name="clientGstNumber"]').fill("06abcde1234f1z5");
    await expect(note).toContainText("CGST 9% + SGST 9%");
    // Nothing to claim until the number is a real GSTIN.
    await modal.locator('input[name="clientGstNumber"]').fill("06ABC");
    await expect(note).toHaveCount(0);
  });

  test("an Admin can overwrite the invoice number and HSN/SAC; a Plan Maker sees the number read-only and doesn't send one", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await mockPlans(page, [plan()]);
    let posted: Record<string, unknown> | null = null;
    await page.route(`${API_URL}/plans/plan-1/client-invoice`, (route) => {
      posted = route.request().postDataJSON();
      return route.fulfill({ json: plan({ clientInvoiceNumber: "TAG/25-26/0042" }) });
    });
    await page.route(`${API_URL}/plans/plan-1/client-invoice.pdf`, (route) => route.fulfill({ status: 200, contentType: "application/pdf", body: PDF }));

    await page.goto("/plans?maker=all");
    await page.getByRole("button", { name: "Generate invoice" }).click();
    let modal = page.getByTestId("client-invoice-modal");
    await modal.locator('input[name="clientInvoiceNumber"]').fill("TAG/25-26/0042");
    await modal.locator('input[name="hsnSac"]').fill("998361");
    await modal.getByRole("button", { name: "Generate invoice" }).click();
    await expect(page.getByTestId("client-invoice-generated")).toContainText("TAG/25-26/0042");
    expect(posted).toMatchObject({ clientInvoiceNumber: "TAG/25-26/0042", hsnSac: "998361" });

    posted = null;
    await signIn(page, "PLAN_MAKER");
    await page.goto("/plans?maker=all");
    await page.getByRole("button", { name: "Generate invoice" }).click();
    modal = page.getByTestId("client-invoice-modal");
    await expect(modal.locator('input[name="clientInvoiceNumber"]')).toHaveValue("TAG/0007");
    await expect(modal.locator('input[name="clientInvoiceNumber"]')).toHaveAttribute("readonly", "");
    await modal.getByRole("button", { name: "Generate invoice" }).click();
    await expect.poll(() => posted).not.toBeNull();
    expect(posted).not.toHaveProperty("clientInvoiceNumber");
  });

  test("a server error is shown inline and the popup stays open", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await mockPlans(page, [plan()]);
    await page.route(`${API_URL}/plans/plan-1/client-invoice`, (route) =>
      route.fulfill({ status: 409, json: { error: { code: "PLAN_NOTHING_TO_INVOICE", message: "This plan has no client-facing cost to invoice" } } })
    );

    await page.goto("/plans?maker=all");
    await page.getByRole("button", { name: "Generate invoice" }).click();
    const modal = page.getByTestId("client-invoice-modal");
    await modal.getByRole("button", { name: "Generate invoice" }).click();
    await expect(modal).toContainText("This plan has no client-facing cost to invoice");
    await expect(modal.getByRole("heading", { name: "Generate invoice" })).toBeVisible();
  });

  test("a PDF failure after a successful generate still lands on the success view, with the error and Download again", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await mockPlans(page, [plan()]);
    let pdfCalls = 0;
    await page.route(`${API_URL}/plans/plan-1/client-invoice`, (route) => route.fulfill({ json: plan({ clientInvoiceNumber: "CINV-1-ABCDEF" }) }));
    await page.route(`${API_URL}/plans/plan-1/client-invoice.pdf`, (route) => {
      pdfCalls += 1;
      return pdfCalls === 1
        ? route.fulfill({ status: 500, json: { error: { code: "PDF_FAILED", message: "PDF render failed" } } })
        : route.fulfill({ status: 200, contentType: "application/pdf", body: PDF });
    });

    await page.goto("/plans?maker=all");
    await page.getByRole("button", { name: "Generate invoice" }).click();
    const modal = page.getByTestId("client-invoice-modal");
    await modal.getByRole("button", { name: "Generate invoice" }).click();

    await expect(page.getByTestId("client-invoice-generated")).toContainText("CINV-1-ABCDEF was generated.");
    await expect(modal).toContainText("PDF render failed");
    await modal.getByRole("button", { name: "Download again" }).click();
    await expect.poll(() => pdfCalls).toBe(2);
    await expect(modal).not.toContainText("PDF render failed");
  });

  test("an already-invoiced plan offers Regenerate plus a download chip with the invoice number", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await mockPlans(page, [plan({ clientInvoiceNumber: "CINV-1-ABCDEF", clientInvoiceAt: "2026-09-13T00:00:00.000Z" })]);
    let pdfFetched = false;
    await page.route(`${API_URL}/plans/plan-1/client-invoice.pdf`, (route) => {
      pdfFetched = true;
      return route.fulfill({ status: 200, contentType: "application/pdf", body: PDF });
    });

    await page.goto("/plans?maker=all");
    await expect(page.getByRole("button", { name: "Generate invoice" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Regenerate invoice" })).toBeVisible();
    await page.getByRole("button", { name: "Download invoice CINV-1-ABCDEF" }).click();
    await expect.poll(() => pdfFetched).toBe(true);
  });

  test("a plan not yet approved has no Generate invoice button", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await mockPlans(page, [plan({ status: "DRAFT", campaignId: null, approvedAt: null })]);

    await page.goto("/plans?maker=all");
    await expect(page.getByText("Q1 Meme Push")).toBeVisible();
    await expect(page.getByRole("button", { name: /Generate invoice|Regenerate invoice/ })).toHaveCount(0);
  });

  test("a Plan Maker only gets Generate invoice on their own plans", async ({ page }) => {
    await signIn(page, "PLAN_MAKER");
    await mockApi(page);
    await mockPlans(page, [plan({ id: "mine" }), plan({ id: "theirs", name: "Someone else's plan", createdBy: { id: "pm-2", name: "Other Planner" } })]);

    await page.goto("/plans?maker=all");
    await expect(page.getByText("Someone else's plan")).toBeVisible();
    await expect(page.getByRole("button", { name: "Generate invoice" })).toHaveCount(1);
  });
});
