import { test, expect } from "@playwright/test";

import { signIn, mockApi, API_URL } from "./fixtures";

/**
 * newTask.md — "based on search result or filter applied, option of
 * selecting all of them or in numbers how much to select": a bulk-selection
 * bar above the Pages grid (Inventory), scoped to whatever's currently on
 * screen after search/category/owner filtering, not the full catalogue.
 */
function testAssets(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `asset-${i + 1}`,
    ownerId: "creator-1",
    platform: "instagram",
    handle: `page.${i + 1}`,
    followers: 1000 * (i + 1),
    category: i % 2 === 0 ? "News page" : "Meme page",
    approvalStatus: "approved",
    createdAt: "2026-01-01T00:00:00.000Z",
    rateCards: [],
    engagement: { avgLikes: null, avgComments: null, avgViews: null, sampleSize: 0 },
  }));
}

test.describe("Inventory — bulk selection (select all / select first N)", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("Select all N selects every page currently on screen", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.route(`${API_URL}/assets`, (route) => route.fulfill({ json: testAssets(4) }));

    await page.goto("/inventory");
    await expect(page.getByRole("checkbox", { name: "Select all 4 pages" })).toBeVisible();
    await page.getByRole("checkbox", { name: "Select all 4 pages" }).check();

    await expect(page.getByText("4 pages selected")).toBeVisible();
    for (let i = 1; i <= 4; i++) {
      await expect(page.getByRole("checkbox", { name: `Select @page.${i} for a plan` })).toBeChecked();
    }

    // Unchecking the header checkbox clears the view's selection.
    await page.getByRole("checkbox", { name: "Deselect all 4 pages" }).uncheck();
    await expect(page.getByText(/selected/)).toHaveCount(0);
  });

  test("Select all only affects the filtered view, not pages hidden by the category filter", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.route(`${API_URL}/assets`, (route) => route.fulfill({ json: testAssets(4) }));

    await page.goto("/inventory");
    await page.getByRole("button", { name: "News page 2" }).click();
    await expect(page.getByText("@page.1")).toBeVisible();
    await expect(page.getByText("@page.2")).toHaveCount(0);

    await page.getByRole("checkbox", { name: "Select all 2 pages" }).check();
    await expect(page.getByText("2 pages selected")).toBeVisible();

    await page.getByRole("button", { name: "All 4" }).click();
    // Selection persists across the filter change; the header checkbox now
    // reflects a partial (indeterminate) selection over all 4.
    await expect(page.getByText("2 of 4 selected")).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "Select @page.1 for a plan" })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: "Select @page.3 for a plan" })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: "Select @page.2 for a plan" })).not.toBeChecked();
  });

  test("Select first N picks exactly the first N pages in view", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.route(`${API_URL}/assets`, (route) => route.fulfill({ json: testAssets(4) }));

    await page.goto("/inventory");
    const input = page.getByLabel("Number of pages to select (out of 4)");
    await input.fill("2");
    await input.press("Enter");

    await expect(page.getByText("2 of 4 selected")).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "Select @page.1 for a plan" })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: "Select @page.2 for a plan" })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: "Select @page.3 for a plan" })).not.toBeChecked();
    await expect(page.getByRole("checkbox", { name: "Select @page.4 for a plan" })).not.toBeChecked();
  });

  test("CREATOR never sees the bulk-selection bar", async ({ page }) => {
    await signIn(page, "CREATOR");
    await mockApi(page);
    await page.route(`${API_URL}/assets`, (route) => route.fulfill({ json: testAssets(2) }));

    await page.goto("/inventory");
    await expect(page.getByText("@page.1")).toBeVisible();
    await expect(page.getByRole("checkbox", { name: /Select all/ })).toHaveCount(0);
  });
});
