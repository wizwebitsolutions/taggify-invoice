import { test, expect, type Page } from "@playwright/test";

import { signIn, mockApi, API_URL } from "./fixtures";

/**
 * Inventory → Import pages, 22 Sep request: the Page Name / Page Link /
 * Followers / Reel Rate / Story Rate template, pages checked on Instagram
 * by their link (not-found and unverifiable pages are never imported),
 * "create new user" to put every page under a brand-new account, and the
 * imported reel rate shown in the list. Server side: importParser.test.js,
 * importAssets.test.js, profilePicStore.test.js.
 */

const owners = [{ id: "creator-1", name: "Priya Creator", phoneNumber: "+919000000001", email: "priya@gmail.com" }];

const templateRow = (rowNumber: number, pageName: string, handle: string, rateCards = [{ format: "reel", amount: 18000 }, { format: "story", amount: 6000 }]) => ({
  rowNumber,
  rawHandle: `https://www.instagram.com/${handle}/`,
  handle,
  pageName,
  category: null,
  followers: 100000,
  rateCards,
  ownerRef: null,
  owner: null,
  ownerId: null,
  status: "owner-missing",
  reason: "Sheet has no owner column.",
});

function preview() {
  return {
    totalRows: 2,
    hasOwnerColumn: false,
    owners,
    summary: { "owner-missing": 2 },
    rows: [templateRow(2, "Laughter Colours", "laughtercolours"), templateRow(3, "Ghantaa", "ghantaa")],
  };
}

