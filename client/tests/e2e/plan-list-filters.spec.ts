import { test, expect } from "@playwright/test";

import { signIn, mockApi, API_URL } from "./fixtures";

/**
 * Plans list — status filter strip, search, and the "details filled"
 * completeness hint on each card (user request, 10 Sep — "active plan
 * going on, need to be approved, etc type filters in horizontal tab
 * selectable filter, with search tab, ... highlighting what's left for
 * filling in this plan, details filled percentage etc").
 */
function plan(overrides: Record<string, unknown> = {}) {
  return {
    id: "plan-1",
    name: "Q1 Meme Push",
    clientName: "Acme",
    clientContact: null,
    budget: null,
    isGstPlan: false,
    status: "DRAFT",
    approvedBy: null,
    approvedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    createdBy: { id: "test-user-1", name: "Test User" },
    items: [],
    totalCost: 5000,
    budgetVariance: null,
    expectedEngagement: { likes: 1000, views: 5000 },
    overview: { totalFollowers: 100000, totalPosts: 1, expectedImpressions: 5000, subtotal: 5000, gstAmount: 0, total: 5000 },
    ...overrides,
  };
}

test.describe("Plans — status filter strip and search", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("status tabs filter the grid and show a per-status count", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.route(`${API_URL}/plans`, (route) =>
      route.fulfill({
        json: [
          plan({ id: "plan-1", name: "Draft plan", status: "DRAFT" }),
          plan({ id: "plan-2", name: "Live plan", status: "APPROVED" }),
        ],
      })
    );

    await page.goto("/plans");
    await expect(page.getByRole("button", { name: "All 2" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Active 1" })).toBeVisible();

    await page.getByRole("button", { name: "Active 1" }).click();
    await expect(page.getByText("Live plan")).toBeVisible();
    await expect(page.getByText("Draft plan")).toHaveCount(0);
  });

  test("search filters by plan or client name", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.route(`${API_URL}/plans`, (route) =>
      route.fulfill({
        json: [
          plan({ id: "plan-1", name: "Q1 Meme Push", clientName: "Acme" }),
          plan({ id: "plan-2", name: "Festive Push", clientName: "Solmate" }),
        ],
      })
    );

    await page.goto("/plans");
    await page.getByLabel("Search plans by name or client").fill("solmate");
    await expect(page.getByText("Festive Push")).toBeVisible();
    await expect(page.getByText("Q1 Meme Push")).toHaveCount(0);
  });

  test("a plan missing budget, contact, and pages shows the completeness hint with what's missing", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.route(`${API_URL}/plans`, (route) => route.fulfill({ json: [plan()] }));

    await page.goto("/plans");
    await expect(page.getByText("Details filled")).toBeVisible();
    await expect(page.getByText(/Missing:.*Client contact.*Budget.*Pages/)).toBeVisible();
  });

  test("a fully-filled plan shows the all-filled confirmation instead of a percentage", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.route(`${API_URL}/plans`, (route) =>
      route.fulfill({
        json: [
          plan({
            clientContact: "acme@example.com",
            budget: "10000",
            items: [{ id: "item-1", planId: "plan-1", assetId: "asset-1", format: "reel", cost: "5000", clientCost: null, postsPerProfile: 1 }],
          }),
        ],
      })
    );

    await page.goto("/plans");
    await expect(page.getByText("All details filled")).toBeVisible();
    await expect(page.getByText("Details filled", { exact: true })).toHaveCount(0);
  });
});
