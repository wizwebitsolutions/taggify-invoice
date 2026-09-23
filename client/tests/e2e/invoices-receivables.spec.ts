import { test, expect, type Page } from "@playwright/test";

import { signIn, mockApi, API_URL } from "./fixtures";

/**
 * /invoices → Payables / Receivables toggle (user decision, 23 Sep — the
 * plan's client invoice is "tracked + listed in /invoices"). Component:
 * components/invoices/client-invoices-panel.tsx. Server side
 * (invoices/clientInvoices.js + the ledger upsert in plans/service.js) is
 * covered by vitest; this checks the view is reachable by the right roles,
 * renders the ledger, and that Mark paid / Cancel hit the right routes.
 */
function clientInvoice(overrides: Record<string, unknown> = {}) {
  return {
    id: "ci-1",
    planId: "plan-1",
    campaignId: "camp-1",
    invoiceNumber: "PI-0007",
    subtotal: "10000",
    gstPercent: "18",
    gstAmount: "1800",
    total: "11800",
    status: "ISSUED",
    issuedAt: "2026-09-20T00:00:00.000Z",
    paidAt: null,
    paidAmount: null,
    remarks: null,
    plan: {
      id: "plan-1",
      name: "Q1 Meme Push",
      clientName: "Rohit Sharma",
      clientCompany: "Acme Foods Pvt Ltd",
      clientGstNumber: "27ABCDE1234F1Z5",
      createdById: "test-user-1",
      createdBy: { id: "test-user-1", name: "Test User" },
      campaign: { id: "camp-1", title: "Q1 Meme Push", brandName: "Acme" },
    },
    issuedBy: { id: "test-user-1", name: "Test User", role: "PLAN_MAKER" },
    ...overrides,
  };
}

async function mockReceivables(page: Page, items: unknown[]) {
  await page.route(`${API_URL}/invoices/client?**`, (route) => route.fulfill({ json: { items, total: items.length } }));
  await page.route(`${API_URL}/invoices/client`, (route) => route.fulfill({ json: { items, total: items.length } }));
}

