import { test, expect } from "@playwright/test";

import { signIn, mockApi, API_URL, type MockRole } from "./fixtures";
import type { Asset, Link } from "@/lib/api-client";

/**
 * Regression coverage for two Admin-dashboard additions
 * (components/dashboard/admin-dashboard.tsx):
 *  - the "Total raised" KPI tile now draws a 6-month trend sparkline
 *    (components/charts/spark-line.tsx) instead of just a static total.
 *  - "Top pages" gained an opt-in Compare mode
 *    (components/dashboard/compare-pages-panel.tsx) that puts two chosen
 *    pages side by side across followers/links/invoiced, alongside its
 *    original ranked-by-followers default.
 */

const ROLE: MockRole = "ADMIN";

function asset(overrides: Partial<Asset>): Asset {
  return {
    id: overrides.id ?? "asset-1",
    ownerId: "creator-1",
    platform: "instagram",
    handle: "glow.studio",
    followers: 50000,
    category: "Lifestyle",
    approvalStatus: "approved",
    createdAt: new Date().toISOString(),
    rateCards: [],
    engagement: { avgLikes: null, avgComments: null, avgViews: null, sampleSize: 0 },
    campaigns: [],
    ...overrides,
  };
}

function link(overrides: Partial<Link>): Link {
  return {
    id: overrides.id ?? "link-1",
    campaignId: "campaign-1",
    assetId: overrides.assetId ?? "asset-1",
    submittedById: "creator-1",
    url: "https://instagram.com/p/abc",
    format: "reel",
    cost: "5000",
    customRate: false,
    status: "INVOICED",
    postedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

test.use({ viewport: { width: 1280, height: 1000 } });

test.describe("Admin dashboard — KPI sparkline + Top pages compare mode", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, ROLE);
    await mockApi(page);

    await page.route(`${API_URL}/invoices?*`, (route) => {
      if (route.request().method() !== "GET") return route.fulfill({ status: 204, body: "" });
      return route.fulfill({
        json: {
          items: [
            {
              id: "inv-1",
              creatorId: "creator-1",
              invoiceNumber: "INV-1",
              amount: "12000",
              subtotal: "12000",
              isGstInvoice: false,
              gstAmount: "0",
              status: "PAID",
              paymentStatus: "COMPLETED",
              gstStatus: "COMPLETED",
              remarks: null,
              dueDate: null,
              paidAt: new Date().toISOString(),
              createdAt: new Date().toISOString(),
              overdueDays: 0,
            },
          ],
          total: 1,
          page: 1,
          pageSize: 100,
        },
      });
    });

    await page.route(`${API_URL}/assets`, (route) => {
      if (route.request().method() !== "GET") return route.fulfill({ status: 204, body: "" });
      return route.fulfill({
        json: [asset({ id: "asset-1", handle: "glow.studio", followers: 50000 }), asset({ id: "asset-2", handle: "nightowl.creates", followers: 30000 })],
      });
    });

    await page.route(`${API_URL}/links?*`, (route) => {
      if (route.request().method() !== "GET") return route.fulfill({ status: 204, body: "" });
      return route.fulfill({
        json: {
          items: [link({ id: "link-1", assetId: "asset-1" }), link({ id: "link-2", assetId: "asset-2" })],
          total: 2,
          page: 1,
          pageSize: 100,
        },
      });
    });
  });

  test("'Total raised' renders a trend sparkline", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByTestId("kpi-sparkline").first()).toBeVisible();
  });

  test("'Top pages' switches into Compare mode with two page pickers and per-metric bars", async ({ page }) => {
    await page.goto("/dashboard");

    const panel = page.locator("section", { has: page.getByRole("heading", { name: "Top pages" }) });
    // Ranked mode is the default — no page pickers yet.
    await expect(panel.getByLabel("Compare page A")).toHaveCount(0);

    await panel.getByRole("button", { name: "Compare" }).click();

    await expect(panel.getByLabel("Compare page A")).toBeVisible();
    await expect(panel.getByLabel("Compare page B")).toBeVisible();
    await expect(panel.getByText("Followers")).toBeVisible();
    await expect(panel.getByText("Links posted")).toBeVisible();
    await expect(panel.getByText("Total invoiced")).toBeVisible();

    // Switching back to Ranked drops the pickers again.
    await panel.getByRole("button", { name: "Ranked" }).click();
    await expect(panel.getByLabel("Compare page A")).toHaveCount(0);
  });
});
