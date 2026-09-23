import { test, expect, type Page } from "@playwright/test";

import { signIn, mockApi, API_URL } from "./fixtures";

/**
 * The plan wizard, reshaped per the user request of 14 Sep, GST moved 23 Sep:
 *  - Step 1 "Client & brief": no GST, no budget; the brief is mandatory.
 *  - Step 2 "Budget & pages": budget first, then pages within it (hard cap),
 *    page names link to Instagram, posts per page → phases hint.
 *  - Step 3 "Pricing": impressions + read-only internal cost per page; the
 *    *overall* client total and expected impressions are the editable numbers
 *    (overrideCost/overrideImpressions — "not single page", 14 Sep), plus GST %
 *    (user request, 23 Sep — "gst input will be filled on pricing section",
 *    moved off Step 1) with a live GST amount / total-incl.-GST preview. No margin %.
 *  - Step 4 "Preview & sheet": preview (one flat page list, not per category),
 *    generate sheets, and "Add another plan" (Plan B, C… — 23 Sep) — no
 *    client details, no execution sheet.
 * Server side (hard cap, mandatory brief, reel/story, phases on approval) is
 * covered by vitest in server/src/modules/plans.
 */
function mockPlan(overrides: Record<string, unknown> = {}) {
  return {
    id: "plan-1",
    name: "Q1 Push",
    clientName: "Acme",
    clientContact: null,
    clientCompany: null,
    clientGstNumber: null,
    clientAddress: null,
    clientPhone: null,
    clientInvoiceNumber: null,
    clientInvoiceAt: null,
    notes: "Launch week push",
    budget: null,
    gstPercent: null,
    isGstPlan: false,
    status: "DRAFT",
    approvedBy: null,
    approvedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
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

const asset = (id: string, handle: string, followers: number, reel: number, story: number, avgViews = 0) => ({
  id,
  ownerId: "owner-1",
  platform: "instagram",
  handle,
  followers,
  category: "Meme page",
  approvalStatus: "approved",
  createdAt: "2026-01-01T00:00:00.000Z",
  rateCards: [
    { format: "reel", amount: String(reel) },
    { format: "story", amount: String(story) },
  ],
  engagement: { avgLikes: null, avgComments: null, avgViews, sampleSize: 0 },
});

async function mockPlanRoutes(page: Page, { assets = [] as unknown[] } = {}) {
  await page.route(`${API_URL}/plans`, (route) => {
    if (route.request().method() === "POST") return route.fulfill({ status: 201, json: mockPlan(route.request().postDataJSON()) });
    return route.fulfill({ json: [] });
  });
  await page.route(`${API_URL}/plans/plan-1`, (route) => {
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON();
      return route.fulfill({ json: mockPlan(body) });
    }
    return route.fulfill({ json: mockPlan() });
  });
  await page.route(`${API_URL}/assets`, (route) => route.fulfill({ json: assets }));
}

async function fillStep1(page: Page) {
  await page.goto("/plans?maker=all");
  await page.getByRole("button", { name: "New plan" }).click();
  await page.getByRole("textbox", { name: "Plan name" }).fill("Q1 Push");
  await page.getByRole("combobox", { name: "Client name" }).fill("Acme");
  await page.getByRole("textbox", { name: "Brief" }).fill("Launch week push");
  await page.getByRole("button", { name: "Next: Budget & pages" }).click();
}

test.describe("Plan wizard — Step 1 (Client & brief)", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("no budget, no client details, no GST field; the brief is what makes Next enabled", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await mockPlanRoutes(page);
    let created: Record<string, unknown> | undefined;
    await page.route(`${API_URL}/plans`, (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      created = route.request().postDataJSON();
      return route.fulfill({ status: 201, json: mockPlan(created) });
    });

    await page.goto("/plans?maker=all");
    await page.getByRole("button", { name: "New plan" }).click();
    await expect(page.getByRole("heading", { name: "New plan" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Budget" })).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "Company name" })).toHaveCount(0);
    // GST moved to Step 3 (23 Sep) — not on this step at all.
    await expect(page.getByRole("textbox", { name: "GST percent" })).toHaveCount(0);

    const next = page.getByRole("button", { name: "Next: Budget & pages" });
    await page.getByRole("textbox", { name: "Plan name" }).fill("Q1 Push");
    await page.getByRole("combobox", { name: "Client name" }).fill("Acme");
    await expect(next).toBeDisabled(); // brief still empty
    await page.getByRole("textbox", { name: "Brief" }).fill("  Launch week push ");
    await expect(next).toBeEnabled();
    await next.click();

    await expect.poll(() => created).toMatchObject({ name: "Q1 Push", clientName: "Acme", notes: "Launch week push" });
    expect(created).not.toHaveProperty("gstPercent");
    expect(created).not.toHaveProperty("budget");
    await expect(page.getByTestId("budget-card")).toBeVisible();
  });
});

test.describe("Plan wizard — Step 2 (Budget & pages) hard cap", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("the budget field is labelled 'Internal budget' (23 Sep — it was always our own cost cap, never the client's)", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await mockPlanRoutes(page);

    await fillStep1(page);

    await expect(page.getByText("Internal budget", { exact: true })).toBeVisible();
    await expect(page.getByText("Client budget")).toHaveCount(0);
  });

  test("pages can't be picked until a budget is set, then only up to it; the budget-left bar and Next follow", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await mockPlanRoutes(page, { assets: [asset("a1", "big.page", 900000, 8000, 3000), asset("a2", "mid.page", 400000, 5000, 2000), asset("a3", "small.page", 100000, 1500, 500)] });
    let saved: Record<string, unknown> | undefined;
    await page.route(`${API_URL}/plans/plan-1`, (route) => {
      if (route.request().method() !== "PUT") return route.fallback();
      saved = route.request().postDataJSON();
      return route.fulfill({ json: mockPlan(saved) });
    });

    await fillStep1(page);
    const next = page.getByRole("button", { name: "Next: Pricing" });
    await expect(next).toBeDisabled();
    await expect(page.getByText("Enter a budget to start picking pages.")).toBeVisible();
    await expect(page.getByLabel("Select @big.page")).toBeDisabled();

    await page.getByRole("textbox", { name: "Budget" }).fill("10000");
    await expect(page.getByTestId("budget-left")).toContainText("₹10,000");
    // 8,000 fits; then only 2,000 is left — mid.page (5,000) no longer does, small.page (1,500) still does.
    await page.getByLabel("Select @big.page").check();
    await expect(page.getByTestId("budget-left")).toContainText("Budget left");
    await expect(page.getByTestId("budget-left")).toContainText("₹2,000");
    await expect(page.getByLabel("Select @mid.page")).toBeDisabled();
    await page.getByLabel("Select @small.page").check();
    await expect(page.getByTestId("budget-left")).toContainText("₹500");

    // Raising posts past the budget is refused with a message; the value stays put.
    await page.getByLabel("Posts for @big.page").fill("2");
    await expect(page.getByTestId("budget-cap-message")).toContainText("over the ₹500 left");
    await expect(page.getByLabel("Posts for @big.page")).toHaveValue("1");
    await expect(next).toBeEnabled();

    // Lowering the budget below what's picked blocks Next until it fits again.
    await page.getByRole("textbox", { name: "Budget" }).fill("9000");
    await expect(page.getByTestId("budget-left")).toContainText("Over budget by");
    await expect(next).toBeDisabled();
    await page.getByRole("textbox", { name: "Budget" }).fill("12000");
    await expect(next).toBeEnabled();

    // Page names open Instagram.
    await expect(page.getByRole("link", { name: "@big.page" })).toHaveAttribute("href", "https://www.instagram.com/big.page/");
    await expect(page.getByRole("link", { name: "@big.page" })).toHaveAttribute("target", "_blank");

    await next.click();
    await expect.poll(() => saved).toMatchObject({ budget: 12000 });
    expect((saved?.items as unknown[]).map((i) => (i as { assetId: string }).assetId)).toEqual(["a1", "a3"]);
  });

  test("format offers reel and story only; more than one post per page shows the phases hint", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await mockPlanRoutes(page, { assets: [asset("a1", "big.page", 900000, 1000, 500)] });

    await fillStep1(page);
    await page.getByRole("textbox", { name: "Budget" }).fill("50000");
    await page.getByLabel("Select @big.page").check();
    const format = page.getByLabel("Format for @big.page");
    await expect(format.locator("option")).toHaveText(["reel", "story"]);
    await page.getByLabel("Posts for @big.page").fill("3");
    await expect(page.getByText(/creators will see this as 3 campaigns \(Phase 1 to 3\)/)).toBeVisible();
  });
});

