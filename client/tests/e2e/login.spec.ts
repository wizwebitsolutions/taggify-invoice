import { test, expect } from "@playwright/test";

import { signIn, mockApi } from "./fixtures";

test.describe("login page", () => {
  test("renders the sign-in form", async ({ page }) => {
    await page.goto("/login");

    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    await expect(page.getByLabel("Phone number")).toBeVisible();
    // exact: true — the bare substring also matches the "Show password"
    // toggle button's aria-label.
    await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  });

  test("shows the server's error message on failed login", async ({ page }) => {
    await page.route("**/auth/login", (route) =>
      route.fulfill({
        status: 401,
        json: { error: { code: "INVALID_CREDENTIALS", message: "Wrong phone number or password." } },
      })
    );

    await page.goto("/login");
    await page.getByLabel("Phone number").fill("9876543210");
    await page.getByLabel("Password", { exact: true }).fill("wrong-password");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByText("Wrong phone number or password.")).toBeVisible();
    // Didn't navigate away on a failed login.
    await expect(page).toHaveURL(/\/login$/);
  });

  test("an already-signed-in visitor is redirected straight to /dashboard", async ({ page }) => {
    await signIn(page, "CREATOR");
    await mockApi(page);

    await page.goto("/login");
    await expect(page).toHaveURL(/\/dashboard$/);
  });
});
