import { test, expect } from "@playwright/test";

import { signIn, mockApi, API_URL } from "./fixtures";

/**
 * newTask.md, 8 Sep — finance data also written to a live Google Sheet,
 * alongside the existing Excel-to-GitHub export. This only covers the
 * manual "run now" trigger and its result — the actual Sheets API calls
 * are server-side (see server/src/lib/googleSheetsClient.test.js and
 * financeGoogleSheetExport.test.js for that).
 */
test.describe("Job runs — Google Sheet export manual trigger", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("both export buttons are independent — Sheet export can succeed even if run separately from the GitHub one", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    let sheetExportCalled = false;
    await page.route(`${API_URL}/admin/finance-google-sheet-export/run-now`, (route) => {
      sheetExportCalled = true;
      return route.fulfill({ json: { ok: true, spreadsheetUrl: "https://docs.google.com/spreadsheets/d/abc123/edit" } });
    });

    await page.goto("/job-runs");
    await expect(page.getByRole("button", { name: "Run finance export now" })).toBeVisible();
    await page.getByRole("button", { name: "Run Sheet export now" }).click();

    await expect(page.getByText("Google Sheet export pushed.")).toBeVisible();
    await expect(page.getByRole("link", { name: "View sheet" })).toHaveAttribute("href", "https://docs.google.com/spreadsheets/d/abc123/edit");
    expect(sheetExportCalled).toBe(true);
  });

  test("shows the server's error when Google Sheets isn't configured yet", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.route(`${API_URL}/admin/finance-google-sheet-export/run-now`, (route) =>
      route.fulfill({
        status: 500,
        json: { error: { code: "FINANCE_GOOGLE_SHEET_EXPORT_FAILED", message: "Finance Google Sheet export not configured: set GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY, and GOOGLE_FINANCE_SPREADSHEET_ID (see server/.env.example)" } },
      })
    );

    await page.goto("/job-runs");
    await page.getByRole("button", { name: "Run Sheet export now" }).click();

    await expect(page.locator("p.text-rose")).toContainText("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  });

  test("a non-admin sees neither export button", async ({ page }) => {
    await signIn(page, "CREATOR");
    await mockApi(page);

    await page.goto("/job-runs");

    await expect(page.getByRole("button", { name: "Run finance export now" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Run Sheet export now" })).toHaveCount(0);
  });
});
