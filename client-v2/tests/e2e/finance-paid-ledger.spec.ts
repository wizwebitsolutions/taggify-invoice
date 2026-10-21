import { expect, test, type Page } from "@playwright/test";

import { API_URL, mockApi, shot, signIn, userFor } from "./fixtures";

/**
 * Finance → Creator Payouts → Paid: every payout across vendors (v1 Payments →
 * Paid) with vendor / page / month-or-dates filters, Net + TDS totals and a
 * note when the server has more than it sent. API fully mocked.
 */

const RIYA = { id: "v-riya", name: "Riya Mehta", phoneNumber: null, email: "riya@example.com" };
const ARJUN = { id: "v-arjun", name: "Arjun Rao", phoneNumber: null, email: "arjun@example.com" };
const now = new Date().toISOString();
const item = (id: string, title: string, handle: string, amount: string) => ({
  id: `pi-${id}`,
  amount,
  link: { id, url: `https://instagram.com/p/${id}`, format: "reel", assetId: `a-${handle}`, postedAt: now, asset: { id: `a-${handle}`, handle }, campaign: { id: `c-${id}`, title, brandName: "Saffron Street" } },
});
const payout = (id: string, vendor: typeof RIYA, net: string, tds: string, items: ReturnType<typeof item>[]) => ({
  kind: "payout",
  paidAt: now,
  payout: { id, creatorId: vendor.id, creator: vendor, subtotal: "42000", isGstInvoice: false, gstAmount: "0", tdsPercent: "1", tdsAmount: tds, netAmount: net, status: "PAID", paidAt: now, utr: `UTR-${id}`, createdAt: now, markedPaidBy: { id: "f", name: "Test FINANCE" }, receipt: { name: "neft.pdf", url: "https://res.example.com/neft.pdf", uploadedAt: now }, items },
});
const ROWS = [
  payout("p1", RIYA, "41580", "420", [item("l1", "Monsoon Cravings campaign", "riya.eats", "18000"), item("l2", "Goa Budget Tips campaign", "riyatravels", "24000")]),
  payout("p2", ARJUN, "9900.50", "100.25", [item("l3", "Gym Diaries campaign", "arjun.fit", "10000.75")]),
  {
    kind: "invoice",
    paidAt: now,
    invoice: { id: "inv-old", invoiceNumber: "INV-2026-0099", creatorId: RIYA.id, creator: RIYA, amount: "11800", subtotal: "10000", isGstInvoice: true, gstAmount: "1800", status: "PAID", dueDate: null, paidAt: now, createdAt: now, links: [], selectable: false, receipt: null },
  },
];

async function ledgerApi(page: Page, opts: { pendingTotal?: number } = {}) {
  const rec = { paid: [] as URLSearchParams[], paymentsCalls: 0 };
  await mockApi(page);
  await page.route(`${API_URL}/payments/**`, (route) => {
    rec.paymentsCalls++;
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api\/payments/, "");
    if (path === "/summary") return route.fulfill({ json: { pending: { amount: 0, links: 0, invoices: 0 }, paid: { amount: 0, links: 0, payments: 0 } } });
    if (path === "/pending") {
      const items = opts.pendingTotal ? [{ id: "lp", campaignId: "c", assetId: "a", url: "https://instagram.com/p/lp", format: "reel", cost: "5000", status: "INSIGHTS_APPROVED", postedAt: now, createdAt: now, asset: { id: "a", handle: "riya.eats", ownerId: RIYA.id, owner: RIYA }, campaign: { id: "c", title: "X", brandName: "Y" }, postSnapshots: [] }] : [];
      return route.fulfill({ json: { items, total: opts.pendingTotal ?? 0, invoices: [] } });
    }
    if (path === "/paid") {
      const p = url.searchParams;
      // Unfiltered reads report 140 on the server, so the ledger has to say it only shows the latest.
      rec.paid.push(p);
      const vendor = p.get("creatorId");
      const items = ROWS.filter((r) => !vendor || ("payout" in r ? r.payout.creatorId : r.invoice.creatorId) === vendor);
      const filtered = p.get("q") || p.get("from") || vendor;
      return route.fulfill({ json: { items, total: filtered ? items.length : 140 } });
    }
    if (path === "/payouts") return route.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 100 } });
    return route.fulfill({ status: 404, json: { error: { code: "NOT_MOCKED", message: path } } });
  });
  return rec;
}

const lastLedgerRead = (rec: { paid: URLSearchParams[] }) => rec.paid.at(-1)!;

