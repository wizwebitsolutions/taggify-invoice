import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";

import { signIn, mockApi, API_URL } from "./fixtures";

/**
 * Plan card → "Attach execution sheet" popup (user request, 21 Sep — "give
 * in which format attachment sheet should be attached, also give option of
 * downloading template ... pop up will be opened by clicking attach
 * execution sheet"). Component: components/plans/execution-sheet-modal.tsx.
 * The template data itself (lib/planSheet.js) is covered by vitest.
 */
function plan(overrides: Record<string, unknown> = {}) {
  return {
    id: "plan-1",
    name: "Q1 Meme Push",
    clientName: "Acme",
    clientContact: null,
    budget: null,
    gstPercent: null,
    isGstPlan: false,
    status: "DRAFT",
    approvedBy: null,
    approvedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    createdBy: { id: "test-user-1", name: "Test User" },
    items: [],
    totalCost: 0,
    budgetVariance: null,
    expectedEngagement: { likes: 0, views: 0 },
    overview: { totalFollowers: 0, totalPosts: 0, expectedImpressions: 0, subtotal: 0, gstAmount: 0, total: 0 },
    clientSheetUrl: null,
    internalSheetUrl: null,
    executionSheetUrl: null,
    ...overrides,
  };
}

const TEMPLATE = {
  title: "Sample — Execution Sheet Template",
  headers: ["S No", "Page Name", "Page Link", "Followers", "Date", "Posted Link"],
  linkColumns: [2, 5],
  rows: [[1, "@ghantaa", "https://instagram.com/ghantaa", 8700000, "10 Sept 2026", "https://instagram.com/reel/example1"]],
  totalsRow: ["", "TOTAL", "", 8700000, "", ""],
};

async function mockPlans(page: Page, plans: unknown[]) {
  await page.route(`${API_URL}/plans`, (route) => route.fulfill({ json: plans }));
  await page.route(`${API_URL}/plans/execution-sheet-template/preview`, (route) => route.fulfill({ json: TEMPLATE }));
}

