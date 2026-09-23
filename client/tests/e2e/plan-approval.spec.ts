import { test, expect } from "@playwright/test";

import { signIn, mockApi, API_URL } from "./fixtures";

/**
 * Plan → Approve workflow (newTask.md, 8 Sep — "Plan Maker... approves
 * plans he created as well" / "Admin... even approving plans"; 11 Sep —
 * "remove option of submit for approval, plan maker or admin can approve
 * plan by themselves only": Approve/Reject now act directly on a DRAFT
 * plan, no submit-for-someone-else step first). Buttons are shown/hidden
 * per app/plans/page.tsx's `ownsPlan` check (Plans moved to its own nav
 * tab, newTask.md 9 Sep), but the real enforcement is server-side
 * (plans/service.js's assertCanAccessPlan) — these tests only cover that
 * the client offers the right actions to the right person and calls the
 * right endpoint, not the access rule itself (that's server/ vitest's job
 * — see plans/service.test.js).
 */
function draftPlan(overrides: Record<string, unknown> = {}) {
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
  await page.goto("/plans?maker=all");
}

test.describe("Plan approval workflow", () => {
  test("Plan Maker never sees a 'Submit for approval' option — it no longer exists", async ({ page }) => {
    await signIn(page, "PLAN_MAKER");
    await mockApi(page);
    await page.route(`${API_URL}/plans`, (route) => route.fulfill({ json: [draftPlan({ createdBy: { id: "test-user-1", name: "Test User" } })] }));

    await openPlansTab(page);
    await expect(page.getByRole("button", { name: "Submit for approval" })).toHaveCount(0);
  });

  test("Plan Maker does not see approve/reject on someone else's draft plan", async ({ page }) => {
    await signIn(page, "PLAN_MAKER");
    await mockApi(page);
    await page.route(`${API_URL}/plans`, (route) =>
      route.fulfill({ json: [draftPlan({ status: "DRAFT", createdBy: { id: "someone-else", name: "Other Planner" } })] })
    );

    await openPlansTab(page);
    await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Reject", exact: true })).toHaveCount(0);
  });

  test("Plan Maker can approve their own draft plan directly, no submit step first", async ({ page }) => {
    await signIn(page, "PLAN_MAKER");
    await mockApi(page);
    await page.route(`${API_URL}/plans`, (route) =>
      route.fulfill({ json: [draftPlan({ status: "DRAFT", createdBy: { id: "test-user-1", name: "Test User" } })] })
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

  test("Admin can approve/reject any Plan Maker's draft plan", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.route(`${API_URL}/plans`, (route) =>
      route.fulfill({ json: [draftPlan({ status: "DRAFT", createdBy: { id: "some-plan-maker", name: "Planner" } })] })
    );

    await openPlansTab(page);
    await expect(page.getByRole("button", { name: "Approve" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reject", exact: true })).toBeVisible();
  });

  // user request, 10 Sep — "on his marking all pages mentioned in the plan
  // will get the campaign visible": approving links a real Campaign onto
  // the plan; the list surfaces it as a direct link.
  test("an approved plan with a campaignId shows a 'View campaign' link to it", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.route(`${API_URL}/plans`, (route) =>
      route.fulfill({ json: [draftPlan({ status: "APPROVED", campaignId: "campaign-1", createdBy: { id: "some-plan-maker", name: "Planner" } })] })
    );

    await openPlansTab(page);
    const link = page.getByRole("link", { name: "View campaign ↗" });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", "/campaigns/view?id=campaign-1");
  });

  test("a plan not yet approved shows no 'View campaign' link", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.route(`${API_URL}/plans`, (route) => route.fulfill({ json: [draftPlan({ status: "DRAFT", campaignId: null })] }));

    await openPlansTab(page);
    await expect(page.getByRole("link", { name: "View campaign ↗" })).toHaveCount(0);
  });

  // user request, 10 Sep — "plan maker can't delete plan": confirms the
  // delete action, unconditionally rendered on every card, actually works
  // end-to-end for a Plan Maker on their own plan (server-side coverage in
  // plans/service.test.js's deletePlan tests; this is the client wiring).
  test("Plan Maker can delete their own plan", async ({ page }) => {
    await signIn(page, "PLAN_MAKER");
    await mockApi(page);
    await page.route(`${API_URL}/plans`, (route) =>
      route.fulfill({ json: [draftPlan({ createdBy: { id: "test-user-1", name: "Test User" } })] })
    );
    let deleted = false;
    await page.route(`${API_URL}/plans/plan-1`, (route) => {
      if (route.request().method() === "DELETE") {
        deleted = true;
        return route.fulfill({ status: 204, body: "" });
      }
      return route.fallback();
    });

    await openPlansTab(page);
    // Card icon is labelled "Delete <plan name>" (11 Sep icon redesign);
    // the confirm sheet's button is the literal "Delete plan".
    await page.getByRole("button", { name: /^Delete (?!plan$)/ }).click();
    await page.getByRole("button", { name: "Delete plan" }).click();
    await expect.poll(() => deleted).toBe(true);
  });
});
