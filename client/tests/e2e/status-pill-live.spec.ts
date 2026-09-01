import { test, expect } from "@playwright/test";

import { signIn, mockApi, type MockRole } from "./fixtures";
import type { Invoice } from "@/lib/api-client";

/**
 * Regression test for StatusPill's "live" indicator (components/ui/status-pill.tsx,
 * STATUS_CONFIG). The pulsing dot is meant to mark statuses that are genuinely
 * still in flight (RAISED, PENDING, ...) and stay off for terminal ones
 * (PAID, COMPLETED, ...) — this pins that behavior down so a future edit to
 * STATUS_CONFIG can't silently flip a status's `live` flag, or make the dot
 * stop rendering altogether, without a test noticing.
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
    paymentStatus: "COMPLETED",
    gstStatus: "COMPLETED",
    remarks: null,
    dueDate: null,
    paidAt: null,
    createdAt: new Date().toISOString(),
    overdueDays: 0,
    creator: { id: "creator-1", name: "Test Creator", phoneNumber: "+919876543210" },
    ...overrides,
  };
}

test.use({ viewport: { width: 1280, height: 900 } }); // desktop breakpoint — the "grid" row layout this test targets

test("live statuses show the pulsing dot, terminal statuses don't", async ({ page }) => {
  await signIn(page, ROLE);
  await mockApi(page);
  await page.route("**/invoices?**", (route) => {
    if (route.request().method() !== "GET") return route.fulfill({ status: 204, body: "" });
    return route.fulfill({
      json: {
        items: [
          invoice({ id: "inv-live", invoiceNumber: "INV-LIVE-TEST", status: "RAISED" }),
          invoice({ id: "inv-terminal", invoiceNumber: "INV-TERMINAL-TEST", status: "PAID" }),
        ],
        total: 2,
        page: 1,
        pageSize: 100,
      },
    });
  });

  await page.goto("/invoices");

  const liveRow = page.locator("div.grid", { hasText: "INV-LIVE-TEST" });
  const terminalRow = page.locator("div.grid", { hasText: "INV-TERMINAL-TEST" });

  await expect(liveRow.getByTestId("status-pill-live-dot")).toHaveCount(1);
  await expect(terminalRow.getByTestId("status-pill-live-dot")).toHaveCount(0);
});
