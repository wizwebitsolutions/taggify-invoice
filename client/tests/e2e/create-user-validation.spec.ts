import { test, expect } from "@playwright/test";

import { signIn, mockApi, API_URL } from "./fixtures";

/**
 * People → "Add a user" (24 Sep): email is required (it's the new account's
 * login), phone is optional — but if one is typed it must be a full
 * 10-digit number. The original phone regression (bugs.md #3: "12345"
 * silently reached the server as "+9112345") still applies to that
 * optional field.
 */
test.describe("Add user — email required, phone optional", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("email is required: submit stays disabled until it's a valid address, with an inline error after leaving the field", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.goto("/users");

    await page.getByRole("button", { name: "Add user" }).click();
    // Team member so the form isn't also blocked by the separate
    // "at least one page" requirement.
    await page.getByRole("combobox").selectOption("TEAM_MEMBER");
    const email = page.getByLabel("Email", { exact: true });
    const submit = page.getByRole("button", { name: "Create user" });

    await expect(submit).toBeDisabled();
    await email.fill("amit@");
    await email.blur();
    await expect(page.getByText("Enter a valid email address — it's how they'll sign in.")).toBeVisible();
    await expect(submit).toBeDisabled();

    await email.fill("amit@gmail.com");
    await expect(page.getByText("Enter a valid email address — it's how they'll sign in.")).toHaveCount(0);
    await expect(submit).toBeEnabled();
  });

  test("phone is optional, but a partial number shows an inline error and blocks submit", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.goto("/users");
    await page.getByRole("button", { name: "Add user" }).click();
    await page.getByRole("combobox").selectOption("TEAM_MEMBER");
    await page.getByLabel("Email", { exact: true }).fill("amit@gmail.com");

    const phoneInput = page.getByPlaceholder("98765 43210");
    const submit = page.getByRole("button", { name: "Create user" });

    await phoneInput.fill("12345");
    await phoneInput.blur();
    await expect(page.getByText("Enter a valid 10-digit mobile number, or leave it empty.")).toBeVisible();
    await expect(submit).toBeDisabled();

    await phoneInput.fill("");
    await expect(submit).toBeEnabled();
    await phoneInput.fill("1234567890");
    await expect(page.getByText("Enter a valid 10-digit mobile number, or leave it empty.")).toHaveCount(0);
    await expect(submit).toBeEnabled();
  });

  test("typing a valid number doesn't flash the error before it's complete", async ({ page }) => {
    // Regression test: showPhoneError used to be driven by "has the user
    // typed anything" rather than "has the field been left".
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.goto("/users");
    await page.getByRole("button", { name: "Add user" }).click();
    await page.getByRole("combobox").selectOption("TEAM_MEMBER");

    await page.getByPlaceholder("98765 43210").pressSequentially("9876543210");
    await expect(page.getByText("Enter a valid 10-digit mobile number, or leave it empty.")).toHaveCount(0);
  });

  test("sends the email (lower-cased by the server) and the phone only when given; the success message names the email", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    const bodies: Record<string, unknown>[] = [];
    await page.route(`${API_URL}/auth/signup`, (route) => {
      bodies.push(route.request().postDataJSON());
      return route.fulfill({
        json: { user: { id: "new-user-1", phoneNumber: null, email: "amit@gmail.com", name: "Amit", role: "TEAM_MEMBER" }, generatedPassword: "Abcdefg1!" },
      });
    });

    await page.goto("/users");
    await page.getByRole("button", { name: "Add user" }).click();
    await page.getByRole("combobox").selectOption("TEAM_MEMBER");
    await page.getByLabel("Email", { exact: true }).fill("amit@gmail.com");
    await page.getByPlaceholder("Their name").fill("Amit");
    await page.getByRole("button", { name: "Create user" }).click();

    await expect(page.getByText(/Account created for/)).toContainText("amit@gmail.com");
    await expect(page.getByText("Abcdefg1!")).toBeVisible();
    expect(bodies[0]).toEqual({ email: "amit@gmail.com", name: "Amit", role: "TEAM_MEMBER" });
  });

  test("a page typed in while Role=Creator isn't created if Role is switched away before submit", async ({ page }) => {
    // Regression test for a real bug: only the Pages section's *visibility*
    // was gated on requiresPage (role === "CREATOR") — the `pages` state
    // itself stuck around, so a page typed before switching Role was still
    // created under the new non-CREATOR account.
    await signIn(page, "ADMIN");
    await mockApi(page);
    let assetCreatePosted = false;
    await page.route(`${API_URL}/auth/signup`, (route) =>
      route.fulfill({
        json: { user: { id: "new-user-1", phoneNumber: null, email: "tm@gmail.com", name: null, role: "TEAM_MEMBER" }, generatedPassword: "Abcdefg1!" },
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

    await page.getByLabel("Email", { exact: true }).fill("tm@gmail.com");
    await page.getByRole("button", { name: "Create user" }).click();
    await expect(page.getByText(/Account created for/)).toBeVisible();

    expect(assetCreatePosted, "no asset should be created for a page typed while a different role was selected").toBe(false);
    await expect(page.getByText(/page.*created\.$/)).toHaveCount(0);
  });
});
