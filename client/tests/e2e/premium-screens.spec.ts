import { test, expect } from "@playwright/test";

import { API_URL, signIn, mockApi } from "./fixtures";

/**
 * The premium screen layouts (Sep 2026 redesign): admin home is a decision
 * queue, /approvals is a list-left/detail-right queue, campaigns and
 * inventory are tables, and selecting inventory rows raises the floating
 * bar. Guards the *structure* the mockups specified, not just the tokens
 * (premium-design-system.spec.ts covers those).
 */

const pendingLink = {
  id: "link-shot",
  campaignId: "camp-1",
  assetId: "asset-1",
  submittedById: "creator-1",
  url: "https://instagram.com/reel/abc",
  format: "reel",
  cost: "12000",
  customRate: false,
  status: "PENDING_SCREENSHOT_REVIEW",
  postedAt: "2026-09-01T00:00:00.000Z",
  createdAt: "2026-09-01T00:00:00.000Z",
  campaign: { id: "camp-1", title: "Zomato Diwali", brandName: "Zomato" },
  asset: { id: "asset-1", handle: "meme.mafia", followers: 2400000 },
  screenshot: { id: "s1", publicId: "x", approved: null, url: null },
};

const campaign = {
  id: "camp-1",
  brandName: "Zomato",
  title: "Zomato Diwali",
  deadline: "2027-01-01T00:00:00.000Z",
  createdAt: "2026-09-01T00:00:00.000Z",
  costCap: "720000",
  spent: 58500,
  remainingBudget: 661500,
  postCount: 4,
  totalLikes: 67300,
  phaseCount: 2,
  pendingAssignmentCount: 0,
};

const asset = (id: string, handle: string, category: string) => ({
  id,
  ownerId: "creator-1",
  platform: "instagram",
  handle,
  followers: 100000,
  category,
  approvalStatus: "approved",
  createdAt: "2026-09-01T00:00:00.000Z",
  rateCards: [{ id: `${id}-reel`, assetId: id, format: "reel", amount: "12000" }],
  engagement: { avgLikes: null, avgComments: null, avgViews: null, sampleSize: 0 },
  owner: { id: "creator-1", name: "Karan Tiwari", phoneNumber: "+919100000001" },
  campaigns: [],
});

test.describe("premium screens", () => {
  test("admin home opens as a decision queue with the pending proof and a budget bar", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.route(`${API_URL}/links?*`, (route) => route.fulfill({ json: { items: [pendingLink], total: 1, page: 1, pageSize: 100 } }));
    await page.route(`${API_URL}/campaigns`, (route) => route.fulfill({ json: [campaign] }));

    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/Good (morning|afternoon|evening)/);
    const queue = page.getByTestId("decision-queue");
    await expect(queue.getByText("Screenshot proof · @meme.mafia")).toBeVisible();
    await expect(queue.getByRole("button", { name: "Approve" })).toBeVisible();
    await expect(queue.getByRole("link", { name: /Open approvals/ })).toHaveAttribute("href", "/approvals");
    await expect(page.getByText("Zomato Diwali", { exact: true })).toBeVisible(); // campaign budgets card
    await expect(page.getByTestId("expenditure-bars")).toBeVisible();
  });

  test("/approvals lists the item and shows its review panel; the sidebar links to it", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.route(`${API_URL}/links?*`, (route) => route.fulfill({ json: { items: [pendingLink], total: 1, page: 1, pageSize: 100 } }));

    await page.goto("/dashboard");
    await page.getByRole("complementary").getByRole("link", { name: "Approvals", exact: true }).click();
    await expect(page).toHaveURL(/\/approvals$/);

    await expect(page.getByTestId("approvals-chip-all")).toBeVisible();
    await expect(page.getByTestId("approval-row-link-shot")).toBeVisible();
    await expect(page.getByTestId("approval-detail")).toContainText("@meme.mafia");
    await expect(page.getByTestId("approval-detail")).toContainText("Zomato Diwali");
  });

  test("campaigns is a table with budget-used and remaining columns", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.route(`${API_URL}/campaigns`, (route) => route.fulfill({ json: [campaign] }));

    await page.goto("/campaigns");
    const table = page.getByTestId("campaigns-table");
    await expect(table.getByRole("columnheader", { name: "Budget used" })).toBeVisible();
    await expect(table.getByRole("columnheader", { name: "Remaining" })).toBeVisible();
    await expect(table.getByText("₹6,61,500")).toBeVisible();
    await expect(table.getByText("2 phases")).toBeVisible();
    await expect(page.getByRole("tab", { name: /Live/ })).toHaveAttribute("aria-selected", "true");
  });

  test("inventory is a table; selecting rows raises the floating bar with Create plan", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.route(`${API_URL}/assets`, (route) => route.fulfill({ json: [asset("a1", "meme.mafia", "Meme page"), asset("a2", "news.now", "News page")] }));

    await page.goto("/inventory");
    await expect(page.getByTestId("inventory-table")).toBeVisible();
    await expect(page.getByTestId("selection-bar")).toHaveCount(0);

    await page.getByRole("checkbox", { name: "Select @meme.mafia for a plan" }).check();
    const bar = page.getByTestId("selection-bar");
    await expect(bar).toBeVisible();
    await expect(bar).toContainText("1 page selected");
    await page.getByTestId("create-plan-from-selection").click();
    // /plans consumes ?assetIds and immediately replaces the URL, so assert on the wizard opening.
    await page.waitForURL(/\/plans/);
    await expect(page.getByRole("heading", { name: "New plan" })).toBeVisible();
  });

  test("new campaign is a four-step wizard with a review step", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.goto("/campaigns");
    await page.getByRole("button", { name: "New campaign", exact: true }).click();

    const wizard = page.getByTestId("new-campaign-wizard");
    await expect(wizard.getByRole("list", { name: "Steps" })).toContainText("Basics");
    await expect(wizard.getByRole("list", { name: "Steps" })).toContainText("Review");
    await expect(wizard.getByRole("button", { name: "Continue" })).toBeDisabled();
    await wizard.getByPlaceholder("e.g. Zomato", { exact: true }).fill("Zomato");
    await wizard.getByPlaceholder("e.g. Zomato Diwali").fill("Zomato Diwali");
    await wizard.getByRole("button", { name: "Continue" }).click();
    await expect(wizard.getByText("Step 2 of 4")).toBeVisible();
    await wizard.getByRole("button", { name: "Continue" }).click();
    await wizard.getByRole("button", { name: "Continue to review" }).click();
    await expect(wizard.getByText("Step 4 of 4")).toBeVisible();
    await expect(wizard.getByRole("button", { name: "Create campaign" })).toBeEnabled();
  });
});
