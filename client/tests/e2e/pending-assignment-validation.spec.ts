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
test.describe("Resolve pending pages — phone number validation", () => {
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

    const phoneInput = page.getByPlaceholder("Creator's phone number");
    const submit = page.getByRole("button", { name: "Create page" });

    await phoneInput.fill("123");
    await phoneInput.blur();
    await expect(page.getByText("Enter a valid 10-digit mobile number.")).toBeVisible();
    await expect(submit).toBeDisabled();

    await phoneInput.fill("9876543210");
    await expect(page.getByText("Enter a valid 10-digit mobile number.")).toHaveCount(0);
    await expect(submit).toBeEnabled();
  });
});
