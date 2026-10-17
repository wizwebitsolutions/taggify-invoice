import { test, expect } from "@playwright/test";

import { signIn, mockApi, API_URL } from "./fixtures";

/**
 * bugs.md #6 — admin can paste a Google Sheet link instead of downloading +
 * re-uploading a CSV export. The server (POST /campaigns/import-sheet-url)
 * fetches the sheet's CSV export and returns the raw text; the client
 * parses it with the exact same code path as a file upload
 * (lib/parseAssignmentSheet.ts now accepts File | string).
 */
test.describe("Google Sheet link import", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("Import work: fetches and parses rows from a pasted sheet link", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    let requestedUrl: string | undefined;
    await page.route(`${API_URL}/campaigns/import-sheet-url`, async (route) => {
      requestedUrl = route.request().postDataJSON().url;
      await route.fulfill({
        json: { csv: "campaign,handle,url,format,cost\nLaunch Week,bignpage,https://instagram.com/p/abc,reel,1500\n" },
      });
    });

    await page.goto("/campaigns");
    await page.getByRole("button", { name: "Import work" }).click();
    await page.getByPlaceholder("Or paste a Google Sheet link…").fill("https://docs.google.com/spreadsheets/d/abc123/edit");
    await page.getByRole("button", { name: "Fetch rows" }).click();

    await expect(page.getByText("1 row parsed.")).toBeVisible();
    expect(requestedUrl).toBe("https://docs.google.com/spreadsheets/d/abc123/edit");
  });

  test("Import work: shows the server's error when the sheet isn't link-shared", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.route(`${API_URL}/campaigns/import-sheet-url`, (route) =>
      route.fulfill({
        status: 400,
        json: { error: { code: "SHEET_NOT_SHARED", message: 'Couldn’t read that sheet — make sure it’s shared as "Anyone with the link can view".' } },
      })
    );

    await page.goto("/campaigns");
    await page.getByRole("button", { name: "Import work" }).click();
    await page.getByPlaceholder("Or paste a Google Sheet link…").fill("https://docs.google.com/spreadsheets/d/private/edit");
    await page.getByRole("button", { name: "Fetch rows" }).click();

    await expect(page.locator("p.text-rose")).toContainText("read that sheet");
  });

  test("New campaign: fetches rows from the reference link field", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.route(`${API_URL}/campaigns/import-sheet-url`, (route) =>
      route.fulfill({ json: { csv: "handle,phone\nbignpage,9876543210\n" } })
    );

    await page.goto("/campaigns");
    await page.getByRole("button", { name: "New campaign", exact: true }).click();
    // The wizard's sheet import lives on step 3 (Pages); steps 1–2 need a
    // brand and title before Continue enables.
    await page.getByPlaceholder("e.g. Zomato", { exact: true }).fill("Northfield");
    await page.getByPlaceholder("e.g. Zomato Diwali").fill("Derby Series");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByPlaceholder("https://docs.google.com/spreadsheets/…").fill("https://docs.google.com/spreadsheets/d/abc123/edit");
    await page.getByRole("button", { name: "Fetch rows" }).click();

    await expect(page.getByText("1 row parsed.")).toBeVisible();
  });
  test("formats are read through the shared aliases; a Reel + Story row is refused with the server's wording (14 Oct)", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    let csv = "campaign,handle,url,format\nLaunch Week,bignpage,https://instagram.com/p/abc,Static\n";
    await page.route(`${API_URL}/campaigns/import-sheet-url`, (route) => route.fulfill({ json: { csv } }));
    let imported: unknown;
    await page.route(`${API_URL}/links/import`, (route) => {
      imported = route.request().postDataJSON();
      return route.fulfill({ status: 201, json: { created: [], skipped: [] } });
    });

    await page.goto("/campaigns");
    await page.getByRole("button", { name: "Import work" }).click();
    await page.getByPlaceholder("Or paste a Google Sheet link…").fill("https://docs.google.com/spreadsheets/d/abc123/edit");
    await page.getByRole("button", { name: "Fetch rows" }).click();
    await expect(page.getByText("1 row parsed.")).toBeVisible();

    csv = "campaign,handle,url,format\nLaunch Week,bignpage,https://instagram.com/p/abc,Reel + Story\n";
    await page.getByRole("button", { name: "Fetch rows" }).click();
    await expect(page.locator("p.text-rose")).toContainText("Row 2: Reel + Story is two posts: use one row per post (Reel and Story)");
    await expect(page.getByText("1 row parsed.")).toHaveCount(0);
    expect(imported).toBeUndefined();
    // The new combo (14 Oct) is refused the same way; new aliases ("Brand reel", "Re-post") read fine.
    csv = "campaign,handle,url,format\nLaunch Week,bignpage,https://instagram.com/p/abc,Repost + Story\n";
    await page.getByRole("button", { name: "Fetch rows" }).click();
    await expect(page.locator("p.text-rose")).toContainText("Row 2: Repost + Story is two posts: use one row per post (Repost and Story)");
    csv = "campaign,handle,url,format\nLaunch Week,bignpage,https://instagram.com/p/abc,Brand reel\nLaunch Week,bignpage,https://instagram.com/p/def,Re-post\n";
    await page.getByRole("button", { name: "Fetch rows" }).click();
    await expect(page.getByText("2 rows parsed.")).toBeVisible();
    expect(imported).toBeUndefined();
  });
});
