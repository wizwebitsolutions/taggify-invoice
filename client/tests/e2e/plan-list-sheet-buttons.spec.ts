import { test, expect } from "@playwright/test";

import { signIn, mockApi, API_URL } from "./fixtures";

/**
 * Plans list — "Client sheet" / "Internal sheet" per card (user request,
 * 10 Sep — "after plan creation where the list of plans are option of
 * viewing googlesheet of plan for client or internal"), replacing the old
 * standalone "PDF" button.
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
    totalCost: 0,
    budgetVariance: null,
    expectedEngagement: { likes: 0, views: 0 },
    overview: { totalFollowers: 0, totalPosts: 0, expectedImpressions: 0, subtotal: 0, gstAmount: 0, total: 0 },
    clientSheetUrl: null,
    internalSheetUrl: null,
    ...overrides,
  };
}

test.describe("Plans list — Client sheet / Internal sheet buttons", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("no PDF button anywhere on a plan card", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.route(`${API_URL}/plans`, (route) => route.fulfill({ json: [plan()] }));

    await page.goto("/plans");
    await expect(page.getByRole("button", { name: "PDF" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Client sheet" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Internal sheet" })).toBeVisible();
  });

  test("clicking Client sheet on an ungenerated plan calls generate, then the button reflects the cached link on refetch", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    let generateCalled = false;
    await page.route(`${API_URL}/plans`, (route) => route.fulfill({ json: [plan()] }));
    await page.route(`${API_URL}/plans/plan-1/sheet`, (route) => {
      generateCalled = true;
      return route.fulfill({ json: { spreadsheetUrl: "https://docs.google.com/spreadsheets/d/sheet-1/edit?gid=1#gid=1" } });
    });

    await page.goto("/plans");
    await page.getByRole("button", { name: "Client sheet" }).click();
    await expect.poll(() => generateCalled).toBe(true);
  });

  test("clicking Client sheet on an already-generated plan opens the cached link directly, without calling generate", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    let generateCalled = false;
    await page.route(`${API_URL}/plans`, (route) => route.fulfill({ json: [plan({ clientSheetUrl: "https://docs.google.com/spreadsheets/d/sheet-1/edit?gid=1#gid=1" })] }));
    await page.route(`${API_URL}/plans/plan-1/sheet`, (route) => {
      generateCalled = true;
      return route.fulfill({ json: { spreadsheetUrl: "https://docs.google.com/spreadsheets/d/sheet-1/edit?gid=1#gid=1" } });
    });

    await page.goto("/plans");
    await expect(page.getByRole("button", { name: "Client sheet ↗" })).toBeVisible();
    const [popup] = await Promise.all([page.waitForEvent("popup"), page.getByRole("button", { name: "Client sheet ↗" }).click()]);
    expect(popup.url()).toContain("docs.google.com/spreadsheets/d/sheet-1");
    await popup.close();
    expect(generateCalled).toBe(false);
  });
});
