import { test, expect, type Page } from "@playwright/test";

import { signIn, mockApi, API_URL } from "./fixtures";

/**
 * Plan card → execution sheet sync (user decision, 23 Sep — "parse → auto-
 * create links"): once a sheet is attached to an approved plan, the card
 * shows when it was last read, how many links it produced, and a Refresh
 * links button to read it again; rows that couldn't become a link are
 * listed with why. Component: app/plans/page.tsx's PlanCard. Server side
 * (executionSheetParser.js + plans/service.js's syncExecutionSheet) is
 * covered by vitest.
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
    status: "APPROVED",
    approvedBy: { id: "admin-1", name: "Ops Admin" },
    approvedAt: "2026-09-10T00:00:00.000Z",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    createdBy: { id: "test-user-1", name: "Test User" },
    items: [],
    totalCost: 0,
    budgetVariance: null,
    expectedEngagement: { likes: 0, views: 0 },
    overview: { totalFollowers: 0, totalPosts: 0, expectedImpressions: 0, subtotal: 0, gstAmount: 0, total: 0 },
    clientSheetUrl: null,
    internalSheetUrl: null,
    executionSheetUrl: "https://docs.google.com/spreadsheets/d/abc123/edit",
    executionSheetFetchedAt: null,
    executionSheetPending: [],
    campaignId: "camp-1",
    ...overrides,
  };
}

async function mockPlans(page: Page, plans: unknown[]) {
  await page.route(`${API_URL}/plans`, (route) => route.fulfill({ json: plans }));
}

test.describe("Plans — execution sheet sync (23 Sep: parse → auto-create links)", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("a DRAFT plan with a sheet attached explains links only read after approval, and shows no Refresh button", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await mockPlans(page, [plan({ status: "DRAFT", campaignId: null })]);

    await page.goto("/plans?maker=all");
    const sync = page.getByTestId("execution-sheet-sync");
    await expect(sync).toContainText("read from this sheet once the plan is approved");
    await expect(page.getByTestId("plan-sync-execution-sheet")).toHaveCount(0);
  });

  test("an approved plan not yet read shows 'Not read yet' and a Refresh links button", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await mockPlans(page, [plan()]);

    await page.goto("/plans?maker=all");
    await expect(page.getByTestId("execution-sheet-sync")).toContainText("Not read yet.");
    await expect(page.getByTestId("plan-sync-execution-sheet")).toBeVisible();
  });

  test("clicking Refresh links calls the sync route and shows the attached/pending summary plus the pending rows with reasons", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await mockPlans(page, [plan({ executionSheetFetchedAt: "2026-09-20T10:00:00.000Z", executionSheetPending: [{ rowNumber: 4, pageHandle: "unknownpage", pageName: null, postUrl: "https://instagram.com/reel/x", reason: "isn't a page on this plan" }] })]);
    let called = false;
    await page.route(`${API_URL}/plans/plan-1/execution-sheet/sync`, (route) => {
      called = true;
      return route.fulfill({
        json: {
          plan: plan({
            executionSheetFetchedAt: "2026-09-23T12:00:00.000Z",
            executionSheetPending: [{ rowNumber: 4, pageHandle: "unknownpage", pageName: null, postUrl: "https://instagram.com/reel/x", reason: "isn't a page on this plan" }],
          }),
          summary: { attached: 2, alreadyLinked: 1, pending: 1, rows: 4 },
        },
      });
    });

    await page.goto("/plans?maker=all");
    await page.getByTestId("plan-sync-execution-sheet").click();
    await expect.poll(() => called).toBe(true);

    const summary = page.getByTestId("execution-sheet-summary");
    await expect(summary).toContainText("Attached 2 new links");
    await expect(summary).toContainText("1 already linked");
    await expect(summary).toContainText("1 pending");

    const pending = page.getByTestId("execution-sheet-pending");
    await expect(pending).toContainText("Row 4");
    await expect(pending).toContainText("@unknownpage");
    await expect(pending).toContainText("isn't a page on this plan");
  });

  test("a sheet that can't be read shows the error from the sync route", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await mockPlans(page, [plan()]);
    await page.route(`${API_URL}/plans/plan-1/execution-sheet/sync`, (route) =>
      route.fulfill({ status: 400, json: { error: { code: "SHEET_NOT_SHARED", message: "Couldn't read that sheet — make sure it's shared as \"Anyone with the link can view\"." } } })
    );

    await page.goto("/plans?maker=all");
    await page.getByTestId("plan-sync-execution-sheet").click();
    await expect(page.getByText(/Couldn't read that sheet/)).toBeVisible();
  });

  test("attaching a sheet for the first time on an approved plan reports a sync error inline if the read fails", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    // The list route stays in sync with the PUT response so the post-
    // invalidation refetch doesn't revert the card to its pre-save state.
    let current = plan({ executionSheetUrl: null });
    await page.route(`${API_URL}/plans`, (route) => (route.request().method() === "GET" ? route.fulfill({ json: [current] }) : route.fallback()));
    await page.route(`${API_URL}/plans/execution-sheet-template/preview`, (route) => route.fulfill({ json: { title: "t", headers: [], linkColumns: [], rows: [], totalsRow: [] } }));
    await page.route(`${API_URL}/plans/plan-1`, (route) => {
      current = plan({ executionSheetSyncError: "That sheet is too large to import." });
      return route.fulfill({ json: current });
    });

    await page.goto("/plans?maker=all");
    await page.getByRole("button", { name: "Attach execution sheet" }).click();
    const modal = page.getByTestId("execution-sheet-modal");
    await modal.locator('input[name="executionSheetUrl"]').fill("https://docs.google.com/spreadsheets/d/abc123/edit");
    await modal.getByRole("button", { name: "Attach sheet" }).click();
    await expect(modal).toHaveCount(0);
    await expect(page.getByText("That sheet is too large to import.")).toBeVisible();
  });
});
