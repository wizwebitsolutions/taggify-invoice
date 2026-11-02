import { expect, test, type Page } from "@playwright/test";

import { API_URL, mockApi, shot, signIn, userFor, type MockRole } from "./fixtures";

/** Reports: payouts by month (shadcn Chart), spend vs budget, pages delivered, CSV export. API fully mocked. */

const now = new Date().toISOString();
const post = (id: string, assetId: string, handle: string, cost: number, views: number, status = "INSIGHTS_APPROVED", overQuota = false) => ({
  id,
  campaignId: "c1",
  assetId,
  url: `https://instagram.com/p/${id}`,
  format: "reel",
  cost: String(cost),
  status,
  overQuota,
  postedAt: now,
  createdAt: now,
  asset: { id: assetId, handle, platform: "instagram", followers: 1 },
  campaign: { id: "c1", title: "Diwali Food Stories", brandName: "Saffron Street" },
  postSnapshots: [{ likeCount: 1, commentsCount: 1, videoViews: views, capturedAt: now }],
});

async function reportsApi(page: Page) {
  const calls = { summaries: 0, links: [] as URLSearchParams[] };
  await mockApi(page);
  await page.route(`${API_URL}/payments/summary**`, (route) => {
    calls.summaries++;
    const from = new URL(route.request().url()).searchParams.get("from") ?? "";
    const month = new Date(from).getMonth();
    return route.fulfill({ json: { pending: { amount: 0, links: 0, invoices: 0 }, paid: { amount: (month + 1) * 10000, links: 1, payments: month % 3 } } });
  });
  await page.route(`${API_URL}/campaigns`, (route) =>
    route.fulfill({
      json: [
        { id: "c1", title: "Diwali Food Stories", brandName: "Saffron Street", createdAt: now, costCap: "100000", spent: 112000 },
        { id: "c2", title: "Monsoon Getaways", brandName: "Northbound", createdAt: now, costCap: "200000", spent: 50000 },
        { id: "c3", title: "No Budget Yet", brandName: "Brew Lane", createdAt: now, costCap: null, spent: 9000 },
      ],
    })
  );
  await page.route(`${API_URL}/links**`, (route) => {
    calls.links.push(new URL(route.request().url()).searchParams);
    const items = [post("l1", "a1", "riya.eats", 18000, 40000), post("l2", "a1", "riya.eats", 12500, 60000), post("l3", "a2", "desi.memes", 32000, 240000), post("l4", "a2", "desi.memes", 32000, 0, "INVALID"), post("l5", "a1", "riya.eats", 9000, 0, "SCREENSHOT_REJECTED"), post("l6", "a1", "riya.eats", 15000, 0, "INSIGHTS_APPROVED", true)];
    return route.fulfill({ json: { items, total: items.length, page: 1, pageSize: 100 } });
  });
  return calls;
}

test.describe("Reports", () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test("finance: payouts by month chart, spend vs budget, and pages delivered", async ({ page }) => {
    await signIn(page, "FINANCE");
    const calls = await reportsApi(page);
    await page.goto("/reports");
    const chart = page.getByRole("img", { name: /Bar chart of payouts per month/ });
    await expect(chart).toBeVisible();
    await expect(page.locator(".recharts-bar-rectangle")).toHaveCount(6);
    expect(calls.summaries).toBeGreaterThanOrEqual(6);

    const spend = page.getByRole("region", { name: "Campaign spend vs budget" });
    // Most of the budget used first; over-budget shows by how much; unbudgeted campaigns are counted, not listed.
    await expect(spend.getByRole("link").first()).toContainText("Diwali Food Stories");
    await expect(spend.getByText(/Over by ₹12,000/)).toBeVisible();
    await expect(spend.getByText("112% used", { exact: true })).toBeVisible();
    await expect(spend.locator(".spend-meter-label").first()).toHaveText("Spent");
    await expect(spend.getByText("1 campaign without a budget isn't shown.")).toBeVisible();

    const pages = page.getByRole("region", { name: "Pages by posts submitted" });
    // Same rule as campaign spend: rejected proofs, broken links and posts over booking don't count.
    const riya = pages.getByRole("row", { name: /riya\.eats/ }).getByRole("cell");
    await expect(riya.nth(1)).toHaveText("2");
    await expect(riya.nth(2)).toHaveText("50K"); // avg of 40K and 60K views
    await expect(riya.nth(3)).toHaveText("₹30,500");
    await expect(pages.getByRole("row", { name: /desi\.memes/ })).toContainText("₹32,000");
    expect(calls.links[0].get("from")).toBeTruthy();
    await shot(page, "reports");
  });

  test("12-month range asks for 12 months; CSV downloads what's on screen", async ({ page }) => {
    await signIn(page, "FINANCE");
    const calls = await reportsApi(page);
    await page.goto("/reports");
    await expect(page.locator(".recharts-bar-rectangle")).toHaveCount(6);
    await page.getByRole("combobox", { name: /Range/ }).click();
    await page.getByRole("option", { name: "Last 12 months" }).click();
    await expect(page.locator(".recharts-bar-rectangle")).toHaveCount(12);
    expect(calls.summaries).toBeGreaterThanOrEqual(12);
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("region", { name: "Pages by posts submitted" }).getByRole("button", { name: "Export CSV" }).click()]);
    expect(download.suggestedFilename()).toMatch(/^taggify-pages-\d{4}-\d{2}\.csv$/);
    const text = await (await download.createReadStream()).toArray().then((c) => Buffer.concat(c).toString("utf8"));
    expect(text).toContain('"Page","Platform","Posts","Avg views","Earned (INR)"');
    expect(text).toContain('"riya.eats","instagram","2","50000","30500.00"');
  });

  test("someone without finance.pay gets the delivery and spend reports but no payout figures", async ({ page }) => {
    await signIn(page, "FINANCE", { permissions: { ...userFor("FINANCE").permissions, "finance.pay": false } });
    const calls = await reportsApi(page);
    await page.goto("/reports");
    await expect(page.getByRole("region", { name: "Pages by posts submitted" })).toBeVisible();
    await expect(page.getByRole("img", { name: /payouts per month/ })).toHaveCount(0);
    expect(calls.summaries).toBe(0);
  });

  for (const role of ["PLAN_MAKER", "CREATOR", "TEAM_MEMBER"] as MockRole[]) {
    test(`${role} can't open Reports`, async ({ page }) => {
      await signIn(page, role);
      const calls = await reportsApi(page);
      await page.goto("/reports");
      await expect(page.getByText(/don.t have access to Reports/)).toBeVisible();
      expect(calls.summaries).toBe(0);
    });
  }
});
