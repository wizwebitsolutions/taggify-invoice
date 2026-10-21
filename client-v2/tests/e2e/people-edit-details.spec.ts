import { expect, test, type Page } from "@playwright/test";

import { API_URL, mockApi, shot, signIn, userFor } from "./fixtures";

/**
 * People → Edit details (ported from v1 people-edit-details.spec.ts): a full admin
 * edits another account's contact details and address (only changed fields are
 * sent, after a review step) and adds bank details for them. API fully mocked;
 * server rules are in server/src/modules/admin/service.test.js.
 */

const KEYS = ["users.view", "users.edit", "campaigns.view", "campaigns.edit", "inventory.view", "inventory.edit", "inventory.approve", "links.view", "links.edit", "links.approve", "finance.view", "finance.edit", "finance.approve", "finance.pay", "plans.view", "plans.edit", "plans.approve"];
const perms = (on: string[]) => Object.fromEntries(KEYS.map((k) => [k, on.includes(k)]));
const now = new Date().toISOString();

const CREATOR = {
  id: "u-1",
  name: "Amit Kumar",
  email: "amit@gmail.com",
  phoneNumber: "+919000000001",
  secondaryPhone: null,
  addressLine1: "12 MG Road",
  addressLine2: null,
  state: "Maharashtra",
  pincode: "400001",
  role: "CREATOR",
  emailVerifiedAt: now,
  createdAt: now,
  permissions: perms([]),
  ownAccess: perms([]),
};
const PROFILE = { id: "bp-1", userId: "u-1", pan: "ABCDE1234F", name: "Amit Kumar", gstin: null, msme: null, bankAccountNumber: "123456789012", ifscCode: "HDFC0001234", approvalStatus: "approved", createdAt: now };

async function peopleApi(page: Page) {
  const calls = { details: [] as Record<string, unknown>[], billingFor: [] as { id: string; body: Record<string, unknown> }[], billingOwn: 0 };
  let current = { ...CREATOR };
  await mockApi(page);
  await page.route(`${API_URL}/admin/users`, (r) => r.fulfill({ json: [{ ...userFor("ADMIN"), emailVerifiedAt: now, createdAt: now, ownAccess: perms([]) }, current] }));
  await page.route(`${API_URL}/billing-profiles`, (r) => {
    if (r.request().method() === "POST") {
      calls.billingOwn++;
      return r.fulfill({ status: 201, json: PROFILE });
    }
    return r.fulfill({ json: [PROFILE, { ...PROFILE, id: "bp-other", userId: "someone-else", pan: "ZZZZZ9999Z", name: "Someone Else" }] });
  });
  await page.route(`${API_URL}/admin/users/*/details`, (r) => {
    const body = r.request().postDataJSON();
    calls.details.push(body);
    current = { ...current, ...body };
    return r.fulfill({ json: current });
  });
  await page.route(`${API_URL}/admin/users/*/billing-profiles`, (r) => {
    const id = r.request().url().split("/users/")[1].split("/")[0];
    const body = r.request().postDataJSON();
    calls.billingFor.push({ id, body });
    return r.fulfill({ status: 201, json: { ...PROFILE, id: "bp-new", ...body, userId: id, approvalStatus: "pending" } });
  });
  return calls;
}

async function openAmit(page: Page) {
  await page.goto("/settings");
  await page.getByRole("button", { name: "Edit access for Amit Kumar" }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("heading", { name: "Amit Kumar" })).toBeVisible();
  return sheet;
}

