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
    gstPercent: null,
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

    await page.goto("/plans?maker=all");
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

    await page.goto("/plans?maker=all");
    await page.getByLabel("Search plans by name, client or plan maker").fill("solmate");
    await expect(page.getByText("Festive Push")).toBeVisible();
    await expect(page.getByText("Q1 Meme Push")).toHaveCount(0);
  });

  test("a plan missing budget, contact, and pages shows the completeness hint with what's missing", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.route(`${API_URL}/plans`, (route) => route.fulfill({ json: [plan()] }));

    await page.goto("/plans?maker=all");
    await expect(page.getByText("Details filled")).toBeVisible();
    await expect(page.getByText(/Missing:.*Brief.*Client contact.*Budget.*Pages/)).toBeVisible();
  });

  test("a fully-filled plan shows the all-filled confirmation instead of a percentage", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.route(`${API_URL}/plans`, (route) =>
      route.fulfill({
        json: [
          plan({
            clientContact: "acme@example.com",
            // The brief counts too (22 Sep — the checklist is what an uploaded sheet is compared against).
            notes: "Launch brief",
            budget: "10000",
            items: [{ id: "item-1", planId: "plan-1", assetId: "asset-1", format: "reel", cost: "5000", clientCost: null, postsPerProfile: 1 }],
          }),
        ],
      })
    );

    await page.goto("/plans?maker=all");
    await expect(page.getByText("All details filled")).toBeVisible();
    await expect(page.getByText("Details filled", { exact: true })).toHaveCount(0);
  });
});

// 23 Sep — admin opens Plans as a list of plan makers (POCs); picking one
// shows only their plans. POC search; budget is a sort, not a filter.
test.describe("Plans — plan makers list (admin), POC search and budget sort", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  const aman = { id: "pm-aman", name: "Aman Malhotra" };
  const priya = { id: "pm-priya", name: "Priya Planner" };
  const plans = [
    plan({ id: "p1", name: "Boat pitch", createdBy: aman, budget: "50000", createdAt: "2026-09-05T10:00:00.000Z", updatedAt: "2026-09-20T10:00:00.000Z" }),
    plan({ id: "p2", name: "Nykaa pitch", createdBy: aman, budget: "150000", status: "APPROVED", createdAt: "2026-09-15T10:00:00.000Z" }),
    plan({ id: "p3", name: "Cred pitch", createdBy: priya, budget: "300000", createdAt: "2026-09-18T10:00:00.000Z" }),
  ];

  test("admin lands on the plan makers list; picking one shows only that maker's plans, with a way back", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.route(`${API_URL}/plans`, (route) => route.fulfill({ json: plans }));

    await page.goto("/plans");
    const list = page.getByTestId("plan-maker-list");
    await expect(list).toContainText("Aman Malhotra");
    await expect(list).toContainText("2 plans · 1 draft · 1 approved");
    await expect(list).toContainText("Priya Planner");
    await expect(page.getByText("Boat pitch")).toHaveCount(0); // no plan cards yet

    await page.getByLabel("Search plan makers").fill("pri");
    await expect(list).not.toContainText("Aman Malhotra");
    await page.getByLabel("Search plan makers").fill("");

    await page.getByRole("button", { name: "Open Aman Malhotra's plans" }).click();
    await expect(page).toHaveURL(/maker=pm-aman/);
    await expect(page.getByTestId("plan-maker-header")).toContainText("Aman Malhotra");
    await expect(page.getByText("Boat pitch")).toBeVisible();
    await expect(page.getByText("Nykaa pitch")).toBeVisible();
    await expect(page.getByText("Cred pitch")).toHaveCount(0);

    await page.getByRole("button", { name: "← All plan makers" }).click();
    await expect(page.getByTestId("plan-maker-list")).toBeVisible();
  });

  test("a Plan Maker never sees the makers list — straight to their own plans", async ({ page }) => {
    await signIn(page, "PLAN_MAKER");
    await mockApi(page);
    await page.route(`${API_URL}/plans`, (route) => route.fulfill({ json: [plans[0]] }));

    await page.goto("/plans");
    await expect(page.getByTestId("plan-maker-list")).toHaveCount(0);
    await expect(page.getByText("Boat pitch")).toBeVisible();
  });

  test("All plans: search matches the POC's name; budget sorts high→low / low→high; no date or budget filters", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.route(`${API_URL}/plans`, (route) => route.fulfill({ json: [...plans, plan({ id: "p4", name: "No budget pitch", createdBy: priya, budget: null })] }));

    await page.goto("/plans");
    await page.getByRole("button", { name: /^All plans/ }).click();
    await expect(page).toHaveURL(/maker=all/);
    await expect(page.getByLabel("Created from")).toHaveCount(0);
    await expect(page.getByLabel("Budget from")).toHaveCount(0);

    const search = page.getByLabel("Search plans by name, client or plan maker");
    await search.fill("priya");
    await expect(page.getByText("Cred pitch")).toBeVisible();
    await expect(page.getByText("Boat pitch")).toHaveCount(0);
    await search.fill("");

    const names = () => page.locator("p.line-clamp-2").allInnerTexts();
    await page.getByLabel("Sort plans").selectOption("budget-desc");
    await expect.poll(names).toEqual(["Cred pitch", "Nykaa pitch", "Boat pitch", "No budget pitch"]);
    await page.getByLabel("Sort plans").selectOption("budget-asc");
    await expect.poll(names).toEqual(["Boat pitch", "Nykaa pitch", "Cred pitch", "No budget pitch"]); // no budget stays last
  });
});
