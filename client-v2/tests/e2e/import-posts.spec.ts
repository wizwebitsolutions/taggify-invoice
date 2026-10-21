import { expect, test, type Page } from "@playwright/test";

import { API_URL, mockApi, shot, signIn, type MockRole } from "./fixtures";

/** Content → Import posts: CSV / Google Sheet → preview every row → import → what was skipped. API fully mocked. */

const now = new Date().toISOString();
const OWNER = { id: "o1", name: "Riya Mehta", email: "riya@example.com", phoneNumber: null };
const PAGES = ["riya.eats", "desi.memes"].map((handle, i) => ({ id: `a${i}`, ownerId: OWNER.id, owner: OWNER, platform: "instagram", handle, followers: 1000, approvalStatus: "approved", createdAt: now, rateCards: [], engagement: {}, campaigns: [] }));
const CSV = [
  "Campaign,Page,Post URL,Format,Cost",
  "Diwali Food Stories,@riya.eats,https://www.instagram.com/reel/AAA/,Reel,\"₹18,000\"", // 2 ready
  "Diwali Food Stories — Phase 2,desi.memes,https://www.instagram.com/reel/BBB/,stories,", // 3 check: phase name (rate card)
  "Holi Colours,riya.eats,https://www.instagram.com/reel/CCC/,Reel,9000", // 4 check: campaign not in list
  "Diwali Food Stories,ghost.page,https://www.instagram.com/reel/DDD/,Reel,", // 5 blocked: page
  "Diwali Food Stories,riya.eats,https://www.instagram.com/p/EEE/,Reel + Story,", // 6 blocked: a combo is one row per post
  "Diwali Food Stories,@riya.eats,https://www.instagram.com/reel/AAA/,Reel,", // 7 blocked: duplicate of row 2
  "Diwali Food Stories,riya.eats,https://www.instagram.com/reel/FFF/,Reel,12.5", // 8 blocked: cost
].join("\n");

async function importApi(page: Page, role: MockRole, permissions?: Record<string, boolean>) {
  const user = await signIn(page, role);
  if (permissions) await signIn(page, role, { permissions: { ...user.permissions, ...permissions } });
  const calls = { imported: [] as unknown[], sheetUrls: [] as string[] };
  await mockApi(page);
  await page.route(`${API_URL}/campaigns**`, (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(/^\/api\/campaigns/, "");
    if (req.method() === "POST" && path === "/import-sheet-url") {
      calls.sheetUrls.push(req.postDataJSON().url);
      return route.fulfill({ json: { csv: "Campaign,Page,Post URL,Format\nDiwali Food Stories,riya.eats,https://www.instagram.com/reel/ZZZ/,Reel\n" } });
    }
    if (path === "") return route.fulfill({ json: [{ id: "c1", title: "Diwali Food Stories", brandName: "Saffron Street", createdAt: now }] });
    return route.fulfill({ json: {} });
  });
  await page.route(`${API_URL}/assets**`, (route) => route.fulfill({ json: PAGES }));
  await page.route(`${API_URL}/links**`, (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === "POST" && url.pathname.endsWith("/bulk-import")) {
      const { rows } = req.postDataJSON();
      calls.imported.push(rows);
      const skipped = rows.filter((r: { campaignTitle: string }) => r.campaignTitle === "Holi Colours").map((row: unknown) => ({ row, reason: 'No campaign titled "Holi Colours"' }));
      return route.fulfill({ json: { created: rows.filter((r: { campaignTitle: string }) => r.campaignTitle !== "Holi Colours").map((r: { url: string }, i: number) => ({ id: `n${i}`, url: r.url })), skipped, totalSubmitted: rows.length } });
    }
    const size = Number(url.searchParams.get("pageSize")) || 10;
    return route.fulfill({ json: { items: [], total: 0, page: 1, pageSize: size } });
  });
  await page.goto("/content");
  await expect(page.getByRole("heading", { name: "Content" })).toBeVisible();
  return calls;
}

const upload = (page: Page, text: string, name = "past-posts.csv") => page.locator('input[type="file"]').setInputFiles({ name, mimeType: "text/csv", buffer: Buffer.from(text) });

