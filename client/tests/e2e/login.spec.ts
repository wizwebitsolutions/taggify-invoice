import { test, expect, type Page } from "@playwright/test";

import { signIn, mockApi, userFor, API_URL } from "./fixtures";

const session = (userOver: Record<string, unknown> = {}) => ({
  step: "AUTHENTICATED",
  user: { ...userFor("CREATOR"), ...userOver },
  accessToken: "test-access-token",
  refreshToken: "test-refresh-token",
});

async function submitCredentials(page: Page, identifier: string, password = "Passw0rd!") {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(identifier);
  // exact: true — the bare substring also matches the "Show password"
  // toggle button's aria-label.
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test.describe("login page", () => {
  test("renders the sign-in form", async ({ page }) => {
    await page.goto("/login");

    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  });

  test("Sign in stays disabled until the email is a full address — a phone number is no longer a login (24 Sep)", async ({ page }) => {
    await page.goto("/login");
    const email = page.getByLabel("Email", { exact: true });
    const button = page.getByRole("button", { name: "Sign in" });
    await page.getByLabel("Password", { exact: true }).fill("x");

    await email.fill("98765 43210");
    await expect(button).toBeDisabled();
    await email.fill("someone@");
    await expect(button).toBeDisabled();
    await email.fill("someone@gmail.com");
    await expect(button).toBeEnabled();
    await email.fill("someone@company.in");
    await expect(button).toBeEnabled();
  });

  test("shows the server's error message on failed login", async ({ page }) => {
    await page.route(`${API_URL}/auth/login`, (route) =>
      route.fulfill({
        status: 401,
        json: { error: { code: "INVALID_CREDENTIALS", message: "Invalid credentials" } },
      })
    );

    await submitCredentials(page, "creator@gmail.com", "wrong-password");

    await expect(page.getByText("Invalid credentials")).toBeVisible();
    // Didn't navigate away on a failed login.
    await expect(page).toHaveURL(/\/login$/);
  });

  test("an already-signed-in visitor is redirected straight to /dashboard", async ({ page }) => {
    await signIn(page, "CREATOR");
    await mockApi(page);

    await page.goto("/login");
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test("the field asks for the email the admin registered, with no phone-number path (24 Sep)", async ({ page }) => {
    await page.goto("/login");

    await expect(page.getByLabel("Email", { exact: true })).toHaveAttribute("placeholder", "you@gmail.com");
    await expect(page.getByText(/Sign in with the email your admin registered/)).toBeVisible();
    await expect(page.getByText(/phone number/i)).toHaveCount(0);
  });
});

// "Skip OTP for 7 days" (user decision, 23 Sep) — a browser that has
// completed one OTP verification sends a trusted-device cookie on its next
// /auth/login and, if the server accepts it, never sees the OTP step again
// within the window. The cookie itself is httpOnly (set by a real
// Set-Cookie header in these mocks, not JS) — Playwright's browser context
// carries it automatically to the next request, same as a real browser.
test.describe("login — trusted device (skip OTP for 7 days)", () => {
  test("after verifying once, a second sign-in on the same browser goes straight to the dashboard — no OTP step shown", async ({ page, context }) => {
    await mockApi(page);
    await page.route(`${API_URL}/auth/login`, (route) =>
      route.fulfill({ json: { step: "OTP_REQUIRED", challengeToken: "challenge-abc", emailHint: "cr***@gmail.com" } })
    );
    await page.route(`${API_URL}/auth/login/verify-otp`, (route) =>
      route.fulfill({
        headers: { "set-cookie": "taggify_trusted_device=device-token-1; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=604800" },
        json: session({ email: "creator@gmail.com", emailVerified: true }),
      })
    );

    await submitCredentials(page, "creator@gmail.com");
    await page.getByLabel("Verification code").fill("123456");
    await page.getByRole("button", { name: "Verify and sign in" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    const cookies = await context.cookies();
    expect(cookies.find((c) => c.name === "taggify_trusted_device")).toMatchObject({ httpOnly: true, value: "device-token-1" });

    // Sign out and sign back in on the same browser — the cookie should
    // already be attached to this second /auth/login request.
    await page.evaluate(() => localStorage.removeItem("taggify_auth"));
    let secondLoginCookie: string | null = null;
    await page.unroute(`${API_URL}/auth/login`);
    await page.route(`${API_URL}/auth/login`, async (route) => {
      secondLoginCookie = await route.request().headerValue("cookie");
      return route.fulfill({ json: session({ email: "creator@gmail.com", emailVerified: true }) });
    });

    await submitCredentials(page, "creator@gmail.com");

    expect(secondLoginCookie).toContain("taggify_trusted_device=device-token-1");
    // Straight to AUTHENTICATED — the OTP screen never appears.
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { name: "Check your email" })).toHaveCount(0);
  });

  test("a browser with no trusted-device cookie still gets the normal OTP step", async ({ page }) => {
    await page.route(`${API_URL}/auth/login`, (route) =>
      route.fulfill({ json: { step: "OTP_REQUIRED", challengeToken: "challenge-abc", emailHint: "cr***@gmail.com" } })
    );

    await submitCredentials(page, "creator@gmail.com");

    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  });

  test("unchecking 'Remember this device' sends remember: false and no cookie is set", async ({ page, context }) => {
    await mockApi(page);
    let verifyBody: Record<string, unknown> | null = null;
    await page.route(`${API_URL}/auth/login`, (route) =>
      route.fulfill({ json: { step: "OTP_REQUIRED", challengeToken: "challenge-abc", emailHint: "cr***@gmail.com" } })
    );
    await page.route(`${API_URL}/auth/login/verify-otp`, (route) => {
      verifyBody = route.request().postDataJSON();
      // The real server sets no cookie at all when remember is false — no set-cookie header here either.
      return route.fulfill({ json: session({ email: "creator@gmail.com", emailVerified: true }) });
    });

    await submitCredentials(page, "creator@gmail.com");
    await page.getByLabel("Remember this device for 7 days").uncheck();
    await page.getByLabel("Verification code").fill("123456");
    await page.getByRole("button", { name: "Verify and sign in" }).click();

    await expect(page).toHaveURL(/\/dashboard$/);
    expect(verifyBody).toEqual({ challengeToken: "challenge-abc", code: "123456", remember: false });
    const cookies = await context.cookies();
    expect(cookies.find((c) => c.name === "taggify_trusted_device")).toBeUndefined();
  });
});

// Email 2FA (21 Sep; email-only since 24 Sep) — what /auth/login answers decides the next step.
test.describe("login — email 2FA steps", () => {
  test("email + password → OTP step → dashboard (also a new account's first login, which verifies its email); no session until the code is verified", async ({ page }) => {
    await mockApi(page);
    let loginBody: Record<string, unknown> | null = null;
    let verifyBody: Record<string, unknown> | null = null;
    await page.route(`${API_URL}/auth/login`, (route) => {
      loginBody = route.request().postDataJSON();
      return route.fulfill({ json: { step: "OTP_REQUIRED", challengeToken: "challenge-abc", emailHint: "cr***@gmail.com" } });
    });
    await page.route(`${API_URL}/auth/login/verify-otp`, (route) => {
      verifyBody = route.request().postDataJSON();
      return route.fulfill({ json: session({ email: "creator@gmail.com", emailVerified: true }) });
    });

    await submitCredentials(page, "creator@gmail.com");

    expect(loginBody).toEqual({ email: "creator@gmail.com", password: "Passw0rd!" });
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
    await expect(page.getByText("cr***@gmail.com")).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
    expect(await page.evaluate(() => localStorage.getItem("taggify_auth"))).toBeNull();

    const verify = page.getByRole("button", { name: "Verify and sign in" });
    // "Remember this device for 7 days" — checked by default.
    await expect(page.getByLabel("Remember this device for 7 days")).toBeChecked();
    await page.getByLabel("Verification code").fill("12ab34");
    await expect(page.getByLabel("Verification code")).toHaveValue("1234"); // digits only
    await expect(verify).toBeDisabled();
    await page.getByLabel("Verification code").fill("123456");
    await verify.click();

    await expect(page).toHaveURL(/\/dashboard$/);
    expect(verifyBody).toEqual({ challengeToken: "challenge-abc", code: "123456", remember: true });
    // A verified account isn't nagged.
    await expect(page.getByText("Verify your email to keep access.")).toHaveCount(0);
  });

  test("OTP step: a wrong code shows the server's message and stays put; resend is on a cooldown; Back returns to the form", async ({ page }) => {
    await page.route(`${API_URL}/auth/login`, (route) =>
      route.fulfill({ json: { step: "OTP_REQUIRED", challengeToken: "challenge-abc", emailHint: "cr***@gmail.com" } })
    );
    await page.route(`${API_URL}/auth/login/verify-otp`, (route) =>
      route.fulfill({ status: 400, json: { error: { code: "OTP_INVALID", message: "Incorrect code — 4 attempts left" } } })
    );

    await submitCredentials(page, "creator@gmail.com");
    await page.getByLabel("Verification code").fill("000000");
    await page.getByRole("button", { name: "Verify and sign in" }).click();

    await expect(page.getByText("Incorrect code — 4 attempts left")).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("button", { name: /Resend code in \d+s/ })).toBeDisabled();

    await page.getByRole("button", { name: "Back to sign in" }).click();
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    // The password isn't left sitting in the form.
    await expect(page.getByLabel("Password", { exact: true })).toHaveValue("");
  });

});

test.describe("/verify-email (signed in, grace period)", () => {
  test("verifies with the session's bearer token (no challenge token) and flips to the verified state", async ({ page }) => {
    const user = { ...userFor("CREATOR"), emailVerified: false };
    await page.addInitScript(
      (s) => {
        // Only seed once — a reload after verifying must keep the adopted session.
        if (!window.localStorage.getItem("taggify_auth")) window.localStorage.setItem("taggify_auth", JSON.stringify(s));
      },
      { user, accessToken: "grace-access-token", refreshToken: "test-refresh-token" }
    );
    await mockApi(page);
    let startAuth: string | null = null;
    let startBody: Record<string, unknown> | null = null;
    await page.route(`${API_URL}/auth/email/start`, async (route) => {
      startAuth = await route.request().headerValue("authorization");
      startBody = route.request().postDataJSON();
      return route.fulfill({ json: { emailHint: "me***@gmail.com" } });
    });
    await page.route(`${API_URL}/auth/email/confirm`, (route) => route.fulfill({ json: session({ email: "me@gmail.com", emailVerified: true }) }));

    await page.goto("/verify-email");
    await page.getByLabel("Email address").fill("me@gmail.com");
    await page.getByRole("button", { name: "Send verification code" }).click();
    await page.getByLabel("Verification code").fill("111222");
    await page.getByRole("button", { name: "Verify email" }).click();

    expect(startAuth).toBe("Bearer grace-access-token");
    expect(startBody).toEqual({ email: "me@gmail.com" });
    await expect(page.getByText("is verified. Use it with your password next time you sign in.")).toBeVisible();
    await page.getByRole("link", { name: "Go to dashboard" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByText("Verify your email to keep access.")).toHaveCount(0);
  });

  // The page can sit open past the 15-minute access token while someone
  // waits for the email. /auth/* is normally exempt from refresh-and-retry
  // (a 401 from login is a wrong password) — without the /auth/email/*
  // exception this dead-ended with "Sign in again", and signing in again
  // costs one of only two phone logins.
  test("an expired access token is refreshed and the send retried, not a dead end", async ({ page }) => {
    await page.addInitScript(
      (s) => window.localStorage.setItem("taggify_auth", JSON.stringify(s)),
      { user: { ...userFor("CREATOR"), emailVerified: false }, accessToken: "expired-access-token", refreshToken: "test-refresh-token" }
    );
    await mockApi(page);
    const bearers: (string | null)[] = [];
    await page.route(`${API_URL}/auth/email/start`, async (route) => {
      const bearer = await route.request().headerValue("authorization");
      bearers.push(bearer);
      if (bearer === "Bearer expired-access-token") {
        return route.fulfill({ status: 401, json: { error: { code: "UNAUTHENTICATED", message: "Sign in again" } } });
      }
      return route.fulfill({ json: { emailHint: "me***@gmail.com" } });
    });
    await page.route(`${API_URL}/auth/refresh`, (route) =>
      route.fulfill({ json: { user: { ...userFor("CREATOR"), emailVerified: false }, accessToken: "fresh-access-token", refreshToken: "rotated-refresh-token" } })
    );

    await page.goto("/verify-email");
    await page.getByLabel("Email address").fill("me@gmail.com");
    await page.getByRole("button", { name: "Send verification code" }).click();

    await expect(page.getByLabel("Verification code")).toBeVisible();
    await expect(page.getByText("Sign in again")).toHaveCount(0);
    expect(bearers).toEqual(["Bearer expired-access-token", "Bearer fresh-access-token"]);
  });

  test("signed out → redirected to /login like any protected page", async ({ page }) => {
    await page.goto("/verify-email");
    await expect(page).toHaveURL(/\/login$/);
  });
});
