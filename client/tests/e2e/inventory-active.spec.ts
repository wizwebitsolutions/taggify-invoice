import { test, expect } from "@playwright/test";

import { signIn, mockApi, API_URL } from "./fixtures";

/** Inventory: an admin marks a page Active / Inactive (8 Oct). Inactive pages can't be added to new plans. */
function assetFixture(over: Record<string, unknown> = {}) {
  return {
    id: "asset-1",
    ownerId: "creator-1",
    platform: "instagram",
    handle: "naughtyworld",
    followers: 8_700_000,
    category: null,
    approvalStatus: "approved",
    createdAt: "2026-01-01T00:00:00.000Z",
    lastScrapedAt: "2026-01-01T00:00:00.000Z",
    rateCards: [],
    engagement: { avgLikes: null, avgComments: null, avgViews: null, sampleSize: 0 },
    campaigns: [],
    ...over,
  };
}

test.describe("Inventory — Active / Inactive pages (8 Oct)", () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test("an admin deactivates a page, and an inactive one shows its tag and can be activated again", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.route(`${API_URL}/assets`, (route) => route.fulfill({ json: [assetFixture(), assetFixture({ id: "asset-2", handle: "old.page", isActive: false })] }));
    const calls: unknown[] = [];
    await page.route(`${API_URL}/assets/*/active`, (route) => {
      calls.push({ url: new URL(route.request().url()).pathname, ...route.request().postDataJSON() });
      return route.fulfill({ json: {} });
    });

    await page.goto("/inventory");
    await expect(page.getByTitle("87,00,000 followers").first()).toHaveText("8.7M"); // followers read as K / M
    const oldRow = page.getByTestId("asset-card").filter({ hasText: "@old.page" });
    await expect(oldRow.getByText("Inactive")).toBeVisible();

    await page.getByRole("button", { name: "Deactivate @naughtyworld" }).click();
    await page.getByRole("button", { name: "Activate @old.page" }).click();
    await expect.poll(() => calls).toEqual([
      { url: "/api/assets/asset-1/active", isActive: false },
      { url: "/api/assets/asset-2/active", isActive: true },
    ]);
  });

  test("finance and a planner don't get the Activate / Deactivate button", async ({ page }) => {
    for (const role of ["FINANCE", "PLAN_MAKER"] as const) {
      await signIn(page, role);
      await mockApi(page);
      await page.route(`${API_URL}/assets`, (route) => route.fulfill({ json: [assetFixture()] }));
      await page.goto("/inventory");
      await expect(page.getByText("@naughtyworld").first()).toBeVisible();
      await expect(page.getByRole("button", { name: /activate @naughtyworld/i })).toHaveCount(0);
    }
  });
});
