import { test, expect, type Page } from "@playwright/test";

import { signIn, mockApi, API_URL } from "./fixtures";

/**
 * Phases vs extra posts, and deleting a phase (user request, 22 Sep):
 *  - admin/plan maker see real phases only; a page's second post of a phase
 *    carries a "Post 2" tag instead of being its own phase;
 *  - admins can delete Phase 2+ (confirm, blocked with the server's reason
 *    while posts/invoices exist); Phase 1 has no delete;
 *  - a plan maker can add a phase but not delete one;
 *  - creators get one campaign entry per phase they're booked on, numbered
 *    in one running count — what the Upload links dropdown offers.
 * Server side: server/src/modules/campaigns/phases.test.js.
 */

const phases = [
  { id: "root", phaseNumber: 1, title: "Diwali", createdAt: "2026-09-01T00:00:00.000Z" },
  { id: "phase2", phaseNumber: 2, title: "Diwali — Phase 2", createdAt: "2026-09-10T00:00:00.000Z" },
];
const campaign = (over: Record<string, unknown> = {}) => ({
  id: "root",
  brandName: "Acme",
  title: "Diwali",
  deadline: null,
  createdAt: "2026-09-01T00:00:00.000Z",
  costCap: "50000",
  spent: 10000,
  remainingBudget: 40000,
  totalLikes: 0,
  postCount: 2,
  pendingAssignmentCount: 0,
  parentCampaignId: null,
  phaseNumber: 1,
  postNumber: 1,
  phases,
  ...over,
});
const asset = { id: "asset-a", ownerId: "creator-a", platform: "instagram", handle: "page.a", followers: 1000, approvalStatus: "approved", createdAt: "2026-09-01T00:00:00.000Z", rateCards: [], engagement: { avgLikes: null, avgComments: null, avgViews: null, sampleSize: 0 } };
const link = (id: string, campaignId: string, postNumber: number) => ({
  id,
  campaignId,
  assetId: "asset-a",
  submittedById: "creator-a",
  url: `https://instagram.com/reel/${id}`,
  format: "reel",
  cost: "5000",
  customRate: false,
  status: "SUBMITTED",
  postedAt: null,
  createdAt: "2026-09-02T00:00:00.000Z",
  asset,
  campaign: { id: campaignId, title: "Diwali", brandName: "Acme", phaseNumber: 1, postNumber },
});

async function mockCampaignPage(page: Page) {
  await page.route(`${API_URL}/campaigns/root`, (route) => route.fulfill({ json: campaign() }));
  await page.route(`${API_URL}/campaigns/phase2`, (route) => route.fulfill({ json: campaign({ id: "phase2", title: "Diwali — Phase 2", phaseNumber: 2, postCount: 0, parentCampaignId: "root" }) }));
  await page.route(`${API_URL}/links?*`, (route) => route.fulfill({ json: { items: [link("l1", "root", 1), link("l2", "p1-post2", 2)], total: 2, page: 1, pageSize: 100 } }));
  await page.route(`${API_URL}/campaigns/root/assignments`, (route) =>
    route.fulfill({
      json: [
        { id: "as1", campaignId: "root", assetId: "asset-a", pageHandle: "page.a", creatorPhone: null, postUrl: null, format: "reel", cost: "5000", linkId: null, status: "matched", createdAt: "2026-09-01T00:00:00.000Z", postNumber: 1 },
        { id: "as3", campaignId: "p1-post2", assetId: "asset-a", pageHandle: "page.a", creatorPhone: null, postUrl: null, format: "reel", cost: "5000", linkId: null, status: "matched", createdAt: "2026-09-01T00:00:00.000Z", postNumber: 2 },
      ],
    })
  );
}

