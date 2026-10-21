import { expect, test } from "@playwright/test";

test.describe("premium login", () => {
  test("keeps the real sign-in form and shows the campaign pulse on desktop", async ({ page }) => {
    await page.goto("/login");

    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    await expect(page.getByLabel("Email", { exact: true })).toHaveAttribute("placeholder", "you@gmail.com");
    await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    await expect(page.getByRole("region", { name: "From campaign booking to payout" })).toBeVisible();
    await expect(page.getByTestId("login-campaign-pulse")).toBeVisible();
    await expect(page.getByTestId("login-hero-illustration-light")).toHaveAttribute("src", /login-team-premium/);
  });

  test("keeps the form focused and removes the decorative hero on phones", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/login");

    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    await expect(page.getByRole("region", { name: "From campaign booking to payout" })).toBeHidden();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  });
});
