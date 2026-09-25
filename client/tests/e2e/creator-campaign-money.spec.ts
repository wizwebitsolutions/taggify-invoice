import { test, expect } from "@playwright/test";

import { signIn, mockApi, API_URL } from "./fixtures";
import type { Campaign } from "@/lib/api-client";

/**
 * 25 Sep — creators never see the deal's budget (cap / remaining / progress
 * bar); the API sends `yourEarnings` instead and the list shows just that.
 * Admin keeps the full budget view.
 */

test.use({ viewport: { width: 1280, height: 900 } });

const base: Campaign = {
  id: "c1",
  brandName: "Wave",
  title: "WaveXT-series",
  deadline: null,
  createdAt: new Date("2026-09-24").toISOString(),
  postCount: 1,
  totalLikes: 0,
  representativePost: null,
  pendingAssignmentCount: 0,
};

test("creator's campaign list shows earnings only — no budget or remaining", async ({ page }) => {
  await signIn(page, "CREATOR");
  await mockApi(page);
  await page.route(`${API_URL}/campaigns`, (route) => route.fulfill({ json: [{ ...base, yourEarnings: 4200, creatorPhaseNumber: 1 }] }));
  await page.goto("/campaigns");

  const row = page.getByTestId("campaign-card").filter({ hasText: "WaveXT-series" });
  await expect(row.getByTestId("your-earnings")).toContainText("4,200");
  await expect(page.getByRole("columnheader", { name: "Your earnings" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: /Budget used|Remaining/ })).toHaveCount(0);
});

test("admin still sees budget used and remaining", async ({ page }) => {
  await signIn(page, "ADMIN");
  await mockApi(page);
  await page.route(`${API_URL}/campaigns`, (route) => route.fulfill({ json: [{ ...base, costCap: "15000", spent: 5000, remainingBudget: 10000 }] }));
  await page.goto("/campaigns");

  await expect(page.getByRole("columnheader", { name: "Budget used" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Remaining" })).toBeVisible();
});