test.describe("Plans — Attach execution sheet popup", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("clicking Attach execution sheet opens a popup stating the supported format with the template columns — no inline link field on the card", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await mockPlans(page, [plan()]);

    await page.goto("/plans?maker=all");
    await expect(page.locator('input[name="executionSheetUrl"]')).toHaveCount(0);
    await page.getByRole("button", { name: "Attach execution sheet" }).click();

    const modal = page.getByTestId("execution-sheet-modal");
    await expect(modal.getByRole("heading", { name: "Attach execution sheet" })).toBeVisible();
    await expect(modal.getByTestId("execution-sheet-format")).toContainText("Google Sheets link");
    await expect(modal.getByTestId("execution-sheet-format")).toContainText("Anyone with the link");
    const table = modal.getByTestId("execution-sheet-template-table");
    for (const header of TEMPLATE.headers) await expect(table.getByRole("columnheader", { name: header, exact: true })).toBeVisible();
    await expect(table).toContainText("@ghantaa");
    await expect(table).toContainText("TOTAL");
  });

  test("Download template saves a .csv with the header row, the sample row and the totals", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await mockPlans(page, [plan()]);

    await page.goto("/plans?maker=all");
    await page.getByRole("button", { name: "Attach execution sheet" }).click();
    const modal = page.getByTestId("execution-sheet-modal");
    await expect(modal.getByTestId("execution-sheet-template-table")).toContainText("@ghantaa");

    const [download] = await Promise.all([page.waitForEvent("download"), modal.getByRole("button", { name: "Download template (.csv)" }).click()]);
    expect(download.suggestedFilename()).toBe("taggify-execution-sheet-template.csv");
    const lines = readFileSync(await download.path(), "utf8").replace(/^﻿/, "").split("\r\n");
    expect(lines[0]).toBe("S No,Page Name,Page Link,Followers,Date,Posted Link");
    expect(lines[1]).toBe("1,@ghantaa,https://instagram.com/ghantaa,8700000,10 Sept 2026,https://instagram.com/reel/example1");
    expect(lines[2]).toBe(",TOTAL,,8700000,,");
  });

  test("Open as Google Sheet opens the live template in a new tab", async ({ page, context }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await mockPlans(page, [plan()]);
    const SHEET_URL = "https://docs.google.com/spreadsheets/d/template-1/edit";
    await page.route(`${API_URL}/plans/execution-sheet-template`, (route) => route.fulfill({ json: { spreadsheetUrl: SHEET_URL } }));
    await context.route("https://docs.google.com/**", (route) => route.fulfill({ contentType: "text/html", body: "<title>template</title>" }));

    await page.goto("/plans?maker=all");
    await page.getByRole("button", { name: "Attach execution sheet" }).click();
    const [tab] = await Promise.all([context.waitForEvent("page"), page.getByTestId("execution-sheet-modal").getByRole("button", { name: /Open as Google Sheet/ }).click()]);
    await tab.waitForURL(SHEET_URL);
  });

  test("when Google isn't connected, Open as Google Sheet's error points at the .csv", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await mockPlans(page, [plan()]);
    await page.route(`${API_URL}/plans/execution-sheet-template`, (route) =>
      route.fulfill({ status: 409, json: { error: { code: "GOOGLE_NOT_CONNECTED", message: "Google isn't connected" } } })
    );

    await page.goto("/plans?maker=all");
    await page.getByRole("button", { name: "Attach execution sheet" }).click();
    const modal = page.getByTestId("execution-sheet-modal");
    await modal.getByRole("button", { name: /Open as Google Sheet/ }).click();
    await expect(modal.getByTestId("google-reconnect-notice")).toContainText("Google isn't connected");
    await expect(modal).toContainText("The .csv template above works without Google.");
  });

  test("only a Google Sheets link is accepted; a valid one is saved onto the plan and the popup closes", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await mockPlans(page, [plan()]);
    let patched: Record<string, unknown> | null = null;
    await page.route(`${API_URL}/plans/plan-1`, (route) => {
      patched = route.request().postDataJSON();
      return route.fulfill({ json: plan(route.request().postDataJSON()) });
    });

    await page.goto("/plans?maker=all");
    await page.getByRole("button", { name: "Attach execution sheet" }).click();
    const modal = page.getByTestId("execution-sheet-modal");
    await modal.getByRole("button", { name: "Attach sheet" }).click();
    await expect(modal).toContainText("Paste the sheet's link.");
    await modal.locator('input[name="executionSheetUrl"]').fill("https://example.com/my-sheet.xlsx");
    await expect(modal).toContainText("Only Google Sheets links are supported");
    // The Google host has to be the link's actual host, not just appear somewhere in it.
    await modal.locator('input[name="executionSheetUrl"]').fill("https://evil.example/?x=docs.google.com/spreadsheets/d/abc");
    await modal.getByRole("button", { name: "Attach sheet" }).click();
    await expect(modal).toContainText("Only Google Sheets links are supported");
    expect(patched).toBeNull();

    await modal.locator('input[name="executionSheetUrl"]').fill(" https://docs.google.com/spreadsheets/d/abc123/edit ");
    await modal.getByRole("button", { name: "Attach sheet" }).click();
    await expect(modal).toHaveCount(0);
    expect(patched).toEqual({ executionSheetUrl: "https://docs.google.com/spreadsheets/d/abc123/edit" });
  });

  test("an attached sheet's Change opens the popup prefilled, and Remove sheet clears it", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await mockPlans(page, [plan({ executionSheetUrl: "https://docs.google.com/spreadsheets/d/abc123/edit" })]);
    let patched: Record<string, unknown> | null = null;
    await page.route(`${API_URL}/plans/plan-1`, (route) => {
      patched = route.request().postDataJSON();
      return route.fulfill({ json: plan() });
    });

    await page.goto("/plans?maker=all");
    await expect(page.getByRole("link", { name: /Execution sheet attached/ })).toHaveAttribute("href", "https://docs.google.com/spreadsheets/d/abc123/edit");
    await page.getByRole("button", { name: "Change" }).click();
    const modal = page.getByTestId("execution-sheet-modal");
    await expect(modal.getByRole("heading", { name: "Change execution sheet" })).toBeVisible();
    await expect(modal.locator('input[name="executionSheetUrl"]')).toHaveValue("https://docs.google.com/spreadsheets/d/abc123/edit");
    await modal.getByRole("button", { name: "Remove sheet" }).click();
    await expect(modal).toHaveCount(0);
    expect(patched).toEqual({ executionSheetUrl: null });
  });
});
