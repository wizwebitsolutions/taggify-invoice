import { test, expect, type Page } from "@playwright/test";

import { signIn, mockApi, API_URL } from "./fixtures";

/**
 * Saved clients (user request, 21 Sep — "if client name already exists in
 * database in plan making, it should fetch all details like gst, address
 * ... it will have dropdown of client name"). GET /plans/clients feeds
 * - the wizard's Client name field (components/plans/plan-wizard.tsx), and
 * - the "Generate invoice" popup's Company name field
 *   (components/plans/client-invoice-modal.tsx),
 * both through components/ui/combo-input.tsx. Server side
 * (plans/service.js listSavedClients — scoping, de-duplication) is vitest's.
 */
function plan(overrides: Record<string, unknown> = {}) {
  return {
    id: "plan-1",
    name: "Nykaa Diwali push",
    clientName: "Nykaa",
    clientContact: null,
    clientCompany: null,
    clientGstNumber: null,
    clientAddress: null,
    clientPhone: null,
    clientInvoiceNumber: null,
    clientInvoiceAt: null,
    invoiceDescription: null,
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

const NYKAA_MUMBAI = { clientName: "Nykaa", clientCompany: "FSN E-Commerce Ventures Ltd", clientGstNumber: "27AABCF1234A1Z5", clientAddress: "104 Vasan Udyog Bhavan, Mumbai", clientPhone: "+919876543210" };
const NYKAA_BLR = { clientName: "Nykaa", clientCompany: "FSN E-Commerce Ventures Ltd", clientGstNumber: "29AABCF1234A1Z1", clientAddress: "Koramangala, Bengaluru", clientPhone: null };
const ZOMATO = { clientName: "Zomato", clientCompany: "Zomato Ltd", clientGstNumber: "06AADCD4946L1ZB", clientAddress: "Sector 43, Gurugram", clientPhone: null };
const BARE = { clientName: "Swiggy", clientCompany: null, clientGstNumber: null, clientAddress: null, clientPhone: null };

async function mockPlansPage(page: Page, plans: unknown[], clients: unknown[]) {
  await page.route(`${API_URL}/plans`, (route) => (route.request().method() === "GET" ? route.fulfill({ json: plans }) : route.fallback()));
  await page.route(`${API_URL}/plans/clients`, (route) => route.fulfill({ json: clients }));
  await page.route(`${API_URL}/plans/client-invoice-numbering`, (route) =>
    route.fulfill({ json: { prefix: "TAG/", nextNumber: 7, suggestion: "TAG/0007", defaultHsnSac: "998397", companyStateCode: "06" } })
  );
}

async function openInvoicePopup(page: Page) {
  await page.goto("/plans?maker=all");
  await page.getByRole("button", { name: "Generate invoice" }).click();
  return page.getByTestId("client-invoice-modal");
}

test.describe("Generate invoice popup — saved clients", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("a plan for a client invoiced before opens with that client's GST, address and phone already filled in, and posts them", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await mockPlansPage(page, [plan()], [NYKAA_MUMBAI, ZOMATO]);
    let posted: Record<string, unknown> | null = null;
    await page.route(`${API_URL}/plans/plan-1/client-invoice`, (route) => {
      posted = route.request().postDataJSON();
      return route.fulfill({ json: plan({ ...(posted as object), clientInvoiceNumber: "TAG/0007" }) });
    });
    await page.route(`${API_URL}/plans/plan-1/client-invoice.pdf`, (route) => route.fulfill({ status: 200, contentType: "application/pdf", body: Buffer.from("%PDF-1.4\n") }));

    const modal = await openInvoicePopup(page);

    await expect(modal.locator('input[name="clientCompany"]')).toHaveValue("FSN E-Commerce Ventures Ltd");
    await expect(modal.locator('input[name="clientGstNumber"]')).toHaveValue("27AABCF1234A1Z5");
    await expect(modal.locator('textarea[name="clientAddress"]')).toHaveValue("104 Vasan Udyog Bhavan, Mumbai");
    await expect(modal.locator('input[name="clientPhone"]')).toHaveValue("9876543210");
    await expect(modal.getByTestId("client-invoice-autofill-note")).toContainText("Filled in from FSN E-Commerce Ventures Ltd");
    // The filled GSTIN drives the same tax note a typed one would (27 ≠ our 06 → IGST).
    await expect(modal.getByTestId("client-invoice-tax-note")).toContainText("IGST 18%");

    await modal.locator('textarea[name="invoiceDescription"]').fill("Influencer marketing services");
    await modal.getByRole("button", { name: "Generate invoice" }).click();
    await expect(page.getByTestId("client-invoice-generated")).toBeVisible();
    expect(posted).toMatchObject({
      clientCompany: "FSN E-Commerce Ventures Ltd",
      clientGstNumber: "27AABCF1234A1Z5",
      clientAddress: "104 Vasan Udyog Bhavan, Mumbai",
      clientPhone: "+919876543210",
    });
  });

  test("the plan's own saved details always win — a saved client never overwrites them", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await mockPlansPage(page, [plan({ clientCompany: "Nykaa Fashion Pvt Ltd", clientGstNumber: "27ZZZZZ9999Z1Z9", clientAddress: "Lower Parel, Mumbai" })], [NYKAA_MUMBAI]);

    const modal = await openInvoicePopup(page);

    await expect(modal.locator('input[name="clientCompany"]')).toHaveValue("Nykaa Fashion Pvt Ltd");
    await expect(modal.locator('input[name="clientGstNumber"]')).toHaveValue("27ZZZZZ9999Z1Z9");
    await expect(modal.getByTestId("client-invoice-autofill-note")).toHaveCount(0);
  });

  test("one brand with two GST registrations isn't guessed — it asks, and picking from the Company name dropdown fills everything", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await mockPlansPage(page, [plan()], [ZOMATO, NYKAA_MUMBAI, NYKAA_BLR]);

    const modal = await openInvoicePopup(page);
    const company = modal.getByRole("combobox", { name: "Company name" });

    await expect(company).toHaveValue("");
    await expect(modal.getByTestId("client-invoice-autofill-note")).toContainText("Nykaa has 2 saved billing profiles");

    await company.click();
    const options = modal.getByRole("option");
    // This plan's own client first, then everyone else.
    await expect(options).toHaveCount(3);
    await expect(options.nth(0)).toContainText("27AABCF1234A1Z5");
    await expect(options.nth(1)).toContainText("29AABCF1234A1Z1");
    await expect(options.nth(2)).toContainText("Zomato Ltd");

    await options.nth(1).click();
    await expect(company).toHaveValue("FSN E-Commerce Ventures Ltd");
    await expect(modal.locator('input[name="clientGstNumber"]')).toHaveValue("29AABCF1234A1Z1");
    await expect(modal.locator('textarea[name="clientAddress"]')).toHaveValue("Koramangala, Bengaluru");
    await expect(modal.locator('input[name="clientPhone"]')).toHaveValue("");
    await expect(modal.getByRole("option")).toHaveCount(0);
  });

  test("typing filters the dropdown by company, client name or GSTIN; a brand-new company is still just typed; keyboard picks too", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await mockPlansPage(page, [plan({ clientName: "Brand New Client" })], [ZOMATO, NYKAA_MUMBAI, BARE]);

    const modal = await openInvoicePopup(page);
    const company = modal.getByRole("combobox", { name: "Company name" });
    // Nothing matches this plan's client, so nothing is filled in.
    await expect(company).toHaveValue("");
    await expect(modal.getByTestId("client-invoice-autofill-note")).toHaveCount(0);

    await company.fill("nyk"); // matches on the client name, not the company
    await expect(modal.getByRole("option")).toHaveCount(1);
    await expect(modal.getByRole("option")).toContainText("FSN E-Commerce Ventures Ltd");
    await company.fill("06AAD"); // …or the GSTIN
    await expect(modal.getByRole("option")).toContainText("Zomato Ltd");
    // A name with no billing details on file has nothing to fill, so it isn't offered here.
    await company.fill("swig");
    await expect(modal.getByRole("option")).toHaveCount(0);

    await company.fill("Totally New Pvt Ltd");
    await expect(modal.getByRole("option")).toHaveCount(0);
    await expect(company).toHaveValue("Totally New Pvt Ltd");
    await expect(modal.locator('input[name="clientGstNumber"]')).toHaveValue("");

    await company.fill("zom");
    await company.press("ArrowDown");
    await company.press("Enter");
    await expect(company).toHaveValue("Zomato Ltd");
    await expect(modal.locator('input[name="clientGstNumber"]')).toHaveValue("06AADCD4946L1ZB");
    // Enter picked the option — it didn't submit the half-filled form.
    await expect(modal).not.toContainText("is required.");
    await expect(modal.getByRole("heading", { name: "Generate invoice" })).toBeVisible();
  });

  test("no saved clients at all → the field behaves like the plain text box it used to be", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page); // GET /plans/clients → []
    await mockPlansPage(page, [plan()], []);

    const modal = await openInvoicePopup(page);
    const company = modal.getByRole("combobox", { name: "Company name" });
    await company.click();
    await company.fill("Acme Foods Pvt Ltd");
    await expect(modal.getByRole("option")).toHaveCount(0);
    await expect(modal.getByRole("listbox")).toHaveCount(0);
    await expect(company).toHaveValue("Acme Foods Pvt Ltd");
  });
});

