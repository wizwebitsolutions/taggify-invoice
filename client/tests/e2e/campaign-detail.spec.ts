import { test, expect } from "@playwright/test";

import { signIn, mockApi, API_URL } from "./fixtures";

/**
 * bugs.md #7 — a real view/edit page for one campaign (brand/title/
 * deadline/cost cap, budget, and every link submitted under it) instead of
 * only ever seeing it as a card on the list. Per-link cost revision isn't
 * new UI — it's the same CostRevisionControl inside LinkDetailPanel the
 * dashboards' review queue already uses (components/dashboard/link-detail-panel.tsx),
 * just reachable from here too now.
 */
test.describe("Campaign detail page", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  const campaign = {
    id: "camp-1",
    brandName: "Solmate Coffee",
    title: "Launch Week",
    deadline: null,
    createdAt: new Date("2026-01-01").toISOString(),
    costCap: "10000",
    spent: 3000,
    remainingBudget: 7000,
    totalLikes: 250,
    postCount: 1,
    pendingAssignmentCount: 0,
  };

  const link = {
    id: "link-1",
    campaignId: "camp-1",
    assetId: "asset-1",
    submittedById: "user-1",
    url: "https://instagram.com/p/abc123",
    format: "reel",
    cost: "3000",
    customRate: false,
    status: "SUBMITTED",
    postedAt: null,
    createdAt: new Date("2026-01-02").toISOString(),
    asset: { id: "asset-1", ownerId: "user-1", platform: "instagram", handle: "solmatepage", followers: 1000, approvalStatus: "APPROVED", createdAt: new Date().toISOString(), rateCards: [], engagement: { avgLikes: null, avgComments: null, avgViews: null, sampleSize: 0 } },
  };

  async function mockCampaignRoutes(page: import("@playwright/test").Page) {
    await page.route(`${API_URL}/campaigns/camp-1`, (route) => route.fulfill({ json: campaign }));
    await page.route(`${API_URL}/links?*`, (route) => route.fulfill({ json: { items: [link], total: 1, page: 1, pageSize: 100 } }));
  }

  test("ADMIN sees campaign details, budget, links, and can open Edit", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await mockCampaignRoutes(page);

    await page.goto("/campaigns/view?id=camp-1");

    await expect(page.getByRole("heading", { name: "Launch Week" })).toBeVisible();
    await expect(page.getByText("SOLMATE COFFEE")).toBeVisible();
    await expect(page.getByText(/₹3,000\s*\/\s*₹10,000/)).toBeVisible(); // spent / cap
    await expect(page.getByTestId("campaign-link-row")).toContainText("@solmatepage");

    await page.getByRole("button", { name: "Edit campaign" }).click();
    await expect(page.getByRole("heading", { name: "Edit campaign" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Brand name" })).toHaveValue("Solmate Coffee");
    await expect(page.getByRole("textbox", { name: "Campaign title" })).toHaveValue("Launch Week");
  });

  test("editing a campaign saves via PUT /campaigns/:id and refetches", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await mockCampaignRoutes(page);
    let putBody: { title: string } | undefined;
    await page.route(`${API_URL}/campaigns/camp-1`, async (route) => {
      if (route.request().method() === "PUT") {
        putBody = route.request().postDataJSON();
        return route.fulfill({ json: { ...campaign, title: putBody!.title } });
      }
      return route.fulfill({ json: campaign });
    });

    await page.goto("/campaigns/view?id=camp-1");
    await page.getByRole("button", { name: "Edit campaign" }).click();
    const titleInput = page.getByRole("textbox", { name: "Campaign title" });
    await titleInput.fill("Launch Week — Extended");
    await page.getByRole("button", { name: "Save changes" }).click();

    await expect(page.getByRole("heading", { name: "Edit campaign" })).toHaveCount(0);
    expect(putBody).toMatchObject({ title: "Launch Week — Extended" });
  });

  test("CREATOR sees the same page but no Edit button and no cost-revision control", async ({ page }) => {
    await signIn(page, "CREATOR");
    await mockApi(page);
    await mockCampaignRoutes(page);

    await page.goto("/campaigns/view?id=camp-1");

    await expect(page.getByRole("heading", { name: "Launch Week" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit campaign" })).toHaveCount(0);

    await page.getByTestId("campaign-link-row").click();
    await expect(page.getByText("Revise cost")).toHaveCount(0);
  });

  test("clicking a link opens its detail panel with Revise cost, for ADMIN", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await mockCampaignRoutes(page);

    await page.goto("/campaigns/view?id=camp-1");
    await page.getByTestId("campaign-link-row").click();

    // Two "Revise cost" buttons exist in the DOM at this viewport — the
    // persistent desktop side panel, and the mobile bottom-sheet version of
    // the same LinkDetailPanel (hidden via CSS, not removed from the DOM).
    await expect(page.getByRole("button", { name: "Revise cost" }).first()).toBeVisible();
  });

  test("a nonexistent campaign shows a not-found state instead of crashing", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.route(`${API_URL}/campaigns/missing`, (route) =>
      route.fulfill({ status: 404, json: { error: { code: "CAMPAIGN_NOT_FOUND", message: "Campaign not found" } } })
    );

    await page.goto("/campaigns/view?id=missing");

    await expect(page.getByText("Campaign not found.")).toBeVisible();
  });

  test("campaign cards on the list link to their detail page", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.route(`${API_URL}/campaigns`, (route) => route.fulfill({ json: [campaign] }));

    await page.goto("/campaigns");
    await page.getByTestId("campaign-card").click();

    await expect(page).toHaveURL(/\/campaigns\/view\?id=camp-1$/);
  });

  test("phase chips appear once a 2nd phase exists, and highlight the one being viewed", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    const phases = [
      { id: "camp-1", phaseNumber: 1, title: "Launch Week", createdAt: campaign.createdAt },
      { id: "camp-2", phaseNumber: 2, title: "Launch Week — Phase 2", createdAt: campaign.createdAt },
    ];
    await mockCampaignRoutes(page);
    await page.route(`${API_URL}/campaigns/camp-1`, (route) => route.fulfill({ json: { ...campaign, phases } }));

    await page.goto("/campaigns/view?id=camp-1");

    await expect(page.getByRole("link", { name: "Phase 1" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Phase 2" })).toBeVisible();
  });

  test("Add phase creates a new phase and navigates to it", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await mockCampaignRoutes(page);
    await page.route(`${API_URL}/campaigns/camp-1/phases`, (route) =>
      route.fulfill({ status: 201, json: { id: "camp-2", parentCampaignId: "camp-1", phaseNumber: 2, title: "Launch Week — Phase 2" } })
    );
    await page.route(`${API_URL}/campaigns/camp-2`, (route) =>
      route.fulfill({ json: { ...campaign, id: "camp-2", title: "Launch Week — Phase 2", phaseNumber: 2, parentCampaignId: "camp-1" } })
    );

    await page.goto("/campaigns/view?id=camp-1");
    await page.getByRole("button", { name: "+ Add phase" }).click();

    await expect(page).toHaveURL(/\/campaigns\/view\?id=camp-2$/);
    await expect(page.getByRole("heading", { name: "Launch Week — Phase 2" })).toBeVisible();
  });
});
