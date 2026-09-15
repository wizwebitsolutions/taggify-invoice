import { test, expect } from "@playwright/test";

import { signIn, mockApi, API_URL } from "./fixtures";

/**
 * Inventory's manual "refresh" button — pulls fresh followers/name/bio/
 * avatar from Apify right now instead of waiting for the 24h
 * assetProfileRescrapeJob cron (see server/src/modules/assets/routes.js's
 * POST /:id/refresh-profile). ADMIN-only, same as the analogous link-level
 * refresh-metrics action.
 */
function testAsset(followers = 0) {
  return {
    id: "asset-1",
    ownerId: "creator-1",
    platform: "instagram",
    handle: "adultsociety",
    followers,
    category: "Meme page",
    approvalStatus: "approved",
    createdAt: "2026-01-01T00:00:00.000Z",
    rateCards: [],
    engagement: { avgLikes: null, avgComments: null, avgViews: null, sampleSize: 0 },
    owner: { id: "creator-1", name: "Priya Creator", phoneNumber: "+919000000001" },
  };
}

test.describe("Inventory — manual profile refresh", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("ADMIN clicking refresh pulls fresh followers and updates the card", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.route(`${API_URL}/assets`, (route) => route.fulfill({ json: [testAsset(0)] }));

    await page.goto("/inventory");
    await expect(page.getByTitle("0 followers")).toBeVisible();

    // After the refresh call succeeds, the card refetches the list — swap
    // the mocked list response so the refetch reflects the "new" numbers,
    // same as the real server would after refreshAssetMetrics persists them.
    let refreshCalled = false;
    await page.route(`${API_URL}/assets/asset-1/refresh-profile`, (route) => {
      refreshCalled = true;
      return route.fulfill({ json: { id: "asset-1", handle: "adultsociety", followers: 8079135 } });
    });
    await page.route(`${API_URL}/assets`, (route) => route.fulfill({ json: [testAsset(8079135)] }));

    await page.getByLabel("Refresh @adultsociety's profile from Instagram").click();

    await expect(page.getByTitle("80,79,135 followers")).toBeVisible();
    expect(refreshCalled).toBe(true);
  });

  test("a failed refresh (e.g. Apify error) shows an inline error, not a silent no-op", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.route(`${API_URL}/assets`, (route) => route.fulfill({ json: [testAsset(0)] }));
    await page.route(`${API_URL}/assets/asset-1/refresh-profile`, (route) =>
      route.fulfill({ status: 502, json: { error: { code: "APIFY_ERROR", message: "Couldn't refresh from Instagram." } } })
    );

    await page.goto("/inventory");
    await page.getByLabel("Refresh @adultsociety's profile from Instagram").click();

    await expect(page.getByText("Couldn't refresh from Instagram.")).toBeVisible();
  });

  test("a non-admin (CREATOR) never sees the refresh button on their own page", async ({ page }) => {
    await signIn(page, "CREATOR");
    await mockApi(page);
    await page.route(`${API_URL}/assets`, (route) => route.fulfill({ json: [testAsset(0)] }));

    await page.goto("/inventory");
    await expect(page.getByText("@adultsociety")).toBeVisible();
    await expect(page.getByLabel("Refresh @adultsociety's profile from Instagram")).toHaveCount(0);
  });
});
