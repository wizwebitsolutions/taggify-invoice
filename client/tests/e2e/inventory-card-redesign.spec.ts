import { test, expect } from "@playwright/test";

import { signIn, mockApi, API_URL } from "./fixtures";

/**
 * Regression coverage for the Inventory page-card redesign (user request,
 * 11 Sep): the collapsed card now shows only the Reel rate (not every
 * rate-card format) and a "Campaigns" section listing which campaigns the
 * page has been assigned to (server-side: assets/service.js's listAssets
 * now dedupes each asset's CampaignAssignment rows into `asset.campaigns`).
 */
function testAssets() {
  return [
    {
      id: "asset-1",
      ownerId: "creator-1",
      platform: "instagram",
      handle: "multi.format.page",
      followers: 120000,
      category: "News page",
      approvalStatus: "approved",
      createdAt: "2026-01-01T00:00:00.000Z",
      rateCards: [
        { id: "rc-1", format: "reel", amount: "12000" },
        { id: "rc-2", format: "story", amount: "5000" },
        { id: "rc-3", format: "carousel", amount: "8000" },
      ],
      engagement: { avgLikes: null, avgComments: null, avgViews: null, sampleSize: 0 },
      campaigns: [
        { id: "campaign-a", title: "Q1 Push", brandName: "Acme" },
        { id: "campaign-b", title: "Diwali Drop", brandName: "Acme" },
      ],
    },
    {
      id: "asset-2",
      ownerId: "creator-1",
      platform: "instagram",
      handle: "no.reel.page",
      followers: 40000,
      category: "Meme page",
      approvalStatus: "approved",
      createdAt: "2026-01-01T00:00:00.000Z",
      rateCards: [{ id: "rc-4", format: "story", amount: "3000" }],
      engagement: { avgLikes: null, avgComments: null, avgViews: null, sampleSize: 0 },
      campaigns: [],
    },
  ];
}

