import { test, expect } from "@playwright/test";

import { signIn, mockApi, type MockRole } from "./fixtures";
import type { Invoice } from "@/lib/api-client";

/**
 * Regression coverage for collapsing the invoice row's actions
 * (app/invoices/page.tsx's InvoiceRowActions) — "Mark paid" stays a
 * visible primary action, while Reject/Download PDF/Download links move
 * behind a single "More actions" trigger, closed by default, instead of
 * four controls fighting for the same row.
 */

const ROLE: MockRole = "ADMIN";

function invoice(overrides: Partial<Invoice>): Invoice {
  return {
    id: overrides.id ?? "inv-1",
    creatorId: "creator-1",
    invoiceNumber: "INV-0001",
    amount: "10000",
    subtotal: "10000",
    isGstInvoice: false,
    gstAmount: "0",
    status: "RAISED",
    paymentStatus: "PENDING",
    gstStatus: "PENDING",
    remarks: null,
    dueDate: null,
    paidAt: null,
    createdAt: new Date().toISOString(),
    overdueDays: 0,
    creator: { id: "creator-1", name: "Test Creator", phoneNumber: "+919876543210" },
    ...overrides,
  };
}

test.use({ viewport: { width: 1280, height: 900 } }); // desktop breakpoint — the row this test targets is md:block only

