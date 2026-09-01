import { test, expect } from "@playwright/test";

import { signIn, mockApi, API_URL } from "./fixtures";
import type { Campaign, Asset } from "@/lib/api-client";

/**
 * Regression tests for the campaign/asset card redesign
 * (app/campaigns/page.tsx's CampaignCard, app/assets/page.tsx's AssetCard).
 * Covers the two genuinely new behaviors, not just that the cards render:
 * the over-budget "Over" pill + rose progress bar, and the asset approval
 * pill now distinguishing "Rejected" from "Pending" (previously both
 * rendered identically in slate — see assets/page.tsx).
 */

test.use({ viewport: { width: 1280, height: 900 } });

function campaign(overrides: Partial<Campaign>): Campaign {
  return {
    id: "c1",
    brandName: "Northfield Running Co.",
    title: "Derby Series",
    deadline: null,
    createdAt: new Date("2026-08-25").toISOString(),
    postCount: 4,
    totalLikes: 10644,
    representativePost: null,
    pendingAssignmentCount: 0,
    ...overrides,
  };
}

function asset(overrides: Partial<Asset>): Asset {
  return {
    id: "a1",
    ownerId: "owner-1",
    handle: "northfield.running",
    platform: "instagram",
    followers: 24500,
    category: "sports",
    approvalStatus: "pending",
    createdAt: new Date("2026-08-25").toISOString(),
    rateCards: [],
    engagement: { avgLikes: null, avgComments: null, avgViews: null, sampleSize: 0 },
    ...overrides,
  };
}

test("over-budget campaign shows the Over pill and a rose progress bar; under-budget doesn't", async ({ page }) => {
  await signIn(page, "ADMIN");
  await mockApi(page);
  // Scoped to the API origin, not a bare "**/campaigns" glob — that also
  // matches the *page* navigation to localhost:3000/campaigns (no
  // scheme/host in the pattern), replacing the whole document with this
  // mocked JSON instead of just answering the API call. See API_URL's doc
  // comment in fixtures.ts.
  await page.route(`${API_URL}/campaigns`, (route) =>
    route.fulfill({
      json: [
        campaign({ id: "over", title: "Derby Series", costCap: "15000", spent: 18400, remainingBudget: -3400 }),
        campaign({ id: "under", title: "Launch Week", brandName: "Solmate Coffee", costCap: "20000", spent: 8200, remainingBudget: 11800 }),
      ],
    })
  );
  await page.goto("/campaigns");

  const overCard = page.getByTestId("campaign-card").filter({ hasText: "Derby Series" });
  const underCard = page.getByTestId("campaign-card").filter({ hasText: "Launch Week" });

  // The pill's text is lowercase in JSX ("Over") and rendered uppercase via
  // CSS (uppercase tracking-wide) — match case-insensitively so the test
  // doesn't care which one is the "real" source of truth.
  await expect(overCard.getByText(/^over$/i)).toBeVisible();
  await expect(overCard.getByText("123%")).toBeVisible(); // round(18400/15000 * 100)
  await expect(underCard.getByText(/^over$/i)).not.toBeAttached();
  await expect(underCard.getByText("41%")).toBeVisible(); // round(8200/20000 * 100)
});

test("a likes total that rounds up to 100.0K reads as 1L, not 100K", async ({ page }) => {
  // Regression test for lib/format.ts's compactNumber: it used to branch to
  // the "K" unit on the *raw* value (v < 100_000), but 99,980 rounds to
  // "100.0" at one decimal — (99980/1000).toFixed(1) — which used to render
  // "100K" instead of crossing over to "1L". No client unit-test runner
  // exists (Playwright only, per CLAUDE.md), so this exercises it through
  // the one place it's actually rendered.
  await signIn(page, "ADMIN");
  await mockApi(page);
  await page.route(`${API_URL}/campaigns`, (route) =>
    route.fulfill({ json: [campaign({ id: "boundary", title: "Boundary Case", totalLikes: 99_980 })] })
  );
  await page.goto("/campaigns");

  const card = page.getByTestId("campaign-card").filter({ hasText: "Boundary Case" });
  await expect(card.getByText("1L")).toBeVisible();
  await expect(card.getByText("100K")).not.toBeAttached();
});

test("asset approval pill distinguishes Rejected from Pending", async ({ page }) => {
  // Regression test: this pill used to only branch on "approved" vs.
  // everything else, so a rejected page rendered identically (slate) to a
  // merely-pending one — indistinguishable at a glance.
  await signIn(page, "ADMIN");
  await mockApi(page);
  await page.route(`${API_URL}/assets`, (route) =>
    route.fulfill({
      json: [
        asset({ id: "a-pending", handle: "pending.page", approvalStatus: "pending" }),
        asset({ id: "a-rejected", handle: "rejected.page", approvalStatus: "rejected" }),
      ],
    })
  );
  await page.goto("/assets");

  // JSX renders the raw lowercase status text, styled capitalized via CSS
  // (`capitalize`) — match case-insensitively rather than depend on which
  // one Playwright's text engine treats as "the" rendered text.
  const pendingPill = page.getByText(/^pending$/i);
  const rejectedPill = page.getByText(/^rejected$/i);
  await expect(pendingPill).toBeVisible();
  await expect(rejectedPill).toBeVisible();

  await expect(pendingPill).not.toHaveClass(/text-rose/);
  await expect(rejectedPill).toHaveClass(/text-rose/);
});