test.describe("Inventory page cards — Reel-only rate summary and Campaigns", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("collapsed card shows only the Reel rate, not story/carousel", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.route(`${API_URL}/assets`, (route) => route.fulfill({ json: testAssets() }));

    await page.goto("/inventory");
    const card = page.getByTestId("asset-card").filter({ hasText: "@multi.format.page" });

    await expect(card.getByText("Reel", { exact: true })).toBeVisible();
    await expect(card.getByText("₹12,000")).toBeVisible();
    await expect(card.getByText("₹5,000")).not.toBeAttached();
    await expect(card.getByText("₹8,000")).not.toBeAttached();
  });

  test("a page with no Reel rate set shows the empty state, not another format", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.route(`${API_URL}/assets`, (route) => route.fulfill({ json: testAssets() }));

    await page.goto("/inventory");
    const card = page.getByTestId("asset-card").filter({ hasText: "@no.reel.page" });

    await expect(card.getByTitle("No reel rate set yet")).toBeVisible();
    await expect(card.getByText("₹3,000")).not.toBeAttached();
  });

  // Ten page prices since 14 Oct: the editor lists all ten by label; a
  // legacy carousel rate card is neither shown nor re-saved (it stays stored
  // server-side), so the Static & Carousel box starts empty.
  test("clicking Edit exposes all ten rates by label, and no legacy format", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.route(`${API_URL}/assets`, (route) => route.fulfill({ json: testAssets() }));

    await page.goto("/inventory");
    const card = page.getByTestId("asset-card").filter({ hasText: "@multi.format.page" });
    await card.getByRole("button", { name: "Edit" }).click();
    // Edit opens a drawer on the right (17 Oct) rather than expanding the row.
    const sheet = page.getByTestId("asset-edit-sheet");
    await expect(sheet).toContainText("@multi.format.page");

    // One line per priced format (16 Oct); unpriced ones are offered in the "Add a rate for…" select, not shown as empty boxes.
    await expect(sheet.getByLabel("@multi.format.page Reel rate", { exact: true })).toHaveValue("12,000");
    await expect(sheet.getByLabel("@multi.format.page Static & Carousel rate", { exact: true })).toHaveCount(0);
    await expect(sheet.getByLabel("@multi.format.page Add a rate for", { exact: true }).locator("option", { hasText: "Static & Carousel" })).toHaveCount(1);
    await expect(sheet.getByText("carousel", { exact: true })).toHaveCount(0);
    await expect(sheet.getByPlaceholder("Add custom format (e.g. VOXPOP)")).toHaveCount(0);
  });

  test("a pending page with only one rate (or none) shows no 'needs rates' note and can be approved — nothing is mandatory (16 Oct)", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    const pending = { ...testAssets()[1], id: "asset-p", handle: "pending.page", approvalStatus: "pending", rateCards: [{ id: "rc-9", format: "reel", amount: "4000" }] };
    await page.route(`${API_URL}/assets`, (route) => route.fulfill({ json: [pending] }));
    let approved = false;
    await page.route(`${API_URL}/assets/asset-p/approval`, (route) => {
      approved = route.request().postDataJSON()?.approvalStatus === "approved";
      return route.fulfill({ json: { ...pending, approvalStatus: "approved" } });
    });

    await page.goto("/inventory");
    const card = page.getByTestId("asset-card").filter({ hasText: "@pending.page" });
    await expect(card.getByTestId("rates-missing")).toHaveCount(0);
    await card.getByRole("button", { name: "Approve @pending.page" }).click();
    await expect.poll(() => approved).toBe(true);
  });

  test("Campaigns section lists every campaign the page has been assigned to", async ({ page }) => {
    // The Campaigns column only shows from 2xl (1536px) up — below that the
    // table would clip its action buttons (user report, 14 Sep); campaigns
    // stay reachable in the row's Edit panel (covered by the test below).
    await page.setViewportSize({ width: 1600, height: 900 });
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.route(`${API_URL}/assets`, (route) => route.fulfill({ json: testAssets() }));

    await page.goto("/inventory");
    const withCampaigns = page.getByTestId("asset-card").filter({ hasText: "@multi.format.page" });
    await expect(withCampaigns.getByText("Q1 Push")).toBeVisible();
    await expect(withCampaigns.getByText("Diwali Drop")).toBeVisible();

    const withoutCampaigns = page.getByTestId("asset-card").filter({ hasText: "@no.reel.page" });
    await expect(withoutCampaigns.getByTitle("No campaigns yet")).toBeVisible();
  });

  test("below 2xl the Campaigns column is hidden but the Edit panel still lists them", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 800 });
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.route(`${API_URL}/assets`, (route) => route.fulfill({ json: testAssets() }));

    await page.goto("/inventory");
    const card = page.getByTestId("asset-card").filter({ hasText: "@multi.format.page" });
    // The hidden column cell is still in the DOM (display: none) — only the Edit panel's copy is visible.
    await expect(card.getByText("Q1 Push")).not.toBeVisible();
    await card.getByRole("button", { name: "Edit" }).click();
    const sheet = page.getByTestId("asset-edit-sheet");
    await expect(sheet.getByText("Q1 Push")).toBeVisible();
    await expect(sheet.getByText("Diwali Drop")).toBeVisible();
  });
});

test.describe("Inventory page cards — profile picture cover", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  // Regression test for a real bug (user report, 11 Sep): Instagram's CDN
  // routinely 503s/403s a direct <img> hotlink from outside Instagram
  // itself, which left a broken-image icon on the card. The fix degrades to
  // the plain fallback the moment the image errors, instead of showing it.
  test("a profile pic that fails to load falls back to the plain gray tile, not a broken image", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.route(`${API_URL}/assets`, (route) =>
      route.fulfill({ json: [{ ...testAssets()[0], profilePicUrl: "https://scontent.cdninstagram.com/broken.jpg" }] })
    );
    // Simulate Instagram's CDN refusing the hotlink.
    await page.route("https://scontent.cdninstagram.com/broken.jpg", (route) => route.fulfill({ status: 503, body: "" }));

    await page.goto("/inventory");
    const card = page.getByTestId("asset-card").filter({ hasText: "@multi.format.page" });
    await expect(card.locator("img")).toHaveCount(0);
    await expect(card.getByText("@multi.format.page")).toBeVisible();
  });

  test("no profile pic at all shows the plain gray tile straightaway", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.route(`${API_URL}/assets`, (route) => route.fulfill({ json: [{ ...testAssets()[0], profilePicUrl: null }] }));

    await page.goto("/inventory");
    const card = page.getByTestId("asset-card").filter({ hasText: "@multi.format.page" });
    await expect(card.locator("img")).toHaveCount(0);
  });

});
