import { expect, test, type Page } from "@playwright/test";

import { API_URL, mockApi, shot, signIn, userFor, type MockRole } from "./fixtures";

/** Finance → Overview: dues tiles, what needs attention, vendors, payouts, receivables. API fully mocked. */

const now = new Date();
const iso = now.toISOString();
const RIYA = { id: "v-riya", name: "Riya Mehta", phoneNumber: null, email: "riya@example.com" };
const due = (id: string, cost: number) => ({
  id,
  campaignId: "c1",
  assetId: "a1",
  url: `https://instagram.com/p/${id}`,
  format: "reel",
  cost: String(cost),
  status: "INSIGHTS_APPROVED",
  postedAt: iso,
  createdAt: iso,
  overQuota: false,
  campaign: { id: "c1", title: "Diwali Food Stories", brandName: "Saffron Street" },
  asset: { id: "a1", handle: "riya.eats", ownerId: RIYA.id, owner: RIYA },
  postSnapshots: [],
});
const clientInvoice = (id: string, status: "ISSUED" | "PAID", total: number, issuedAt: string, paidAt: string | null = null) => ({ id, planId: "p1", campaignId: null, invoiceNumber: `TGF/26-27/${id}`, subtotal: String(total), gstPercent: null, gstAmount: "0", total: String(total), status, issuedAt, paidAt, paidAmount: paidAt ? String(total) : null, remarks: null });

async function overviewApi(page: Page) {
  const requested = new Set<string>();
  const summaries: URLSearchParams[] = [];
  await mockApi(page);
  page.on("request", (req) => {
    if (req.url().startsWith(API_URL)) requested.add(new URL(req.url()).pathname.replace(/^\/api/, "").split("/")[1]);
  });
  await page.route(`${API_URL}/payments/**`, (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api\/payments/, "");
    if (path === "/summary") {
      summaries.push(url.searchParams);
      const monthly = url.searchParams.has("from");
      return route.fulfill({ json: { pending: { amount: monthly ? 18000 : 50000, links: monthly ? 1 : 3, invoices: 0 }, paid: { amount: 29700, links: 1, payments: 1 } } });
    }
    if (path === "/pending") return route.fulfill({ json: { items: [due("d1", 32000), due("d2", 18000)], total: 2, invoices: [] } });
    if (path === "/paid") return route.fulfill({ json: { items: [{ kind: "payout", paidAt: iso, payout: { id: "po1", creatorId: RIYA.id, creator: RIYA, netAmount: "29700", tdsPercent: "1", utr: "HDFCN52610021134", receipt: null } }], total: 1 } });
    if (path === "/payouts") return route.fulfill({ json: { items: [{ id: "dr1" }], total: 1, page: 1, pageSize: 25 } });
    return route.fulfill({ json: {} });
  });
  await page.route(`${API_URL}/assets`, (route) => route.fulfill({ json: [] }));
  await page.route(`${API_URL}/invoices?**`, (route) => route.fulfill({ json: { items: [], total: 2, page: 1, pageSize: 1 } }));
  await page.route(`${API_URL}/invoices/client**`, (route) => {
    const status = new URL(route.request().url()).searchParams.get("status");
    const items = status === "ISSUED" ? [clientInvoice("031", "ISSUED", 495600, "2026-09-28T10:00:00.000Z"), clientInvoice("029", "ISSUED", 118000, "2026-09-17T10:00:00.000Z")] : [clientInvoice("020", "PAID", 261000, "2026-08-01T10:00:00.000Z", iso), clientInvoice("010", "PAID", 50000, "2026-06-01T10:00:00.000Z", "2026-06-20T10:00:00.000Z")];
    return route.fulfill({ json: { items, total: items.length } });
  });
  await page.route(`${API_URL}/billing-profiles**`, (route) => route.fulfill({ json: [{ id: "b1", userId: RIYA.id, approvalStatus: "pending", bankAccountNumber: "1234", ifscCode: "X", createdAt: iso }] }));
  return { requested, summaries };
}

