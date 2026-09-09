import { test, expect } from "@playwright/test";

import { signIn, mockApi, API_URL } from "./fixtures";

/**
 * Plan → Approve workflow (newTask.md, 8 Sep — "Plan Maker... approves
 * plans he created as well" / "Admin... even approving plans"). Buttons are
 * shown/hidden per app/inventory/page.tsx's `ownsPlan` check, but the real
 * enforcement is server-side (plans/service.js's assertCanAccessPlan) —
 * these tests only cover that the client offers the right actions to the
 * right person and calls the right endpoint, not the access rule itself
 * (that's server/ vitest's job — see plans/service.test.js).
 */
function draftPlan(overrides: Record<string, unknown> = {}) {
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
    createdBy: { id: "pm-1", name: "Planner One" },
    items: [],
    totalCost: 5000,
    budgetVariance: null,
    expectedEngagement: { likes: 1000, views: 5000 },
    overview: { totalFollowers: 100000, totalPosts: 1, expectedImpressions: 5000, subtotal: 5000, gstAmount: 0, total: 5000 },
    ...overrides,
  };
}

async function openPlansTab(page: import("@playwright/test").Page) {
  await page.goto("/inventory");
  await page.getByRole("button", { name: "Plans", exact: true }).click();
}

test.describe("Plan approval workflow", () => {
  test("Plan Maker sees Submit for approval on their own DRAFT plan", async ({ page }) => {
    await signIn(page, "PLAN_MAKER");
    await mockApi(page);
    await page.route(`${API_URL}/plans`, (route) => route.fulfill({ json: [draftPlan({ createdBy: { id: "test-user-1", name: "Test User" } })] }));
    let submitted = false;
    await page.route(`${API_URL}/plans/plan-1/submit`, (route) => {
      submitted = true;
      return route.fulfill({ json: draftPlan({ status: "PENDING_APPROVAL", createdBy: { id: "test-user-1", name: "Test User" } }) });
    });

    await openPlansTab(page);
    await page.getByRole("button", { name: "Submit for approval" }).click();
    await expect.poll(() => submitted).toBe(true);
  });

  test("Plan Maker does not see approve/reject on someone else's pending plan", async ({ page }) => {
    await signIn(page, "PLAN_MAKER");
    await mockApi(page);
    await page.route(`${API_URL}/plans`, (route) =>
      route.fulfill({ json: [draftPlan({ status: "PENDING_APPROVAL", createdBy: { id: "someone-else", name: "Other Planner" } })] })
    );

    await openPlansTab(page);
    await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Reject" })).toHaveCount(0);
  });

  test("Plan Maker can approve their own pending plan", async ({ page }) => {
    await signIn(page, "PLAN_MAKER");
    await mockApi(page);
    await page.route(`${API_URL}/plans`, (route) =>
      route.fulfill({ json: [draftPlan({ status: "PENDING_APPROVAL", createdBy: { id: "test-user-1", name: "Test User" } })] })
    );
    let approved = false;
    await page.route(`${API_URL}/plans/plan-1/approve`, (route) => {
      approved = true;
      return route.fulfill({ json: draftPlan({ status: "APPROVED", createdBy: { id: "test-user-1", name: "Test User" } }) });
    });

    await openPlansTab(page);
    await page.getByRole("button", { name: "Approve" }).click();
    await expect.poll(() => approved).toBe(true);
  });

  test("Admin can approve/reject any Plan Maker's pending plan", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.route(`${API_URL}/plans`, (route) =>
      route.fulfill({ json: [draftPlan({ status: "PENDING_APPROVAL", createdBy: { id: "some-plan-maker", name: "Planner" } })] })
    );

    await openPlansTab(page);
    await expect(page.getByRole("button", { name: "Approve" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reject" })).toBeVisible();
  });
});
