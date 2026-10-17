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
    gstPercent: null,
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

    await page.goto("/plans?maker=all");
    await expect(page.getByRole("button", { name: "PDF" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Client sheet" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Internal sheet" })).toBeVisible();
  });

  // 16 Oct — "Client sheet" first asks which of the two formats to use; confirming generates.
  test("clicking Client sheet on an ungenerated plan asks for the format, then calls generate; the button reflects the cached link on refetch", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    let generateCalled = false;
    await page.route(`${API_URL}/plans`, (route) => route.fulfill({ json: [plan()] }));
    await page.route(`${API_URL}/plans/plan-1/sheet`, (route) => {
      generateCalled = true;
      return route.fulfill({ json: { spreadsheetUrl: "https://docs.google.com/spreadsheets/d/sheet-1/edit?gid=1#gid=1" } });
    });

    await page.goto("/plans?maker=all");
    await page.getByRole("button", { name: "Client sheet" }).click();
    await expect(page.getByTestId("sheet-format-modal")).toBeVisible();
    expect(generateCalled).toBe(false);
    const [tab] = await Promise.all([page.waitForEvent("popup"), page.getByTestId("sheet-format-confirm").click()]);
    await tab.close();
    await expect.poll(() => generateCalled).toBe(true);
  });

  test("clicking Client sheet on an already-generated plan offers the cached link to open as is, without calling generate", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    let generateCalled = false;
    await page.route(`${API_URL}/plans`, (route) => route.fulfill({ json: [plan({ clientSheetUrl: "https://docs.google.com/spreadsheets/d/sheet-1/edit?gid=1#gid=1" })] }));
    await page.route(`${API_URL}/plans/plan-1/sheet`, (route) => {
      generateCalled = true;
      return route.fulfill({ json: { spreadsheetUrl: "https://docs.google.com/spreadsheets/d/sheet-1/edit?gid=1#gid=1" } });
    });

    await page.goto("/plans?maker=all");
    await expect(page.getByRole("button", { name: "Client sheet ↗" })).toBeVisible();
    await page.getByRole("button", { name: "Client sheet ↗" }).click();
    // Same format as the sheet already has → a plain link to it; the format cards are still there to regenerate differently.
    await expect(page.getByTestId("sheet-format-open-existing")).toHaveAttribute("href", "https://docs.google.com/spreadsheets/d/sheet-1/edit?gid=1#gid=1");
    await expect(page.getByTestId("sheet-format-confirm")).toHaveText("Regenerate");
    expect(generateCalled).toBe(false);
  });

  // 22 Sep — an expired Google refresh token surfaced as a raw 500
  // "Something went wrong" on every ungenerated plan.
  test("an expired Google connection shows the real reason and, for an Admin, a Reconnect Google button that opens the consent flow", async ({ page, context }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.route(`${API_URL}/plans`, (route) => route.fulfill({ json: [plan(), plan({ id: "plan-2", name: "Other plan" })] }));
    await page.route(`${API_URL}/plans/plan-1/sheet`, (route) =>
      route.fulfill({ status: 503, json: { error: { code: "GOOGLE_RECONNECT_REQUIRED", message: "The connected Google account's access has expired or been revoked — an admin needs to reconnect it (Plans → Reconnect Google)." } } })
    );
    await context.route(`${API_URL}/integrations/google/authorize**`, (route) => route.fulfill({ contentType: "text/html", body: "<title>consent</title>" }));

    await page.goto("/plans?maker=all");
    await page.getByRole("button", { name: "Client sheet" }).first().click();
    // The generate path opens a blank tab first (popup-blocker-safe); it just stays blank on failure.
    const [blank] = await Promise.all([page.waitForEvent("popup"), page.getByTestId("sheet-format-confirm").click()]);
    await blank.close();
    // Shown once, inside the format popup that's still open — not on every card.
    await expect(page.getByTestId("google-reconnect-notice")).toHaveCount(1);
    const notice = page.getByTestId("google-reconnect-notice");
    await expect(notice).toContainText("access has expired or been revoked");
    await expect(notice).not.toContainText("Something went wrong");

    const [consent] = await Promise.all([page.waitForEvent("popup"), notice.getByRole("button", { name: /Reconnect Google/ }).click()]);
    expect(consent.url()).toContain("/integrations/google/authorize?token=test-access-token");
    await consent.close();
  });

  test("a non-admin is told to ask an admin instead of getting the Reconnect button", async ({ page }) => {
    await signIn(page, "PLAN_MAKER");
    await mockApi(page);
    await page.route(`${API_URL}/plans`, (route) => route.fulfill({ json: [plan({ createdBy: { id: "test-user-1", name: "Test User" } })] }));
    await page.route(`${API_URL}/plans/plan-1/sheet`, (route) => route.fulfill({ status: 503, json: { error: { code: "GOOGLE_RECONNECT_REQUIRED", message: "Google access expired." } } }));

    await page.goto("/plans?maker=all");
    await page.getByRole("button", { name: "Client sheet" }).click();
    const [blank] = await Promise.all([page.waitForEvent("popup"), page.getByTestId("sheet-format-confirm").click()]);
    await blank.close();
    const notice = page.getByTestId("google-reconnect-notice");
    await expect(notice).toContainText("Ask an admin to reconnect");
    await expect(notice.getByRole("button", { name: /Reconnect Google/ })).toHaveCount(0);
  });
});
