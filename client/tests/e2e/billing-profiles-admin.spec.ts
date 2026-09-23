import { test, expect } from "@playwright/test";

import { signIn, mockApi, API_URL } from "./fixtures";

/**
 * Profile → Billing profiles for an Admin (user request, 22 Sep — "admin
 * can [add a] billing profile for himself as well, currently it's not
 * showing, and can edit billing details for any profile ... show list of
 * name, number, and in right on selection show all details"). Server side
 * (PUT /billing-profiles/:id, who may) is vitest in billing/service.test.js.
 */
const profile = (over: Record<string, unknown> = {}) => ({
  id: "bp-1",
  userId: "creator-1",
  pan: "ABCDE1234F",
  name: "Rohit Sharma",
  gstin: "27ABCDE1234F1Z5",
  msme: null,
  bankAccountNumber: "123456789012",
  ifscCode: "HDFC0001234",
  approvalStatus: "pending",
  createdAt: "2026-09-01T00:00:00.000Z",
  user: { id: "creator-1", name: "Rohit Sharma", phoneNumber: "+919999900001" },
  ...over,
});

test.describe("Billing profiles — Admin master–detail", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("lists accounts (own first) on the left; selecting one shows its full details on the right; Edit saves via PUT", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.route(`${API_URL}/billing-profiles`, (route) =>
      route.fulfill({ json: [profile(), profile({ id: "bp-2", userId: "creator-2", pan: "ZZZZZ9999Z", name: "Priya", approvalStatus: "approved", user: { id: "creator-2", name: "Priya Nair", phoneNumber: "+919999900002" } })] })
    );
    let patched: Record<string, unknown> | null = null;
    await page.route(`${API_URL}/billing-profiles/bp-2`, (route) => {
      patched = route.request().postDataJSON();
      return route.fulfill({ json: profile({ id: "bp-2", ...(patched as object) }) });
    });

    await page.goto("/profile?tab=billing");
    const accounts = page.getByTestId("billing-accounts");
    const rows = accounts.getByRole("button");
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText("(you)");
    await expect(rows.nth(0)).toContainText("+919876543210");
    await expect(rows.nth(1)).toContainText("Priya Nair");
    await expect(rows.nth(2)).toContainText("Rohit Sharma");
    await expect(rows.nth(2)).toContainText("1 pending");

    // Own account first, with Add for the admin's own profile.
    const detail = page.getByTestId("billing-detail");
    await expect(detail).toContainText("You have no billing profile yet");
    await expect(detail.getByRole("button", { name: "Add billing profile" })).toBeVisible();

    await rows.nth(1).click();
    await expect(detail).toContainText("Priya Nair · +919999900002");
    await expect(detail).toContainText("ZZZZZ9999Z — Priya");
    await expect(detail).toContainText("HDFC0001234");
    await expect(detail.getByRole("button", { name: "Add billing profile" })).toHaveCount(0);

    await detail.getByRole("button", { name: "Edit billing profile ZZZZZ9999Z" }).click();
    const form = page.getByTestId("billing-profile-form");
    await expect(form.getByLabel("Name on PAN")).toHaveValue("Priya");
    await form.getByLabel("Name on PAN").fill("Priya Nair");
    await form.getByLabel("Bank account number").fill("999988887777");
    await form.getByRole("button", { name: "Save changes" }).click();
    await expect(form).toHaveCount(0);
    expect(patched).toEqual({ pan: "ZZZZZ9999Z", name: "Priya Nair", gstin: "27ABCDE1234F1Z5", msme: null, bankAccountNumber: "999988887777", ifscCode: "HDFC0001234" });
  });

  test("an Admin can add a billing profile for themselves", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    let posted: Record<string, unknown> | null = null;
    await page.route(`${API_URL}/billing-profiles`, (route) => {
      if (route.request().method() !== "POST") return route.fulfill({ json: [] });
      posted = route.request().postDataJSON();
      return route.fulfill({ status: 201, json: profile({ userId: "test-user-1" }) });
    });

    await page.goto("/profile?tab=billing");
    await page.getByTestId("billing-detail").getByRole("button", { name: "Add billing profile" }).click();
    const form = page.getByTestId("billing-profile-form");
    await form.getByLabel("PAN", { exact: true }).fill("QWERT5678U");
    await form.getByLabel("Name on PAN").fill("Ops Admin");
    await form.getByLabel("Bank account number").fill("123456789");
    await form.getByLabel("IFSC code").fill("UTIB0000240");
    await form.getByRole("button", { name: "Add profile" }).click();
    await expect(form).toHaveCount(0);
    expect(posted).toEqual({ pan: "QWERT5678U", name: "Ops Admin", bankAccountNumber: "123456789", ifscCode: "UTIB0000240" });
  });

  test("a creator sees their own profiles as a plain list with Edit, no account list", async ({ page }) => {
    await signIn(page, "CREATOR");
    await mockApi(page);
    await page.route(`${API_URL}/billing-profiles`, (route) => route.fulfill({ json: [profile({ userId: "test-user-1", user: undefined })] }));

    await page.goto("/profile?tab=billing");
    await expect(page.getByTestId("billing-accounts")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Edit billing profile ABCDE1234F" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add billing profile" })).toBeVisible();
  });
});