test.describe("Finance → Payouts → Paid ledger", () => {
  test.use({ viewport: { width: 1536, height: 1000 } });

  test("lists every vendor's payouts with Net/TDS totals, a truncation note and expandable posts", async ({ page }) => {
    await signIn(page, "FINANCE");
    await ledgerApi(page);
    await page.goto("/finance/payouts");
    await page.getByRole("tab", { name: "Paid (140)" }).click();
    const rows = page.getByTestId("paid-row");
    await expect(rows).toHaveCount(3);
    await expect(rows.filter({ hasText: "Arjun Rao" })).toContainText("₹9,900.50");
    await expect(rows.filter({ hasText: "INV-2026-0099" })).toContainText("paid outside a payout");
    // 41,580 + 9,900.50 + 11,800 = 63,280.50 net; 420 + 100.25 = 520.25 TDS (legacy invoice had none).
    await expect(page.getByTestId("paid-totals")).toHaveText("3 payments · ₹63,280.50 paid · ₹520.25 TDS withheld");
    await expect(page.getByTestId("truncation-note")).toContainText("Showing the latest 3 of 140 payments");
    await page.getByRole("button", { name: /Show posts paid on .* to Riya Mehta/ }).first().click();
    const posts = page.getByTestId("paid-row-posts");
    await expect(posts).toContainText("Monsoon Cravings campaign");
    await expect(posts).toContainText("Goa Budget Tips campaign");
    await expect(posts).toContainText("UTR UTR-p1");
    await shot(page, "paid-ledger");
  });

  test("vendor, page and month / custom-range filters go to the server", async ({ page }) => {
    await signIn(page, "FINANCE");
    const rec = await ledgerApi(page);
    await page.goto("/finance/payouts?view=paid");
    await expect(page.getByTestId("paid-row")).toHaveCount(3);

    await page.getByRole("combobox", { name: "Vendor: All" }).click();
    await page.getByRole("option", { name: "Arjun Rao" }).click();
    await expect.poll(() => lastLedgerRead(rec).get("creatorId")).toBe(ARJUN.id);
    await expect(page.getByTestId("paid-row")).toHaveCount(1);
    await expect(page.getByTestId("paid-totals")).toHaveText("1 payment · ₹9,900.50 paid · ₹100.25 TDS withheld");
    await expect(page.getByTestId("truncation-note")).toHaveCount(0);

    await page.getByRole("searchbox", { name: "Search page" }).fill("@arjun.fit");
    await expect.poll(() => lastLedgerRead(rec).get("q")).toBe("arjun.fit");

    const month = new Date().toLocaleDateString("en-GB", { month: "long", year: "numeric" });
    await page.getByRole("combobox", { name: "Paid in: All time" }).click();
    await page.getByRole("option", { name: month }).click();
    await expect.poll(() => lastLedgerRead(rec).get("from")).toBe(new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString());
    expect(lastLedgerRead(rec).get("creatorId")).toBe(ARJUN.id);

    await page.getByRole("combobox", { name: `Paid in: ${month}` }).click();
    await page.getByRole("option", { name: "Custom range" }).click();
    await page.getByLabel("Paid from").fill("2026-09-01");
    await page.getByLabel("Paid to").fill("2026-09-30");
    await expect.poll(() => lastLedgerRead(rec).get("to")).toBe(new Date("2026-09-30T23:59:59.999").toISOString());
    expect(lastLedgerRead(rec).get("from")).toBe(new Date("2026-09-01T00:00:00").toISOString());
  });

  test("the vendor list warns when it's built from only part of the dues", async ({ page }) => {
    await signIn(page, "FINANCE");
    await ledgerApi(page, { pendingTotal: 812 });
    await page.goto("/finance/payouts");
    await expect(page.getByText("This list adds up the newest 1 of 812 dues, so some vendors' totals may be short.")).toBeVisible();
    await expect(page.getByRole("tab", { name: /Fully paid/ })).toBeVisible();
  });

  test("someone without finance.pay can't see the Paid ledger or any pay controls", async ({ page }) => {
    await signIn(page, "FINANCE", { permissions: { ...userFor("FINANCE").permissions, "finance.pay": false } });
    const rec = await ledgerApi(page);
    await page.goto("/finance/payouts?view=paid");
    await expect(page.getByRole("heading", { name: "You don't have access to vendor payouts" })).toBeVisible();
    await expect(page.getByTestId("paid-row")).toHaveCount(0);
    await page.goto(`/finance/payouts/${RIYA.id}?invoice=inv-1`);
    await expect(page.getByRole("heading", { name: "You don't have access to vendor payouts" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Process Payout" })).toHaveCount(0);
    expect(rec.paymentsCalls).toBe(0);
  });
});
