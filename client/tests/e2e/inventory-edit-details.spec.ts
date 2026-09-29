import { test, expect } from "@playwright/test";

import { signIn, mockApi, API_URL } from "./fixtures";

/**
 * Inventory's Edit panel can set the page's category and its engagement
 * figures (user report, 28 Sep — "after pages created, there is no option of
 * edit category, engagement"). Both were previously write-once at creation /
 * scrape-only. A typed figure is a manual override that beats the scrape and
 * survives re-scrapes (server side: assets/service.js's getAvgEngagement).
 */
function assetFixture(over: Record<string, unknown> = {}) {
  return {
    id: "asset-1",
    ownerId: "creator-1",
    platform: "instagram",
    handle: "naughtyworld",
    followers: 1000,
    category: null,
    approvalStatus: "approved",
    createdAt: "2026-01-01T00:00:00.000Z",
    rateCards: [],
    engagement: { avgLikes: null, avgComments: null, avgViews: null, sampleSize: 0 },
    campaigns: [],
    ...over,
  };
}

test.describe("Inventory — editing category and engagement (28 Sep)", () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test("the Edit panel saves a category and typed engagement figures", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.route(`${API_URL}/assets`, (route) => route.fulfill({ json: [assetFixture()] }));

    let details: Record<string, unknown> | null = null;
    await page.route(`${API_URL}/assets/asset-1/details`, (route) => {
      details = route.request().postDataJSON();
      return route.fulfill({ json: assetFixture({ category: "Meme page" }) });
    });
    await page.route(`${API_URL}/assets/asset-1/rate-card`, (route) => route.fulfill({ json: [] }));

    await page.goto("/inventory");
    await page.getByRole("button", { name: "Edit" }).first().click();

    // getByLabel("Category") would also match the page's search box, whose
    // own label mentions categories — target the combobox itself.
    await page.getByRole("combobox", { name: "Category" }).fill("Meme page");
    await page.getByLabel("Avg. views").fill("125000");
    await page.getByLabel("Avg. likes").fill("4200");
    await page.getByRole("button", { name: "Save" }).click();

    await expect.poll(() => details).toMatchObject({ category: "Meme page", avgViews: 125000, avgLikes: 4200 });
    // The box left blank stays automatic rather than being saved as 0.
    expect(details!.avgComments).toBeNull();
  });

  test("a scraped figure shows as a placeholder and stays blank; only a manual one prefills", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.route(`${API_URL}/assets`, (route) =>
      route.fulfill({
        json: [
          assetFixture({
            engagement: { avgLikes: 50, avgComments: 3, avgViews: 9000, sampleSize: 12, source: "profile", manual: { avgViews: true } },
          }),
        ],
      })
    );

    await page.goto("/inventory");
    await page.getByRole("button", { name: "Edit" }).first().click();

    // avgViews is the manual one — it prefills so you can see/edit what was typed.
    await expect(page.getByLabel("Avg. views")).toHaveValue("9000");
    // avgLikes comes from the scrape — blank box, scraped number as the hint.
    await expect(page.getByLabel("Avg. likes")).toHaveValue("");
    await expect(page.getByLabel("Avg. likes")).toHaveAttribute("placeholder", "50");
    await expect(page.getByText(/clear a box to use the scraped number/i)).toBeVisible();
  });

  test("a page with no rate card yet can still have its category saved", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.route(`${API_URL}/assets`, (route) => route.fulfill({ json: [assetFixture({ rateCards: [] })] }));

    let details: Record<string, unknown> | null = null;
    let rateCardCalled = false;
    await page.route(`${API_URL}/assets/asset-1/details`, (route) => {
      details = route.request().postDataJSON();
      return route.fulfill({ json: assetFixture({ category: "News page" }) });
    });
    // The rate-card endpoint rejects an empty list, so saving a category alone
    // must not call it at all (regression: it used to, and 400'd the save).
    await page.route(`${API_URL}/assets/asset-1/rate-card`, (route) => {
      rateCardCalled = true;
      return route.fulfill({ status: 400, json: { error: { code: "VALIDATION", message: "rateCards must have at least one" } } });
    });

    await page.goto("/inventory");
    await page.getByRole("button", { name: "Edit" }).first().click();
    await page.getByRole("combobox", { name: "Category" }).fill("News page");
    await page.getByRole("button", { name: "Save" }).click();

    await expect.poll(() => details).toMatchObject({ category: "News page" });
    expect(rateCardCalled).toBe(false);
  });

  test("clearing a manual figure sends null, handing it back to the scrape", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.route(`${API_URL}/assets`, (route) =>
      route.fulfill({ json: [assetFixture({ engagement: { avgLikes: null, avgComments: null, avgViews: 9000, sampleSize: 0, manual: { avgViews: true } } })] })
    );
    let details: Record<string, unknown> | null = null;
    await page.route(`${API_URL}/assets/asset-1/details`, (route) => {
      details = route.request().postDataJSON();
      return route.fulfill({ json: assetFixture() });
    });
    await page.route(`${API_URL}/assets/asset-1/rate-card`, (route) => route.fulfill({ json: [] }));

    await page.goto("/inventory");
    await page.getByRole("button", { name: "Edit" }).first().click();
    await page.getByLabel("Avg. views").fill("");
    await page.getByRole("button", { name: "Save" }).click();

    await expect.poll(() => details).toMatchObject({ avgViews: null });
  });
});
