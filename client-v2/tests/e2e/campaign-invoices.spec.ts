import { expect, test, type Page } from "@playwright/test";

import { API_URL, mockApi, shot, signIn, type MockRole } from "./fixtures";

/** Campaign detail → Invoices: the campaign's invoices with approve / pay / PDF / creator's file (v1 CampaignInvoicesPanel). API fully mocked. */

const now = new Date().toISOString();
const CAMPAIGN = { id: "c1", brandName: "Saffron Street", title: "Diwali Food Stories", deadline: null, createdAt: now, costCap: "300000", spent: 0, postCount: 0, phaseCount: 1, parentCampaignId: null, phases: [{ id: "c1", phaseNumber: 1, title: "Diwali Food Stories", createdAt: now }] };
const RIYA = { id: "v-riya", name: "Riya Mehta", phoneNumber: null, email: "riya@example.com" };
const invoice = (id: string, number: string, status: string, extra: Record<string, unknown> = {}) => ({
  id,
  creatorId: RIYA.id,
  creator: RIYA,
  invoiceNumber: number,
  amount: "37760",
  subtotal: "32000",
  isGstInvoice: true,
  gstAmount: "5760",
  status,
  paymentStatus: "PENDING",
  gstStatus: "PENDING",
  remarks: null,
  dueDate: null,
  paidAt: null,
  createdAt: now,
  overdueDays: 0,
  campaignId: "c1",
  campaign: { id: "c1", title: "Diwali Food Stories", brandName: "Saffron Street" },
  items: [{ id: `${id}-1`, amount: "32000", link: { id: `${id}l`, url: `https://www.instagram.com/reel/${id}/`, format: "reel", overQuota: false } }],
  overQuotaCount: 0,
  raisedBy: null,
  attachment: null,
  ...extra,
});

async function campaignInvoicesApi(page: Page, role: MockRole, opts: { ownAccess?: Record<string, boolean> } = {}) {
  await signIn(page, role, opts.ownAccess ? { ownAccess: opts.ownAccess } : {});
  const rows = [invoice("i1", "INV-2026-0140", "RAISED"), invoice("i2", "INV-2026-0141", "APPROVED"), invoice("i3", "INV-2026-0142", "RAISED", { overQuotaCount: 1 })];
  const calls = { listed: [] as (string | null)[], approved: [] as string[], pdf: [] as string[] };
  await mockApi(page);
  await page.route(`${API_URL}/campaigns**`, (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api\/campaigns/, "");
    if (path === "/c1") return route.fulfill({ json: CAMPAIGN });
    if (path === "/c1/assignments") return route.fulfill({ json: [] });
    if (path === "") return route.fulfill({ json: [CAMPAIGN] });
    return route.fulfill({ status: 404, json: {} });
  });
  await page.route(`${API_URL}/invoices**`, (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace(/^\/api\/invoices/, "");
    const approve = path.match(/^\/([^/]+)\/approve$/);
    if (approve && req.method() === "POST") {
      calls.approved.push(approve[1]);
      const row = rows.find((r) => r.id === approve[1])!;
      row.status = "APPROVED";
      return route.fulfill({ json: row });
    }
    const pdf = path.match(/^\/([^/]+)\/pdf$/);
    if (pdf) {
      calls.pdf.push(pdf[1]);
      return route.fulfill({ body: Buffer.from("%PDF-1.4"), headers: { "Content-Type": "application/pdf" } });
    }
    calls.listed.push(url.searchParams.get("campaignId"));
    return route.fulfill({ json: { items: rows, total: rows.length, page: 1, pageSize: 100 } });
  });
  await page.goto("/campaigns/c1");
  await expect(page.getByRole("heading", { name: "Diwali Food Stories" })).toBeVisible();
  return calls;
}

test.describe("Campaign invoices", () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test("admin: lists this campaign's invoices, approves one, and pays from Payouts", async ({ page }) => {
    const calls = await campaignInvoicesApi(page, "ADMIN");
    await page.getByRole("tab", { name: "Invoices" }).click();
    const list = page.getByTestId("campaign-invoice-list");
    await expect(list.getByRole("listitem")).toHaveCount(3);
    expect(calls.listed).toContain("c1");
    await expect(page.getByText("3 invoices raised for this campaign so far.")).toBeVisible();
    await shot(page, "campaign-invoices");

    const raised = page.getByTestId("campaign-invoice-i1");
    await expect(raised).toContainText("Waiting for approval");
    await raised.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByText("INV-2026-0140 approved. Pay it from Payouts.")).toBeVisible();
    expect(calls.approved).toEqual(["i1"]);

    await expect(page.getByTestId("campaign-invoice-i2").getByRole("link", { name: "Pay" })).toHaveAttribute("href", "/finance/payouts/v-riya?invoice=i2");
    await expect(page.getByRole("link", { name: "Open Invoices" })).toHaveAttribute("href", "/finance/invoices");
  });

  test("an invoice with posts over the booking can't be approved", async ({ page }) => {
    await campaignInvoicesApi(page, "ADMIN");
    await page.getByRole("tab", { name: "Invoices" }).click();
    const over = page.getByTestId("campaign-invoice-i3");
    await expect(over).toContainText("1 post over booking");
    await expect(over.getByRole("button", { name: "Approve" })).toHaveCount(0);
    await expect(page.getByText(/can't be approved. Reject it on Invoices/)).toBeVisible();
  });

  test("download PDF fetches that invoice's PDF", async ({ page }) => {
    const calls = await campaignInvoicesApi(page, "FINANCE");
    await page.getByRole("tab", { name: "Invoices" }).click();
    await page.getByRole("button", { name: "Download INV-2026-0141 PDF" }).click();
    await expect.poll(() => calls.pdf).toEqual(["i2"]);
  });

  test("creator: sees their invoices, can attach their own file, and raises new ones from Money", async ({ page }) => {
    await campaignInvoicesApi(page, "CREATOR");
    await page.getByRole("tab", { name: "Invoices" }).click();
    await expect(page.getByText("3 invoices for your work on this campaign.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Raise an invoice" })).toHaveAttribute("href", "/money");
    await expect(page.getByRole("button", { name: "Attach your invoice" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Pay" })).toHaveCount(0);
  });

  test("creator with money switched off has no Invoices tab", async ({ page }) => {
    await campaignInvoicesApi(page, "CREATOR", { ownAccess: { "finance.view": false, "finance.edit": false } });
    await expect(page.getByRole("tab", { name: /^Posts/ })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Invoices" })).toHaveCount(0);
  });
});
