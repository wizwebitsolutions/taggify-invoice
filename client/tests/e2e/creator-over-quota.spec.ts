import { test, expect } from "@playwright/test";

import { signIn, mockApi, API_URL } from "./fixtures";

/**
 * User decision, 29 Sep — "if limit is of 2 post for that page, creator can
 * submit 3 but everywhere it'll show 2 of 2, in maths money calculation as
 * well cause it's creator fault not admin/finance". A post beyond what the
 * campaign booked for its page (Link.overQuota, set server-side by
 * lib/postQuota.js) still shows up, but is marked, never counted as ready to
 * bill, and can't be picked for an invoice.
 */
const asset = { id: "asset-a", ownerId: "creator-a", platform: "instagram", handle: "newspaper", followers: 1000, approvalStatus: "approved", createdAt: "2026-09-01T00:00:00.000Z", rateCards: [], engagement: { avgLikes: null, avgComments: null, avgViews: null, sampleSize: 0 } };

const link = (id: string, title: string, cost: string, overQuota: boolean) => ({
  id,
  campaignId: "camp-1",
  assetId: "asset-a",
  submittedById: "creator-a",
  url: `https://instagram.com/reel/${id}`,
  format: "reel",
  cost,
  customRate: false,
  status: "INSIGHTS_APPROVED",
  postedAt: "2026-09-05T00:00:00.000Z",
  overQuota,
  createdAt: "2026-09-05T00:00:00.000Z",
  asset,
  campaign: { id: "camp-1", title, brandName: "Red Bull", createdAt: "2026-09-01T00:00:00.000Z" },
  postSnapshots: [],
});

test.describe("Creator dashboard — posts beyond the booking (29 Sep)", () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test("an over-booking post is marked, left out of 'ready to bill', and can't be selected for an invoice", async ({ page }) => {
    await signIn(page, "CREATOR");
    await mockApi(page);
    await page.route(`${API_URL}/links?*`, (route) =>
      route.fulfill({ json: { items: [link("within", "Booked post", "5000", false), link("extra", "Extra post", "20000", true)], total: 2, page: 1, pageSize: 100 } })
    );
    await page.route(`${API_URL}/assets`, (route) => route.fulfill({ json: [asset] }));
    await page.goto("/dashboard");

    // Only the booked post counts toward what's ready — not ₹25,000 across 2.
    await expect(page.getByText("1 post ready to bill.")).toBeVisible();
    await expect(page.getByText("₹5,000 of approved work is waiting to be invoiced.")).toBeVisible();

    const extra = page.getByTestId("post-row").filter({ hasText: "Extra post" });
    await expect(extra.getByTestId("over-quota-badge")).toContainText("Over limit · not paid");
    await expect(extra.getByRole("checkbox")).toHaveCount(0);

    const within = page.getByTestId("post-row").filter({ hasText: "Booked post" });
    await expect(within.getByTestId("over-quota-badge")).toHaveCount(0);
    await expect(within.getByRole("checkbox")).toBeVisible();
  });
});
