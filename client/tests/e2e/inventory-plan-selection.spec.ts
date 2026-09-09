import { test, expect } from "@playwright/test";

import { signIn, mockApi, API_URL } from "./fixtures";

/**
 * newTask.md #13 / 8 Sep — "inventory tab -> all pages, listed category
 * wise, selection of pages, option of create a plan": pages picked directly
 * on the Pages grid (not from inside the plan form) carry straight into a
 * new plan's page list once "Create plan" is clicked, via
 * app/inventory/page.tsx's selectedAssetIds/pendingPlanAssetIds state.
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
    await page.route(`${API_URL}/plans`, (route) => route.fulfill({ json: [] }));

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
    await page.route(`${API_URL}/plans`, (route) => route.fulfill({ json: [] }));

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
    await page.route(`${API_URL}/plans`, (route) => route.fulfill({ json: [] }));

    await page.goto("/inventory");
    await page.getByRole("checkbox", { name: "Select @daily.news.test for a plan" }).check();
    await expect(page.getByText("1 page selected")).toBeVisible();

    await page.getByRole("button", { name: "Clear" }).click();
    await expect(page.getByText("1 page selected")).toHaveCount(0);
    await expect(page.getByRole("checkbox", { name: "Select @daily.news.test for a plan" })).not.toBeChecked();
  });

  test("Create plan switches to the Plans tab and pre-fills the new plan with the selected pages", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.route(`${API_URL}/assets`, (route) => route.fulfill({ json: testAssets() }));
    await page.route(`${API_URL}/plans`, (route) => route.fulfill({ json: [] }));

    await page.goto("/inventory");
    await page.getByRole("checkbox", { name: "Select @daily.news.test for a plan" }).check();
    await page.getByRole("checkbox", { name: "Select @meme.central.test for a plan" }).check();
    await page.getByRole("button", { name: "Create plan" }).click();

    // Switched to the Plans tab underneath, and the New plan modal opened.
    await expect(page.getByRole("heading", { name: "New plan" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Plans", exact: true })).toHaveClass(/bg-accent-soft/);

    // Both selected pages are already checked in the modal's own picker,
    // each defaulted to its page's only rate-card format — asserted as a
    // set (not scoped per-row) since the two <select>s are the only
    // comboboxes this modal renders.
    const formatValues = await page.getByRole("combobox").evaluateAll((els) => els.map((el) => (el as HTMLSelectElement).value));
    expect(formatValues.sort()).toEqual(["reel", "story"]);

    // Cost totals reflect both pages' rate cards: 15000 + 8000.
    await expect(page.getByText("₹23,000").first()).toBeVisible();
  });

  test("the plain 'New plan' button (from the Plans tab) never carries over a stale selection", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.route(`${API_URL}/assets`, (route) => route.fulfill({ json: testAssets() }));
    await page.route(`${API_URL}/plans`, (route) => route.fulfill({ json: [] }));

    await page.goto("/inventory");
    // Select a page, then abandon that flow by switching to the Plans tab directly.
    await page.getByRole("checkbox", { name: "Select @daily.news.test for a plan" }).check();
    await page.getByRole("button", { name: "Plans", exact: true }).click();
    await page.getByRole("button", { name: "New plan" }).click();

    await expect(page.getByRole("heading", { name: "New plan" })).toBeVisible();
    // Nothing pre-checked — neither the GST checkbox nor either page's —
    // this "New plan" click didn't go through "Create plan from selection".
    const checkedStates = await page.getByRole("checkbox").evaluateAll((els) => els.map((el) => (el as HTMLInputElement).checked));
    expect(checkedStates.every((checked) => checked === false)).toBe(true);
  });
});
