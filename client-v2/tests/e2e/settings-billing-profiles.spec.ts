import { expect, test, type Page } from "@playwright/test";

import { API_URL, mockApi, shot, signIn, userFor } from "./fixtures";

/**
 * Settings → Billing profiles (ported from v1 /profile → Billing for Admin and
 * Finance): every account's bank details, filter + search, a detail sheet with
 * the account number hidden until asked, Edit (finance.edit) and Approve /
 * Reject (finance.pay). API fully mocked; server rules: billing/routes.js.
 */

const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

const PROFILES = [
  { id: "bp-amit", userId: "u-amit", pan: "ABCDE1234F", name: "Amit Kumar", gstin: "27ABCDE1234F1Z5", msme: null, bankAccountNumber: "123456789012", ifscCode: "HDFC0001234", approvalStatus: "pending", createdAt: ago(1), user: { id: "u-amit", name: "Amit Kumar", phoneNumber: "+919000000001", email: "amit@gmail.com" } },
  { id: "bp-riya", userId: "u-riya", pan: "FGHIJ5678K", name: "Riya Mehta", gstin: null, msme: "UDYAM-MH-01-0000001", bankAccountNumber: "998877665544", ifscCode: "ICIC0004321", approvalStatus: "approved", createdAt: ago(10), user: { id: "u-riya", name: "Riya Mehta", phoneNumber: null, email: "riya@example.com" } },
  { id: "bp-sam", userId: "u-sam", pan: "KLMNO4321P", name: "Sam Rao", gstin: null, msme: null, bankAccountNumber: "555544443333", ifscCode: "SBIN0000001", approvalStatus: "rejected", createdAt: ago(20), user: { id: "u-sam", name: "Sam Rao", phoneNumber: null, email: "sam@example.com" } },
];

async function billingApi(page: Page) {
  const calls = { update: [] as { id: string; body: Record<string, unknown> }[], approval: [] as { id: string; body: Record<string, unknown> }[] };
  let rows = PROFILES.map((p) => ({ ...p }));
  await mockApi(page);
  await page.route(`${API_URL}/billing-profiles`, (r) => r.fulfill({ json: rows }));
  await page.route(`${API_URL}/billing-profiles/*`, (r) => {
    const id = r.request().url().split("/billing-profiles/")[1];
    const body = r.request().postDataJSON();
    calls.update.push({ id, body });
    rows = rows.map((p) => (p.id === id ? { ...p, ...body } : p));
    return r.fulfill({ json: rows.find((p) => p.id === id) });
  });
  await page.route(`${API_URL}/billing-profiles/*/approval`, (r) => {
    const id = r.request().url().split("/billing-profiles/")[1].split("/")[0];
    const body = r.request().postDataJSON();
    calls.approval.push({ id, body });
    rows = rows.map((p) => (p.id === id ? { ...p, approvalStatus: body.approvalStatus } : p));
    return r.fulfill({ json: rows.find((p) => p.id === id) });
  });
  return calls;
}

const tab = (page: Page) => page.getByRole("tabpanel", { name: "Billing profiles" });

