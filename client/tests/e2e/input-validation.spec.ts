import { test, expect } from "@playwright/test";

import { API_URL, signIn, mockApi } from "./fixtures";

/**
 * Input rules (user request, 13 Sep): no <input type="number"> anywhere
 * (so no spinner arrows and no scroll-to-change), money grouped the Indian
 * way as you type (1,50,000), phones capped at exactly 10 digits, and the
 * billing profile form checks PAN / GSTIN / IFSC / account formats inline.
 */
test.describe("input validation", () => {
  test("money fields group digits in Indian style and never render as type=number", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.goto("/campaigns");
    await page.getByRole("button", { name: "New campaign", exact: true }).click();
    await page.getByPlaceholder("e.g. Zomato", { exact: true }).fill("Zomato");
    await page.getByPlaceholder("e.g. Zomato Diwali").fill("Zomato Diwali");
    await page.getByRole("button", { name: "Continue" }).click();

    const cap = page.getByLabel("Total budget cap");
    await cap.fill("720000");
    await expect(cap).toHaveValue("7,20,000");
    // Non-digits are dropped, grouping re-applied.
    await cap.fill("12a3456");
    await expect(cap).toHaveValue("1,23,456");
    await expect(cap).toHaveAttribute("inputmode", "numeric");
    expect(await page.locator('input[type="number"]').count()).toBe(0);

    // The review step shows the same amount formatted as rupees.
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Continue to review" }).click();
    await expect(page.getByText("₹1,23,456")).toBeVisible();
  });

  test("phone inputs accept digits only and stop at 10", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.goto("/users");
    await page.getByRole("button", { name: "Add user" }).click();
    const phone = page.getByPlaceholder("98765 43210");
    await phone.pressSequentially("98765-43210-999");
    await expect(phone).toHaveValue("9876543210");
    await expect(phone).toHaveAttribute("maxlength", "10");
    await expect(phone).toHaveAttribute("inputmode", "numeric");
  });

  test("login takes an email only — Sign in waits for a full address, a phone number never enables it (24 Sep)", async ({ page }) => {
    await page.goto("/login");
    const email = page.getByLabel("Email", { exact: true });
    await expect(email).toHaveAttribute("type", "email");
    await email.pressSequentially("1234567890");
    await expect(page.getByRole("button", { name: "Sign in" })).toBeDisabled();
    await email.fill("");
    await email.pressSequentially("creator@gmail");
    await expect(page.getByRole("button", { name: "Sign in" })).toBeDisabled();
    await email.pressSequentially(".com");
    await expect(page.getByRole("button", { name: "Sign in" })).toBeEnabled();
  });

  test("billing profile form flags a bad PAN, GSTIN and IFSC inline and blocks submit", async ({ page }) => {
    await signIn(page, "CREATOR");
    await mockApi(page);
    await page.route(`${API_URL}/billing-profiles`, (route) => route.fulfill({ json: [] }));
    await page.goto("/profile?tab=billing");
    await page.getByRole("button", { name: /Add (a )?billing profile|Add profile|New profile/ }).first().click();

    await page.getByLabel("PAN", { exact: true }).fill("abc123");
    await expect(page.getByText("PAN is 10 characters, e.g. ABCDE1234F.")).toBeVisible();
    await page.getByLabel("PAN", { exact: true }).fill("ABCDE1234F");
    await expect(page.getByText("PAN is 10 characters, e.g. ABCDE1234F.")).toHaveCount(0);

    await page.getByLabel("GSTIN").fill("123");
    await expect(page.getByText(/GSTIN is 15 characters/)).toBeVisible();
    await page.getByLabel("GSTIN").fill("27ABCDE1234F1Z5");
    await expect(page.getByText(/GSTIN is 15 characters/)).toHaveCount(0);

    await page.getByLabel("IFSC code").fill("hdfc1234");
    await expect(page.getByText(/IFSC is 11 characters/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Add profile" })).toBeDisabled();

    await page.getByLabel("IFSC code").fill("HDFC0001234");
    await page.getByLabel("Bank account number").fill("12345678901");
    await page.getByLabel("Name on PAN").fill("Test User");
    await expect(page.getByRole("button", { name: "Add profile" })).toBeEnabled();
  });
});
