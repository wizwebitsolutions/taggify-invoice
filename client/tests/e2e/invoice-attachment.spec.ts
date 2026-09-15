import { test, expect } from "@playwright/test";

import { signIn, mockApi, API_URL } from "./fixtures";
import type { Invoice } from "@/lib/api-client";

/**
 * User request, 12 Sep — "attach invoice": the creator's own invoice
 * document (PDF/image) attached to an Invoice record so Finance sees it
 * next to the system-generated one. Component:
 * components/invoices/invoice-attachment.tsx (Invoices page detail panel +
 * campaign page rows). Upload is the same two-step direct-to-Cloudinary
 * flow as screenshots; here the "Cloudinary" URL is a mocked endpoint.
 */
function invoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: "inv-1",
    creatorId: "test-user-1",
    invoiceNumber: "INV-0001",
    amount: "10000",
    subtotal: "10000",
    isGstInvoice: false,
    gstAmount: "0",
    status: "APPROVED",
    paymentStatus: "PENDING",
    gstStatus: "PENDING",
    remarks: null,
    dueDate: null,
    paidAt: null,
    createdAt: new Date().toISOString(),
    overdueDays: 0,
    creator: { id: "test-user-1", name: "Test User", phoneNumber: "+919876543210" },
    attachment: null,
    ...overrides,
  };
}

test.describe("Invoice attachment — the creator's own invoice document", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("CREATOR attaches a PDF to their own invoice: upload-url → upload → confirm, then it shows as a link", async ({ page }) => {
    await signIn(page, "CREATOR");
    await mockApi(page);
    let attached: Invoice["attachment"] = null;
    await page.route("**/invoices?**", (route) => route.fulfill({ json: { items: [invoice({ attachment: attached })], total: 1, page: 1, pageSize: 100 } }));
    await page.route(`${API_URL}/invoices/inv-1/attachment/upload-url`, (route) =>
      route.fulfill({ json: { uploadUrl: `${API_URL}/fake-cloudinary`, apiKey: "k", timestamp: 1, signature: "s", publicId: "invoice-attachments/inv-1/uuid" } })
    );
    let uploadedField: string | undefined;
    await page.route(`${API_URL}/fake-cloudinary`, (route) => {
      uploadedField = route.request().headers()["content-type"];
      return route.fulfill({ status: 200, json: { ok: true } });
    });
    let confirmBody: { publicId: string; fileName: string } | undefined;
    await page.route(`${API_URL}/invoices/inv-1/attachment`, (route) => {
      confirmBody = route.request().postDataJSON();
      attached = { name: confirmBody!.fileName, url: "https://cdn/inv-1.pdf", uploadedAt: new Date().toISOString(), uploadedById: "test-user-1" };
      return route.fulfill({ status: 201, json: attached });
    });

    await page.goto("/invoices");
    const panel = page.getByTestId("invoice-detail-panel");
    await expect(panel.getByText("Creator's invoice document")).toBeVisible();
    await expect(panel.getByRole("button", { name: /Attach the creator's invoice/ })).toBeVisible();

    await panel.getByLabel("Attach invoice file for INV-0001").setInputFiles({ name: "gst-invoice.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 test") });

    await expect.poll(() => confirmBody).toEqual({ publicId: "invoice-attachments/inv-1/uuid", fileName: "gst-invoice.pdf" });
    expect(uploadedField).toContain("multipart/form-data");
    await expect(panel.getByRole("link", { name: "gst-invoice.pdf" })).toHaveAttribute("href", "https://cdn/inv-1.pdf");
    await expect(panel.getByRole("button", { name: "Replace" })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Remove attached invoice" })).toBeVisible();
  });

  test("Remove calls DELETE and a PAID invoice's attachment is read-only", async ({ page }) => {
    await signIn(page, "FINANCE");
    await mockApi(page);
    const att = { name: "old.pdf", url: "https://cdn/old.pdf", uploadedAt: new Date().toISOString(), uploadedById: "test-user-1" };
    await page.route("**/invoices?**", (route) =>
      route.fulfill({
        json: {
          items: [invoice({ id: "inv-open", invoiceNumber: "INV-OPEN", attachment: att }), invoice({ id: "inv-paid", invoiceNumber: "INV-PAID", status: "PAID", attachment: att })],
          total: 2,
          page: 1,
          pageSize: 100,
        },
      })
    );
    let deleted = false;
    await page.route(`${API_URL}/invoices/inv-open/attachment`, (route) => {
      deleted = route.request().method() === "DELETE";
      return route.fulfill({ status: 204, body: "" });
    });

    await page.goto("/invoices");
    const panel = page.getByTestId("invoice-detail-panel");
    await panel.getByRole("button", { name: "Remove attached invoice" }).click();
    await expect.poll(() => deleted).toBe(true);

    await page.locator("div.grid", { hasText: "INV-PAID" }).click();
    await expect(panel.getByRole("link", { name: "old.pdf" })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Remove attached invoice" })).toHaveCount(0);
    await expect(panel.getByRole("button", { name: "Replace" })).toHaveCount(0);
  });
});
