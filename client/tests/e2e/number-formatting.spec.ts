import { test, expect } from "@playwright/test";

import { signIn, mockApi, API_URL } from "./fixtures";

/**
 * Regression test for bugs.md #5: money and count displays should always
 * use Indian digit grouping (1,00,000) regardless of the browser's own
 * locale. lib/format.ts's money()/count() both explicitly pass "en-IN" to
 * toLocaleString() — this test exists because it's easy to reintroduce the
 * bug one call site at a time by reaching for a bare `n.toLocaleString()`
 * again (see admin-dashboard.tsx, creator-dashboard.tsx, and
 * inventory/page.tsx — which absorbed the former assets/page.tsx, newTask.md
 * 8 Sep — all fixed alongside this test), which silently falls back to the
 * runtime's default locale instead.
 */
test.describe("Indian number grouping", () => {
  test("a follower count over one lakh renders as 1,50,000, not 150,000", async ({ page }) => {
    await signIn(page, "CREATOR");
    await mockApi(page);
    await page.route(`${API_URL}/assets`, (route) =>
      route.fulfill({
        json: [
          {
            id: "asset-1",
            ownerId: "test-user-1",
            platform: "instagram",
            handle: "bignpage",
            followers: 150000,
            category: null,
            approvalStatus: "APPROVED",
            createdAt: new Date().toISOString(),
            rateCards: [],
            engagement: { avgLikes: null, avgComments: null, avgViews: null, sampleSize: 0 },
          },
        ],
      })
    );

    // Pages now live on /inventory (newTask.md, 8 Sep — Assets folded in).
    await page.goto("/inventory");
    await expect(page.getByTitle("1,50,000 followers")).toBeVisible();
    await expect(page.getByTitle("150,000 followers")).toHaveCount(0);
  });
});
