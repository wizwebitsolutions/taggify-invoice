import { test, expect } from "@playwright/test";

import { signIn, mockApi, API_URL, addRate } from "./fixtures";

/**
 * Inventory → "Create page" popup (user request, 23 Sep):
 *  - Category is a searchable combobox suggesting categories that already
 *    exist on some page in the DB, not a fixed chip list — still free-text
 *    for a brand-new category (Asset.category has no enum).
 *  - "New account" (24 Sep redesign) creates the creator account together
 *    with the page on one submit (same POST /auth/signup the Users page
 *    uses); its one-time password is shown on a success screen afterwards
 *    with a Copy button — never mid-form — and an abandoned form creates
 *    nothing. If the page fails after the account was made, the password
 *    stays visible and a retry reuses the account.
 * Server side is covered by existing auth/assets vitest suites.
 */
const owners = [{ id: "creator-1", name: "Priya Creator", phoneNumber: "+919000000001", email: null }];

function testAssets() {
  return [
    { id: "a1", ownerId: "creator-1", platform: "instagram", handle: "meme.page", followers: 100000, category: "Meme page", approvalStatus: "approved", createdAt: "2026-01-01T00:00:00.000Z", rateCards: [], engagement: { avgLikes: null, avgComments: null, avgViews: null, sampleSize: 0 }, owner: owners[0] },
    { id: "a2", ownerId: "creator-1", platform: "instagram", handle: "news.page", followers: 200000, category: "News page", approvalStatus: "approved", createdAt: "2026-01-01T00:00:00.000Z", rateCards: [], engagement: { avgLikes: null, avgComments: null, avgViews: null, sampleSize: 0 }, owner: owners[0] },
  ];
}

