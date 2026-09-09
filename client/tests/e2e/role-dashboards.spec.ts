import { test, expect } from "@playwright/test";

import { signIn, mockApi } from "./fixtures";

/**
 * Phase 4 (newTask.md, 8 Sep — "separate dashboard for finance" / "separate
 * dashboard for plan maker"): Admin, Finance, and Plan Maker each land on a
 * genuinely different dashboard component now instead of two of the three
 * sharing AdminDashboard — see app/dashboard/page.tsx's role branch and the
 * three components under components/dashboard/.
 */
test.describe("Dashboard content varies by role, not just by a shared component", () => {
  test("ADMIN sees the Admin dashboard's ops sections (Team, Recent job runs)", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.goto("/dashboard");

    await expect(page.getByRole("heading", { name: "Team" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Recent job runs" })).toBeVisible();
  });

  test("FINANCE sees its own dashboard (page-wise dues, no ops-only sections)", async ({ page }) => {
    await signIn(page, "FINANCE");
    await mockApi(page);
    await page.goto("/dashboard");

    await expect(page.getByRole("heading", { name: "Page-wise dues" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Pending post-for-cost" })).toBeVisible();
    // Ops-only content (asset approval, job runs, team) isn't Finance's to act on.
    await expect(page.getByRole("heading", { name: "Recent job runs" })).toHaveCount(0);
  });

  test("PLAN_MAKER sees its own dashboard (their plans, a New plan action)", async ({ page }) => {
    await signIn(page, "PLAN_MAKER");
    await mockApi(page);
    await page.goto("/dashboard");

    // level: 2 disambiguates the "Your plans" panel heading from the hero's
    // own <h1> title, which reuses the same copy.
    await expect(page.getByRole("heading", { name: "Your plans", level: 2 })).toBeVisible();
    await expect(page.getByRole("button", { name: "New plan" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Recent job runs" })).toHaveCount(0);
  });

  test("CREATOR still sees the per-link My Works dashboard, unaffected by the 3-way split", async ({ page }) => {
    await signIn(page, "CREATOR");
    await mockApi(page);
    await page.goto("/dashboard");

    await expect(page.getByRole("heading", { name: "Your plans", level: 2 })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Page-wise dues" })).toHaveCount(0);
  });
});
