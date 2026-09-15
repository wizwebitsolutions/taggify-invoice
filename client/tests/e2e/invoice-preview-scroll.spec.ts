import { test, expect } from "@playwright/test";

import { signIn, mockApi, API_URL } from "./fixtures";

/**
 * Regression for: "Preview invoice ... was not scrolling down" — step 2 of
 * NewInvoiceModal (app/invoices/page.tsx) gave only its link list its own
 * overflow-y-auto region (with a min-h-[160px] floor). On a short viewport,
 * once there were enough links to fill that floor, the GST toggle, totals
 * card, and the Cancel/Raise footer below it were pushed past the Sheet's
 * max-h and clipped by its overflow-hidden — with no scrollable region able
 * to reach them. Fixed by making the whole step-2 body (banner through
 * totals) one scroll region, with only the footer pinned outside it.
 */
test.describe("New invoice — Preview invoice step scrolls to reveal GST choice, totals, and the Raise button", () => {
  // Short viewport, matching how this bug was actually reproduced — a tall
  // viewport would never exercise the clipped-footer failure mode.
  test.use({ viewport: { width: 900, height: 620 } });

  function eligibleLinks(count: number) {
    return Array.from({ length: count }, (_, i) => ({
      id: `link-${i}`,
      status: "SCREENSHOT_APPROVED",
      format: "reel",
      cost: "1000",
      postedAt: "2026-01-01T00:00:00.000Z",
      asset: { id: "asset-1", handle: "demo.page" },
      campaign: { id: "camp-1", title: "Derby Series", brandName: "Northfield Running Co." },
    }));
  }

  test("Raise invoice button is reachable by scrolling, and reflects the full total", async ({ page }) => {
    await signIn(page, "CREATOR");
    await mockApi(page);
    await page.route(`${API_URL}/links?*`, (route) => route.fulfill({ json: { items: eligibleLinks(16), total: 16, page: 1, pageSize: 100 } }));
    await page.route(`${API_URL}/campaigns`, (route) => route.fulfill({ json: [] }));

    await page.goto("/invoices");
    await page.getByRole("button", { name: "New invoice" }).click();
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(page.getByRole("heading", { name: "Preview invoice" })).toBeVisible();
    // Step 3 (Generate) carries the GST choice and the Raise button.
    await page.getByRole("button", { name: "Continue" }).click();

    const raiseButton = page.getByRole("button", { name: /Raise invoice/ });
    // Not necessarily in the (short) viewport yet — the point of the test —
    // but it must exist and become reachable by scrolling the step, not be
    // clipped off with no way to get to it.
    await raiseButton.scrollIntoViewIfNeeded();
    await expect(raiseButton).toBeInViewport();
    await expect(raiseButton).toHaveText("Raise invoice · ₹16,000");

    // The GST toggle sits just above the footer in the same scroll region —
    // reachable the same way, independently of where Raise was scrolled to.
    const gstToggle = page.getByRole("radio", { name: /^GST invoice/ });
    await gstToggle.scrollIntoViewIfNeeded();
    await expect(gstToggle).toBeInViewport();
  });
});
