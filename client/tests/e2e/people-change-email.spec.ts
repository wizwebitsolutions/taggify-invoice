import { test, expect } from "@playwright/test";

import { signIn, mockApi, API_URL } from "./fixtures";

/**
 * Email is the login since 24 Sep, so an admin can fix it (a typo at
 * creation, a new inbox) from People → "Change email" — same gate as Reset
 * password. Server rules (lower-casing, unverified until the next login's
 * code, sessions revoked, audit log, sub-admin guard) are covered by vitest
 * in server/src/modules/admin/service.test.js.
 */
const creator = { id: "u-1", name: "Amit Kumar", email: "amit@gmial.com", phoneNumber: null, role: "CREATOR", whatsappVerified: false, permissions: {}, createdAt: "2026-09-24T00:00:00.000Z" };

test.describe("People — change a user's email (24 Sep)", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("admin corrects a typo'd email; the row then shows the new address", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    let current = { ...creator };
    let putBody: Record<string, unknown> | null = null;
    await page.route(`${API_URL}/admin/users`, (route) => route.fulfill({ json: [current] }));
    await page.route(`${API_URL}/admin/users/u-1/email`, (route) => {
      putBody = route.request().postDataJSON();
      current = { ...current, email: "amit@gmail.com" };
      return route.fulfill({ json: { id: "u-1", email: "amit@gmail.com", emailVerified: false } });
    });

    await page.goto("/users");
    await expect(page.getByRole("cell", { name: "amit@gmial.com" })).toBeVisible();
    await page.getByRole("button", { name: "Change email" }).first().click();

    const form = page.getByTestId("change-email-form");
    const field = form.getByLabel("New email");
    await expect(field).toHaveValue("amit@gmial.com");
    // Unchanged or invalid can't be submitted.
    await expect(form.getByRole("button", { name: "Change email" })).toBeDisabled();
    await field.fill("amit@");
    await expect(form.getByRole("button", { name: "Change email" })).toBeDisabled();

    await field.fill("Amit@Gmail.com");
    await form.getByRole("button", { name: "Change email" }).click();

    await expect(form).toContainText("now signs in with amit@gmail.com");
    await expect(form).toContainText("signed out everywhere");
    expect(putBody).toEqual({ email: "Amit@Gmail.com" });
    await form.getByRole("button", { name: "Done" }).click();
    await expect(page.getByRole("cell", { name: /amit@gmail\.com/ })).toBeVisible();
  });

  test("an email that's already taken shows the server's message and keeps the form open", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.route(`${API_URL}/admin/users`, (route) => route.fulfill({ json: [creator] }));
    await page.route(`${API_URL}/admin/users/u-1/email`, (route) =>
      route.fulfill({ status: 409, json: { error: { code: "EMAIL_ALREADY_REGISTERED", message: "An account with this email already exists" } } })
    );

    await page.goto("/users");
    await page.getByRole("button", { name: "Change email" }).first().click();
    const form = page.getByTestId("change-email-form");
    await form.getByLabel("New email").fill("taken@gmail.com");
    await form.getByRole("button", { name: "Change email" }).click();

    await expect(form).toContainText("An account with this email already exists");
    await expect(form.getByLabel("New email")).toBeVisible();
  });
});

test.describe("Resolve pending pages — a phone that's already someone else's isn't reused silently (24 Sep review)", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("signup 409 on the phone → a clear error naming the holder, and no page is created", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.route(`${API_URL}/campaigns`, (route) =>
      route.fulfill({ json: [{ id: "camp-1", brandName: "Solmate", title: "Launch", deadline: null, createdAt: new Date().toISOString(), pendingAssignmentCount: 1 }] })
    );
    await page.route(`${API_URL}/campaigns/camp-1/assignments`, (route) =>
      route.fulfill({
        json: [{ id: "assign-1", campaignId: "camp-1", assetId: null, pageHandle: "newpage", creatorPhone: "+919000000001", status: "pending", createdAt: new Date().toISOString() }],
      })
    );
    // The phone's holder is an Admin (not a creator), so the row doesn't
    // auto-select them and starts on "New creator account".
    await page.route(`${API_URL}/admin/users`, (route) =>
      route.fulfill({ json: [{ id: "u-admin", phoneNumber: "+919000000001", email: "ops@gmail.com", name: "Ops Admin", role: "ADMIN", whatsappVerified: true }] })
    );
    await page.route(`${API_URL}/auth/signup`, (route) =>
      route.fulfill({ status: 409, json: { error: { code: "PHONE_ALREADY_REGISTERED", message: "This phone number is already registered" } } })
    );
    let assetPosted = false;
    await page.route(`${API_URL}/assets`, (route) => {
      if (route.request().method() === "POST") assetPosted = true;
      return route.fulfill({ json: [] });
    });

    await page.goto("/campaigns");
    await page.getByRole("button", { name: /still need.*creating/ }).click();
    await page.getByRole("button", { name: "Create" }).click();
    await page.getByLabel("Creator's email").fill("new.person@gmail.com");
    await page.getByRole("button", { name: "Create page" }).click();

    await expect(page.getByText(/That phone number already belongs to Ops Admin/)).toBeVisible();
    expect(assetPosted).toBe(false);
  });
});