test.describe("Import posts", () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test("admin: preview shows every row with its status; only importable rows are sent; skipped rows are listed", async ({ page }) => {
    const calls = await importApi(page, "ADMIN");
    await page.getByRole("button", { name: "Import posts" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("link", { name: "Download a sample CSV" })).toHaveAttribute("download", "import-posts-sample.csv");
    await shot(page, "import-source");
    await upload(page, CSV);

    await expect(dialog.getByRole("heading", { name: "Check the rows" })).toBeVisible();
    await expect(dialog.getByText("past-posts.csv: 7 rows. 3 rows can be imported; 4 rows can't and will be left out.")).toBeVisible();
    const row = (n: number) => dialog.getByRole("row").filter({ has: page.getByRole("cell", { name: String(n), exact: true }) });
    await expect(row(2)).toContainText("Ready");
    await expect(row(2)).toContainText("₹18,000");
    await expect(row(3)).toContainText("Rate card");
    await expect(row(3)).toContainText("Phase name is checked on import");
    await expect(row(4)).toContainText("Campaign name not found");
    await expect(row(5)).toContainText("No page called ghost.page in Inventory");
    await expect(row(6)).toContainText("Reel + Story is two posts: use one row per post (Reel and Story)");
    await expect(row(7)).toContainText("Same page and link as an earlier row");
    await expect(row(8)).toContainText(`Cost "12.5" isn't a whole rupee amount`);
    await shot(page, "import-preview");

    await dialog.getByRole("button", { name: "Import 3 posts" }).click();
    await expect(dialog.getByRole("heading", { name: "2 posts imported" })).toBeVisible();
    expect(calls.imported).toEqual([
      [
        { campaignTitle: "Diwali Food Stories", pageHandle: "riya.eats", url: "https://www.instagram.com/reel/AAA/", format: "reel", cost: 18000 },
        { campaignTitle: "Diwali Food Stories — Phase 2", pageHandle: "desi.memes", url: "https://www.instagram.com/reel/BBB/", format: "story" },
        { campaignTitle: "Holi Colours", pageHandle: "riya.eats", url: "https://www.instagram.com/reel/CCC/", format: "reel", cost: 9000 },
      ],
    ]);
    // Rows left out in the preview and rows the server skipped, in sheet order.
    const skipped = dialog.getByRole("listitem");
    await expect(skipped).toHaveCount(5);
    await expect(skipped.first()).toContainText("Row 4");
    await expect(skipped.first()).toContainText('No campaign titled "Holi Colours"');
    await shot(page, "import-result");
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(dialog).toBeHidden();
  });

  test("admin: reads rows from a Google Sheet link", async ({ page }) => {
    const calls = await importApi(page, "ADMIN");
    await page.getByRole("button", { name: "Import posts" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("radio", { name: "Google Sheet link" }).click();
    await dialog.getByLabel("Google Sheet link").fill("https://docs.google.com/spreadsheets/d/abc/edit");
    await dialog.getByRole("button", { name: "Read rows" }).click();
    await expect(dialog.getByText("Google Sheet: 1 row. All of them can be imported.")).toBeVisible();
    expect(calls.sheetUrls).toEqual(["https://docs.google.com/spreadsheets/d/abc/edit"]);
  });

  test("admin: a file with no rows says what's expected", async ({ page }) => {
    await importApi(page, "ADMIN");
    await page.getByRole("button", { name: "Import posts" }).click();
    await upload(page, "Campaign,Page,Post URL,Format\n");
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText("No rows found");
  });

  test("blank rows keep sheet row numbers; a profile link in Page and a ₹18,000.00 cost are understood", async ({ page }) => {
    const calls = await importApi(page, "ADMIN");
    await page.getByRole("button", { name: "Import posts" }).click();
    // A BOM, Windows line endings and a blank sheet row (exported as ",,,,") — row 4 must still be "Row 4".
    await upload(page, ["﻿Campaign,Page,Post URL,Format,Cost", 'Diwali Food Stories,https://www.instagram.com/riya.eats/?igsh=MWx0c2J5ZTh2dGVzdGluZw==,https://www.instagram.com/reel/AAA/,Reel,"₹18,000.00"', ",,,,", "Diwali Food Stories,riya.eats,https://www.instagram.com/reel/BBB/,Video,"].join("\r\n"));
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("past-posts.csv: 2 rows.", { exact: false })).toBeVisible();
    const row = (n: number) => dialog.getByRole("row").filter({ has: page.getByRole("cell", { name: String(n), exact: true }) });
    await expect(row(2)).toContainText("riya.eats");
    await expect(row(2)).toContainText("₹18,000");
    await expect(row(4)).toContainText(`Format "video" isn't Reel, Entertainment / Brand, PR, Political reel, Static / Carousel, Repost, Story or Political story`);
    await dialog.getByRole("button", { name: "Import 1 post" }).click();
    await expect(dialog.getByRole("heading", { name: "1 post imported" })).toBeVisible();
    expect(calls.imported).toEqual([[{ campaignTitle: "Diwali Food Stories", pageHandle: "riya.eats", url: "https://www.instagram.com/reel/AAA/", format: "reel", cost: 18000 }]]);
    await expect(dialog.getByText("Row 4")).toBeVisible();
  });

  test("non-admin with links.edit: sheet costs aren't sent, and the preview says so", async ({ page }) => {
    const calls = await importApi(page, "FINANCE", { "links.edit": true });
    await page.getByRole("button", { name: "Import posts" }).click();
    const dialog = page.getByRole("dialog");
    // Finance has no campaigns.edit, so only the file option (the sheet link goes through a campaigns route).
    await expect(dialog.getByRole("radio", { name: "Google Sheet link" })).toHaveCount(0);
    await expect(dialog.getByText("Each post is billed at its page's rate card.")).toBeVisible();
    await upload(page, CSV);
    await expect(dialog.getByText(/Costs in the sheet aren't used/)).toBeVisible();
    await dialog.getByRole("button", { name: "Import 3 posts" }).click();
    await expect(dialog.getByRole("heading", { name: "2 posts imported" })).toBeVisible();
    expect((calls.imported[0] as Record<string, unknown>[]).every((r) => !("cost" in r))).toBe(true);
  });

  for (const role of ["FINANCE", "PLAN_MAKER"] as const) {
    test(`${role} (no links.edit) has no Import posts`, async ({ page }) => {
      await importApi(page, role);
      await expect(page.getByRole("button", { name: "Import posts" })).toHaveCount(0);
    });
  }
});

test.describe("Import posts · phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the preview scrolls inside the dialog, not the page", async ({ page }) => {
    await importApi(page, "ADMIN");
    await page.getByRole("button", { name: "Import posts" }).click();
    await upload(page, CSV);
    await expect(page.getByRole("dialog").getByRole("heading", { name: "Check the rows" })).toBeVisible();
    await shot(page, "import-preview-390");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
