import { expect, test, type Page } from "@playwright/test";

import { API_URL, mockApi, shot, signIn } from "./fixtures";

/** Creator Money → Invoices: download the PDF / links file, and see the posts on an invoice (v1 invoice card). API fully mocked. */

const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const link = (id: string, format: string) => ({ id, url: `https://www.instagram.com/reel/${id}/`, format, cost: "32000", status: "INVOICED", campaignId: "c1", assetId: "a1" });
const invoice = {
  id: "i1",
  creatorId: "test-creator",
  invoiceNumber: "INV-2026-0042",
  amount: "59590",
  subtotal: "50500",
  isGstInvoice: true,
  gstAmount: "9090",
  status: "RAISED",
  paymentStatus: "PENDING",
  gstStatus: "PENDING",
  remarks: null,
  dueDate: null,
  paidAt: null,
  createdAt: ago(20),
  overdueDays: 0,
  campaign: { id: "c1", title: "Diwali Food Stories", brandName: "Saffron Street" },
  attachment: null,
  items: [
    { id: "it1", amount: "32000", link: link("REEL1", "reel") },
    { id: "it2", amount: "18500", link: link("STORY1", "story") },
  ],
};

async function moneyApi(page: Page) {
  const calls = { pdf: [] as string[], links: [] as string[] };
  await mockApi(page);
  await page.route(`${API_URL}/payments/me/summary**`, (route) => route.fulfill({ json: { pending: { amount: 0, links: 0, invoices: 1 }, paid: { amount: 0, links: 0, payments: 0 } } }));
  await page.route(`${API_URL}/invoices**`, (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api\/invoices/, "");
    if (path === "/i1/pdf") {
      calls.pdf.push(route.request().headers()["authorization"] ?? "");
      return route.fulfill({ status: 200, contentType: "application/pdf", body: "%PDF-1.4" });
    }
    if (path === "/i1/links.txt") {
      calls.links.push(route.request().headers()["authorization"] ?? "");
      return route.fulfill({ status: 200, contentType: "text/plain", body: "https://www.instagram.com/reel/REEL1/\n" });
    }
    return route.fulfill({ json: { items: [invoice], total: 1, page: 1, pageSize: 100 } });
  });
  return calls;
}

test.describe("Creator money invoices", () => {
  test("download an invoice PDF from the list", async ({ page }) => {
    await signIn(page, "CREATOR");
    const calls = await moneyApi(page);
    await page.goto("/money");
    await page.getByRole("tab", { name: /Invoices/ }).click();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download INV-2026-0042 PDF" }).click();
    expect((await download).suggestedFilename()).toBe("INV-2026-0042.pdf");
    expect(calls.pdf).toEqual(["Bearer test-access-token"]);
  });

  test("view an invoice's posts and totals, then download its PDF and links", async ({ page }) => {
    await signIn(page, "CREATOR");
    const calls = await moneyApi(page);
    await page.goto("/money");
    await page.getByRole("tab", { name: /Invoices/ }).click();
    await page.getByRole("button", { name: "View INV-2026-0042" }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("heading", { name: "INV-2026-0042" })).toBeVisible();
    await expect(sheet.getByText("Diwali Food Stories · 2 posts")).toBeVisible();
    const lines = sheet.getByRole("list", { name: "Posts on this invoice" }).getByRole("listitem");
    await expect(lines).toHaveCount(2);
    await expect(lines.nth(0)).toContainText("instagram.com/reel/REEL1/");
    await expect(lines.nth(0)).toContainText("₹32,000");
    await expect(lines.nth(1)).toContainText("₹18,500");
    await expect(sheet.getByText("₹59,590")).toBeVisible();
    await shot(page, "creator-money-invoice");

    let download = page.waitForEvent("download");
    await sheet.getByRole("button", { name: "Download PDF" }).click();
    expect((await download).suggestedFilename()).toBe("INV-2026-0042.pdf");
    download = page.waitForEvent("download");
    await sheet.getByRole("button", { name: "Download links" }).click();
    expect((await download).suggestedFilename()).toBe("INV-2026-0042-links.txt");
    expect(calls.pdf).toHaveLength(1);
    expect(calls.links).toHaveLength(1);
  });

  test("staff don't get the creator Money page", async ({ page }) => {
    await signIn(page, "FINANCE");
    const calls = await moneyApi(page);
    await page.goto("/money");
    await expect(page.getByText(/don.t have access/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /Download .* PDF/ })).toHaveCount(0);
    expect(calls.pdf).toEqual([]);
  });
});