test.describe("People → Edit details", () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test("full admin: details and their own bank details show in the person sheet", async ({ page }) => {
    await signIn(page, "ADMIN");
    await peopleApi(page);
    const sheet = await openAmit(page);
    const details = sheet.getByRole("region", { name: "Details", exact: true });
    await expect(details).toContainText("+919000000001");
    await expect(details).toContainText("12 MG Road, Maharashtra 400001");
    await expect(details).toContainText("Not added"); // WhatsApp number
    const bank = sheet.getByRole("region", { name: "Bank details" });
    await expect(bank).toContainText("•••• 9012");
    await expect(bank).not.toContainText("Someone Else");
    await shot(page, "people-details");
  });

  test("full admin: review step lists before → after, then only changed fields are saved", async ({ page }) => {
    await signIn(page, "ADMIN");
    const calls = await peopleApi(page);
    const sheet = await openAmit(page);
    await sheet.getByRole("button", { name: "Edit details" }).click();
    const dialog = page.getByRole("dialog", { name: "Edit details" });
    await expect(dialog.getByLabel("Name")).toHaveValue("Amit Kumar");
    await expect(dialog.getByLabel("Phone", { exact: true })).toHaveValue("9000000001");
    const review = dialog.getByRole("button", { name: "Review changes" });
    await expect(review).toBeDisabled();

    await dialog.getByLabel("WhatsApp number").fill("98765 43210");
    await dialog.getByLabel("State").fill("Karnataka");
    await review.click();
    const summary = dialog.getByRole("status");
    await expect(summary).toContainText("Save these changes?");
    await expect(summary).toContainText("+919876543210");
    await expect(summary).toContainText("Karnataka");
    await shot(page, "people-edit-details-review");
    expect(calls.details).toEqual([]);

    await dialog.getByRole("button", { name: "Save 2 changes" }).click();
    await expect(page.getByText("Details saved for Amit Kumar.")).toBeVisible();
    expect(calls.details).toEqual([{ secondaryPhone: "+919876543210", state: "Karnataka" }]);
    await expect(dialog).toBeHidden();
  });

  test("bad phone and PIN code are caught before anything is sent; Back to editing keeps the values", async ({ page }) => {
    await signIn(page, "ADMIN");
    const calls = await peopleApi(page);
    const sheet = await openAmit(page);
    await sheet.getByRole("button", { name: "Edit details" }).click();
    const dialog = page.getByRole("dialog", { name: "Edit details" });
    await dialog.getByLabel("Phone", { exact: true }).fill("98765");
    await dialog.getByLabel("PIN code").fill("4000");
    await expect(dialog.getByText("Enter a 10-digit mobile number.")).toBeVisible();
    await expect(dialog.getByText("Enter a 6-digit PIN code.")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Review changes" })).toBeDisabled();

    await dialog.getByLabel("Phone", { exact: true }).fill("9000000002");
    await dialog.getByLabel("PIN code").fill("400001");
    await dialog.getByRole("button", { name: "Review changes" }).click();
    await dialog.getByRole("button", { name: "Back to editing" }).click();
    await expect(dialog.getByLabel("Phone", { exact: true })).toHaveValue("9000000002");
    await dialog.getByRole("button", { name: "Review changes" }).click();
    await dialog.getByRole("button", { name: "Save 1 change" }).click();
    await expect(page.getByText("Details saved for Amit Kumar.")).toBeVisible();
    expect(calls.details).toEqual([{ phoneNumber: "+919000000002" }]);
  });

  test("full admin: adding bank details for them goes to the owner route", async ({ page }) => {
    await signIn(page, "ADMIN");
    const calls = await peopleApi(page);
    const sheet = await openAmit(page);
    await sheet.getByRole("region", { name: "Bank details" }).getByRole("button", { name: "Add" }).click();
    const dialog = page.getByRole("dialog", { name: /Add bank details/ });
    await expect(dialog).toContainText("for Amit Kumar");
    await dialog.getByLabel("PAN", { exact: true }).fill("FGHIJ5678K");
    await dialog.getByLabel("Name on PAN").fill("Amit Kumar");
    await dialog.getByLabel("Account number").fill("998877665544");
    await dialog.getByLabel("IFSC").fill("ICIC0004321");
    await dialog.getByRole("button", { name: "Add bank details" }).click();
    await expect(page.getByText("Bank details saved. Finance will check them before the next payout.")).toBeVisible();
    expect(calls.billingFor).toEqual([{ id: "u-1", body: { pan: "FGHIJ5678K", name: "Amit Kumar", bankAccountNumber: "998877665544", ifscCode: "ICIC0004321" } }]);
    expect(calls.billingOwn).toBe(0);
  });

  test("a restricted admin sees no Edit details or Bank details", async ({ page }) => {
    await signIn(page, "ADMIN", { permissions: perms(KEYS.filter((k) => k !== "finance.pay")) });
    await peopleApi(page);
    const sheet = await openAmit(page);
    await expect(sheet.getByRole("button", { name: "Edit details" })).toHaveCount(0);
    await expect(sheet.getByRole("region", { name: "Bank details" })).toHaveCount(0);
  });

  test("finance with People access sees no Edit details", async ({ page }) => {
    await signIn(page, "FINANCE", { permissions: { ...userFor("FINANCE").permissions, "users.view": true, "users.edit": true } });
    await peopleApi(page);
    const sheet = await openAmit(page);
    await expect(sheet.getByRole("button", { name: "Edit details" })).toHaveCount(0);
    await expect(sheet.getByRole("region", { name: "Details", exact: true })).toHaveCount(0);
  });
});
