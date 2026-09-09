import { test, expect } from "@playwright/test";

import { signIn, mockApi, API_URL } from "./fixtures";

/**
 * bugs.md — "scroll invoice not working": the row list, its column header,
 * and the persistent detail panel all just grew to full content height
 * with nothing actually bounding/scrolling them — the *page* scrolled
 * instead, carrying the header and detail panel away with the rows. Fixed
 * by giving the page root a real height (app/invoices/page.tsx) so the row
 * list and detail panel each get their own independent scroll region while
 * the header stays sticky and the panel stays put.
 */
test.describe("Invoices — scrollable list with a fixed header and detail panel", () => {
  // Short viewport so 30 rows can't possibly fit without scrolling —
  // this is what makes the bug reproduce reliably.
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

  test("column header and detail panel stay fixed while the row list scrolls", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.route(`${API_URL}/invoices?*`, (route) =>
      route.fulfill({ json: { items: invoices, total: invoices.length, page: 1, pageSize: 100 } })
    );

    await page.goto("/invoices");

    const header = page.getByTestId("invoice-table-header");
    await expect(header).toBeVisible();
    const headerBoxBefore = await header.boundingBox();

    const rowList = page.getByTestId("invoice-row-list");
    const firstRow = rowList.getByText("INV-000", { exact: true });
    const lastRow = rowList.getByText("INV-029", { exact: true });
    await expect(firstRow).toBeInViewport();
    await expect(lastRow).not.toBeInViewport();

    // Scroll the row list itself, not the page — the whole point of the fix.
    await rowList.evaluate((el) => el.scrollBy(0, 100000));

    await expect(lastRow).toBeInViewport();

    const headerBoxAfter = await header.boundingBox();
    expect(Math.round(headerBoxAfter!.y)).toBe(Math.round(headerBoxBefore!.y));
  });

  test("selected invoice's detail panel doesn't scroll away with the list", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.route(`${API_URL}/invoices?*`, (route) =>
      route.fulfill({ json: { items: invoices, total: invoices.length, page: 1, pageSize: 100 } })
    );

    await page.goto("/invoices");
    await page.getByTestId("invoice-row-list").getByText("INV-000", { exact: true }).click();

    const panel = page.getByTestId("invoice-detail-panel");
    const panelInvoiceNumber = panel.getByText("INV-000", { exact: true });
    await expect(panelInvoiceNumber).toBeInViewport();

    await page.getByTestId("invoice-row-list").evaluate((el) => el.scrollBy(0, 100000));

    // Still selected, still visible — the panel has its own scroll region
    // and isn't carried off by the list's.
    await expect(panelInvoiceNumber).toBeInViewport();
  });
});
