import { expect, test, type Page } from "@playwright/test";

import { API_URL, mockApi, shot, signIn, type MockRole } from "./fixtures";

/** Campaigns → New campaign: brand + title → budget + deadline → pages from a sheet → review → POST /campaigns. API fully mocked. */

const now = new Date().toISOString();
const SHEET_LINK = "https://docs.google.com/spreadsheets/d/abc123/edit";
const SHEET_CSV = [
  "Handle,Phone,Post URL,Format,Cost",
  '@riya.eats,+919000000001,https://www.instagram.com/reel/AAA/,Reel,"₹80,000"',
  "desi.memes,,https://www.instagram.com/reel/BBB/,Stories,40000",
  "newpage.official,+919000000099,,,",
  // A profile link counts as the handle; a post with a format the app doesn't take isn't sent.
  "https://www.instagram.com/foodie.hub/,,https://www.instagram.com/p/CCC/,Video,5000",
].join("\n");
const CREATED = { id: "new1", brandName: "Zomato", title: "Zomato Diwali", deadline: null, createdAt: now, costCap: "100000", spent: 0, postCount: 0, pendingAssignmentCount: 1, phaseCount: 1, parentCampaignId: null, phases: [{ id: "new1", phaseNumber: 1, title: "Zomato Diwali", createdAt: now }], pageQuota: [] };

async function newCampaignApi(page: Page, role: MockRole) {
  await signIn(page, role);
  const calls = { created: [] as unknown[], sheetUrls: [] as string[] };
  await mockApi(page);
  await page.route(`${API_URL}/campaigns**`, (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(/^\/api\/campaigns/, "");
    if (req.method() === "POST" && path === "/import-sheet-url") {
      calls.sheetUrls.push(req.postDataJSON().url);
      return route.fulfill({ json: { csv: SHEET_CSV } });
    }
    if (req.method() === "POST" && path === "") {
      calls.created.push(req.postDataJSON());
      return route.fulfill({ status: 201, json: { campaign: CREATED, matchedCount: 3, pendingCount: 1, autoAttachedCount: 2 } });
    }
    if (path === "") return route.fulfill({ json: calls.created.length ? [CREATED] : [] });
    if (path === "/new1") return route.fulfill({ json: CREATED });
    if (path === "/new1/assignments") return route.fulfill({ json: [] });
    return route.fulfill({ status: 404, json: {} });
  });
  return calls;
}

const upload = (page: Page, text: string, name = "pages.csv") => page.locator('input[type="file"]').setInputFiles({ name, mimeType: "text/csv", buffer: Buffer.from(text) });

