import { test, expect, type Page } from "@playwright/test";

import { signIn, mockApi, API_URL } from "./fixtures";

/**
 * Payments tab → Receivables (tasks.md #5, 23 Sep) — reuses
 * components/invoices/client-invoices-panel.tsx (already covered for
 * /invoices in invoices-receivables.spec.ts), here with hasAttachment on by
 * default and the attach-invoice control rendered inline. Server side
 * (hasAttachment filter, invoiceAttachment resolution) is covered by
 * vitest in server/src/modules/invoices/clientInvoices.test.js.
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
      createdById: "pm-1",
      createdBy: { id: "pm-1", name: "Priya POC" },
      campaign: { id: "camp-1", title: "Q1 Meme Push", brandName: "Acme" },
      invoiceAttachment: null,
    },
    issuedBy: { id: "pm-1", name: "Priya POC", role: "PLAN_MAKER" },
    ...overrides,
  };
}

async function mockReceivables(page: Page, items: unknown[]) {
  const handler = (route: Parameters<Parameters<Page["route"]>[1]>[0]) => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get("hasAttachment")).toBe("true");
    return route.fulfill({ json: { items, total: items.length } });
  };
  await page.route(`${API_URL}/invoices/client?**`, handler);
}

test.describe("Payments — Receivables tab", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("ADMIN sees the ledger, filtered to plans with a real invoice attached, showing the POC", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await mockReceivables(page, [clientInvoice()]);

    await page.goto("/payments");
    await page.getByRole("tab", { name: "Client receivables" }).click();

    const rows = page.getByTestId("client-invoice-row-list");
    await expect(rows).toContainText("PI-0007");
    await expect(rows).toContainText("POC · Priya POC");
  });

  test("attaching the real invoice from the Payments tab hits the same plan attachment route as the Plans page", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    let attached: Record<string, unknown> | null = null;
    await page.route(`${API_URL}/invoices/client?**`, (route) => route.fulfill({ json: { items: [clientInvoice({ plan: { ...clientInvoice().plan, invoiceAttachment: attached } })], total: 1 } }));
    await page.route(`${API_URL}/plans/plan-1/invoice-attachment/upload-url`, (route) =>
      route.fulfill({ json: { uploadUrl: `${API_URL}/fake-cloudinary`, apiKey: "k", timestamp: 1, signature: "s", publicId: "plan-invoice-attachments/plan-1/uuid" } })
    );
    await page.route(`${API_URL}/fake-cloudinary`, (route) => route.fulfill({ status: 200, json: { ok: true } }));
    await page.route(`${API_URL}/plans/plan-1/invoice-attachment`, (route) => {
      const body = route.request().postDataJSON();
      attached = { name: body.fileName, url: "https://cdn/plan-1.pdf", uploadedAt: "2026-09-23T00:00:00.000Z", uploadedById: "test-user-1" };
      return route.fulfill({ status: 201, json: attached });
    });

    await page.goto("/payments");
    await page.getByRole("tab", { name: "Client receivables" }).click();

    await page.getByRole("button", { name: "Attach invoice (PDF)" }).click();
    await page.setInputFiles('input[type="file"]', { name: "real-invoice.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%mock\n") });

    await expect(page.getByRole("link", { name: "real-invoice.pdf" })).toBeVisible();
  });

  test("marking a receivable paid from the Payments tab still posts to /invoices/client/:id/mark-paid", async ({ page }) => {
    await signIn(page, "FINANCE");
    await mockApi(page);
    await mockReceivables(page, [clientInvoice()]);
    let body: Record<string, unknown> | null = null;
    await page.route(`${API_URL}/invoices/client/ci-1/mark-paid`, (route) => {
      body = route.request().postDataJSON();
      return route.fulfill({ json: clientInvoice({ status: "PAID", paidAt: "2026-09-23T00:00:00.000Z", paidAmount: "11800" }) });
    });

    await page.goto("/payments");
    await page.getByRole("tab", { name: "Client receivables" }).click();
    const row = page.getByTestId("client-invoice-row-list").locator("div.grid", { hasText: "PI-0007" });
    await row.getByRole("button", { name: "Mark paid" }).click();
    await page.getByRole("dialog", { name: "Mark PI-0007 as paid" }).getByRole("button", { name: "Confirm payment" }).click();

    await expect.poll(() => body).toEqual({});
  });
});
