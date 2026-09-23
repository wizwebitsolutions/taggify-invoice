import { test, expect } from "@playwright/test";

import { signIn, mockApi, API_URL } from "./fixtures";

/**
 * Inventory → "Create page" popup (user request, 23 Sep):
 *  - Category is a searchable combobox suggesting categories that already
 *    exist on some page in the DB, not a fixed chip list — still free-text
 *    for a brand-new category (Asset.category has no enum).
 *  - "+ New user" creates a creator account inline (same POST /auth/signup
 *    the Users page uses) instead of forcing a trip there first, then
 *    selects it as the page's owner.
 * Server side is covered by existing auth/assets vitest suites.
 */
const owners = [{ id: "creator-1", name: "Priya Creator", phoneNumber: "+919000000001", email: null }];

function testAssets() {
  return [
    { id: "a1", ownerId: "creator-1", platform: "instagram", handle: "meme.page", followers: 100000, category: "Meme page", approvalStatus: "approved", createdAt: "2026-01-01T00:00:00.000Z", rateCards: [], engagement: { avgLikes: null, avgComments: null, avgViews: null, sampleSize: 0 }, owner: owners[0] },
    { id: "a2", ownerId: "creator-1", platform: "instagram", handle: "news.page", followers: 200000, category: "News page", approvalStatus: "approved", createdAt: "2026-01-01T00:00:00.000Z", rateCards: [], engagement: { avgLikes: null, avgComments: null, avgViews: null, sampleSize: 0 }, owner: owners[0] },
  ];
}

test.describe("Inventory — Create page popup: category search + inline new user (23 Sep)", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("category suggests the DB's existing categories, filters as you type, and still accepts a brand-new one", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.route(`${API_URL}/assets`, (route) => route.fulfill({ json: testAssets() }));
    await page.route(`${API_URL}/assets/owners`, (route) => route.fulfill({ json: owners }));

    await page.goto("/inventory");
    await page.getByRole("button", { name: "Create page" }).click();
    const category = page.getByRole("combobox", { name: "Category" });
    await expect(category).toBeVisible();

    await category.click();
    await expect(page.getByRole("option", { name: "Meme page" })).toBeVisible();
    await expect(page.getByRole("option", { name: "News page" })).toBeVisible();

    await category.fill("me");
    await expect(page.getByRole("option", { name: "Meme page" })).toBeVisible();
    await expect(page.getByRole("option", { name: "News page" })).toHaveCount(0);

    await category.fill("Podcast page"); // not in the DB yet — still typeable
    await expect(category).toHaveValue("Podcast page");
  });

  test("+ New user creates a creator account inline, shows the one-time password, and selects it as the owner", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.route(`${API_URL}/assets`, (route) => route.fulfill({ json: [] }));
    let ownersCallCount = 0;
    await page.route(`${API_URL}/assets/owners`, (route) => {
      ownersCallCount += 1;
      return route.fulfill({ json: ownersCallCount === 1 ? [] : [{ id: "new-creator-1", name: "Amit Kumar", phoneNumber: "+919876500000", email: null }] });
    });
    let signupBody: Record<string, unknown> | null = null;
    await page.route(`${API_URL}/auth/signup`, (route) => {
      signupBody = route.request().postDataJSON();
      return route.fulfill({
        status: 201,
        json: { user: { id: "new-creator-1", phoneNumber: "+919876500000", name: "Amit Kumar", role: "CREATOR", email: null, emailVerified: false, whatsappVerified: false }, generatedPassword: "Xk9#mPz2" },
      });
    });

    await page.goto("/inventory");
    await page.getByRole("button", { name: "Create page" }).click();
    await expect(page.getByText("No creator accounts yet.")).toBeVisible();
    await page.getByRole("button", { name: "+ New user" }).click();

    await page.getByLabel("New user name").fill("Amit Kumar");
    const phone = page.getByPlaceholder("98765 43210");
    await phone.fill("9876500000");
    await page.getByRole("button", { name: "Create account" }).click();

    await expect.poll(() => signupBody).toMatchObject({ phoneNumber: "+919876500000", name: "Amit Kumar", role: "CREATOR" });
    await expect(page.getByText("Xk9#mPz2")).toBeVisible();
    await expect(page.getByLabel("Creator account")).toHaveValue("Amit Kumar");
  });
});
