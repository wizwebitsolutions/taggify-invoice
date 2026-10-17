import { test, expect, type Page } from "@playwright/test";

import { signIn, mockApi, API_URL, addPlanFormat } from "./fixtures";

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

test.describe("Plan wizard — Step 2 (Budget & pages) budget", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("the budget field is labelled 'Internal budget' (23 Sep — it was always our own cost cap, never the client's)", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await mockPlanRoutes(page);

    await fillStep1(page);

    await expect(page.getByText("Internal budget", { exact: true })).toBeVisible();
    await expect(page.getByText("Client budget")).toHaveCount(0);
  });

  // 14 Sep – 16 Oct the budget was a hard cap. 16 Oct: "chaahe budget 3.5 lac ho jae pr add hone chahie pages" — over budget warns, never blocks.
  test("pages can't be picked until a budget is set, then freely — going over the budget warns but never blocks (16 Oct)", async ({ page }) => {
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
    // 8,000 of 10,000 — 2,000 left. mid.page (5,000) stays pickable even though it wouldn't fit.
    await page.getByLabel("Select @big.page").check();
    await expect(page.getByTestId("budget-left")).toContainText("Budget left");
    await expect(page.getByTestId("budget-left")).toContainText("₹2,000");
    await expect(page.getByLabel("Select @mid.page")).toBeEnabled();
    await page.getByLabel("Select @small.page").check();
    await expect(page.getByTestId("budget-left")).toContainText("₹500");

    // Raising posts past the budget is allowed: the value sticks, the bar turns to "Over budget by", a warning says by how much, Next stays enabled.
    await page.getByLabel("Reel posts for @big.page").fill("2");
    await expect(page.getByLabel("Reel posts for @big.page")).toHaveValue("2");
    await expect(page.getByTestId("budget-left")).toContainText("Over budget by");
    await expect(page.getByTestId("over-budget-warning")).toContainText("Over budget by ₹7,500");
    await expect(next).toBeEnabled();
    await page.getByLabel("Reel posts for @big.page").fill("1");
    await expect(page.getByTestId("over-budget-warning")).toHaveCount(0);

    // Lowering the budget below what's picked warns too, and still doesn't block Next.
    await page.getByRole("textbox", { name: "Budget" }).fill("9000");
    await expect(page.getByTestId("budget-left")).toContainText("Over budget by");
    await expect(page.getByTestId("over-budget-warning")).toBeVisible();
    await expect(next).toBeEnabled();
    await page.getByRole("textbox", { name: "Budget" }).fill("12000");
    await expect(page.getByTestId("over-budget-warning")).toHaveCount(0);
    await expect(next).toBeEnabled();

    // Page names open Instagram.
    await expect(page.getByRole("link", { name: "@big.page" })).toHaveAttribute("href", "https://www.instagram.com/big.page/");
    await expect(page.getByRole("link", { name: "@big.page" })).toHaveAttribute("target", "_blank");

    await next.click();
    await expect.poll(() => saved).toMatchObject({ budget: 12000 });
    expect((saved?.items as unknown[]).map((i) => (i as { assetId: string }).assetId)).toEqual(["a1", "a3"]);
  });

  test("a page can have a reel and a story from the format dropdown, each with its own posts; more than one post shows the phases hint (8 Oct, dropdown 14 Oct)", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await mockPlanRoutes(page, { assets: [asset("a1", "big.page", 900000, 1000, 500)] });
    let saved: Record<string, unknown> | undefined;
    await page.route(`${API_URL}/plans/plan-1`, (route) => {
      if (route.request().method() !== "PUT") return route.fallback();
      saved = route.request().postDataJSON();
      return route.fulfill({ json: mockPlan(saved) });
    });

    await fillStep1(page);
    await page.getByRole("textbox", { name: "Budget" }).fill("50000");
    await page.getByLabel("Select @big.page").check();
    // The page starts with its first priced format (Reel) as a line; the select offers the other nine (16 Oct),
    // each with the page's rate or "no rate".
    const adder = page.getByTestId("plan-add-format-a1");
    await expect(page.getByTestId("plan-line-a1-reel")).toBeVisible();
    await expect(adder.locator("option")).toHaveCount(10); // placeholder + nine
    await expect(adder).toContainText("Repost + Story · no rate");
    await expect(adder.locator("option", { hasText: /^Reel ·/ })).toHaveCount(0);
    await addPlanFormat(page, "a1", "story");
    await expect(page.getByTestId("plan-line-a1-story")).toBeVisible();

    await page.getByLabel("Story posts for @big.page").fill("2");
    await page.getByLabel("Reel posts for @big.page").fill("3");
    await expect(page.getByText(/creators will see this as 3 campaigns \(Phase 1 to 3\)/)).toBeVisible();
    // Row total: 3 × 1,000 + 2 × 500.
    await expect(page.getByTestId("plan-row-total-a1")).toHaveText("₹4,000");
    // The last format can't be removed; unticking the page removes it.
    await page.getByRole("button", { name: "Remove Story for @big.page" }).click();
    await page.getByRole("button", { name: "Remove Reel for @big.page" }).click();
    await expect(page.getByTestId("budget-cap-message")).toContainText("needs at least one format");
    await expect(page.getByTestId("plan-line-a1-reel")).toBeVisible();
    await addPlanFormat(page, "a1", "story");
    await page.getByLabel("Story posts for @big.page").fill("2");

    await page.getByRole("button", { name: /Next/ }).click();
    await expect.poll(() => saved?.items).toEqual([
      { assetId: "a1", format: "reel", postsPerProfile: 3 },
      { assetId: "a1", format: "story", postsPerProfile: 2 },
    ]);
  });

  test("picked formats sit side by side in one row, each with its posts and cost; an unpriced one blocks Next until its cost is typed (14 Oct)", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await mockPlanRoutes(page, { assets: [asset("a1", "big.page", 900000, 1000, 500)] });
    let saved: Record<string, unknown> | undefined;
    await page.route(`${API_URL}/plans/plan-1`, (route) => {
      if (route.request().method() !== "PUT") return route.fallback();
      saved = route.request().postDataJSON();
      return route.fulfill({ json: mockPlan(saved) });
    });

    await fillStep1(page);
    await page.getByRole("textbox", { name: "Budget" }).fill("50000");
    await page.getByLabel("Select @big.page").check();
    await addPlanFormat(page, "a1", "story");
    await addPlanFormat(page, "a1", "pr");
    await addPlanFormat(page, "a1", "entertainment");
    await expect(page.getByTestId("plan-add-format-a1")).toContainText("4 picked");

    // Four lines, stacked (16 Oct), in the app's format order.
    const groups = page.getByTestId("plan-lines-a1").locator(":scope > div");
    await expect(groups).toHaveCount(4);
    const texts = await groups.allTextContents();
    expect(texts.map((t) => t.split("×")[0].trim())).toEqual(["Reel", "Entertainment / Brand", "PR", "Story"]);
    const tops = await Promise.all((await groups.all()).map(async (g) => Math.round((await g.boundingBox())!.y)));
    expect(new Set(tops).size).toBe(1);
    for (const f of ["Reel", "Entertainment / Brand", "PR", "Story"]) {
      await expect(page.getByLabel(`${f} posts for @big.page`)).toBeVisible();
      await expect(page.getByLabel(`${f} cost for @big.page`)).toBeVisible();
    }

    // PR and Entertainment / Brand have no rate: Next waits for their costs.
    const next = page.getByRole("button", { name: "Next: Pricing" });
    await expect(next).toBeDisabled();
    await page.getByLabel("PR cost for @big.page").fill("4000");
    await page.getByLabel("Entertainment / Brand cost for @big.page").fill("6000");
    await page.getByLabel("PR posts for @big.page").fill("2");
    await expect(page.getByTestId("plan-row-total-a1")).toHaveText("₹15,500"); // 1,000 + 6,000 + 2 × 4,000 + 500
    await expect(next).toBeEnabled();
    await next.click();
    await expect.poll(() => saved?.items).toEqual([
      { assetId: "a1", format: "reel", postsPerProfile: 1 },
      { assetId: "a1", format: "story", postsPerProfile: 1 },
      { assetId: "a1", format: "pr", cost: 4000, postsPerProfile: 2 },
      { assetId: "a1", format: "entertainment", cost: 6000, postsPerProfile: 1 },
    ]);
  });

  test("a Reel + Story combo line shows its split, counts as two posts and saves as reel_story (14 Oct)", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    const combo = {
      ...asset("a1", "big.page", 900000, 20000, 15000, 1000),
      rateCards: [
        { format: "reel", amount: "20000" },
        { format: "story", amount: "15000" },
        { format: "post", amount: "9000" },
        { format: "reel_story", amount: "30000" },
      ],
    };
    await mockPlanRoutes(page, { assets: [combo] });
    let saved: Record<string, unknown> | undefined;
    await page.route(`${API_URL}/plans/plan-1`, (route) => {
      if (route.request().method() !== "PUT") return route.fallback();
      saved = route.request().postDataJSON();
      return route.fulfill({ json: mockPlan(saved) });
    });

    await fillStep1(page);
    await page.getByRole("textbox", { name: "Budget" }).fill("100000");
    await page.getByLabel("Select @big.page").check();
    // The select lists every format not yet on the page, with its rate or "no rate" (Reel is already a line).
    await expect(page.getByTestId("plan-add-format-a1").locator("option")).toHaveText([
      /Add format/,
      "Entertainment / Brand · no rate",
      "PR · no rate",
      "Political · no rate",
      "Static & Carousel · ₹9,000",
      "Repost · no rate",
      "Story · ₹15,000",
      "Political Story · no rate",
      "Reel + Story · ₹30,000",
      "Repost + Story · no rate",
    ]);
    await addPlanFormat(page, "a1", "reel_story");
    await page.getByRole("button", { name: "Remove Reel for @big.page" }).click();
    // ₹30,000 split by the reel/story rates (20k : 15k) in paise — halves add up exactly.
    await expect(page.getByTestId("combo-split-a1-reel_story")).toHaveText("Reel ₹17,142.85 + Story ₹12,857.15 each");

    await page.getByRole("button", { name: /Next/ }).click();
    await expect.poll(() => saved?.items).toEqual([{ assetId: "a1", format: "reel_story", postsPerProfile: 1 }]);
    // Pricing: one combo is two posts, with its split beside it.
    await expect(page.getByTestId("price-table")).toContainText("Reel + Story · 2 posts · Reel ₹17,142.85 + Story ₹12,857.15");
  });

  test("a Repost + Story combo splits by the repost/story rates, or in half without them (14 Oct)", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    const pageWithRepost = {
      ...asset("a1", "big.page", 900000, 20000, 3000, 1000),
      rateCards: [
        { format: "reel", amount: "20000" },
        { format: "story", amount: "3000" },
        { format: "repost", amount: "7000" },
        { format: "repost_story", amount: "9000" },
      ],
    };
    const noRepostRate = { ...asset("a2", "small.page", 100000, 1000, 500), rateCards: [{ format: "reel", amount: "1000" }, { format: "story", amount: "500" }] };
    await mockPlanRoutes(page, { assets: [pageWithRepost, noRepostRate] });
    let saved: Record<string, unknown> | undefined;
    await page.route(`${API_URL}/plans/plan-1`, (route) => {
      if (route.request().method() !== "PUT") return route.fallback();
      saved = route.request().postDataJSON();
      return route.fulfill({ json: mockPlan(saved) });
    });

    await fillStep1(page);
    await page.getByRole("textbox", { name: "Budget" }).fill("100000");
    await page.getByLabel("Select @big.page").check();
    await addPlanFormat(page, "a1", "repost_story");
    // ₹9,000 × 7,000 / (7,000 + 3,000) = ₹6,300 repost, ₹2,700 story.
    await expect(page.getByTestId("combo-split-a1-repost_story")).toHaveText("Repost ₹6,300 + Story ₹2,700 each");

    // No repost rate on the page: the typed price splits in half (paise remainder to the story).
    await page.getByLabel("Select @small.page").check();
    await addPlanFormat(page, "a2", "repost_story");
    await expect(page.getByTestId("combo-split-a2-repost_story")).toHaveCount(0);
    await page.getByLabel("Repost + Story cost for @small.page").fill("1001");
    await expect(page.getByTestId("combo-split-a2-repost_story")).toHaveText("Repost ₹500.5 + Story ₹500.5 each");

    await page.getByRole("button", { name: /Next/ }).click();
    await expect.poll(() => saved?.items).toEqual([
      { assetId: "a1", format: "reel", postsPerProfile: 1 },
      { assetId: "a1", format: "repost_story", postsPerProfile: 1 },
      { assetId: "a2", format: "reel", postsPerProfile: 1 },
      { assetId: "a2", format: "repost_story", cost: 1001, postsPerProfile: 1 },
    ]);
    await expect(page.getByTestId("price-table")).toContainText("Repost + Story · 2 posts · Repost ₹6,300 + Story ₹2,700");
  });

  test("an inactive page isn't offered when picking pages (8 Oct)", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await mockPlanRoutes(page, { assets: [asset("a1", "big.page", 900000, 1000, 500), { ...asset("a2", "off.page", 500000, 1000, 500), isActive: false }] });
    await fillStep1(page);
    await expect(page.getByLabel("Select @big.page")).toBeVisible();
    await expect(page.getByLabel("Select @off.page")).toHaveCount(0);
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
    await expect(table.getByRole("columnheader", { name: "Our cost" })).toBeVisible();
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

    // Step 4 — preview + generate. Since 8 Oct the preview follows the plan's sheet
    // format (Category breakdown by default) and lists pages per category, like the sheet's tabs.
    await expect(page.getByText(/<> Taggify · Category breakdown/)).toBeVisible();
    await expect(page.getByTestId("preview-breakdown")).toContainText("Meme Pages");
    await expect(page.getByTestId("preview-breakdown")).toContainText("News Pages");
    const preview = page.getByTestId("preview-pages");
    await expect(preview.locator("tbody tr")).toHaveCount(2);
    await expect(preview).toContainText("Meme Pages");
    await expect(preview).toContainText("News Pages");
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

    // "Generate" on the client sheet asks which format first (16 Oct), then generates.
    await page.getByTestId("generate-client-sheet").click();
    await page.getByTestId("sheet-format-confirm").click();
    await expect(page.getByRole("link", { name: "Open sheet ↗" })).toHaveAttribute("href", sheetUrl);
    await page.getByText("Internal sheet").locator("..").getByRole("button", { name: "Generate" }).click();
    await expect(page.getByText("Google Sheets export isn't configured yet.")).toBeVisible();
  });

  // 8 Oct the format was a picker on the step itself; 16 Oct it moved into the popup "Generate" (client sheet) opens.
  test("Step 4: 'Generate' on the client sheet asks which format first; the pick travels with the generate call and the preview follows it (16 Oct)", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await mockPlanRoutes(page, { assets: [asset("a1", "big.page", 900000, 8000, 3000, 250000)] });
    const formats: unknown[] = [];
    let format = "breakdown";
    await page.route(`${API_URL}/plans/plan-1/sheet*`, (route) => {
      const picked = route.request().postDataJSON()?.sheetFormat ?? null;
      formats.push(picked);
      if (picked) format = picked;
      return route.fulfill({ json: { spreadsheetUrl: "https://docs.google.com/spreadsheets/d/sheet-1/edit?gid=1#gid=1" } });
    });
    await page.route(`${API_URL}/plans/plan-1`, (route) => {
      if (route.request().method() === "GET") return route.fulfill({ json: mockPlan({ budget: 10000, sheetFormat: format, items: [{ assetId: "a1", format: "reel", cost: "8000", clientCost: null, postsPerProfile: 1, asset: { handle: "big.page", followers: 900000, category: "Meme page" } }] }) });
      if (route.request().method() !== "PUT") return route.fallback();
      const body = route.request().postDataJSON();
      return route.fulfill({ json: mockPlan({ budget: 10000, sheetFormat: format, ...body, items: [{ assetId: "a1", format: "reel", cost: "8000", clientCost: null, postsPerProfile: 1, asset: { handle: "big.page", followers: 900000, category: "Meme page" } }] }) });
    });

    await fillStep1(page);
    await page.getByRole("textbox", { name: "Budget" }).fill("10000");
    await page.getByLabel("Select @big.page").check();
    await page.getByRole("button", { name: "Next: Pricing" }).click();
    await page.getByRole("button", { name: "Next: Preview" }).click();

    await expect(page.getByTestId("preview-breakdown")).toBeVisible();
    await expect(page.getByRole("radiogroup", { name: "Google Sheet format" })).toHaveCount(0);
    await page.getByTestId("generate-client-sheet").click();
    const picker = page.getByRole("radiogroup", { name: "Google Sheet format" });
    await expect(picker.getByRole("radio", { name: /Category breakdown/ })).toHaveAttribute("aria-checked", "true");
    await picker.getByRole("radio", { name: /Campaign summary/ }).click();
    await page.getByTestId("sheet-format-confirm").click();
    await expect.poll(() => formats).toEqual(["summary"]);
    // The popup closes and the preview re-reads the plan in its new format.
    await expect(page.getByTestId("sheet-format-modal")).toHaveCount(0);
    await expect(page.getByTestId("preview-summary")).toContainText("Total Deliverables");
  });
});