test.describe("Finance overview", () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test("finance: tiles, attention, vendors, payouts and receivables — and no links to screens that don't exist yet", async ({ page }) => {
    await signIn(page, "FINANCE");
    await overviewApi(page);
    await page.goto("/finance");
    await expect(page.getByText("Total Dues").locator("..")).toContainText("₹50,000");
    await expect(page.getByText("₹18,000").first()).toBeVisible(); // this month
    const attn = page.getByRole("region", { name: "Needs attention" });
    await expect(attn.getByRole("link", { name: /1\s*Payout waiting for its receipt/ })).toHaveAttribute("href", "/finance/payouts");
    await expect(attn.getByRole("link", { name: /1\s*Bank details to check/ })).toHaveAttribute("href", "/approvals?type=billing");
    await expect(attn.getByRole("link", { name: /2\s*Creator invoices waiting for approval/ })).toHaveAttribute("href", "/finance/invoices");
    await expect(attn.getByText("Client invoices unpaid")).toBeVisible();
    await expect(attn.getByRole("link", { name: /2\s*Client invoices unpaid/ })).toHaveAttribute("href", "/finance/receivables");
    await expect(page.getByRole("region", { name: "Client receivables" }).getByRole("link", { name: "Open" })).toHaveAttribute("href", "/finance/receivables");

    await expect(page.getByRole("region", { name: "Vendors to pay" }).getByRole("link", { name: /Riya Mehta/ })).toHaveAttribute("href", "/finance/payouts/v-riya");
    await expect(page.getByRole("region", { name: /Payouts in/ }).getByText(/UTR HDFCN52610021134/)).toBeVisible();
    const rec = page.getByRole("region", { name: "Client receivables" });
    await expect(rec.getByText("₹6,13,600")).toBeVisible(); // 4,95,600 + 1,18,000 issued, unpaid
    await expect(rec.getByText(/oldest from 17 Sept? 2026/)).toBeVisible();
    await expect(rec.getByText("₹2,61,000")).toBeVisible(); // only the one paid this month
    await shot(page, "finance-overview");
  });

  test("the month picker re-asks the server for that month", async ({ page }) => {
    await signIn(page, "FINANCE");
    const { summaries } = await overviewApi(page);
    await page.goto("/finance");
    await page.getByRole("combobox", { name: /Month/ }).click();
    await page.getByRole("option").nth(1).click();
    await expect.poll(() => summaries.filter((s) => s.has("from")).length).toBeGreaterThan(1);
    const froms = summaries.filter((s) => s.has("from")).map((s) => s.get("from"));
    expect(new Set(froms).size).toBeGreaterThan(1);
  });

  test("a past month relabels the month tiles and lists", async ({ page }) => {
    await signIn(page, "ADMIN");
    await overviewApi(page);
    await page.goto("/finance");
    await expect(page.getByText("Dues This Month")).toBeVisible();
    await page.getByRole("combobox", { name: /Month/ }).click();
    const option = page.getByRole("option").nth(1);
    const label = (await option.textContent())!.trim();
    await option.click();
    await expect(page.getByText(`Dues in ${label}`)).toBeVisible();
    await expect(page.getByText(`Paid in ${label}`).first()).toBeVisible();
    await expect(page.getByRole("region", { name: `Payouts in ${label}` })).toBeVisible();
  });

  test("a count that fails to load says so instead of silently vanishing", async ({ page }) => {
    await signIn(page, "FINANCE");
    await overviewApi(page);
    await page.route(`${API_URL}/invoices?**`, (route) => route.fulfill({ status: 500, json: {} }));
    await page.goto("/finance");
    const attn = page.getByRole("region", { name: "Needs attention" });
    await expect(attn.getByText("Some of this couldn't load")).toBeVisible();
    await expect(attn.getByText("Bank details to check")).toBeVisible();
  });

  test("the Finance nav opens Overview", async ({ page }) => {
    await signIn(page, "FINANCE");
    await overviewApi(page);
    await page.goto("/dashboard");
    // The Finance group links to its first built screen, which is now Overview.
    await page.getByRole("link", { name: "Finance", exact: true }).first().click();
    await expect(page).toHaveURL(/\/finance$/);
  });

  test("someone with finance.view but not finance.pay sees invoices and receivables, never payment data", async ({ page }) => {
    await signIn(page, "FINANCE", { permissions: { ...userFor("FINANCE").permissions, "finance.pay": false } });
    const { requested } = await overviewApi(page);
    await page.goto("/finance");
    await expect(page.getByRole("region", { name: "Client receivables" })).toBeVisible();
    await expect(page.getByText("Total Dues")).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Vendors to pay" })).toHaveCount(0);
    expect(requested.has("payments")).toBe(false);
    expect(requested.has("billing-profiles")).toBe(false);
  });

  for (const role of ["PLAN_MAKER", "CREATOR", "TEAM_MEMBER"] as MockRole[]) {
    test(`${role} can't open the Finance overview`, async ({ page }) => {
      await signIn(page, role);
      const { requested } = await overviewApi(page);
      await page.goto("/finance");
      await expect(page.getByText(/don.t have access to the Finance overview/)).toBeVisible();
      expect(requested.has("payments")).toBe(false);
    });
  }
});
