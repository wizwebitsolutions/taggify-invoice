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

  // 25 Sep: /invoices' Receivables asks for attached-only, matching Payments'
  // Client tab — a Proforma with nothing real attached isn't a receivable
  // this list counts, even though the server still holds the row.
  test("FINANCE's Receivables requests hasAttachment=true, unlike Payments' own list", async ({ page }) => {
    await signIn(page, "FINANCE");
    await mockApi(page);
    let requestedUrl = "";
    await page.route(`${API_URL}/invoices/client**`, (route) => {
      requestedUrl = route.request().url();
      return route.fulfill({ json: { items: [clientInvoice()], total: 1 } });
    });

    await page.goto("/invoices?view=receivables");
    await expect(page.getByTestId("receivables-view")).toContainText("PI-0007");
    expect(new URL(requestedUrl).searchParams.get("hasAttachment")).toBe("true");
    await expect(page.getByText("with a real invoice attached")).toBeVisible();
  });

  // Independent review (25 Sep): filtering unconditionally would have made a
  // Plan Maker's own receivables disappear the moment they're Proforma-only —
  // a Plan Maker has no "Mark paid"/"Cancel" and no "Attach an invoice" entry
  // point on this page, so there'd be no way to bring an unattached row back.
  // They keep seeing everything, same as before this change.
  test("PLAN_MAKER's Receivables stays unfiltered — no hasAttachment sent, no 'Attach an invoice' button", async ({ page }) => {
    await signIn(page, "PLAN_MAKER");
    await mockApi(page);
    let requestedUrl = "";
    await page.route(`${API_URL}/invoices/client**`, (route) => {
      requestedUrl = route.request().url();
      return route.fulfill({ json: { items: [clientInvoice({ plan: { ...clientInvoice().plan, invoiceAttachmentPublicId: null } })], total: 1 } });
    });

    await page.goto("/invoices?view=receivables");
    await expect(page.getByTestId("receivables-view")).toContainText("PI-0007");
    expect(new URL(requestedUrl).searchParams.has("hasAttachment")).toBe(false);
    await expect(page.getByTestId("attach-invoice-button")).toHaveCount(0);
  });

  // 25 Sep: attaching no longer requires first finding the right plan on the
  // Plans page — pick the client here, see everything billed to them
  // (including not-yet-attached rows the main list above just excluded).
  test("'Attach an invoice' picks a client, lists their invoices unfiltered by attachment, and attaches inline", async ({ page }) => {
    await signIn(page, "FINANCE");
    await mockApi(page);
    // One handler, branching on the query string, covering all three calls
    // this flow makes to the same endpoint: the main list (hasAttachment, no
    // search) sees the normal attached row; the picker's own unfiltered fetch
    // (no params at all — deliberately not /plans/clients, which a plain
    // FINANCE account can't reach) sees the same row to build its client
    // suggestion from; the modal's client search (no hasAttachment) sees an
    // unattached one — proving the modal's list isn't filtered the way the
    // page behind it now is.
    let searchSent: string | null = "not called";
    await page.route(`${API_URL}/invoices/client**`, (route) => {
      const params = new URL(route.request().url()).searchParams;
      if (params.get("search")) {
        searchSent = params.get("search");
        return route.fulfill({ json: { items: [clientInvoice({ id: "ci-unattached", invoiceNumber: "PI-0009", plan: { ...clientInvoice().plan, invoiceAttachmentPublicId: null } })], total: 1 } });
      }
      return route.fulfill({ json: { items: [clientInvoice()], total: 1 } });
    });

    await page.goto("/invoices?view=receivables");
    await page.getByTestId("attach-invoice-button").click();
    const modal = page.getByTestId("attach-invoice-modal");
    await expect(modal).toBeVisible();

    await modal.getByLabel("Client").click();
    await modal.getByLabel("Client").fill("Acme");
    await modal.getByRole("option", { name: /Acme Foods/ }).click();

    await expect(modal).toContainText("PI-0009");
    expect(searchSent).toBe("Acme Foods Pvt Ltd");

    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByTestId("attach-invoice-modal")).toHaveCount(0);
  });
});
