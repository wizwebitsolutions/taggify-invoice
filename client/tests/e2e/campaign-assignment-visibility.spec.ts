import { test, expect } from "@playwright/test";

import { signIn, mockApi, API_URL } from "./fixtures";

/**
 * newTask.md, 8 Sep — "attached sheet/links for a campaign should be
 * visible to all creators listed in that sheet, not just admin/finance"
 * and "if a post link is already mentioned in the attached sheet, it
 * should get added directly to that creator's posts". The server itself
 * scopes what GET /campaigns/:id/assignments returns per role (see
 * campaigns/service.js's listAssignments) — these tests only cover that
 * the client renders whatever comes back, and hides the panel when there's
 * nothing relevant to the viewer.
 */
test.describe("Campaign detail — attached sheet visibility", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  const campaign = {
    id: "camp-1",
    brandName: "Solmate Coffee",
    title: "Launch Week",
    deadline: null,
    createdAt: new Date("2026-01-01").toISOString(),
    costCap: null,
    spent: 0,
    remainingBudget: null,
    totalLikes: 0,
    postCount: 0,
    pendingAssignmentCount: 0,
  };

  async function mockCampaignBase(page: import("@playwright/test").Page) {
    await page.route(`${API_URL}/campaigns/camp-1`, (route) => route.fulfill({ json: campaign }));
    await page.route(`${API_URL}/links?*`, (route) => route.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 100 } }));
  }

  test("a Creator sees only their own matched row, with its phone number hidden", async ({ page }) => {
    await signIn(page, "CREATOR");
    await mockApi(page);
    await mockCampaignBase(page);
    // Server-scoped: a CREATOR's request only ever gets their own row(s) back.
    await page.route(`${API_URL}/campaigns/camp-1/assignments`, (route) =>
      route.fulfill({
        json: [
          {
            id: "a1",
            campaignId: "camp-1",
            assetId: "asset-1",
            pageHandle: "mypage",
            creatorPhone: "+919876543210",
            postUrl: null,
            format: null,
            cost: null,
            linkId: null,
            status: "matched",
            createdAt: new Date().toISOString(),
            asset: { id: "asset-1", handle: "mypage", category: null, approvalStatus: "approved" },
          },
        ],
      })
    );

    await page.goto("/campaigns/view?id=camp-1");

    await expect(page.getByRole("heading", { name: "Attached sheet" })).toBeVisible();
    await expect(page.getByText("@mypage")).toBeVisible();
    // Privacy: a non-privileged viewer never sees a phone number on this panel.
    await expect(page.getByText("+919876543210")).toHaveCount(0);
  });

  test("Admin sees every row including other creators' phone numbers", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await mockCampaignBase(page);
    await page.route(`${API_URL}/campaigns/camp-1/assignments`, (route) =>
      route.fulfill({
        json: [
          {
            id: "a1",
            campaignId: "camp-1",
            assetId: "asset-1",
            pageHandle: "pageone",
            creatorPhone: "+919876543210",
            postUrl: null,
            format: null,
            cost: null,
            linkId: null,
            status: "matched",
            createdAt: new Date().toISOString(),
            asset: { id: "asset-1", handle: "pageone", category: null, approvalStatus: "approved" },
          },
          {
            id: "a2",
            campaignId: "camp-1",
            assetId: null,
            pageHandle: "pagetwo",
            creatorPhone: "+919000000000",
            postUrl: null,
            format: null,
            cost: null,
            linkId: null,
            status: "pending",
            createdAt: new Date().toISOString(),
            asset: null,
          },
        ],
      })
    );

    await page.goto("/campaigns/view?id=camp-1");

    await expect(page.getByRole("heading", { name: "Attached sheet" })).toBeVisible();
    await expect(page.getByText("@pageone")).toBeVisible();
    await expect(page.getByText("+919876543210")).toBeVisible();
    await expect(page.getByText("@pagetwo")).toBeVisible();
    await expect(page.getByText("Pending", { exact: true })).toBeVisible();
    await expect(page.getByText("Matched", { exact: true })).toBeVisible();
  });

  test("shows an auto-attached post's status inline on its row", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await mockCampaignBase(page);
    await page.route(`${API_URL}/campaigns/camp-1/assignments`, (route) =>
      route.fulfill({
        json: [
          {
            id: "a1",
            campaignId: "camp-1",
            assetId: "asset-1",
            pageHandle: "pageone",
            creatorPhone: null,
            postUrl: "https://instagram.com/p/abc123",
            format: "reel",
            cost: null,
            linkId: "link-1",
            status: "matched",
            createdAt: new Date().toISOString(),
            asset: { id: "asset-1", handle: "pageone", category: null, approvalStatus: "approved" },
            link: { id: "link-1", status: "SUBMITTED" },
          },
        ],
      })
    );

    await page.goto("/campaigns/view?id=camp-1");

    await expect(page.getByText(/Post attached/)).toBeVisible();
  });

  test("the panel is hidden entirely when there's nothing for this viewer to see", async ({ page }) => {
    await signIn(page, "CREATOR");
    await mockApi(page);
    await mockCampaignBase(page);
    // No explicit route — mockApi's catch-all returns [] for GET /campaigns/camp-1/assignments.

    await page.goto("/campaigns/view?id=camp-1");
    await expect(page.getByRole("heading", { name: "Launch Week" })).toBeVisible();

    await expect(page.getByRole("heading", { name: "Attached sheet" })).toHaveCount(0);
  });
});
