import { expect, test, type Page } from "@playwright/test";

import { API_URL, mockApi, shot, signIn, userFor, type MockRole } from "./fixtures";

/** Finance → Receivables: client invoices, mark paid (full or part), cancel with a reason. API fully mocked. */

const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
const row = (id: string, number: string, status: "ISSUED" | "PAID" | "CANCELLED", total: number, issuedDaysAgo: number, extra: Record<string, unknown> = {}) => ({
  id,
  planId: `p-${id}`,
  campaignId: null,
  invoiceNumber: number,
  subtotal: String(total),
  gstPercent: "18",
  gstAmount: "0",
  total: String(total),
  status,
  issuedAt: daysAgo(issuedDaysAgo),
  paidAt: status === "PAID" ? daysAgo(0) : null,
  paidAmount: status === "PAID" ? String(total) : null,
  remarks: null,
  plan: { id: `p-${id}`, name: "Diwali Food Stories", clientName: "Neha Kapoor", clientCompany: "Saffron Street Foods", clientGstNumber: "27AAKCS1234L1Z5", createdById: "pl1", createdBy: { id: "pl1", name: "Priya Sharma" }, campaign: { id: "c1", title: "Diwali Food Stories", brandName: "Saffron Street" }, invoiceAttachment: null },
  issuedBy: null,
  ...extra,
});

async function receivablesApi(page: Page) {
  const calls = { paid: [] as unknown[], cancelled: [] as unknown[] };
  await mockApi(page);
  const rows = [
    row("r1", "TGF/26-27/031", "ISSUED", 495600, 9),
    row("r2", "TGF/26-27/029", "ISSUED", 118000, 45, { plan: { ...row("x", "x", "ISSUED", 0, 0).plan, clientCompany: "Loom & Lane", createdBy: { id: "pl2", name: "Arjun" } } }),
    row("r3", "TGF/26-27/020", "PAID", 261000, 30),
    row("r4", "TGF/26-27/018", "CANCELLED", 50000, 60, { remarks: "Deal fell through" }),
  ];
  await page.route(`${API_URL}/invoices/client**`, (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(/^\/api\/invoices\/client/, "");
    const m = path.match(/^\/([^/]+)\/(mark-paid|cancel)$/);
    if (req.method() === "POST" && m) {
      (m[2] === "mark-paid" ? calls.paid : calls.cancelled).push({ id: m[1], ...req.postDataJSON() });
      return route.fulfill({ json: {} });
    }
    return route.fulfill({ json: { items: rows, total: rows.length } });
  });
  return calls;
}

test.describe("Finance receivables", () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test("finance sees what clients owe, the oldest unpaid, and records a part payment", async ({ page }) => {
    await signIn(page, "FINANCE");
    const calls = await receivablesApi(page);
    await page.goto("/finance/receivables");
    await expect(page.getByRole("tab", { name: "Issued (2)" })).toBeVisible();
    await expect(page.getByText("Unpaid", { exact: true }).locator("..")).toContainText("₹6,13,600");
    await expect(page.getByText("Oldest unpaid").locator("..")).toContainText("45 days");
    await expect(page.getByRole("row", { name: /TGF\/26-27\/029/ }).getByText("Issued 45 days ago")).toBeVisible();
    await shot(page, "finance-receivables");

    await page.getByRole("row", { name: /TGF\/26-27\/031/ }).getByRole("button", { name: "Mark paid…" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Amount received (₹)")).toHaveValue("495600");
    await dialog.getByLabel("Amount received (₹)").fill("600000");
    await expect(dialog.getByText("That's more than the invoice total.")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Mark paid" })).toBeDisabled();
    // Commas are fine; a short amount closes the invoice and writes off the rest, so it needs a reason.
    await dialog.getByLabel("Amount received (₹)").fill("4,00,000");
    await expect(dialog.getByText(/less than the total\. The invoice still closes as paid/)).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Mark paid" })).toBeDisabled();
    await dialog.getByLabel(/Note/).fill("Client deducted TDS");
    await dialog.getByRole("button", { name: "Mark paid" }).click();
    await expect(page.getByText("TGF/26-27/031 marked paid.")).toBeVisible();
    expect(calls.paid).toEqual([{ id: "r1", paidAmount: 400000, remarks: "Client deducted TDS" }]);
  });

  test("cancel needs a reason; search covers client and planner", async ({ page }) => {
    await signIn(page, "FINANCE");
    const calls = await receivablesApi(page);
    await page.goto("/finance/receivables");
    await page.getByRole("searchbox", { name: "Search receivables" }).fill("loom");
    await expect(page.getByRole("tab", { name: "Issued (1)" })).toBeVisible();
    await page.getByRole("searchbox", { name: "Search receivables" }).fill("arjun");
    const r2 = page.getByRole("row", { name: /TGF\/26-27\/029/ });
    await r2.getByRole("button", { name: "More for TGF/26-27/029" }).click();
    await page.getByRole("menuitem", { name: "Cancel invoice…" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: "Cancel invoice" })).toBeDisabled();
    await dialog.getByLabel("Reason").fill("Re-issued outside the system");
    await dialog.getByRole("button", { name: "Cancel invoice" }).click();
    await expect(page.getByText("TGF/26-27/029 cancelled.")).toBeVisible();
    expect(calls.cancelled).toEqual([{ id: "r2", remarks: "Re-issued outside the system" }]);
    await page.getByRole("searchbox", { name: "Search receivables" }).fill("");
    await page.getByRole("tab", { name: /Cancelled/ }).click();
    await expect(page.getByRole("row", { name: /TGF\/26-27\/018/ }).getByText("Deal fell through")).toBeVisible();
  });

  test("view-only finance and planners read receivables but can't settle them", async ({ page }) => {
    await signIn(page, "FINANCE", { permissions: { ...userFor("FINANCE").permissions, "finance.pay": false } });
    await receivablesApi(page);
    await page.goto("/finance/receivables");
    await expect(page.getByRole("row", { name: /TGF\/26-27\/031/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Mark paid…" })).toHaveCount(0);
  });

  test("planner reads their plans' receivables, plan links open the plan", async ({ page }) => {
    await signIn(page, "PLAN_MAKER");
    await receivablesApi(page);
    await page.goto("/finance/receivables");
    await expect(page.getByRole("row", { name: /TGF\/26-27\/031/ }).getByRole("link", { name: "Diwali Food Stories" })).toHaveAttribute("href", "/plans/p-r1");
    await expect(page.getByRole("button", { name: "Mark paid…" })).toHaveCount(0);
  });

  for (const role of ["CREATOR", "TEAM_MEMBER"] as MockRole[]) {
    test(`${role} can't open Receivables`, async ({ page }) => {
      await signIn(page, role);
      await receivablesApi(page);
      await page.goto("/finance/receivables");
      await expect(page.getByText(/don.t have access to receivables/)).toBeVisible();
    });
  }
});