/** Reel and Story rates, added one at a time (16 Oct) — no rate is mandatory any more; these just give the create bodies something to check. */
async function fillRequiredRates(page: import("@playwright/test").Page) {
  await addRate(page, "reel", "20000");
  await addRate(page, "story", "15000");
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

  const NEW_USER = { id: "new-creator-1", phoneNumber: null, name: "Amit Kumar", role: "CREATOR", email: "amit.kumar@gmail.com", emailVerified: false, whatsappVerified: false };

  /** Mocks owners, signup and page create; records what was called, in order. */
  async function mockCreateFlow(page: import("@playwright/test").Page, opts: { owners?: typeof owners; assetStatus?: number[] } = {}) {
    const calls: { path: string; body: Record<string, unknown> }[] = [];
    const assetStatuses = [...(opts.assetStatus ?? [201])];
    await page.route(`${API_URL}/assets`, (route) => {
      if (route.request().method() === "POST") {
        const body = route.request().postDataJSON();
        calls.push({ path: "/assets", body });
        const status = assetStatuses.shift() ?? 201;
        if (status !== 201) return route.fulfill({ status, json: { error: { code: "DUPLICATE", message: "That page already exists" } } });
        return route.fulfill({ status: 201, json: { id: "asset-new", ownerId: body.ownerId, platform: "instagram", handle: body.handle, followers: 0, approvalStatus: "approved", createdAt: "2026-09-24T00:00:00.000Z", rateCards: [] } });
      }
      return route.fulfill({ json: [] });
    });
    await page.route(`${API_URL}/assets/owners`, (route) => route.fulfill({ json: opts.owners ?? [] }));
    await page.route(`${API_URL}/auth/signup`, (route) => {
      calls.push({ path: "/auth/signup", body: route.request().postDataJSON() });
      return route.fulfill({ status: 201, json: { user: NEW_USER, generatedPassword: "Xk9#mPz2-long-Password-Value" } });
    });
    return calls;
  }

  test("New account: the account is created together with the page on one submit, and the one-time password shows on the success screen afterwards", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    const calls = await mockCreateFlow(page);

    await page.goto("/inventory");
    await page.getByRole("button", { name: "Create page" }).click();
    // No accounts yet → starts on "New account".
    await expect(page.getByRole("tab", { name: "New account" })).toHaveAttribute("aria-selected", "true");

    // Only name + email are asked for a new account (24 Sep) — no phone field.
    const fields = page.getByTestId("new-account-fields");
    await expect(fields.getByRole("textbox")).toHaveCount(2);
    await expect(fields.getByPlaceholder("98765 43210")).toHaveCount(0);
    await page.getByLabel("New user name").fill("Amit Kumar");
    await page.getByLabel("New user email").fill("amit.kumar@gmail.com");
    await page.getByLabel("Instagram handle").fill("@amit.memes");
    await fillRequiredRates(page);
    // Nothing created while filling in, and no password shown mid-form.
    expect(calls).toHaveLength(0);
    await expect(page.getByTestId("generated-password")).toHaveCount(0);

    await page.getByRole("button", { name: "Create account & page" }).click();

    const success = page.getByTestId("create-page-success");
    await expect(success).toContainText("@amit.memes is live");
    await expect(success.getByTestId("generated-password")).toHaveText("Xk9#mPz2-long-Password-Value");
    await expect(success).toContainText("amit.kumar@gmail.com");
    expect(calls.map((c) => c.path)).toEqual(["/auth/signup", "/assets"]);
    expect(calls[0].body).toEqual({ email: "amit.kumar@gmail.com", name: "Amit Kumar", role: "CREATOR" });
    expect(calls[1].body).toMatchObject({ handle: "amit.memes", ownerId: "new-creator-1" });

    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await success.getByRole("button", { name: "Copy" }).click();
    await expect(success.getByRole("button", { name: "Copied" })).toBeVisible();
    await success.getByRole("button", { name: "Done" }).click();
    await expect(success).toHaveCount(0);
  });

  test("abandoning a New account form creates nothing", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    const calls = await mockCreateFlow(page, { owners });

    await page.goto("/inventory");
    await page.getByRole("button", { name: "Create page" }).click();
    await page.getByRole("tab", { name: "New account" }).click();
    await page.getByLabel("New user name").fill("Amit Kumar");
    await page.getByLabel("New user email").fill("amit.kumar@gmail.com");
    await page.getByTestId("create-page-form").getByRole("button", { name: "Cancel" }).click();

    await expect(page.getByTestId("create-page-form")).toHaveCount(0);
    expect(calls).toHaveLength(0);
  });

  test("if the page fails after the account was created, the password stays visible and a retry doesn't create the account twice", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    const calls = await mockCreateFlow(page, { assetStatus: [409, 201] });

    await page.goto("/inventory");
    await page.getByRole("button", { name: "Create page" }).click();
    await page.getByLabel("New user email").fill("amit.kumar@gmail.com");
    await page.getByLabel("Instagram handle").fill("taken.page");
    await fillRequiredRates(page);
    await page.getByRole("button", { name: "Create account & page" }).click();

    const form = page.getByTestId("create-page-form");
    await expect(form).toContainText("The account was created, but the page wasn't: That page already exists");
    await expect(form.getByTestId("generated-password")).toHaveText("Xk9#mPz2-long-Password-Value");

    await page.getByLabel("Instagram handle").fill("free.page");
    await form.getByRole("button", { name: "Create page" }).click();
    await expect(page.getByTestId("create-page-success")).toContainText("@free.page is live");
    expect(calls.map((c) => c.path)).toEqual(["/auth/signup", "/assets", "/assets"]);
    expect(calls[2].body).toMatchObject({ handle: "free.page", ownerId: "new-creator-1" });
  });

  test("Existing account: creates the page and closes — no success screen, no signup", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    const calls = await mockCreateFlow(page, { owners });

    await page.goto("/inventory");
    await page.getByRole("button", { name: "Create page" }).click();
    await expect(page.getByRole("tab", { name: "Existing account" })).toHaveAttribute("aria-selected", "true");
    await page.getByLabel("Creator account").click();
    await page.getByRole("option", { name: /Priya Creator/ }).click();
    await page.getByLabel("Instagram handle").fill("priya.page");
    await fillRequiredRates(page);
    await page.getByTestId("create-page-form").getByRole("button", { name: "Create page" }).click();

    await expect(page.getByTestId("create-page-form")).toHaveCount(0);
    await expect(page.getByTestId("create-page-success")).toHaveCount(0);
    expect(calls.map((c) => c.path)).toEqual(["/assets"]);
    expect(calls[0].body).toMatchObject({ ownerId: "creator-1", handle: "priya.page" });
  });

  // 25 Sep: a plan maker can register a vendor's page too, while building a
  // plan — same owner-assignment UI an admin gets (existing/new account
  // tabs), but never the admin-only extras (rate cards, auto-approval).
  test("PLAN_MAKER can add a page under an existing creator — no rate card fields, always pending", async ({ page }) => {
    await signIn(page, "PLAN_MAKER");
    await mockApi(page);
    const calls = await mockCreateFlow(page, { owners });

    await page.goto("/inventory");
    await page.getByRole("button", { name: "Add page" }).first().click();
    await expect(page.getByRole("tab", { name: "Existing account" })).toHaveAttribute("aria-selected", "true");
    // Admin-only extras stay hidden — a plan maker's page is always pending, never priced.
    await expect(page.getByTestId("rate-fields")).toHaveCount(0);
    await expect(page.getByText("Approved on creation.")).toHaveCount(0);

    await page.getByLabel("Creator account").click();
    await page.getByRole("option", { name: /Priya Creator/ }).click();
    await page.getByLabel("Instagram handle").fill("vendor.page");
    await page.getByTestId("create-page-form").getByRole("button", { name: "Create page" }).click();

    await expect(page.getByTestId("create-page-form")).toHaveCount(0);
    expect(calls.map((c) => c.path)).toEqual(["/assets"]);
    expect(calls[0].body).toMatchObject({ ownerId: "creator-1", handle: "vendor.page" });
  });

  test("PLAN_MAKER can also create a brand-new creator account inline while adding a page", async ({ page }) => {
    await signIn(page, "PLAN_MAKER");
    await mockApi(page);
    const calls = await mockCreateFlow(page, { owners });

    await page.goto("/inventory");
    await page.getByRole("button", { name: "Add page" }).first().click();
    await page.getByRole("tab", { name: "New account" }).click();
    await page.getByLabel("New user name").fill("Amit Kumar");
    await page.getByLabel("New user email").fill("amit.kumar@gmail.com");
    await page.getByLabel("Instagram handle").fill("amit.memes");
    await page.getByRole("button", { name: "Create account & page" }).click();

    await expect(page.getByTestId("create-page-success")).toBeVisible();
    expect(calls.map((c) => c.path)).toEqual(["/auth/signup", "/assets"]);
    expect(calls[0].body).toEqual({ email: "amit.kumar@gmail.com", name: "Amit Kumar", role: "CREATOR" });
    expect(calls[1].body).toMatchObject({ handle: "amit.memes", ownerId: "new-creator-1" });
  });

  test("admin: rates are added one format at a time, none is mandatory, and they're sent in the app's format order (16 Oct)", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    const calls = await mockCreateFlow(page, { owners });

    await page.goto("/inventory");
    await page.getByRole("button", { name: "Create page" }).click();
    const form = page.getByTestId("create-page-form");
    // No boxes up front — a select of the ten formats, an amount and Add.
    await expect(form.getByTestId("rate-fields")).toContainText("No rates yet");
    await expect(form.getByLabel("Add a rate for", { exact: true }).locator("option")).toHaveCount(11); // placeholder + ten formats
    await expect(form.getByTestId("rate-fields")).toContainText("Every rate is optional");
    await page.getByLabel("Creator account").click();
    await page.getByRole("option", { name: /Priya Creator/ }).click();
    await page.getByLabel("Instagram handle").fill("priced.page");

    await addRate(form, "reel", "20000");
    await expect(form.getByLabel("Reel rate", { exact: true })).toHaveValue("20,000");
    // A priced format leaves the select; a removed one comes back.
    await expect(form.getByLabel("Add a rate for", { exact: true }).locator("option", { hasText: /^Reel$/ })).toHaveCount(0);
    await addRate(form, "repost_story", "30000");
    await form.getByLabel("Remove Repost + Story rate", { exact: true }).click();
    await expect(form.getByLabel("Repost + Story rate", { exact: true })).toHaveCount(0);
    await addRate(form, "story", "15000");
    await addRate(form, "pr", "12000");
    await addRate(form, "repost_story", "30000");
    // Editing an added line in place.
    await form.getByLabel("PR rate", { exact: true }).fill("12000");

    await form.getByRole("button", { name: "Create page" }).click();
    await expect(form).toHaveCount(0);
    expect(calls.map((c) => c.path)).toEqual(["/assets"]);
    expect(calls[0].body).toMatchObject({
      handle: "priced.page",
      rateCards: [
        { format: "reel", amount: 20000 },
        { format: "pr", amount: 12000 },
        { format: "story", amount: 15000 },
        { format: "repost_story", amount: 30000 },
      ],
    });
  });

  test("regression (24 Sep): no horizontal overflow in the form or the success screen at phone width, even with a long name and password", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await signIn(page, "ADMIN");
    await mockApi(page);
    await mockCreateFlow(page);

    await page.goto("/inventory");
    await page.getByRole("button", { name: /Create page/ }).first().click();
    await page.getByLabel("New user name").fill("Aarav Khanna Productions Private Limited Mumbai");
    await page.getByLabel("New user email").fill("amit.kumar@gmail.com");
    await page.getByLabel("Instagram handle").fill("a.very.long.instagram.handle_x");
    await fillRequiredRates(page);

    const noOverflow = (testId: string) =>
      page.getByTestId(testId).evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
    expect(await noOverflow("create-page-form")).toBe(true);

    await page.getByRole("button", { name: "Create account & page" }).click();
    await expect(page.getByTestId("create-page-success")).toBeVisible();
    expect(await noOverflow("create-page-success")).toBe(true);
  });
});
