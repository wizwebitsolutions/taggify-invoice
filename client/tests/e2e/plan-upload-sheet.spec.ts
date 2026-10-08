import { test, expect, type Page } from "@playwright/test";

import { signIn, mockApi, API_URL } from "./fixtures";

/**
 * "Upload plan" from a Google Sheet (user request, 22 Sep — "plan maker can
 * upload their own made excel sheet plan, it'll be showed in their plans,
 * anything missing ... will be shown as missing ... refresh button of
 * fetching updated sheet"). Components: components/plans/upload-plan-modal.tsx,
 * complete-plan-steps.tsx, the card in app/plans/page.tsx; parser in
 * lib/parseAssignmentSheet.ts (parsePlanSheet — covered here through the
 * exact body posted, since the client has no unit-test runner). Server side
 * (createPlanFromSheet / syncPlanFromSheet / addPendingPage) is vitest.
 */
function plan(overrides: Record<string, unknown> = {}) {
  return {
    id: "plan-1",
    name: "Q1 Meme Push",
    clientName: "Acme",
    clientContact: null,
    notes: null,
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
    internal: { computedFollowers: 0, computedPosts: 0, computedImpressions: 0, computedSubtotal: 0, computedGstAmount: 0, computedTotal: 0 },
    clientSheetUrl: null,
    internalSheetUrl: null,
    executionSheetUrl: null,
    sourceSheetUrl: null,
    sourceSheetFetchedAt: null,
    sourceSheetPending: [],
    ...overrides,
  };
}

const SHEET_URL = "https://docs.google.com/spreadsheets/d/plan123/edit#gid=0";
// Two tabs (22 Sep): Details, then Pages — with a page link, handles without "@".
const DETAILS_CSV = ["Plan name,Q1 Meme Push", "Client name:,Acme Foods", "Budget,\"₹1,50,000\"", "GST %,18%", "Brief,Launch reels in October"].join("\n");
const PAGES_CSV = [
  "Handle,Page link,Category,Followers,Format,Posts per profile,Cost,Client cost",
  "@ghantaa,https://www.instagram.com/ghantaa/,Meme page,8.7M,reel,2,45000,60000",
  ",https://www.instagram.com/brand.new/?hl=en,,12K,story,1,,",
  ",,TOTAL,,,,,",
].join("\n");
const TABS = { tabs: [{ gid: "0", title: "Details", csv: DETAILS_CSV }, { gid: "77", title: "Pages", csv: PAGES_CSV }] };

const pendingPage = { kind: "page", handle: "brand.new", category: null, followers: 12000, format: "story", cost: 1500, clientCost: null, postsPerProfile: 1, reason: "Not in Inventory yet." };
const uploaded = (overrides: Record<string, unknown> = {}) =>
  plan({ sourceSheetUrl: SHEET_URL, sourceSheetFetchedAt: "2026-09-22T09:00:00.000Z", budget: 150000, gstPercent: 18, notes: "Launch reels in October", sourceSheetPending: [pendingPage], ...overrides });

async function mockPlans(page: Page, plans: unknown[]) {
  await page.route(`${API_URL}/plans`, (route) => route.fulfill({ json: plans }));
}

