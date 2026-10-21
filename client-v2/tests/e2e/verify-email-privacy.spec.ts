import { expect, test, type Page } from "@playwright/test";

import { API_URL, mockApi, signIn, userFor, type MockRole } from "./fixtures";

/** Verify-email banner + /verify-email (send code → confirm → new session), and the public /privacy page. API fully mocked. */

async function verifyApi(page: Page, role: MockRole = "CREATOR") {
  const user = await signIn(page, role, { emailVerified: false });
  const calls = { start: [] as Record<string, unknown>[], confirm: [] as Record<string, unknown>[], auth: [] as (string | null)[] };
  await mockApi(page);
  await page.route(`${API_URL}/auth/email/start`, (r) => {
    calls.start.push(r.request().postDataJSON());
    calls.auth.push(r.request().headers()["authorization"] ?? null);
    return r.fulfill({ json: { emailHint: "ri***@gmail.com" } });
  });
  await page.route(`${API_URL}/auth/email/confirm`, (r) => {
    const body = r.request().postDataJSON();
    calls.confirm.push(body);
    if (body.code !== "123456") return r.fulfill({ status: 400, json: { error: { code: "OTP_INVALID", message: "That code isn't right. Check it and try again." } } });
    return r.fulfill({ json: { user: { ...user, email: "riya@gmail.com", emailVerified: true }, accessToken: "fresh-access", refreshToken: "fresh-refresh" } });
  });
  return calls;
}

test.describe("Verify email", () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test("an unverified account sees the banner on other pages but not on /verify-email", async ({ page }) => {
    await verifyApi(page);
    await page.goto("/settings");
    const banner = page.getByRole("status").filter({ hasText: "Verify your email to keep access." });
    await expect(banner).toBeVisible();
    await banner.getByRole("link", { name: "Verify email" }).click();
    await expect(page).toHaveURL(/\/verify-email$/);
    await expect(page.getByRole("heading", { name: "Verify your email" })).toBeVisible();
    await expect(page.getByText("Verify your email to keep access.")).toHaveCount(0);
  });

  test("a verified account sees no banner", async ({ page }) => {
    await signIn(page, "CREATOR");
    await mockApi(page);
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await expect(page.getByText("Verify your email to keep access.")).toHaveCount(0);
  });

  test("send a code, a wrong code says why, the right one verifies and swaps the session", async ({ page }) => {
    const calls = await verifyApi(page);
    await page.goto("/verify-email");
    const send = page.getByRole("button", { name: "Send verification code" });
    await expect(send).toBeDisabled();
    await page.getByLabel("Email address").fill(" riya@gmail.com ");
    await send.click();
    await expect(page.getByText("We sent a 6-digit code to")).toContainText("riya@gmail.com");
    expect(calls.start).toEqual([{ email: "riya@gmail.com" }]);
    expect(calls.auth).toEqual(["Bearer test-access-token"]);
    await expect(page.getByRole("button", { name: /Resend code in \d+s/ })).toBeDisabled();

    await page.getByLabel("Verification code").fill("000000");
    await page.getByRole("button", { name: "Verify email" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "That code isn't right." })).toBeVisible();

    await page.getByLabel("Verification code").fill("123456");
    await page.getByRole("button", { name: "Verify email" }).click();
    await expect(page.getByRole("status").filter({ hasText: "riya@gmail.com is verified." })).toBeVisible();
    expect(calls.confirm).toEqual([{ code: "000000" }, { code: "123456" }]);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("taggify_auth") ?? "null"));
    expect(stored).toMatchObject({ accessToken: "fresh-access", refreshToken: "fresh-refresh", user: { emailVerified: true, email: "riya@gmail.com" } });

    await page.getByRole("link", { name: "Go to Home" }).click();
    await expect(page.getByText("Verify your email to keep access.")).toHaveCount(0);
  });

  test("Use a different email goes back to the email step", async ({ page }) => {
    await verifyApi(page, "ADMIN");
    await page.goto("/verify-email");
    await page.getByLabel("Email address").fill("ops@taggify.in");
    await page.getByRole("button", { name: "Send verification code" }).click();
    await page.getByRole("button", { name: "Use a different email" }).click();
    await expect(page.getByLabel("Email address")).toBeVisible();
  });
});

test.describe("Privacy policy", () => {
  test("loads signed out and is linked from the login footer", async ({ page }) => {
    await mockApi(page);
    await page.goto("/login");
    await page.getByRole("link", { name: "Privacy policy" }).click();
    await expect(page).toHaveURL(/\/privacy$/);
    await expect(page.getByRole("heading", { level: 1, name: "Privacy policy" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in", exact: true })).toHaveAttribute("href", "/login");
  });

  test("opens directly without a session (no redirect to sign in)", async ({ page }) => {
    await mockApi(page);
    await page.goto("/privacy");
    await expect(page.getByRole("heading", { level: 1, name: "Privacy policy" })).toBeVisible();
    await expect(page).toHaveURL(/\/privacy$/);
  });

  test("still opens for a signed-in user", async ({ page }) => {
    await signIn(page, "ADMIN", userFor("ADMIN"));
    await mockApi(page);
    await page.goto("/privacy");
    await expect(page.getByRole("heading", { level: 1, name: "Privacy policy" })).toBeVisible();
  });
});
