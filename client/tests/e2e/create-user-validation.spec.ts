import { test, expect } from "@playwright/test";

import { signIn, mockApi, API_URL } from "./fixtures";

/**
 * Regression test for bugs.md #3: the "Add a user" form's phone number
 * field had no real validation — canSubmit only checked "non-empty", so
 * e.g. "12345" silently reached the server as "+9112345" and failed there
 * with a generic error instead of a clear one here. Fixed in
 * app/users/page.tsx (CreateUserModal) by requiring exactly 10 digits and
 * showing an inline error.
 */
test.describe("Add user — phone number validation", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("a short phone number shows an inline error and blocks submit", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.goto("/users");

    await page.getByRole("button", { name: "Add user" }).click();
    // Team member so the form isn't also blocked by the separate
    // "at least one page" requirement — this test is only about the phone field.
    await page.getByRole("combobox").selectOption("TEAM_MEMBER");

    const phoneInput = page.getByPlaceholder("98765 43210");
    const submit = page.getByRole("button", { name: "Create user" });

    // The inline error is blur-gated (not shown on every keystroke — see
    // app/users/page.tsx's showPhoneError), so leave the field to trigger it.
    await phoneInput.fill("12345");
    await phoneInput.blur();
    await expect(page.getByText("Enter a valid 10-digit mobile number.")).toBeVisible();
    await expect(submit).toBeDisabled();

    await phoneInput.fill("1234567890");
    await expect(page.getByText("Enter a valid 10-digit mobile number.")).toHaveCount(0);
    await expect(submit).toBeEnabled();
  });

  test("typing a valid number doesn't flash the error before it's complete", async ({ page }) => {
    // Regression test: showPhoneError used to be driven by "has the user
    // typed anything" rather than "has the field been left", so entering a
    // correct 10-digit number one keystroke at a time showed the invalid
    // state on every intermediate digit.
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.goto("/users");
    await page.getByRole("button", { name: "Add user" }).click();
    await page.getByRole("combobox").selectOption("TEAM_MEMBER");

    await page.getByPlaceholder("98765 43210").pressSequentially("9876543210");
    await expect(page.getByText("Enter a valid 10-digit mobile number.")).toHaveCount(0);
  });

  test("a page typed in while Role=Creator isn't created if Role is switched away before submit", async ({ page }) => {
    // Regression test for a real bug: only the Pages section's *visibility*
    // was gated on requiresPage (role === "CREATOR") — the `pages` state
    // itself stuck around. Typing a page handle, then switching Role to
    // something else before submitting, still silently created that page
    // asset owned by the new non-CREATOR account. Fixed by also gating what
    // actually gets submitted (submittedPages), not just the section's
    // visibility.
    await signIn(page, "ADMIN");
    await mockApi(page);
    let assetCreatePosted = false;
    await page.route(`${API_URL}/auth/signup`, (route) =>
      route.fulfill({
        json: { user: { id: "new-user-1", phoneNumber: "+919876543210", name: null, role: "TEAM_MEMBER" }, generatedPassword: "Abcdefg1!" },
      })
    );
    await page.route(`${API_URL}/assets`, (route) => {
      if (route.request().method() === "POST") assetCreatePosted = true;
      return route.fulfill({ json: [] });
    });

    await page.goto("/users");
    await page.getByRole("button", { name: "Add user" }).click();
    // Role defaults to Creator — type a page while the Pages section is up.
    await page.getByPlaceholder("Instagram handle (without @)").fill("stalepage");
    // Then switch away — Pages section disappears, but `pages` state remains.
    await page.getByRole("combobox").selectOption("TEAM_MEMBER");
    await expect(page.getByText("At least one Instagram page is required for a creator account.")).toHaveCount(0);

    await page.getByPlaceholder("98765 43210").fill("9876543210");
    await page.getByRole("button", { name: "Create user" }).click();
    await expect(page.getByText(/Account created for/)).toBeVisible();

    expect(assetCreatePosted, "no asset should be created for a page typed while a different role was selected").toBe(false);
    // The "N of M pages created" summary shouldn't reference the stale page either.
    await expect(page.getByText(/page.*created\.$/)).toHaveCount(0);
  });
});