test.describe("Plans — Upload plan from a Google Sheet", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("Upload plan opens a popup with the format + template; the sheet is fetched, parsed and posted as a plan, then the missing-details steps open", async ({ page }) => {
    await signIn(page, "PLAN_MAKER");
    await mockApi(page);
    // The list is refetched after Create — it must then contain the new plan.
    const plans: unknown[] = [];
    await page.route(`${API_URL}/plans`, (route) => route.fulfill({ json: plans }));
    let fetched: string | null = null;
    await page.route(`${API_URL}/plans/import-sheet-tabs`, (route) => {
      fetched = route.request().postDataJSON().url;
      return route.fulfill({ json: TABS });
    });
    let posted: Record<string, unknown> | null = null;
    await page.route(`${API_URL}/plans/from-sheet`, (route) => {
      posted = route.request().postDataJSON();
      plans.push(uploaded({ clientName: "Acme Foods" }));
      return route.fulfill({ status: 201, json: plans[0] });
    });

    await page.goto("/plans?maker=all");
    await page.getByRole("button", { name: "Upload plan" }).first().click();
    const modal = page.getByTestId("upload-plan-modal");
    await expect(modal.getByTestId("upload-plan-format")).toContainText("Tab 1 — Details");
    await expect(modal.getByTestId("upload-plan-format")).toContainText("Tab 2 — Pages");
    const [download] = await Promise.all([page.waitForEvent("download"), modal.getByRole("button", { name: "Pages tab template (.csv)" }).click()]);
    expect(download.suggestedFilename()).toBe("taggify-plan-template-pages.csv");
    await expect(modal.getByRole("button", { name: "Details tab template (.csv)" })).toBeVisible();

    // Only a Google Sheets link is accepted.
    await modal.locator('input[name="sourceSheetUrl"]').fill("https://example.com/plan.xlsx");
    await modal.getByRole("button", { name: "Fetch sheet" }).click();
    await expect(modal).toContainText("Only Google Sheets links are supported");
    expect(fetched).toBeNull();

    await modal.locator('input[name="sourceSheetUrl"]').fill(SHEET_URL);
    await modal.getByRole("button", { name: "Fetch sheet" }).click();
    expect(fetched).toBe(SHEET_URL);
    const review = modal.getByTestId("upload-plan-review");
    await expect(review.getByTestId("upload-plan-summary")).toContainText("2 pages found · budget ₹1,50,000 · GST 18%");
    await expect(review).toContainText("Not in the sheet: client contact");
    await expect(review.locator('input[name="name"]')).toHaveValue("Q1 Meme Push");
    await expect(review.locator('input[name="clientName"]')).toHaveValue("Acme Foods");
    await review.getByRole("button", { name: "Create plan" }).click();

    expect(posted).toEqual({
      sourceSheetUrl: SHEET_URL,
      fields: { name: "Q1 Meme Push", clientName: "Acme Foods", budget: 150000, gstPercent: 18, notes: "Launch reels in October" },
      rows: [
        // "@" stripped; a row with only a page link gets its handle from the link.
        { handle: "ghantaa", pageUrl: "https://www.instagram.com/ghantaa/", category: "Meme page", followers: 8700000, format: "reel", postsPerProfile: 2, cost: 45000, clientCost: 60000 },
        { handle: "brand.new", pageUrl: "https://www.instagram.com/brand.new/?hl=en", followers: 12000, format: "story", postsPerProfile: 1 },
      ],
    });
    // Straight into the steps for what's missing: client contact, then the pending page.
    const steps = page.getByTestId("complete-plan-steps");
    await expect(steps).toContainText("step 1 of 2");
    await expect(steps.getByTestId("step-clientContact")).toBeVisible();
    await expect(page.getByTestId("plan-from-sheet-badge")).toHaveAttribute("href", SHEET_URL);
  });

  test("a sheet without a plan/client name asks for both before creating", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await mockPlans(page, []);
    // A single-tab sheet (pages only) still works.
    await page.route(`${API_URL}/plans/import-sheet-tabs`, (route) => route.fulfill({ json: { tabs: [{ gid: "0", title: null, csv: "Handle,Cost\n@ghantaa,1000" }] } }));
    let posted: Record<string, unknown> | null = null;
    await page.route(`${API_URL}/plans/from-sheet`, (route) => {
      posted = route.request().postDataJSON();
      return route.fulfill({ status: 201, json: uploaded({ name: "Typed", clientName: "Client", sourceSheetPending: [] }) });
    });

    await page.goto("/plans?maker=all");
    await page.getByRole("button", { name: "Upload plan" }).first().click();
    const modal = page.getByTestId("upload-plan-modal");
    await modal.locator('input[name="sourceSheetUrl"]').fill(SHEET_URL);
    await modal.getByRole("button", { name: "Fetch sheet" }).click();
    await modal.getByRole("button", { name: "Create plan" }).click();
    await expect(modal).toContainText("Plan name is required.");
    await expect(modal).toContainText("Client name is required.");
    expect(posted).toBeNull();
    await modal.locator('input[name="name"]').fill("Typed");
    await modal.locator('input[name="clientName"]').fill("Client");
    await modal.getByRole("button", { name: "Create plan" }).click();
    expect(posted).toMatchObject({ fields: { name: "Typed", clientName: "Client" }, rows: [{ handle: "ghantaa", cost: 1000 }] });
  });

  test("an uploaded plan's card shows the From sheet badge, lists what's missing (incl. pending pages) and Complete details walks through it", async ({ page }) => {
    await signIn(page, "PLAN_MAKER");
    await mockApi(page);
    const plans = [uploaded()];
    await page.route(`${API_URL}/plans`, (route) => route.fulfill({ json: plans }));
    let patched: Record<string, unknown> | null = null;
    await page.route(`${API_URL}/plans/plan-1`, (route) => {
      patched = route.request().postDataJSON();
      plans[0] = uploaded({ clientContact: "Rohit" });
      return route.fulfill({ json: plans[0] });
    });
    let added: Record<string, unknown> | null = null;
    await page.route(`${API_URL}/plans/plan-1/sheet-pending/add`, (route) => {
      added = route.request().postDataJSON();
      plans[0] = uploaded({ clientContact: "Rohit", sourceSheetPending: [], items: [{ id: "i1", assetId: "a1", format: "story", cost: 1500, clientCost: null, postsPerProfile: 1, asset: { id: "a1", handle: "brand.new", followers: 12000 } }] });
      return route.fulfill({ json: plans[0] });
    });

    await page.goto("/plans?maker=all");
    await expect(page.getByTestId("plan-from-sheet-badge")).toBeVisible();
    await expect(page.getByText(/Missing:.*Client contact.*@brand\.new not in Inventory/)).toBeVisible();
    await page.getByRole("button", { name: "Complete details →" }).click();

    const steps = page.getByTestId("complete-plan-steps");
    await expect(steps).toContainText("step 1 of 2");
    await steps.getByRole("button", { name: "Save & next" }).click();
    await expect(steps).toContainText("Who's the contact at the client?");
    await steps.locator('input[name="clientContact"]').fill("Rohit");
    await steps.getByRole("button", { name: "Save & next" }).click();
    expect(patched).toEqual({ clientContact: "Rohit" });

    const pages = steps.getByTestId("step-pages");
    await expect(pages.getByTestId("pending-page-brand.new")).toContainText("12K followers"); // K / M since 8 Oct
    await pages.getByRole("button", { name: "Add to inventory" }).click();
    expect(added).toEqual({ handle: "brand.new" });
    await expect(pages).toContainText("Every page in the sheet is on the plan now.");
    await pages.getByRole("button", { name: "Done" }).click();
    await expect(page.getByText("All details filled")).toBeVisible();
  });

  test("Refresh re-fetches the SAME stored link and posts the re-parsed sheet to sheet-sync — nothing to re-attach", async ({ page }) => {
    await signIn(page, "PLAN_MAKER");
    await mockApi(page);
    await mockPlans(page, [uploaded()]);
    let fetched: string | null = null;
    await page.route(`${API_URL}/plans/import-sheet-tabs`, (route) => {
      fetched = route.request().postDataJSON().url;
      return route.fulfill({ json: TABS });
    });
    let synced: Record<string, unknown> | null = null;
    await page.route(`${API_URL}/plans/plan-1/sheet-sync`, (route) => {
      synced = route.request().postDataJSON();
      return route.fulfill({ json: uploaded() });
    });

    await page.goto("/plans?maker=all");
    await page.getByTestId("plan-refresh-sheet").click();
    await expect.poll(() => synced).not.toBeNull();
    expect(fetched).toBe(SHEET_URL);
    expect(synced).toMatchObject({ fields: { name: "Q1 Meme Push", budget: 150000 }, rows: [{ handle: "ghantaa" }, { handle: "brand.new" }] });
    // The sheet stays where it was — no link input appeared anywhere.
    await expect(page.locator('input[name="sourceSheetUrl"]')).toHaveCount(0);
  });

  test("a wizard-built plan has no badge or Refresh; an approved uploaded plan keeps the badge but loses Refresh", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await mockPlans(page, [plan(), uploaded({ id: "plan-2", status: "APPROVED", clientContact: "R", sourceSheetPending: [] })]);

    await page.goto("/plans?maker=all");
    await expect(page.getByTestId("plan-from-sheet-badge")).toHaveCount(1);
    await expect(page.getByTestId("plan-refresh-sheet")).toHaveCount(0);
  });
});
