import { test, expect } from "@playwright/test";

import { signIn, mockApi, API_URL } from "./fixtures";

/**
 * Regression test for bugs.md #3/#4: PendingAssignmentRow (the "Create" flow
 * inside Campaigns' "Resolve pending pages" sheet) calls authApi.signup with
 * the exact same "+91"-prefixed phone number pattern CreateUserModal
 * (app/users/page.tsx) does, but this second call site was left on the old
 * "just check non-empty" validation when that one got fixed. Both now share
 * the same 10-digit requirement and blur-gated inline error.
 */
test.describe("Resolve pending pages — email required, phone optional (24 Sep)", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("a short phone number shows an inline error and blocks Create page", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.route(`${API_URL}/campaigns`, (route) =>
      route.fulfill({
        json: [
          {
            id: "camp-1",
            brandName: "Solmate Coffee",
            title: "Launch Week",
            deadline: null,
            createdAt: new Date().toISOString(),
            pendingAssignmentCount: 1,
          },
        ],
      })
    );
    await page.route(`${API_URL}/campaigns/camp-1/assignments`, (route) =>
      route.fulfill({
        json: [
          {
            id: "assign-1",
            campaignId: "camp-1",
            assetId: null,
            pageHandle: "newpage",
            creatorPhone: null,
            status: "pending",
            createdAt: new Date().toISOString(),
          },
        ],
      })
    );

    await page.goto("/campaigns");
    await page.getByRole("button", { name: /still need.*creating/ }).click();
    await page.getByRole("button", { name: "Create" }).click();

    const emailInput = page.getByLabel("Creator's email");
    const phoneInput = page.getByPlaceholder("Phone (optional)");
    const submit = page.getByRole("button", { name: "Create page" });

    // Email is required (24 Sep — it's the new account's login).
    await expect(submit).toBeDisabled();
    await emailInput.fill("new.creator@gmail.com");
    await expect(submit).toBeEnabled();

    // Phone is optional, but a partial number still blocks (bugs.md #3/#4).
    await phoneInput.fill("123");
    await phoneInput.blur();
    await expect(page.getByText("Enter a valid 10-digit mobile number, or leave it empty.")).toBeVisible();
    await expect(submit).toBeDisabled();

    await phoneInput.fill("9876543210");
    await expect(page.getByText("Enter a valid 10-digit mobile number, or leave it empty.")).toHaveCount(0);
    await expect(submit).toBeEnabled();
    await phoneInput.fill("");
    await expect(submit).toBeEnabled();
  });
});
