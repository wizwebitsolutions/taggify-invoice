import { test, expect } from "@playwright/test";

import { signIn, mockApi, API_URL } from "./fixtures";

/**
 * newTask.md #13 / 8 Sep — "inventory tab -> all pages, listed category
 * wise, selection of pages, option of create a plan": pages picked directly
 * on the Pages grid carry into a new plan's page list once "Create plan" is
 * clicked. Plans moved to its own /plans nav tab (newTask.md, 9 Sep), so
 * the hand-off is now a route param (?assetIds=...) rather than in-page
 * state — app/inventory/page.tsx's onCreatePlanFromSelection navigates
 * there, and app/plans/page.tsx consumes it once on mount.
 */
function testAssets() {
  return [
    {
      id: "asset-1",
      ownerId: "creator-1",
      platform: "instagram",
      handle: "daily.news.test",
      followers: 500000,
      category: "News page",
      approvalStatus: "approved",
      createdAt: "2026-01-01T00:00:00.000Z",
      rateCards: [{ id: "rc-1", format: "story", amount: "15000" }],
      engagement: { avgLikes: null, avgComments: null, avgViews: null, sampleSize: 0 },
    },
    {
      id: "asset-2",
      ownerId: "creator-1",
      platform: "instagram",
      handle: "meme.central.test",
      followers: 250000,
      category: "Meme page",
      approvalStatus: "approved",
      createdAt: "2026-01-01T00:00:00.000Z",
      rateCards: [{ id: "rc-2", format: "reel", amount: "8000" }],
      engagement: { avgLikes: null, avgComments: null, avgViews: null, sampleSize: 0 },
    },
  ];
}