const profile = (followers: number) => ({ followers, avgViews: null, avgLikes: null, avgComments: null, fullName: null });
const xlsx = { name: "pages.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from("PK-not-really") };

async function openImport(page: Page) {
  await page.goto("/inventory");
  await page.getByTestId("import-pages-button").click();
}

test.describe("Import pages — template, verification, new user (22 Sep)", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("Download template fetches the server's five-column workbook", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    let templateAuth: string | null = null;
    await page.route(`${API_URL}/assets/import/template.xlsx`, async (route) => {
      templateAuth = await route.request().headerValue("authorization");
      return route.fulfill({ status: 200, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", body: Buffer.from("PK") });
    });
    await openImport(page);
    await expect(page.getByTestId("import-pages-modal")).toContainText("Page Name, Page Link (required");

    const download = page.waitForEvent("download");
    await page.getByTestId("import-download-template").click();
    expect((await download).suggestedFilename()).toBe("import-pages-template.xlsx");
    expect(templateAuth).toBe("Bearer test-access-token");
  });

  test("create new user → every page goes under that account, its password is shown once, and page names are sent", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.route(`${API_URL}/assets/import/preview`, (route) => route.fulfill({ json: preview() }));
    await page.route(`${API_URL}/assets/import/followers`, (route) => route.fulfill({ json: { profiles: { laughtercolours: profile(4300000), ghantaa: profile(8700000) } } }));
    let signupBody: Record<string, unknown> | null = null;
    await page.route(`${API_URL}/auth/signup`, (route) => {
      signupBody = route.request().postDataJSON();
      return route.fulfill({ status: 201, json: { user: { id: "new-creator", name: "Kavya Rao", phoneNumber: null, email: "kavya.rao@gmail.com", role: "CREATOR", whatsappVerified: false }, generatedPassword: "Xy7!pQ2mZr" } });
    });
    let importBody: { rows: Array<Record<string, unknown>> } | null = null;
    await page.route(`${API_URL}/assets/import`, (route) => {
      importBody = route.request().postDataJSON();
      return route.fulfill({ status: 201, json: { created: [{ id: "a1", handle: "laughtercolours", ownerId: "new-creator", owner: { id: "new-creator", name: "Kavya Rao", phoneNumber: "+919812345678" } }, { id: "a2", handle: "ghantaa", ownerId: "new-creator", owner: { id: "new-creator", name: "Kavya Rao", phoneNumber: "+919812345678" } }], skipped: [] } });
    });

    await openImport(page);
    await page.getByLabel("Pages sheet (.xlsx or .csv)").setInputFiles(xlsx);
    const rows = page.getByTestId("import-preview-row");
    await expect(rows).toHaveCount(2);
    // Page Name shown above the handle taken from the link.
    await expect(rows.nth(0)).toContainText("Laughter Colours");
    await expect(rows.nth(0)).toContainText("@laughtercolours");
    // Reel rate has its own column (22 Sep), story as the quieter second line.
    await expect(page.getByTestId("import-preview-table").getByRole("columnheader", { name: "Reel rate" })).toBeVisible();
    await expect(rows.nth(0).getByTestId("import-reel-rate")).toContainText("₹18,000");
    await expect(rows.nth(0).getByTestId("import-reel-rate")).toContainText("Story ₹6,000");
    // The handle links to the real profile, so a wrong link is easy to spot.
    await expect(rows.nth(0).getByRole("link", { name: "@laughtercolours" })).toHaveAttribute("href", "https://www.instagram.com/laughtercolours/");
    await expect(page.getByTestId("import-confirm")).toHaveText("Import 0 pages");

    await page.getByTestId("import-new-user").click();
    const form = page.getByTestId("import-new-user-form");
    await form.getByLabel("New user name").fill("Kavya Rao");
    await form.getByRole("button", { name: "Create user" }).click();
    // Only name + email are asked (24 Sep); email is required.
    await expect(form).toContainText("Enter a valid email — it's their login.");
    await expect(form.getByLabel("New user phone")).toHaveCount(0);
    expect(signupBody).toBeNull();
    await form.getByLabel("New user email").fill("Kavya.Rao@gmail.com");
    await form.getByRole("button", { name: "Create user" }).click();

    await expect.poll(() => signupBody).toEqual({ email: "kavya.rao@gmail.com", name: "Kavya Rao", role: "CREATOR" });
    await expect(page.getByTestId("import-new-user-password")).toContainText("Xy7!pQ2mZr");
    await expect(page.getByLabel("Account for all pages")).toHaveValue("new-creator");
    await expect(page.getByTestId("import-confirm")).toHaveText("Import 2 pages");

    await page.getByTestId("import-confirm").click();
    await expect(page.getByTestId("import-result")).toContainText("2 pages imported");
    // The password is still on screen after importing.
    await expect(page.getByTestId("import-new-user-password")).toContainText("Xy7!pQ2mZr");
    expect(importBody!.rows).toEqual([
      { handle: "laughtercolours", ownerId: "new-creator", category: null, pageName: "Laughter Colours", followers: 4300000, rateCards: [{ format: "reel", amount: 18000 }, { format: "story", amount: 6000 }] },
      { handle: "ghantaa", ownerId: "new-creator", category: null, pageName: "Ghantaa", followers: 8700000, rateCards: [{ format: "reel", amount: 18000 }, { format: "story", amount: 6000 }] },
    ]);
  });

  test("while a Google Sheet link is being fetched, the popup says so — then the preview replaces it", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    let release: () => void = () => {};
    const held = new Promise<void>((r) => (release = r));
    await page.route(`${API_URL}/assets/import/preview-url`, async (route) => {
      await held;
      return route.fulfill({ json: preview() });
    });
    await page.route(`${API_URL}/assets/import/followers`, (route) => route.fulfill({ json: { profiles: { laughtercolours: profile(1), ghantaa: profile(2) } } }));

    await openImport(page);
    await page.getByLabel("Google Sheet link").fill("https://docs.google.com/spreadsheets/d/abc123/edit#gid=0");
    await page.getByTestId("import-fetch-sheet").click();

    await expect(page.getByTestId("import-loading")).toContainText("Fetching your Google Sheet…");
    await expect(page.getByTestId("import-fetch-sheet")).toHaveText("Fetching…");
    await expect(page.getByTestId("import-fetch-sheet")).toBeDisabled();

    release();
    await expect(page.getByTestId("import-preview-row")).toHaveCount(2);
    await expect(page.getByTestId("import-loading")).toHaveCount(0);
    await expect(page.getByTestId("import-fetch-sheet")).toHaveText("Fetch sheet");
  });

  test("an uploaded file shows 'Reading your file…' while it's parsed; a row with no reel rate shows a dash", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    let release: () => void = () => {};
    const held = new Promise<void>((r) => (release = r));
    const noRate = { ...preview(), rows: [templateRow(2, "No Rate Page", "no.rate.page", [])] };
    await page.route(`${API_URL}/assets/import/preview`, async (route) => {
      await held;
      return route.fulfill({ json: noRate });
    });
    await page.route(`${API_URL}/assets/import/followers`, (route) => route.fulfill({ json: { profiles: { "no.rate.page": profile(10) } } }));

    await openImport(page);
    await page.getByLabel("Pages sheet (.xlsx or .csv)").setInputFiles(xlsx);
    await expect(page.getByTestId("import-loading")).toContainText("Reading your file…");
    release();
    const cell = page.getByTestId("import-preview-row").first().getByTestId("import-reel-rate");
    await expect(cell).toHaveText("—");
    await expect(cell.getByTitle("No reel rate in the sheet")).toBeVisible();
  });

  test("on a phone the preview is one card per page — followers, reel rate and status stay on screen (no sideways table)", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.route(`${API_URL}/assets/import/preview`, (route) => route.fulfill({ json: preview() }));
    await page.route(`${API_URL}/assets/import/followers`, (route) => route.fulfill({ json: { profiles: { laughtercolours: profile(4300000), ghantaa: null } } }));

    await openImport(page);
    await page.getByLabel("Pages sheet (.xlsx or .csv)").setInputFiles(xlsx);
    const cards = page.getByTestId("import-preview-cards").getByTestId("import-preview-row");
    await expect(cards).toHaveCount(2);
    await expect(page.getByTestId("import-preview-table")).toHaveCount(0);

    await expect(cards.nth(0)).toContainText("Laughter Colours");
    // Reachable by scrolling the popup down — never clipped off to the side.
    await cards.nth(0).getByTestId("import-reel-rate").scrollIntoViewIfNeeded();
    await expect(cards.nth(0).getByTestId("import-reel-rate")).toBeInViewport({ ratio: 1 });
    await expect(cards.nth(0).getByTestId("import-reel-rate")).toContainText("₹18,000");
    await expect(cards.nth(0)).toContainText("43L");
    await expect(cards.nth(1).getByTestId("import-row-status")).toContainText("Link broken / not found");
    // The not-found card has no pickers; the found one does.
    await expect(cards.nth(1).getByLabel("Account for @ghantaa")).toHaveCount(0);
    await page.getByLabel("Account for all pages").selectOption("creator-1");
    await expect(cards.nth(0).getByLabel("Account for @laughtercolours")).toBeVisible();
    await expect(page.getByTestId("import-confirm")).toHaveText("Import 1 page");
    // Nothing overflows the phone width.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test("creating a user with a creator's existing email just selects that creator (no duplicate, no password)", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.route(`${API_URL}/assets/import/preview`, (route) => route.fulfill({ json: preview() }));
    await page.route(`${API_URL}/assets/import/followers`, (route) => route.fulfill({ json: { profiles: { laughtercolours: profile(1), ghantaa: profile(2) } } }));
    await page.route(`${API_URL}/auth/signup`, (route) => route.fulfill({ status: 409, json: { error: { code: "EMAIL_ALREADY_REGISTERED", message: "An account with this email already exists" } } }));

    await openImport(page);
    await page.getByLabel("Pages sheet (.xlsx or .csv)").setInputFiles(xlsx);
    await page.getByTestId("import-new-user").click();
    await page.getByLabel("New user email").fill("priya@gmail.com");
    await page.getByTestId("import-new-user-form").getByRole("button", { name: "Create user" }).click();

    await expect(page.getByLabel("Account for all pages")).toHaveValue("creator-1");
    await expect(page.getByTestId("import-new-user-password")).toHaveCount(0);
    await expect(page.getByTestId("import-confirm")).toHaveText("Import 2 pages");
  });

  test("picking the account for all pages moves rows the sheet had placed under someone else", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    const two = [...owners, { id: "creator-2", name: "Rahul Creator", phoneNumber: "+919000000002", email: null }];
    const placed = { ...preview(), owners: two, rows: preview().rows.map((r) => ({ ...r, ownerId: "creator-2", owner: two[1], status: "ready" })) };
    await page.route(`${API_URL}/assets/import/preview`, (route) => route.fulfill({ json: placed }));
    await page.route(`${API_URL}/assets/import/followers`, (route) => route.fulfill({ json: { profiles: { laughtercolours: profile(1), ghantaa: profile(2) } } }));
    await openImport(page);
    await page.getByLabel("Pages sheet (.xlsx or .csv)").setInputFiles(xlsx);
    const rows = page.getByTestId("import-preview-row");
    await expect(rows.nth(0).getByLabel("Account for @laughtercolours")).toHaveValue("creator-2");

    await page.getByLabel("Account for all pages").selectOption("creator-1");
    await expect(rows.nth(0).getByLabel("Account for @laughtercolours")).toHaveValue("");
    await expect(rows.nth(0).getByLabel("Account for @laughtercolours")).toContainText("Priya Creator");
  });

  test("a sub-admin without user management can't create users from the popup", async ({ page }) => {
    await page.addInitScript(
      (s) => window.localStorage.setItem("taggify_auth", JSON.stringify(s)),
      {
        user: { id: "sub-1", phoneNumber: "+919000000009", name: "Sub Admin", role: "ADMIN", whatsappVerified: true, emailVerified: true, permissions: { "users.view": false, "users.edit": false, "campaigns.view": true, "campaigns.edit": true, "inventory.view": true, "inventory.edit": true, "inventory.approve": true, "links.view": true, "links.edit": true, "links.approve": true, "finance.view": true, "finance.edit": true, "finance.approve": true, "finance.pay": true, "plans.view": true, "plans.edit": true, "plans.approve": true } },
        accessToken: "test-access-token",
        refreshToken: "test-refresh-token",
      }
    );
    await mockApi(page);
    await page.route(`${API_URL}/assets/import/preview`, (route) => route.fulfill({ json: preview() }));
    await page.route(`${API_URL}/assets/import/followers`, (route) => route.fulfill({ json: { profiles: { laughtercolours: profile(1), ghantaa: profile(2) } } }));
    await openImport(page);
    await page.getByLabel("Pages sheet (.xlsx or .csv)").setInputFiles(xlsx);
    await expect(page.getByTestId("import-account-picker")).toBeVisible();
    await expect(page.getByTestId("import-new-user")).toHaveCount(0);
  });

  test("when Instagram can't be reached, nothing can be imported until a retry confirms the pages", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.route(`${API_URL}/assets/import/preview`, (route) => route.fulfill({ json: preview() }));
    let calls = 0;
    await page.route(`${API_URL}/assets/import/followers`, (route) => {
      calls += 1;
      if (calls === 1) return route.fulfill({ status: 502, json: { error: { code: "FOLLOWERS_FETCH_FAILED", message: "Couldn't fetch follower counts from Instagram right now." } } });
      return route.fulfill({ json: { profiles: { laughtercolours: profile(4300000), ghantaa: profile(8700000) } } });
    });

    await openImport(page);
    await page.getByLabel("Pages sheet (.xlsx or .csv)").setInputFiles(xlsx);
    const rows = page.getByTestId("import-preview-row");
    await expect(rows.nth(0).getByTestId("import-row-status")).toContainText("Couldn't verify");
    await page.getByLabel("Account for all pages").selectOption("creator-1");
    await expect(page.getByTestId("import-confirm")).toHaveText("Import 0 pages");
    await expect(page.getByTestId("import-confirm")).toBeDisabled();

    await page.getByTestId("import-retry-check").click();
    await expect(rows.nth(0).getByTestId("import-row-status")).toContainText("Will be created");
    await expect(page.getByTestId("import-confirm")).toHaveText("Import 2 pages");
    await expect(page.getByTestId("import-retry-check")).toHaveCount(0);
  });

  test("an imported page shows its reel rate card in the Inventory list (reel-only summary, 11 Sep)", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.route(`${API_URL}/assets`, (route) =>
      route.fulfill({
        json: [
          {
            id: "a1",
            ownerId: "creator-1",
            platform: "instagram",
            handle: "laughtercolours",
            followers: 4300000,
            fullName: "Laughter Colours",
            category: "Meme page",
            approvalStatus: "approved",
            createdAt: "2026-09-22T00:00:00.000Z",
            lastScrapedAt: "2026-09-22T00:00:00.000Z",
            rateCards: [
              { format: "reel", amount: "18000" },
              { format: "story", amount: "6000" },
            ],
            owner: owners[0],
            campaigns: [],
            engagement: { avgLikes: null, avgComments: null, avgViews: null, sampleSize: 0 },
          },
        ],
      })
    );
    await page.goto("/inventory");
    const cell = page.getByTestId("rate-card-cell");
    await expect(cell).toContainText("Reel");
    await expect(cell).toContainText("₹18,000");
    await expect(cell).not.toContainText("₹6,000");
  });
});