test.describe("New campaign", () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test("admin: four steps, sheet preview, over-cap warning, then creates and opens the campaign", async ({ page }) => {
    test.slow(); // `next dev` compiles the campaign page on first visit.
    const calls = await newCampaignApi(page, "ADMIN");
    await page.goto("/campaigns");
    await expect(page.getByText("Approving a plan creates its campaign, or start one yourself with New campaign.")).toBeVisible();
    await page.getByRole("button", { name: "New campaign" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Step 1 of 4 · What is this deal?")).toBeVisible();

    // Step 1: both names are needed.
    const next = dialog.getByRole("button", { name: "Continue", exact: true });
    await expect(next).toBeDisabled();
    await dialog.getByLabel("Brand name").fill("Zomato");
    await dialog.getByLabel("Campaign title").fill("Zomato Diwali");
    await next.click();

    // Step 2: cap is whole rupees only.
    await expect(dialog.getByText("Step 2 of 4 · How much, and by when?")).toBeVisible();
    await dialog.getByLabel("Budget cap (optional)").fill("₹1,00,000");
    await expect(dialog.getByLabel("Budget cap (optional)")).toHaveValue("100000");
    await dialog.getByLabel("Deadline (optional)").fill("2026-12-31");
    await next.click();

    // Step 3: read the pages from a Google Sheet link.
    await expect(dialog.getByText("Step 3 of 4 · Which pages will post?")).toBeVisible();
    await dialog.getByLabel("Google Sheet link").fill("not a link");
    await expect(dialog.getByText("Paste the full link, starting with https://")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Continue to review" })).toBeDisabled();
    await dialog.getByLabel("Google Sheet link").fill(SHEET_LINK);
    await dialog.getByRole("button", { name: "Read rows" }).click();
    await expect(dialog.getByText("4 rows read. 2 of them name a post: it's added to the page's posts straight away.")).toBeVisible();
    const preview = dialog.getByTestId("sheet-preview");
    await expect(preview.getByRole("row")).toHaveCount(5);
    await expect(preview.getByRole("row").nth(1)).toContainText("riya.eats");
    await expect(preview.getByRole("row").nth(1)).toContainText("Reel");
    await expect(preview.getByRole("row").nth(1)).toContainText("₹80,000");
    await expect(preview.getByRole("row").nth(2)).toContainText("Story");
    await expect(preview.getByRole("row").nth(4)).toContainText("foodie.hub");
    expect(calls.sheetUrls).toEqual([SHEET_LINK]);
    await shot(page, "new-campaign-pages");
    // Editing the link drops the rows read from the old one; Enter then reads the new link instead of moving on.
    await dialog.getByLabel("Google Sheet link").fill(`${SHEET_LINK}#gid=1`);
    await expect(preview).toHaveCount(0);
    await dialog.getByLabel("Google Sheet link").fill(SHEET_LINK);
    await dialog.getByLabel("Google Sheet link").press("Enter");
    await expect(preview.getByRole("row")).toHaveCount(5);
    await expect(dialog.getByText("Step 3 of 4 · Which pages will post?")).toBeVisible();
    expect(calls.sheetUrls).toEqual([SHEET_LINK, SHEET_LINK]);
    await dialog.getByRole("button", { name: "Continue to review" }).click();

    // Step 4: review, with the sheet's costs over the cap.
    await expect(dialog.getByText("Step 4 of 4 · Check everything before creating.")).toBeVisible();
    const review = dialog.getByTestId("new-campaign-review");
    await expect(review).toContainText("Zomato Diwali");
    await expect(review).toContainText("₹1,00,000");
    await expect(review).toContainText("31 Dec 2026");
    await expect(review).toContainText("4 pages from the sheet · ₹1,20,000");
    await expect(dialog.getByRole("status")).toHaveText("The sheet's costs (₹1,20,000) are above the budget cap (₹1,00,000). You can still create it, or go back and change the cap.");
    await shot(page, "new-campaign-review");
    await dialog.getByRole("button", { name: "Create campaign" }).click();

    await expect(page.getByText("Campaign created. 1 page from the sheet isn't in Inventory yet: add or match it on the campaign.")).toBeVisible();
    await expect(page).toHaveURL(/\/campaigns\/new1$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Zomato Diwali");
    expect(calls.created).toEqual([
      {
        brandName: "Zomato",
        title: "Zomato Diwali",
        deadline: "2026-12-31",
        costCap: 100000,
        sheetLink: SHEET_LINK,
        assignments: [
          { handle: "riya.eats", phone: "+919000000001", postUrl: "https://www.instagram.com/reel/AAA/", format: "reel", cost: 80000 },
          { handle: "desi.memes", postUrl: "https://www.instagram.com/reel/BBB/", format: "story", cost: 40000 },
          { handle: "newpage.official", phone: "+919000000099" },
          { handle: "foodie.hub" },
        ],
      },
    ]);
  });

  test("admin: ?new=1 opens it; a CSV under the cap shows no warning; only brand and title are required", async ({ page }) => {
    const calls = await newCampaignApi(page, "ADMIN");
    await page.goto("/campaigns?new=1");
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "New campaign" })).toBeVisible();
    await dialog.getByLabel("Brand name").fill("Zomato");
    await dialog.getByLabel("Campaign title").fill("Zomato Diwali");
    await dialog.getByRole("button", { name: "Continue", exact: true }).click();
    await dialog.getByLabel("Budget cap (optional)").fill("500000");
    await dialog.getByRole("button", { name: "Continue", exact: true }).click();

    await dialog.getByRole("radio", { name: "CSV file" }).click();
    await upload(page, "Page,Phone\nriya.eats,+919000000001\n");
    await expect(dialog.getByText("1 row read from pages.csv.")).toBeVisible();
    await upload(page, "Phone\n\n");
    await expect(dialog.getByRole("alert")).toContainText("No rows found");
    // A Reel + Story combo is two posts: the sheet needs one row per post, as the server says.
    await upload(page, ["Handle,Post URL,Format,Cost", "riya.eats,https://www.instagram.com/reel/AAA/,Reel + Story,30000"].join("\n"));
    await expect(dialog.getByRole("alert")).toHaveText("riya.eats: Reel + Story is two posts: use one row per post (Reel and Story).");
    await expect(dialog.getByTestId("sheet-preview")).toHaveCount(0);
    await upload(page, SHEET_CSV);
    await dialog.getByRole("button", { name: "Continue to review" }).click();
    await expect(dialog.getByTestId("new-campaign-review")).toContainText("4 pages from the sheet · ₹1,20,000");
    await expect(dialog.getByRole("status")).toHaveCount(0);

    // Back keeps what was typed.
    await dialog.getByRole("button", { name: "Back" }).click();
    await dialog.getByRole("button", { name: "Back" }).click();
    await expect(dialog.getByLabel("Budget cap (optional)")).toHaveValue("500000");

    // Closing drops ?new=1 so a reload doesn't reopen it; nothing was created.
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(page).toHaveURL(/\/campaigns$/);
    await expect(dialog).toHaveCount(0);
    expect(calls.created).toEqual([]);
  });

  test("admin: no sheet sends just the basics; a server error is shown and nothing navigates", async ({ page }) => {
    await signIn(page, "ADMIN");
    const bodies: unknown[] = [];
    await mockApi(page);
    await page.route(`${API_URL}/campaigns**`, (route) => {
      if (route.request().method() === "POST") {
        bodies.push(route.request().postDataJSON());
        return route.fulfill({ status: 400, json: { error: { code: "VALIDATION", message: "Title is too long" } } });
      }
      return route.fulfill({ json: [] });
    });
    await page.goto("/campaigns");
    await page.getByRole("button", { name: "New campaign" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Brand name").fill("  Zomato ");
    await dialog.getByLabel("Campaign title").fill("Zomato Diwali");
    for (let i = 0; i < 3; i++) await dialog.getByRole("button", { name: /^Continue/ }).click();
    await expect(dialog.getByTestId("new-campaign-review")).toContainText("No cap");
    await expect(dialog.getByTestId("new-campaign-review")).toContainText("Add later");
    await dialog.getByRole("button", { name: "Create campaign" }).click();
    await expect(dialog.getByRole("alert")).toHaveText("Title is too long");
    await expect(page).toHaveURL(/\/campaigns$/);
    expect(bodies).toEqual([{ brandName: "Zomato", title: "Zomato Diwali" }]);
  });

  for (const role of ["CREATOR", "FINANCE", "PLAN_MAKER"] as const) {
    test(`${role}: no New campaign button, and ?new=1 doesn't open it`, async ({ page }) => {
      await newCampaignApi(page, role);
      await page.goto("/campaigns?new=1");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByRole("button", { name: "New campaign" })).toHaveCount(0);
      await expect(page.getByRole("dialog")).toHaveCount(0);
    });
  }
});