test.describe("Invoices — Receivables view (client invoices, 23 Sep)", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  for (const role of ["ADMIN", "FINANCE", "PLAN_MAKER"] as const) {
    test(`${role} sees the Payables/Receivables toggle and the ledger under Receivables`, async ({ page }) => {
      await signIn(page, role);
      await mockApi(page);
      await mockReceivables(page, [clientInvoice(), clientInvoice({ id: "ci-2", invoiceNumber: "PI-0008", status: "PAID", paidAt: "2026-09-22T00:00:00.000Z", paidAmount: "11800" })]);

      await page.goto("/invoices");
      const tabs = page.getByRole("tablist", { name: "Invoice direction" });
      await expect(tabs).toBeVisible();
      await expect(tabs.getByRole("tab", { name: /Payables/ })).toHaveAttribute("aria-selected", "true");

      await tabs.getByRole("tab", { name: /Receivables/ }).click();
      const view = page.getByTestId("receivables-view");
      await expect(view).toBeVisible();
      const rows = view.getByTestId("client-invoice-row-list");
      await expect(rows).toContainText("PI-0007");
      await expect(rows).toContainText("Acme Foods Pvt Ltd");
      await expect(rows).toContainText("Q1 Meme Push");
      await expect(rows).toContainText("₹11,800");
      // The payables table is gone while Receivables is showing.
      await expect(page.getByTestId("invoice-table-header")).toHaveCount(0);
    });
  }

  test("CREATOR has no toggle and never sees the receivables view", async ({ page }) => {
    await signIn(page, "CREATOR");
    await mockApi(page);
    let listed = false;
    await page.route(`${API_URL}/invoices/client**`, (route) => {
      listed = true;
      return route.fulfill({ status: 403, json: { error: { code: "FORBIDDEN", message: "no" } } });
    });

    await page.goto("/invoices?view=receivables");
    await expect(page.getByRole("tablist", { name: "Invoice direction" })).toHaveCount(0);
    await expect(page.getByTestId("receivables-view")).toHaveCount(0);
    await expect(page.getByTestId("invoice-table-header")).toBeVisible();
    expect(listed).toBe(false);
  });

  test("?view=receivables deep-links straight to the ledger", async ({ page }) => {
    await signIn(page, "FINANCE");
    await mockApi(page);
    await mockReceivables(page, [clientInvoice()]);

    await page.goto("/invoices?view=receivables");
    await expect(page.getByRole("tab", { name: /Receivables/ })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("receivables-view")).toContainText("PI-0007");
  });

  test("FINANCE marks a client invoice paid — the modal posts amount + remarks to /invoices/client/:id/mark-paid", async ({ page }) => {
    await signIn(page, "FINANCE");
    await mockApi(page);
    await mockReceivables(page, [clientInvoice()]);
    let body: Record<string, unknown> | null = null;
    await page.route(`${API_URL}/invoices/client/ci-1/mark-paid`, (route) => {
      body = route.request().postDataJSON();
      return route.fulfill({ json: clientInvoice({ status: "PAID", paidAt: "2026-09-23T00:00:00.000Z", paidAmount: "11000", remarks: "TDS deducted" }) });
    });

    await page.goto("/invoices?view=receivables");
    const row = page.getByTestId("client-invoice-row-list").locator("div.grid", { hasText: "PI-0007" });
    await row.getByRole("button", { name: "Mark paid" }).click();

    const dialog = page.getByRole("dialog", { name: "Mark PI-0007 as paid" });
    await expect(dialog).toBeVisible();
    const amount = dialog.getByLabel("Amount received (₹)");
    await expect(amount).toHaveValue("11800");
    await amount.fill("11000");
    await dialog.getByLabel("Remarks (optional)").fill("TDS deducted");
    await dialog.getByRole("button", { name: "Confirm payment" }).click();

    await expect.poll(() => body).toEqual({ paidAmount: 11000, remarks: "TDS deducted" });
    await expect(dialog).toHaveCount(0);
  });

  test("FINANCE cancels an issued client invoice with a reason; a PAID row offers neither Mark paid nor Cancel", async ({ page }) => {
    await signIn(page, "FINANCE");
    await mockApi(page);
    await mockReceivables(page, [clientInvoice(), clientInvoice({ id: "ci-2", invoiceNumber: "PI-0008", status: "PAID", paidAt: "2026-09-22T00:00:00.000Z", paidAmount: "11800" })]);
    let body: Record<string, unknown> | null = null;
    await page.route(`${API_URL}/invoices/client/ci-1/cancel`, (route) => {
      body = route.request().postDataJSON();
      return route.fulfill({ json: clientInvoice({ status: "CANCELLED", remarks: "Deal fell through" }) });
    });

    await page.goto("/invoices?view=receivables");
    const list = page.getByTestId("client-invoice-row-list");
    const paid = list.locator("div.grid", { hasText: "PI-0008" });
    await expect(paid.getByRole("button", { name: "Mark paid" })).toHaveCount(0);
    await expect(paid.getByRole("button", { name: "Cancel" })).toHaveCount(0);
    await expect(paid.getByRole("button", { name: "Download PI-0008" })).toBeVisible();

    const issued = list.locator("div.grid", { hasText: "PI-0007" });
    await issued.getByRole("button", { name: "Cancel" }).click();
    const dialog = page.getByRole("dialog", { name: "Cancel PI-0007" });
    await expect(dialog.getByRole("button", { name: "Cancel invoice" })).toBeDisabled();
    await dialog.getByLabel("Reason").fill("Deal fell through");
    await dialog.getByRole("button", { name: "Cancel invoice" }).click();
    await expect.poll(() => body).toEqual({ remarks: "Deal fell through" });
  });

  test("PLAN_MAKER sees the ledger read-only — download, but no Mark paid / Cancel", async ({ page }) => {
    await signIn(page, "PLAN_MAKER");
    await mockApi(page);
    await mockReceivables(page, [clientInvoice()]);

    await page.goto("/invoices?view=receivables");
    const row = page.getByTestId("client-invoice-row-list").locator("div.grid", { hasText: "PI-0007" });
    await expect(row.getByRole("button", { name: "Download PI-0007" })).toBeVisible();
    await expect(row.getByRole("button", { name: "Mark paid" })).toHaveCount(0);
    await expect(row.getByRole("button", { name: "Cancel" })).toHaveCount(0);
  });
});
