import { test, expect } from "@playwright/test";

import { signIn, mockApi, API_URL } from "./fixtures";

/**
 * People → Edit details (12 Oct): a full admin edits a creator's contact,
 * address and billing profiles in a 4-step wizard (Contact → Address →
 * Billing → Review). Row actions are icon buttons now, still reachable by
 * their accessible name. Server rules (full admin only, only changed fields
 * written + audit-logged, duplicate phone 409) are in
 * server/src/modules/admin/service.test.js.
 */
const creator = {
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
  whatsappVerified: false,
  permissions: {},
  createdAt: "2026-09-24T00:00:00.000Z",
};
const profile = {
  id: "bp-1",
  userId: "u-1",
  pan: "ABCDE1234F",
  name: "Amit Kumar",
  gstin: null,
  msme: null,
  bankAccountNumber: "123456789012",
  ifscCode: "HDFC0001234",
  approvalStatus: "approved",
  createdAt: "2026-09-24T00:00:00.000Z",
};

test.describe("People — edit a creator's details (12 Oct)", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("full admin: details are visible, then Contact → Address → Billing → Review saves only what changed", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    let current = { ...creator };
    let detailsBody: Record<string, unknown> | null = null;
    let billingBody: Record<string, unknown> | null = null;
    await page.route(`${API_URL}/admin/users`, (route) => route.fulfill({ json: [current] }));
    await page.route(`${API_URL}/billing-profiles`, (route) => route.fulfill({ json: [profile, { ...profile, id: "bp-other", userId: "someone-else", pan: "ZZZZZ9999Z" }] }));
    await page.route(`${API_URL}/billing-profiles/bp-1`, (route) => {
      billingBody = route.request().postDataJSON();
      return route.fulfill({ json: { ...profile, ...billingBody } });
    });
    await page.route(`${API_URL}/admin/users/u-1/details`, (route) => {
      detailsBody = route.request().postDataJSON();
      current = { ...current, ...(detailsBody as object), addressLine2: null };
      return route.fulfill({ json: current });
    });

    await page.goto("/users");
    // Row actions are icons, one row.
    for (const name of ["Edit details", "Change email", "Reset password", "Edit access"]) {
      await expect(page.getByRole("row").filter({ hasText: "Amit Kumar" }).getByRole("button", { name })).toBeVisible();
    }

    // The detail panel shows contact + address read-only.
    await page.getByRole("cell", { name: /Amit Kumar/ }).first().click();
    const details = page.getByTestId("person-details");
    await expect(details).toContainText("+919000000001");
    await expect(details).toContainText("12 MG Road");
    await expect(details).toContainText("Maharashtra 400001");

    await page.getByRole("row").filter({ hasText: "Amit Kumar" }).getByRole("button", { name: "Edit details" }).click();
    const dialog = page.getByTestId("edit-details");

    // 1 Contact
    await expect(dialog.getByLabel("Name")).toHaveValue("Amit Kumar");
    await expect(dialog.getByLabel("Phone", { exact: true })).toHaveValue("9000000001");
    await dialog.getByLabel("Secondary phone").fill("98765");
    await expect(dialog.getByRole("button", { name: "Next" })).toBeDisabled();
    await dialog.getByLabel("Secondary phone").fill("9876543210");
    await dialog.getByRole("button", { name: "Next" }).click();

    // 2 Address
    await expect(dialog.getByLabel("Address line 1")).toHaveValue("12 MG Road");
    await dialog.getByLabel("Address line 1").fill("");
    await dialog.getByLabel("Pincode").fill("411");
    await expect(dialog.getByRole("button", { name: "Next" })).toBeDisabled();
    await dialog.getByLabel("Pincode").fill("411001");
    await dialog.getByRole("button", { name: "Next" }).click();

    // 3 Billing — only this creator's profile; edit it in place.
    const billing = page.getByTestId("edit-details-billing");
    await expect(billing.getByTestId("edit-details-billing-card")).toHaveCount(1);
    await expect(billing).toContainText("ABCDE1234F");
    await expect(billing).toContainText("•••• 9012");
    await billing.getByRole("button", { name: "Edit billing profile ABCDE1234F" }).click();
    await billing.getByLabel("IFSC code").fill("ICIC0004321");
    await billing.getByRole("button", { name: "Save changes" }).click();
    await expect(billing).toContainText("Saved.");
    expect(billingBody).toMatchObject({ pan: "ABCDE1234F", ifscCode: "ICIC0004321" });
    await dialog.getByRole("button", { name: "Next" }).click();

    // 4 Review — before → after, only the changed fields are sent.
    const review = page.getByTestId("edit-details-review");
    await expect(review).toContainText("Secondary phone");
    await expect(review).toContainText("(cleared)");
    await dialog.getByRole("button", { name: "Save details" }).click();
    await expect(dialog).toHaveCount(0);
    expect(detailsBody).toEqual({ secondaryPhone: "+919876543210", addressLine1: "", pincode: "411001" });
    await expect(details).toContainText("+919876543210");
    await expect(details).toContainText("Maharashtra 411001");
  });

  test("the server's error stays on the Review step", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.route(`${API_URL}/admin/users`, (route) => route.fulfill({ json: [creator] }));
    await page.route(`${API_URL}/billing-profiles`, (route) => route.fulfill({ json: [] }));
    await page.route(`${API_URL}/admin/users/u-1/details`, (route) =>
      route.fulfill({ status: 409, json: { error: { code: "PHONE_ALREADY_REGISTERED", message: "Another account already uses this phone number" } } })
    );
    await page.goto("/users");
    await page.getByRole("button", { name: "Edit details" }).first().click();
    const dialog = page.getByTestId("edit-details");
    await dialog.getByLabel("Phone", { exact: true }).fill("9000000002");
    for (let i = 0; i < 3; i++) await dialog.getByRole("button", { name: "Next" }).click();
    await dialog.getByRole("button", { name: "Save details" }).click();
    await expect(dialog).toContainText("Another account already uses this phone number");
  });

  test("a restricted sub-admin gets no Edit details action", async ({ page }) => {
    await signIn(page, "ADMIN");
    await page.addInitScript(() => {
      const raw = window.localStorage.getItem("taggify_auth");
      if (!raw) return;
      const s = JSON.parse(raw);
      s.user.permissions = { ...s.user.permissions, "finance.pay": false };
      window.localStorage.setItem("taggify_auth", JSON.stringify(s));
    });
    await mockApi(page);
    await page.route(`${API_URL}/admin/users`, (route) => route.fulfill({ json: [creator] }));
    await page.goto("/users");
    await expect(page.getByRole("button", { name: "Reset password" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit details" })).toHaveCount(0);
  });
});