test.describe("Plan wizard — Client name suggests saved clients", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("dropdown lists each saved client once; picking one says its billing details are on file; the picked name is what's posted", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await mockPlansPage(page, [], [NYKAA_MUMBAI, NYKAA_BLR, ZOMATO, BARE]);
    await page.route(`${API_URL}/assets`, (route) => route.fulfill({ json: [] }));
    let created: Record<string, unknown> | undefined;
    await page.route(`${API_URL}/plans`, (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      created = route.request().postDataJSON();
      return route.fulfill({ status: 201, json: plan({ ...created, status: "DRAFT", campaignId: null }) });
    });

    await page.goto("/plans?maker=all");
    await page.getByRole("button", { name: "New plan" }).click();
    const clientName = page.getByRole("combobox", { name: "Client name" });
    await clientName.click();
    // Two Nykaa billing profiles, one Nykaa suggestion.
    await expect(page.getByRole("option")).toHaveCount(3);
    await expect(page.getByRole("option").filter({ hasText: "Nykaa" })).toHaveCount(1);

    await clientName.fill("zo");
    await page.getByRole("option", { name: /Zomato/ }).click();
    await expect(clientName).toHaveValue("Zomato");
    await expect(page.getByTestId("plan-known-client-note")).toContainText("Zomato Ltd · 06AADCD4946L1ZB");

    await clientName.fill("nykaa"); // typed, any case — still recognised
    await expect(page.getByTestId("plan-known-client-note")).toContainText("2 billing profiles");
    await clientName.fill("Swiggy"); // known name, nothing on file yet
    await expect(page.getByTestId("plan-known-client-note")).toHaveCount(0);

    await clientName.fill("zo");
    await page.getByRole("option", { name: /Zomato/ }).click();
    await page.getByRole("textbox", { name: "Plan name" }).fill("Zomato Q4");
    await page.getByRole("textbox", { name: "Brief" }).fill("Festive push");
    await page.getByRole("button", { name: "Next: Budget & pages" }).click();
    await expect.poll(() => created).toMatchObject({ name: "Zomato Q4", clientName: "Zomato" });
  });

  test("pressing Enter on a freshly typed new client doesn't swap in a suggestion", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await mockPlansPage(page, [], [ZOMATO]);

    await page.goto("/plans?maker=all");
    await page.getByRole("button", { name: "New plan" }).click();
    const clientName = page.getByRole("combobox", { name: "Client name" });
    await clientName.fill("Zo");
    await expect(page.getByRole("option")).toHaveCount(1);
    await clientName.press("Enter");
    await expect(clientName).toHaveValue("Zo");
  });
});
