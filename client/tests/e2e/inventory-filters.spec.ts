import { test, expect } from "@playwright/test";

import { signIn, mockApi, API_URL } from "./fixtures";

/**
 * newTask.md, 9 Sep — "multiple filters of category, user under page,
 * ranking by followers etc": Inventory's Pages grid gains an owner filter
 * (which Creator a page belongs to) and a followers sort, alongside the
 * existing category tabs.
 */
function testAssets() {
  return [
    {
      id: "asset-1",
      ownerId: "creator-1",
      platform: "instagram",
      handle: "big.page",
      followers: 900000,
      category: "News page",
      approvalStatus: "approved",
      createdAt: "2026-01-01T00:00:00.000Z",
      rateCards: [],
      engagement: { avgLikes: null, avgComments: null, avgViews: null, sampleSize: 0 },
      owner: { id: "creator-1", name: "Priya Creator", phoneNumber: "+919000000001" },
    },
    {
      id: "asset-2",
      ownerId: "creator-2",
      platform: "instagram",
      handle: "small.page",
      followers: 10000,
      category: "Meme page",
      approvalStatus: "approved",
      createdAt: "2026-01-02T00:00:00.000Z",
      rateCards: [],
      engagement: { avgLikes: null, avgComments: null, avgViews: null, sampleSize: 0 },
      owner: { id: "creator-2", name: "Rahul Creator", phoneNumber: "+919000000002" },
    },
  ];
}

test.describe("Inventory — owner filter and followers sort", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("owner dropdown filters the grid down to one creator's pages", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.route(`${API_URL}/assets`, (route) => route.fulfill({ json: testAssets() }));

    await page.goto("/inventory");
    await expect(page.getByText("@big.page")).toBeVisible();
    await expect(page.getByText("@small.page")).toBeVisible();

    await page.getByLabel("Filter by page owner").selectOption("creator-2");
    await expect(page.getByText("@small.page")).toBeVisible();
    await expect(page.getByText("@big.page")).toHaveCount(0);
  });

  test("sort by followers (high to low / low to high) reorders the grid", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.route(`${API_URL}/assets`, (route) => route.fulfill({ json: testAssets() }));

    await page.goto("/inventory");

    await page.getByLabel("Sort pages").selectOption("followers-desc");
    let handles = await page.getByTestId("asset-instagram-link").allTextContents();
    expect(handles).toEqual(["@big.page", "@small.page"]);

    await page.getByLabel("Sort pages").selectOption("followers-asc");
    handles = await page.getByTestId("asset-instagram-link").allTextContents();
    expect(handles).toEqual(["@small.page", "@big.page"]);
  });

  test("a CREATOR with only their own pages never sees an owner filter (nothing to filter by)", async ({ page }) => {
    await signIn(page, "CREATOR");
    await mockApi(page);
    await page.route(`${API_URL}/assets`, (route) => route.fulfill({ json: [testAssets()[0]] }));

    await page.goto("/inventory");
    await expect(page.getByText("@big.page")).toBeVisible();
    await expect(page.getByLabel("Filter by page owner")).toHaveCount(0);
  });
});

/**
 * newTask.md, 9 Sep — "add category filter in inventory section, that will
 * be horizontally ... and also give search tab as well for page or
 * category": the category strip is a scrollable single-row tab list (not
 * wrapping chips), and a dedicated search box filters by handle or category.
 */
test.describe("Inventory — category tab strip and search", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("category tabs filter the grid and show a per-category count", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.route(`${API_URL}/assets`, (route) => route.fulfill({ json: testAssets() }));

    await page.goto("/inventory");
    await expect(page.getByRole("button", { name: "All 2" })).toBeVisible();
    await expect(page.getByRole("button", { name: "News page 1" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Meme page 1" })).toBeVisible();

    await page.getByRole("button", { name: "Meme page 1" }).click();
    await expect(page.getByText("@small.page")).toBeVisible();
    await expect(page.getByText("@big.page")).toHaveCount(0);
  });

  test("search filters by handle", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.route(`${API_URL}/assets`, (route) => route.fulfill({ json: testAssets() }));

    await page.goto("/inventory");
    await page.getByLabel("Search pages by handle, category, or owner").fill("small");
    await expect(page.getByText("@small.page")).toBeVisible();
    await expect(page.getByText("@big.page")).toHaveCount(0);
  });

  test("search filters by category", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.route(`${API_URL}/assets`, (route) => route.fulfill({ json: testAssets() }));

    await page.goto("/inventory");
    await page.getByLabel("Search pages by handle, category, or owner").fill("news");
    await expect(page.getByText("@big.page")).toBeVisible();
    await expect(page.getByText("@small.page")).toHaveCount(0);
  });

  test("search also matches the owning user's name (user request, 11 Sep)", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.route(`${API_URL}/assets`, (route) => route.fulfill({ json: testAssets() }));

    await page.goto("/inventory");
    await page.getByLabel("Search pages by handle, category, or owner").fill("rahul");
    await expect(page.getByText("@small.page")).toBeVisible();
    await expect(page.getByText("@big.page")).toHaveCount(0);
  });

  test("clearing search restores the full grid", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.route(`${API_URL}/assets`, (route) => route.fulfill({ json: testAssets() }));

    await page.goto("/inventory");
    const search = page.getByLabel("Search pages by handle, category, or owner");
    await search.fill("small");
    await expect(page.getByText("@big.page")).toHaveCount(0);

    await page.getByLabel("Clear search").click();
    await expect(search).toHaveValue("");
    await expect(page.getByText("@big.page")).toBeVisible();
    await expect(page.getByText("@small.page")).toBeVisible();
  });
});