test.describe("Inventory — select pages, then create a plan from the selection", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("ADMIN sees a checkbox per page; selecting one shows a 'Create plan' bar", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.route(`${API_URL}/assets`, (route) => route.fulfill({ json: testAssets() }));

    await page.goto("/inventory");
    await expect(page.getByRole("checkbox", { name: "Select @daily.news.test for a plan" })).toBeVisible();

    await page.getByRole("checkbox", { name: "Select @daily.news.test for a plan" }).check();
    await expect(page.getByText("1 page selected")).toBeVisible();
    await expect(page.getByRole("button", { name: "Create plan" })).toBeVisible();

    await page.getByRole("checkbox", { name: "Select @meme.central.test for a plan" }).check();
    await expect(page.getByText("2 pages selected")).toBeVisible();
  });

  test("PLAN_MAKER also sees selection checkboxes (they can build plans too)", async ({ page }) => {
    await signIn(page, "PLAN_MAKER");
    await mockApi(page);
    await page.route(`${API_URL}/assets`, (route) => route.fulfill({ json: testAssets() }));

    await page.goto("/inventory");
    await expect(page.getByRole("checkbox", { name: "Select @daily.news.test for a plan" })).toBeVisible();
  });

  test("CREATOR sees no selection checkboxes — they can't build plans", async ({ page }) => {
    await signIn(page, "CREATOR");
    await mockApi(page);
    await page.route(`${API_URL}/assets`, (route) => route.fulfill({ json: testAssets() }));

    await page.goto("/inventory");
    await expect(page.getByText("@daily.news.test")).toBeVisible();
    await expect(page.getByRole("checkbox", { name: /Select @/ })).toHaveCount(0);
  });

  test("Clear empties the selection and hides the bar", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.route(`${API_URL}/assets`, (route) => route.fulfill({ json: testAssets() }));

    await page.goto("/inventory");
    await page.getByRole("checkbox", { name: "Select @daily.news.test for a plan" }).check();
    await expect(page.getByText("1 page selected")).toBeVisible();

    await page.getByRole("button", { name: "Clear" }).click();
    await expect(page.getByText("1 page selected")).toHaveCount(0);
    await expect(page.getByRole("checkbox", { name: "Select @daily.news.test for a plan" })).not.toBeChecked();
  });

  test("Create plan navigates to /plans with the selection, which opens New plan at Step 1, pages pre-filled once Step 2 is reached", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.route(`${API_URL}/assets`, (route) => route.fulfill({ json: testAssets() }));
    await page.route(`${API_URL}/plans`, (route) => {
      if (route.request().method() === "POST") return route.fulfill({ status: 201, json: { id: "plan-new", variantLabel: "Plan A", items: [] } });
      return route.fulfill({ json: [] });
    });

    await page.goto("/inventory");
    await page.getByRole("checkbox", { name: "Select @daily.news.test for a plan" }).check();
    await page.getByRole("checkbox", { name: "Select @meme.central.test for a plan" }).check();
    await page.getByRole("button", { name: "Create plan" }).click();

    await expect(page).toHaveURL(/\/plans(\?|$)/);
    await expect(page.getByRole("heading", { name: "New plan" })).toBeVisible();
    // Multi-step now (user request, 10 Sep — "not everything at one time
    // ui"): Step 1 is Basics only, nothing about pages yet.
    await expect(page.getByRole("textbox", { name: "Plan name" })).toBeVisible();
    // The only combobox on Step 1 is Client name's saved-client suggestions
    // (21 Sep) — still none of Step 2's page/format pickers.
    await expect(page.getByRole("combobox")).toHaveCount(1);
    await expect(page.getByRole("combobox", { name: "Client name" })).toBeVisible();

    // The ?assetIds= param is consumed once, then stripped — a refresh
    // shouldn't reopen the wizard with the same stale selection later.
    await expect(page).toHaveURL(/\/plans$/);

    await page.getByRole("textbox", { name: "Plan name" }).fill("Q1 Push");
    await page.getByRole("combobox", { name: "Client name" }).fill("Acme");
    await page.getByRole("textbox", { name: "Brief" }).fill("Launch week push"); // mandatory since 14 Sep
    await page.getByRole("button", { name: "Next: Budget & pages" }).click();

    // Step 2 — both selected pages already checked, each defaulted to its
    // page's only rate-card format, and a running total reflecting both
    // rate cards (15000 + 8000).
    await expect(page.getByRole("checkbox", { name: /daily\.news\.test/ })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: /meme\.central\.test/ })).toBeChecked();
    // Formats are toggles since 8 Oct (a page can have both); each page starts with its one priced format on.
    const formatValues = await page.locator('[role="group"][aria-label^="Formats for"] button[aria-pressed="true"]').allTextContents();
    expect(formatValues.sort()).toEqual(["reel", "story"]);
    await expect(page.getByText("₹23,000").first()).toBeVisible();
  });

  test("visiting /plans directly (no selection) never carries over a stale one", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.route(`${API_URL}/assets`, (route) => route.fulfill({ json: testAssets() }));
    await page.route(`${API_URL}/plans`, (route) => {
      if (route.request().method() === "POST") return route.fulfill({ status: 201, json: { id: "plan-new", variantLabel: "Plan A", items: [] } });
      return route.fulfill({ json: [] });
    });

    await page.goto("/plans");
    await page.getByRole("button", { name: "New plan" }).click();

    await expect(page.getByRole("heading", { name: "New plan" })).toBeVisible();
    // Step 1 has no checkboxes at all any more (the GST toggle went on 14 Sep).
    await expect(page.getByRole("checkbox")).toHaveCount(0);

    await page.getByRole("textbox", { name: "Plan name" }).fill("Q1 Push");
    await page.getByRole("combobox", { name: "Client name" }).fill("Acme");
    await page.getByRole("textbox", { name: "Brief" }).fill("Launch week push");
    await page.getByRole("button", { name: "Next: Budget & pages" }).click();

    // Step 2 — nothing pre-checked, since no selection was carried over.
    const checkedStates = await page.getByRole("checkbox").evaluateAll((els) => els.map((el) => (el as HTMLInputElement).checked));
    expect(checkedStates.every((checked) => checked === false)).toBe(true);
  });
});
