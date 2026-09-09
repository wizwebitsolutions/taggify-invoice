import { test, expect } from "@playwright/test";

import { signIn, mockApi, API_URL } from "./fixtures";

/**
 * Supersedes the earlier "bounded box + its own scrollbar" fix for
 * bugs.md's "scroll invoice not working": user feedback (9 Sep) was that a
 * capped-height table/detail-panel with an internal scrollbar felt small
 * regardless of window size — "full scrollable, no fixed size of height".
 * The table and detail panel now grow to fit their content and the page
 * itself scrolls, same as any other page in the app.
 */
test.describe("Invoices — table and detail panel grow with content; the page scrolls", () => {
  test.use({ viewport: { width: 1280, height: 700 } });

  const invoices = Array.from({ length: 30 }, (_, i) => ({
    id: `inv-${i}`,
    creatorId: "user-1",
    invoiceNumber: `INV-${String(i).padStart(3, "0")}`,
    amount: String(10000 + i * 100),
    subtotal: String(10000 + i * 100),
    isGstInvoice: false,
    gstAmount: "0",
    status: "RAISED" as const,
    paymentStatus: "PENDING" as const,
    gstStatus: "PENDING" as const,
    remarks: null,
    dueDate: null,
    paidAt: null,
    createdAt: new Date("2026-01-01").toISOString(),
    overdueDays: 0,
    creator: { id: "user-1", name: "Demo Creator", phoneNumber: "+919000000003" },
    items: [],
  }));

  test("no internal scroll container clips the row list — every row is reachable by scrolling the page", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.route(`${API_URL}/invoices?*`, (route) =>
      route.fulfill({ json: { items: invoices, total: invoices.length, page: 1, pageSize: 100 } })
    );

    await page.goto("/invoices");

    const rowList = page.getByTestId("invoice-row-list");
    await expect(rowList).toHaveCSS("overflow-y", "visible");

    const firstRow = rowList.getByText("INV-000", { exact: true });
    const lastRow = rowList.getByText("INV-029", { exact: true });
    await expect(firstRow).toBeVisible();

    // Reached by scrolling the whole page, not a nested region.
    await lastRow.scrollIntoViewIfNeeded();
    await expect(lastRow).toBeInViewport();
  });

  test("selecting an invoice shows its detail panel, sized to its own content", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.route(`${API_URL}/invoices?*`, (route) =>
      route.fulfill({ json: { items: invoices, total: invoices.length, page: 1, pageSize: 100 } })
    );

    await page.goto("/invoices");
    await page.getByTestId("invoice-row-list").getByText("INV-000", { exact: true }).click();

    const panel = page.getByTestId("invoice-detail-panel");
    await expect(panel).toHaveCSS("overflow-y", "visible");
    await expect(panel.getByText("INV-000", { exact: true })).toBeVisible();
  });
});