test.describe("Settings → Billing profiles", () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test("finance: lists every account's profiles, filters by status and searches by person, PAN or GSTIN", async ({ page }) => {
    await signIn(page, "FINANCE");
    await billingApi(page);
    await page.goto("/settings?tab=billing");
    await expect(page.getByRole("tab", { name: "Billing profiles" })).toHaveAttribute("aria-selected", "true");
    const panel = tab(page);
    await expect(panel.getByRole("row")).toHaveCount(4); // header + 3
    await expect(panel.getByTestId("billing-row-bp-amit")).toContainText("Waiting for approval");
    await expect(panel.getByTestId("billing-row-bp-amit")).toContainText("•••• 9012");
    await expect(panel).not.toContainText("123456789012");
    await shot(page, "settings-billing-list");

    await panel.getByRole("radio", { name: /^Approved/ }).click();
    await expect(panel.getByRole("row")).toHaveCount(2);
    await expect(panel).toContainText("Riya Mehta");
    await panel.getByRole("radio", { name: /^Rejected/ }).click();
    await expect(panel.getByRole("row")).toHaveCount(2);
    await expect(panel).toContainText("Sam Rao");
    await panel.getByRole("radio", { name: /^All/ }).click();

    const search = panel.getByRole("searchbox", { name: "Search bank details" });
    await search.fill("klmno4321p");
    await expect(panel.getByRole("row")).toHaveCount(2);
    await expect(panel).toContainText("Sam Rao");
    await search.fill("27ABCDE");
    await expect(panel.getByRole("row")).toHaveCount(2);
    await expect(panel).toContainText("Amit Kumar");
    await search.fill("riya@");
    await expect(panel.getByRole("row")).toHaveCount(2);
    await expect(panel).toContainText("Riya Mehta");
    await search.fill("nobody");
    await expect(panel.getByText("Nothing matches")).toBeVisible();
  });

  test("finance: the sheet hides the account number until shown, edits send only what changed", async ({ page }) => {
    await signIn(page, "FINANCE");
    const calls = await billingApi(page);
    await page.goto("/settings?tab=billing");
    await tab(page).getByRole("button", { name: "View bank details FGHIJ5678K for Riya Mehta" }).click();
    const sheet = page.getByRole("dialog", { name: "Riya Mehta" });
    await expect(sheet.getByTestId("account-number")).toHaveText("•••• 5544");
    await expect(sheet).toContainText("UDYAM-MH-01-0000001");
    await expect(sheet).toContainText("ICIC0004321");
    await sheet.getByRole("button", { name: "Show" }).click();
    await expect(sheet.getByTestId("account-number")).toHaveText("998877665544");
    await sheet.getByRole("button", { name: "Hide" }).click();
    await expect(sheet.getByTestId("account-number")).toHaveText("•••• 5544");
    // Already approved: no decision to make here.
    await expect(sheet.getByRole("button", { name: "Approve" })).toHaveCount(0);

    await sheet.getByRole("button", { name: "Edit" }).click();
    const dialog = page.getByRole("dialog", { name: /Edit bank details/ });
    await expect(dialog).toContainText("for Riya Mehta");
    await expect(dialog).toContainText("keep their current approval");
    await dialog.getByLabel("IFSC").fill("ICIC0009999");
    await dialog.getByLabel("GSTIN (optional)").fill("27FGHIJ5678K1Z5");
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Bank details saved.", { exact: true })).toBeVisible();
    expect(calls.update).toEqual([{ id: "bp-riya", body: { ifscCode: "ICIC0009999", gstin: "27FGHIJ5678K1Z5" } }]);
    await expect(sheet).toContainText("ICIC0009999");
  });

  test("finance: approves a waiting profile; reject asks first", async ({ page }) => {
    await signIn(page, "FINANCE");
    const calls = await billingApi(page);
    await page.goto("/settings?tab=billing");
    await tab(page).getByRole("button", { name: "View bank details ABCDE1234F for Amit Kumar" }).click();
    const sheet = page.getByRole("dialog", { name: "Amit Kumar" });
    await expect(sheet).toContainText("Waiting for approval");

    await sheet.getByRole("button", { name: "Reject" }).click();
    await expect(sheet.getByRole("alert")).toContainText("won't pay into these bank details");
    expect(calls.approval).toEqual([]);
    await sheet.getByRole("button", { name: "Keep it" }).click();
    await shot(page, "settings-billing-sheet");

    await sheet.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByText("Bank details approved: Amit Kumar")).toBeVisible();
    expect(calls.approval).toEqual([{ id: "bp-amit", body: { approvalStatus: "approved" } }]);
    await expect(sheet.getByText("Approved", { exact: true })).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Approve" })).toHaveCount(0);
  });

  test("finance: reject confirmed sends rejected", async ({ page }) => {
    await signIn(page, "FINANCE");
    const calls = await billingApi(page);
    await page.goto("/settings?tab=billing");
    await tab(page).getByRole("button", { name: "View bank details ABCDE1234F for Amit Kumar" }).click();
    const sheet = page.getByRole("dialog", { name: "Amit Kumar" });
    await sheet.getByRole("button", { name: "Reject" }).click();
    await sheet.getByRole("button", { name: "Yes, reject" }).click();
    await expect(page.getByText("Bank details rejected: Amit Kumar")).toBeVisible();
    expect(calls.approval).toEqual([{ id: "bp-amit", body: { approvalStatus: "rejected" } }]);
  });

  test("admin sees the tab", async ({ page }) => {
    await signIn(page, "ADMIN");
    await billingApi(page);
    await page.goto("/settings");
    await page.getByRole("tab", { name: "Billing profiles" }).click();
    await expect(tab(page).getByRole("row")).toHaveCount(4);
  });

  test("finance without pay or edit: can look, but no Edit, Approve or Reject on someone else's", async ({ page }) => {
    await signIn(page, "FINANCE", { permissions: { ...userFor("FINANCE").permissions, "finance.edit": false, "finance.pay": false } });
    await billingApi(page);
    await page.goto("/settings?tab=billing");
    await tab(page).getByRole("button", { name: "View bank details ABCDE1234F for Amit Kumar" }).click();
    const sheet = page.getByRole("dialog", { name: "Amit Kumar" });
    await expect(sheet.getByTestId("account-number")).toHaveText("•••• 9012");
    await expect(sheet.getByRole("button", { name: "Edit" })).toHaveCount(0);
    await expect(sheet.getByRole("button", { name: "Approve" })).toHaveCount(0);
    await expect(sheet.getByRole("button", { name: "Reject" })).toHaveCount(0);
  });

  for (const role of ["CREATOR", "PLAN_MAKER"] as const) {
    test(`${role.toLowerCase()} gets no Billing profiles tab`, async ({ page }) => {
      await signIn(page, role);
      await billingApi(page);
      await page.goto("/settings?tab=billing");
      await expect(page.getByRole("heading", { name: "Your details" })).toBeVisible();
      await expect(page.getByRole("tab", { name: "Billing profiles" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: /View bank details/ })).toHaveCount(0);
    });
  }
});