test.describe("Plan wizard — Step 3 (Pricing) and Step 4 (Preview & sheet)", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("pricing: per-page internal cost is read-only, no per-page client price; overall total cost + impressions are editable and saved as overrides; a quoted total above the budget is allowed", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await mockPlanRoutes(page, { assets: [asset("a1", "big.page", 900000, 8000, 3000, 250000), asset("a2", "small.page", 100000, 1000, 500, 20000)] });
    let saved: Record<string, unknown> | undefined;
    await page.route(`${API_URL}/plans/plan-1`, (route) => {
      if (route.request().method() !== "PUT") return route.fallback();
      saved = route.request().postDataJSON();
      return route.fulfill({
        json: mockPlan({
          ...saved,
          items: [
            { assetId: "a1", format: "reel", cost: "8000", clientCost: null, postsPerProfile: 1, asset: { handle: "big.page", followers: 900000, category: "Meme page" } },
            { assetId: "a2", format: "reel", cost: "1000", clientCost: null, postsPerProfile: 1, asset: { handle: "small.page", followers: 100000, category: "News" } },
          ],
          overview: { totalFollowers: 1000000, totalPosts: 2, expectedImpressions: 300000, subtotal: 9500, gstAmount: 0, total: 9500 },
        }),
      });
    });

    await fillStep1(page);
    await page.getByRole("textbox", { name: "Budget" }).fill("10000");
    await page.getByLabel("Select @big.page").check();
    await page.getByLabel("Select @small.page").check();
    await page.getByRole("button", { name: "Next: Pricing" }).click();

    const table = page.getByTestId("price-table");
    await expect(table.getByRole("columnheader", { name: "Exp. impressions" })).toBeVisible();
    await expect(table.getByRole("columnheader", { name: "Internal cost" })).toBeVisible();
    await expect(table.getByRole("columnheader", { name: "Client price" })).toHaveCount(0);
    await expect(table.getByRole("columnheader", { name: "Margin" })).toHaveCount(0);
    await expect(table.locator("input")).toHaveCount(0); // nothing per-page is editable
    await expect(table.getByText("2.5L")).toBeVisible(); // 250,000 avg views × 1 post, lakh-formatted
    await expect(page.getByTestId("internal-cost-a1")).toContainText("₹8,000");

    // Overall numbers: computed by default (8000 + 1000; 250k + 20k views).
    const totals = page.getByTestId("price-totals");
    await expect(totals).toContainText("computed ₹9,000");
    await expect(totals).toContainText("computed 2.7L");
    const totalCost = page.getByLabel("Total cost to client");
    const impressions = page.getByLabel("Expected impressions");
    await expect(totalCost).toHaveAttribute("placeholder", "9,000");
    await expect(impressions).toHaveAttribute("placeholder", "2,70,000");

    const next = page.getByRole("button", { name: "Next: Preview" });
    await totalCost.fill("12000"); // above the 10,000 budget — that's a markup, not an error
    await expect(totals).not.toContainText("Over budget by");
    await expect(totals).toContainText("Margin");
    await expect(totals).toContainText("₹3,000"); // 12,000 quoted − 9,000 pages
    await expect(next).toBeEnabled();
    await totalCost.fill("5000");
    await expect(page.getByTestId("override-below-computed")).toContainText("₹9,000"); // warns, doesn't block
    await expect(next).toBeEnabled();
    await totalCost.fill("9500");
    await expect(page.getByTestId("override-below-computed")).toHaveCount(0);
    await expect(totals).toContainText("₹1,000"); // budget left is about the pages (9,000 of 10,000), not the quote
    await impressions.fill("300000");
    await expect(page.getByText("Using the impressions you entered.")).toBeVisible();
    await next.click();
    await expect.poll(() => saved).toBeTruthy();
    expect(saved?.overrideCost).toBe(9500);
    expect(saved?.overrideImpressions).toBe(300000);
    expect((saved?.items as { clientCost?: number }[]).every((i) => !("clientCost" in i))).toBe(true); // no per-page client price is ever sent

    // Step 4 — preview + generate only; pages in one flat list, not per category.
    await expect(page.getByText(/Overview of Q1 Push/)).toBeVisible();
    await expect(page.getByText("3,00,000 (est.)")).toBeVisible(); // the overridden impressions
    const preview = page.getByTestId("preview-pages");
    await expect(preview.locator("tbody tr")).toHaveCount(2);
    await expect(preview.locator("thead")).toHaveCount(1);
    await expect(preview).not.toContainText("Meme page");
    await expect(preview).not.toContainText("News");
    await expect(preview.locator("tbody tr").nth(1)).toContainText("2"); // S No keeps counting
    await expect(page.getByText("Client-facing overview")).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: /company name/i })).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: /GST number/i })).toHaveCount(0);
    await expect(page.getByText("Execution sheet")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Add another plan" })).toBeVisible(); // Plan B, C… (23 Sep)
    await expect(page.getByText("Client sheet").locator("..").getByRole("button", { name: "Generate" })).toBeVisible();
  });

  test("Budget shows in the Internal section, above Our cost — not under Client side (23 Sep)", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await mockPlanRoutes(page, { assets: [asset("a1", "big.page", 900000, 8000, 3000)] });

    await fillStep1(page);
    await page.getByRole("textbox", { name: "Budget" }).fill("10000");
    await page.getByLabel("Select @big.page").check();
    await page.getByRole("button", { name: "Next: Pricing" }).click();

    const text = (await page.getByTestId("price-totals").innerText()).replace(/\s+/g, " ");
    const clientSideIdx = text.indexOf("Client side");
    const internalIdx = text.indexOf("Internal");
    const budgetIdx = text.indexOf("Budget");
    const ourCostIdx = text.indexOf("Our cost");

    expect(clientSideIdx).toBeGreaterThanOrEqual(0);
    expect(internalIdx).toBeGreaterThan(clientSideIdx);
    expect(budgetIdx).toBeGreaterThan(internalIdx); // after the "Internal" heading, not under "Client side"
    expect(budgetIdx).toBeLessThan(ourCostIdx); // and right above "Our cost"
    expect(text).toContain("₹10,000"); // the budget value itself
  });

  test("GST %: lives on Step 3, previews the GST amount and total live, and is saved with the pricing", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await mockPlanRoutes(page, { assets: [asset("a1", "big.page", 900000, 8000, 3000, 250000)] });
    let saved: Record<string, unknown> | undefined;
    await page.route(`${API_URL}/plans/plan-1`, (route) => {
      if (route.request().method() !== "PUT") return route.fallback();
      saved = route.request().postDataJSON();
      return route.fulfill({ json: mockPlan({ ...saved, items: [{ assetId: "a1", format: "reel", cost: "8000", clientCost: null, postsPerProfile: 1, asset: { handle: "big.page", followers: 900000, category: "Meme page" } }] }) });
    });

    await fillStep1(page);
    await page.getByRole("textbox", { name: "Budget" }).fill("10000");
    await page.getByLabel("Select @big.page").check();
    await page.getByRole("button", { name: "Next: Pricing" }).click();

    const totals = page.getByTestId("price-totals");
    const gst = page.getByLabel("GST percent");
    await expect(gst).toBeVisible();
    // No GST line until a percent is entered.
    await expect(totals).not.toContainText("Total incl. GST");

    await gst.fill("18");
    // Quoted (computed) is ₹8,000 → 18% = ₹1,440, total ₹9,440.
    await expect(totals).toContainText("GST (18%)");
    await expect(totals).toContainText("₹1,440");
    await expect(totals).toContainText("Total incl. GST");
    await expect(totals).toContainText("₹9,440");

    await page.getByRole("button", { name: "Next: Preview" }).click();
    await expect.poll(() => saved).toBeTruthy();
    expect(saved?.gstPercent).toBe(18);
  });

    test("a saved override is loaded back into the fields and blank sends null (clears it)", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await mockPlanRoutes(page, { assets: [asset("a1", "big.page", 900000, 8000, 3000, 250000)] });
    let saved: Record<string, unknown> | undefined;
    await page.route(`${API_URL}/plans/plan-1`, (route) => {
      if (route.request().method() !== "PUT") return route.fallback();
      saved = route.request().postDataJSON();
      return route.fulfill({ json: mockPlan({ ...withOverride, ...saved, items: withOverride.items }) });
    });
    const withOverride = mockPlan({
      budget: 10000,
      overrideCost: "9500.00",
      overrideImpressions: 300000,
      gstPercent: 12,
      // A legacy per-page markup (clientCost) is ignored and wiped on save.
      items: [{ assetId: "a1", format: "reel", cost: "8000", clientCost: "8800", postsPerProfile: 1, asset: { handle: "big.page", followers: 900000, category: "Meme page" } }],
    });
    await page.route(`${API_URL}/plans`, (route) => (route.request().method() === "GET" ? route.fulfill({ json: [withOverride] }) : route.fallback()));

    await page.goto("/plans?maker=all");
    await page.getByRole("button", { name: "Edit Q1 Push" }).click();
    await page.getByRole("button", { name: "Next: Budget & pages" }).click();
    await page.getByRole("button", { name: "Next: Pricing" }).click();
    await expect(page.getByLabel("Total cost to client")).toHaveValue("9,500");
    await expect(page.getByLabel("Expected impressions")).toHaveValue("300000");
    await expect(page.getByLabel("GST percent")).toHaveValue("12");
    await expect(page.getByTestId("price-totals")).toContainText("computed ₹8,000"); // the line's cost, not its legacy clientCost
    await page.getByLabel("Total cost to client").fill("");
    await page.getByLabel("GST percent").fill("");
    await page.getByRole("button", { name: "Next: Preview" }).click();
    await expect.poll(() => saved).toBeTruthy();
    expect(saved?.overrideCost).toBeNull();
    expect(saved?.overrideImpressions).toBe(300000);
    expect(saved?.gstPercent).toBeNull();
    expect((saved?.items as Record<string, unknown>[])[0]).not.toHaveProperty("clientCost");
  });

  test("Add another plan (23 Sep): creates Plan B, reopens at Budget & pages with an empty budget/pages, and saves onto the new plan", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await mockPlanRoutes(page, { assets: [asset("a1", "big.page", 900000, 8000, 3000)] });
    const planB = mockPlan({ id: "plan-2", variantLabel: "Plan B", pitchGroupId: "plan-1", gstPercent: 18, budget: null, items: [] });
    let variantCalled = false;
    await page.route(`${API_URL}/plans/plan-1/variant`, (route) => {
      variantCalled = true;
      return route.fulfill({ status: 201, json: planB });
    });
    let savedB: Record<string, unknown> | undefined;
    await page.route(`${API_URL}/plans/plan-2`, (route) => {
      if (route.request().method() !== "PUT") return route.fallback();
      savedB = route.request().postDataJSON();
      return route.fulfill({ json: { ...planB, ...savedB, items: [] } });
    });

    await fillStep1(page);
    await page.getByRole("textbox", { name: "Budget" }).fill("10000");
    await page.getByLabel("Select @big.page").check();
    await page.getByRole("button", { name: "Next: Pricing" }).click();
    await page.getByRole("button", { name: "Next: Preview" }).click();

    await page.getByRole("button", { name: "Add another plan" }).click();
    await expect.poll(() => variantCalled).toBe(true);

    // Straight to Step 2 of Plan B — client details carried over, budget/pages fresh.
    await expect(page.getByRole("heading", { name: "Q1 Push · Plan B" })).toBeVisible();
    await expect(page.getByTestId("budget-card")).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Budget" })).toHaveValue("");
    await expect(page.getByLabel("Select @big.page")).not.toBeChecked();

    await page.getByRole("textbox", { name: "Budget" }).fill("20000");
    await page.getByLabel("Select @big.page").check();
    await page.getByRole("button", { name: "Next: Pricing" }).click();
    await expect.poll(() => savedB).toBeTruthy();
    expect(savedB?.budget).toBe(20000);
    expect(savedB?.gstPercent).toBe(18); // carried over from Plan A
  });

  test("Generate shows the sheet link; a server error shows inline", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await mockPlanRoutes(page, { assets: [asset("a1", "big.page", 900000, 8000, 3000)] });
    const sheetUrl = "https://docs.google.com/spreadsheets/d/sheet-1/edit?gid=999#gid=999";
    let generated = false;
    await page.route(`${API_URL}/plans/plan-1/sheet*`, (route) => {
      if (route.request().url().includes("variant=internal")) {
        return route.fulfill({ status: 503, json: { error: { code: "SHEETS_NOT_CONFIGURED", message: "Google Sheets export isn't configured yet." } } });
      }
      generated = true;
      return route.fulfill({ json: { spreadsheetUrl: sheetUrl } });
    });
    await page.route(`${API_URL}/plans/plan-1`, (route) => {
      if (route.request().method() === "GET") return route.fulfill({ json: mockPlan({ budget: 10000, clientSheetUrl: generated ? sheetUrl : null }) });
      return route.fallback();
    });

    await fillStep1(page);
    await page.getByRole("textbox", { name: "Budget" }).fill("10000");
    await page.getByLabel("Select @big.page").check();
    await page.getByRole("button", { name: "Next: Pricing" }).click();
    await page.getByRole("button", { name: "Next: Preview" }).click();

    await page.getByText("Client sheet").locator("..").getByRole("button", { name: "Generate" }).click();
    await expect(page.getByRole("link", { name: "Open sheet ↗" })).toHaveAttribute("href", sheetUrl);
    await page.getByText("Internal sheet").locator("..").getByRole("button", { name: "Generate" }).click();
    await expect(page.getByText("Google Sheets export isn't configured yet.")).toBeVisible();
  });
});