test.describe("Invoices — collapsed row actions", () => {
  test("Mark paid stays visible (on an APPROVED row); Reject/Download move behind a closed 'More actions' menu", async ({ page }) => {
    await signIn(page, ROLE);
    await mockApi(page);
    await page.route("**/invoices?**", (route) => {
      if (route.request().method() !== "GET") return route.fulfill({ status: 204, body: "" });
      return route.fulfill({
        json: { items: [invoice({ id: "inv-raised", invoiceNumber: "INV-RAISED", status: "APPROVED" })], total: 1, page: 1, pageSize: 100 },
      });
    });

    await page.goto("/invoices");

    const row = page.locator("div.grid", { hasText: "INV-RAISED" });
    await expect(row.getByRole("button", { name: "Mark paid" })).toBeVisible();

    const trigger = row.getByTestId("invoice-actions-trigger-inv-raised");
    await expect(trigger).toBeVisible();
    const menu = page.getByTestId("invoice-actions-menu-inv-raised");
    await expect(menu).toHaveCount(0); // closed by default — no controls crowding the row

    await trigger.click();
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Download PDF" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Download links" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Reject invoice" })).toBeVisible();
  });

  test("clicking outside the open menu closes it", async ({ page }) => {
    await signIn(page, ROLE);
    await mockApi(page);
    await page.route("**/invoices?**", (route) => {
      if (route.request().method() !== "GET") return route.fulfill({ status: 204, body: "" });
      return route.fulfill({
        json: { items: [invoice({ id: "inv-raised", invoiceNumber: "INV-RAISED" })], total: 1, page: 1, pageSize: 100 },
      });
    });

    await page.goto("/invoices");
    await page.getByTestId("invoice-actions-trigger-inv-raised").click();
    const menu = page.getByTestId("invoice-actions-menu-inv-raised");
    await expect(menu).toBeVisible();

    await page.mouse.click(20, 20);
    await expect(menu).toHaveCount(0);
  });

  // 12 Sep — the RAISED → APPROVED sign-off that was missing (APPROVED was
  // in the enum but nothing ever set it). Admin-only; Finance still just
  // marks paid.
  test("ADMIN sees an Approve button on a RAISED row, which calls POST /invoices/:id/approve", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    let approveCalled = false;
    await page.route("**/invoices/inv-raised/approve", (route) => {
      approveCalled = true;
      return route.fulfill({ json: invoice({ id: "inv-raised", status: "APPROVED" }) });
    });
    await page.route("**/invoices?**", (route) => {
      if (route.request().method() !== "GET") return route.fulfill({ status: 204, body: "" });
      return route.fulfill({
        json: { items: [invoice({ id: "inv-raised", invoiceNumber: "INV-RAISED" })], total: 1, page: 1, pageSize: 100 },
      });
    });

    await page.goto("/invoices");
    const row = page.locator("div.grid", { hasText: "INV-RAISED" });
    await expect(row.getByRole("button", { name: "Approve" })).toBeVisible();
    // Payment waits on approval — no Mark paid on a RAISED row.
    await expect(row.getByRole("button", { name: "Mark paid" })).toHaveCount(0);
    // The side panel carries the same action.
    await expect(page.getByTestId("invoice-detail-panel").getByRole("button", { name: "Approve invoice" })).toBeVisible();

    await row.getByRole("button", { name: "Approve" }).click();
    await expect.poll(() => approveCalled).toBe(true);
  });

  test("an already-APPROVED row has no Approve button, only Mark paid", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.route("**/invoices?**", (route) => {
      if (route.request().method() !== "GET") return route.fulfill({ status: 204, body: "" });
      return route.fulfill({
        json: { items: [invoice({ id: "inv-approved", invoiceNumber: "INV-APPROVED", status: "APPROVED" })], total: 1, page: 1, pageSize: 100 },
      });
    });

    await page.goto("/invoices");
    const row = page.locator("div.grid", { hasText: "INV-APPROVED" });
    await expect(row.getByRole("button", { name: "Mark paid" })).toBeVisible();
    await expect(row.getByRole("button", { name: "Approve" })).toHaveCount(0);
  });

  test("FINANCE sees Approve on a RAISED row and Mark paid on an APPROVED one — Finance approves and pays (23 Sep)", async ({ page }) => {
    await signIn(page, "FINANCE");
    await mockApi(page);
    let approveCalled = false;
    await page.route("**/invoices/inv-raised/approve", (route) => {
      approveCalled = true;
      return route.fulfill({ json: invoice({ id: "inv-raised", invoiceNumber: "INV-RAISED", status: "APPROVED" }) });
    });
    await page.route("**/invoices?**", (route) => {
      if (route.request().method() !== "GET") return route.fulfill({ status: 204, body: "" });
      return route.fulfill({
        json: {
          items: [
            invoice({ id: "inv-raised", invoiceNumber: "INV-RAISED" }),
            invoice({ id: "inv-approved", invoiceNumber: "INV-APPROVED", status: "APPROVED" }),
          ],
          total: 2,
          page: 1,
          pageSize: 100,
        },
      });
    });

    await page.goto("/invoices");
    const raised = page.locator("div.grid", { hasText: "INV-RAISED" });
    await expect(raised.getByRole("button", { name: "Approve" })).toBeVisible();
    await expect(raised.getByRole("button", { name: "Mark paid" })).toHaveCount(0);
    await raised.click();
    await expect(page.getByTestId("invoice-detail-panel")).not.toContainText("Awaiting an admin's approval");
    await raised.getByRole("button", { name: "Approve" }).click();
    await expect.poll(() => approveCalled).toBe(true);

    const approved = page.locator("div.grid", { hasText: "INV-APPROVED" });
    await expect(approved.getByRole("button", { name: "Mark paid" })).toBeVisible();
    await expect(approved.getByRole("button", { name: "Approve" })).toHaveCount(0);
  });

  test("a paid invoice offers only the download actions, not Mark paid or Reject", async ({ page }) => {
    await signIn(page, ROLE);
    await mockApi(page);
    await page.route("**/invoices?**", (route) => {
      if (route.request().method() !== "GET") return route.fulfill({ status: 204, body: "" });
      return route.fulfill({
        json: {
          items: [invoice({ id: "inv-paid", invoiceNumber: "INV-PAID", status: "PAID", paymentStatus: "COMPLETED" })],
          total: 1,
          page: 1,
          pageSize: 100,
        },
      });
    });

    await page.goto("/invoices");
    const row = page.locator("div.grid", { hasText: "INV-PAID" });
    await expect(row.getByRole("button", { name: "Mark paid" })).toHaveCount(0);

    await row.getByTestId("invoice-actions-trigger-inv-paid").click();
    const menu = page.getByTestId("invoice-actions-menu-inv-paid");
    await expect(menu.getByRole("menuitem", { name: "Download PDF" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Reject invoice" })).toHaveCount(0);
  });
});
