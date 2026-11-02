import { expect, test } from "@playwright/test";
import { API_URL, mockApi, signIn } from "./fixtures";

for (const theme of ["light", "dark"] as const) {
  test(`${theme}: finance dashboard shows real history and a working report link`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await signIn(page, "FINANCE");
    await mockApi(page);
    await page.route(`${API_URL}/campaigns`, (route) => route.fulfill({ json: [{
      id: "campaign-redesign", title: "Autumn launch", brandName: "Test brand",
      createdAt: new Date().toISOString(), deadline: null, postCount: 3,
      costCap: null, spent: 0, pendingAssignmentCount: 0,
    }] }));
    await page.route(`${API_URL}/payments/summary**`, (route) => route.fulfill({ json: {
      pending: { amount: 0, links: 0, invoices: 0 },
      paid: { amount: 10000, payments: 2, links: 2 },
    } }));
    await page.goto("/dashboard");
    const activity = page.getByRole("region", { name: "Payout activity" });
    await expect(activity.getByText("₹60,000", { exact: true })).toBeVisible();
    await expect(activity.getByRole("img", { name: /Bar chart of payouts per month/ })).toBeVisible();
    await expect(activity.locator(".recharts-bar-rectangle")).toHaveCount(6);
    await expect(activity.getByText("12", { exact: true })).toBeVisible();
    const campaign = page.getByRole("region", { name: "Active campaigns" }).getByRole("link", { name: /Autumn launch/ });
    await expect(campaign).toBeVisible();
    await expect(campaign).toHaveClass(/listing-row/);
    await expect(campaign).toHaveAttribute("href", "/campaigns/campaign-redesign");
    await activity.getByRole("link", { name: "View reports" }).click();
    await expect(page).toHaveURL(/\/reports$/);
    await expect(page.getByRole("heading", { name: "Reports", exact: true })).toBeVisible();
  });
}

test("empty payout history is explained without invented bars", async ({ page }) => {
  await signIn(page, "FINANCE");
  await mockApi(page);
  await page.route(`${API_URL}/payments/summary**`, (route) => route.fulfill({ json: {
    pending: { amount: 0, links: 0, invoices: 0 }, paid: { amount: 0, payments: 0, links: 0 },
  } }));
  await page.goto("/dashboard");
  const activity = page.getByRole("region", { name: "Payout activity" });
  await expect(activity.getByText("No payouts in this period")).toBeVisible();
  await expect(activity.locator(".recharts-bar-rectangle")).toHaveCount(0);
});

test("creator dashboard never requests global payment summaries", async ({ page }) => {
  await signIn(page, "CREATOR");
  await mockApi(page);
  const summaries: string[] = [];
  page.on("request", (request) => { if (request.url().startsWith(`${API_URL}/payments/summary`)) summaries.push(request.url()); });
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("region", { name: "Payout activity" })).toHaveCount(0);
  expect(summaries).toEqual([]);
});
