import { test, expect } from "@playwright/test";

import { signIn, mockApi, API_URL } from "./fixtures";

/**
 * Invoices page → "Proforma invoice numbering" card (user request, 17 Sep —
 * "admin, finance will have power to change invoice no. prefix").
 * Component: components/invoices/invoice-numbering-card.tsx. Server side
 * (lib/clientInvoiceNumbering.js + the counter rules) is covered by vitest.
 */
test.describe("Invoices — Proforma invoice numbering", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  for (const role of ["ADMIN", "FINANCE"] as const) {
    test(`${role} can change the prefix and the next number`, async ({ page }) => {
      await signIn(page, role);
      await mockApi(page);
      let saved: Record<string, unknown> | null = null;
      await page.route(`${API_URL}/admin/invoice-numbering`, (route) => {
        if (route.request().method() === "PUT") {
          saved = route.request().postDataJSON();
          return route.fulfill({ json: { prefix: "TAG/", nextNumber: 120, suggestion: "TAG/0120" } });
        }
        return route.fulfill({ json: { prefix: "PI-", nextNumber: 7, suggestion: "PI-0007" } });
      });

      await page.goto("/invoices");
      const card = page.getByTestId("invoice-numbering-card");
      await expect(card.getByRole("textbox", { name: "Invoice number prefix" })).toHaveValue("PI-");
      await expect(card.getByRole("textbox", { name: "Next invoice number" })).toHaveValue("7");
      await expect(card.getByRole("button", { name: "Save" })).toBeDisabled(); // nothing changed yet

      await card.getByRole("textbox", { name: "Invoice number prefix" }).fill("TAG/");
      await card.getByRole("textbox", { name: "Next invoice number" }).fill("120");
      await expect(page.getByTestId("invoice-numbering-preview")).toHaveText("TAG/0120");
      await card.getByRole("button", { name: "Save" }).click();

      await expect.poll(() => saved).toEqual({ prefix: "TAG/", nextNumber: 120 });
      await expect(card.getByRole("button", { name: "Save" })).toBeDisabled(); // saved — clean again
    });
  }

  test("a prefix with a space or symbol is refused before saving", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.route(`${API_URL}/admin/invoice-numbering`, (route) => route.fulfill({ json: { prefix: "PI-", nextNumber: 7, suggestion: "PI-0007" } }));

    await page.goto("/invoices");
    const card = page.getByTestId("invoice-numbering-card");
    await card.getByRole("textbox", { name: "Invoice number prefix" }).fill("TAG #");
    await expect(card).toContainText("Use letters, digits and / . _ - only.");
    await expect(card.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  test("a creator never sees the card", async ({ page }) => {
    await signIn(page, "CREATOR");
    await mockApi(page);
    await page.goto("/invoices");
    await expect(page.getByRole("heading", { name: "Invoices" })).toBeVisible();
    await expect(page.getByTestId("invoice-numbering-card")).toHaveCount(0);
  });
});