test.describe("Campaign phases (22 Sep)", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("admin: real phases only; the page's second post of Phase 1 is tagged 'Post 2', not a phase", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await mockCampaignPage(page);
    await page.goto("/campaigns/view?id=root");

    await expect(page.getByTestId("phase-row")).toHaveCount(2);
    const rows = page.getByTestId("campaign-link-row");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0).getByTestId("post-number-tag")).toHaveCount(0);
    await expect(rows.nth(1).getByTestId("post-number-tag")).toHaveText("Post 2");
    await expect(page.getByText("· Post 2")).toBeVisible(); // attached-sheet row
  });

  test("admin: Phase 1 has no delete; deleting Phase 2 asks first, then calls the API and refreshes", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await mockCampaignPage(page);
    let deleted: string | null = null;
    await page.route(`${API_URL}/campaigns/phase2/phase`, (route) => {
      deleted = route.request().method();
      return route.fulfill({ json: { deleted: 1, rootId: "root" } });
    });
    await page.goto("/campaigns/view?id=root");

    await expect(page.getByRole("button", { name: "Delete phase 1" })).toHaveCount(0);
    await page.getByRole("button", { name: "Delete phase 2" }).click();
    const confirm = page.getByTestId("delete-phase-confirm");
    await expect(confirm).toContainText("Delete Phase 2?");
    expect(deleted).toBeNull(); // nothing happens before confirming
    await confirm.getByRole("button", { name: "Delete Phase 2" }).click();
    await expect(confirm).toHaveCount(0);
    expect(deleted).toBe("DELETE");
  });

  test("admin: a phase with posts can't be deleted — the server's reason is shown and the phase stays", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await mockCampaignPage(page);
    await page.route(`${API_URL}/campaigns/phase2/phase`, (route) =>
      route.fulfill({ status: 409, json: { error: { code: "PHASE_HAS_POSTS", message: "Phase 2 has 1 submitted post — remove it before deleting the phase." } } })
    );
    await page.goto("/campaigns/view?id=root");
    await page.getByRole("button", { name: "Delete phase 2" }).click();
    await page.getByTestId("delete-phase-confirm").getByRole("button", { name: "Delete Phase 2" }).click();
    await expect(page.getByTestId("delete-phase-confirm")).toContainText("Phase 2 has 1 submitted post");
    await expect(page.getByTestId("phase-row")).toHaveCount(2);
  });

  test("deleting the phase you're viewing lands you on Phase 1", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await mockCampaignPage(page);
    await page.route(`${API_URL}/campaigns/phase2/phase`, (route) => route.fulfill({ json: { deleted: 1, rootId: "root" } }));
    await page.goto("/campaigns/view?id=phase2");
    await page.getByRole("button", { name: "Delete phase 2" }).click();
    await page.getByTestId("delete-phase-confirm").getByRole("button", { name: "Delete Phase 2" }).click();
    await expect(page).toHaveURL(/\/campaigns\/view\?id=root$/);
  });

  test("plan maker: can add a phase but not delete one", async ({ page }) => {
    await signIn(page, "PLAN_MAKER");
    await mockApi(page);
    await mockCampaignPage(page);
    let created = false;
    await page.route(`${API_URL}/campaigns/root/phases`, (route) => {
      created = true;
      return route.fulfill({ status: 201, json: { id: "phase3", phaseNumber: 3 } });
    });
    await page.route(`${API_URL}/campaigns/phase3`, (route) => route.fulfill({ json: campaign({ id: "phase3", phaseNumber: 3, title: "Diwali — Phase 3" }) }));
    await page.goto("/campaigns/view?id=root");

    await expect(page.getByRole("button", { name: /Delete phase/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Edit campaign" })).toHaveCount(0);
    await page.getByRole("button", { name: "Add phase" }).click();
    await expect.poll(() => created).toBe(true);
    await expect(page).toHaveURL(/id=phase3/);
  });

  test("creator: the Upload links dropdown lists each phase they're booked on, in one running count", async ({ page }) => {
    await signIn(page, "CREATOR");
    await mockApi(page);
    // Real shape: a creator's phase entries are child rows (parentCampaignId set) — the list page must keep them.
    const entry = (id: string, n: number) => ({ ...campaign({ id, title: n > 1 ? `Diwali — Phase ${n}` : "Diwali", phases: undefined, parentCampaignId: n > 1 ? "root" : null }), creatorPhaseNumber: n, phaseCount: 1 });
    await page.route(`${API_URL}/campaigns`, (route) => route.fulfill({ json: [entry("root", 1), entry("p1-post2", 2), entry("phase2", 3)] }));
    await page.route(`${API_URL}/assets`, (route) => route.fulfill({ json: [asset] }));
    await page.goto("/dashboard");

    await page.getByRole("button", { name: /Upload links/i }).first().click();
    const modal = page.locator("form").filter({ has: page.getByRole("heading", { name: "Upload links" }) });
    const campaignSelect = modal.locator("select").first();
    await expect(campaignSelect.locator("option")).toHaveText(["Diwali", "Diwali — Phase 2", "Diwali — Phase 3"]);

    await page.goto("/campaigns");
    await expect(page.getByText("Diwali — Phase 3")).toBeVisible();
    // The phase column says which of their phases each entry is (not the admin's "2 phases").
    const cards = page.getByTestId("campaign-card");
    await expect(cards).toHaveCount(3);
    await expect(cards.filter({ hasText: "Diwali — Phase 3" }).locator("td").nth(1)).toHaveText("Phase 3");
    await expect(cards.first().locator("td").nth(1)).toHaveText("Phase 1");
  });

  // Booked campaigns only (24 Sep): each entry carries the creator's pages
  // booked on that exact row; the picker offers only those.
  test("creator: Upload links offers only rows a page is booked on, and only those pages", async ({ page }) => {
    await signIn(page, "CREATOR");
    await mockApi(page);
    const assetB = { ...asset, id: "asset-b", handle: "page.b" };
    const entry = (id: string, n: number, booked: string[]) => ({
      ...campaign({ id, title: n > 1 ? `Diwali — Phase ${n}` : "Diwali", phases: undefined, parentCampaignId: n > 1 ? "root" : null }),
      creatorPhaseNumber: n,
      phaseCount: 1,
      bookedAssetIds: booked,
    });
    await page.route(`${API_URL}/campaigns`, (route) => route.fulfill({ json: [entry("root", 1, ["asset-b"]), entry("p1-post2", 2, []), entry("phase2", 3, ["asset-a", "asset-b"])] }));
    await page.route(`${API_URL}/assets`, (route) => route.fulfill({ json: [asset, assetB] }));
    await page.goto("/dashboard");

    await page.getByRole("button", { name: /Upload links/i }).first().click();
    const modal = page.locator("form").filter({ has: page.getByRole("heading", { name: "Upload links" }) });
    const [campaignSelect, pageSelect] = [modal.locator("select").nth(0), modal.locator("select").nth(1)];
    await expect(campaignSelect.locator("option")).toHaveText(["Diwali", "Diwali — Phase 3"]);
    await expect(pageSelect.locator("option")).toHaveText(["@page.b"]);
    await campaignSelect.selectOption("phase2");
    await expect(pageSelect.locator("option")).toHaveText(["@page.a", "@page.b"]);
  });

  test("creator with no booked page: Upload links says so and can't submit", async ({ page }) => {
    await signIn(page, "CREATOR");
    await mockApi(page);
    await page.route(`${API_URL}/campaigns`, (route) => route.fulfill({ json: [] }));
    await page.route(`${API_URL}/assets`, (route) => route.fulfill({ json: [asset] }));
    await page.goto("/dashboard");

    await page.getByRole("button", { name: /Upload links/i }).first().click();
    const modal = page.locator("form").filter({ has: page.getByRole("heading", { name: "Upload links" }) });
    await expect(modal.getByTestId("upload-not-booked")).toContainText("None of your pages is booked on a campaign yet");
    await modal.locator("textarea").fill("https://instagram.com/reel/abc");
    await expect(modal.getByRole("button", { name: /^Submit/ })).toBeDisabled();
  });
});

test.describe("Campaign phases — creator view and direct links (22 Sep)", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("a creator on their own Phase 2 sees no admin 'Post 2' tags", async ({ page }) => {
    await signIn(page, "CREATOR");
    await mockApi(page);
    await page.route(`${API_URL}/campaigns/p1-post2`, (route) =>
      route.fulfill({ json: campaign({ id: "p1-post2", title: "Diwali — Phase 2", phaseNumber: 2, creatorPhaseNumber: 2, parentCampaignId: "root", phases: [phases[0], { id: "p1-post2", phaseNumber: 2, title: "Diwali — Phase 2", createdAt: phases[0].createdAt }] }) })
    );
    await page.route(`${API_URL}/links?*`, (route) => route.fulfill({ json: { items: [link("l2", "p1-post2", 2)], total: 1, page: 1, pageSize: 100 } }));
    await page.route(`${API_URL}/campaigns/p1-post2/assignments`, (route) =>
      route.fulfill({ json: [{ id: "as3", campaignId: "p1-post2", assetId: "asset-a", pageHandle: "page.a", creatorPhone: null, postUrl: null, format: "reel", cost: "5000", linkId: null, status: "matched", createdAt: "2026-09-01T00:00:00.000Z", postNumber: 2 }] })
    );
    await page.goto("/campaigns/view?id=p1-post2");
    await expect(page.getByRole("heading", { name: "Diwali — Phase 2" })).toBeVisible();
    await expect(page.getByTestId("campaign-link-row")).toHaveCount(1);
    await expect(page.getByTestId("post-number-tag")).toHaveCount(0);
    await expect(page.getByText("· Post 2")).toHaveCount(0);
  });

  test("an admin opening a page's 2nd-post row directly is moved to the phase it belongs to", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await mockCampaignPage(page);
    // The server answers the extra-post id with its phase (Phase 1 = root).
    await page.route(`${API_URL}/campaigns/p1-post2`, (route) => route.fulfill({ json: campaign() }));
    await page.goto("/campaigns/view?id=p1-post2");
    await expect(page).toHaveURL(/\/campaigns\/view\?id=root$/);
    await expect(page.getByTestId("phase-row").first()).toContainText("Viewing");
  });
});
