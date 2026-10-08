import { test, expect } from "@playwright/test";

import { signIn, mockApi, userFor, API_URL } from "./fixtures";

/**
 * Inventory → "Create page" / "Import pages" (user request, 14 Sep): an
 * admin can register a page under a chosen creator account, or attach an
 * .xlsx/.csv and review every row — with the account each will sit under
 * — before confirming. Server parsing/resolution is covered by
 * server/src/modules/assets/importParser.test.js + importAssets.test.js;
 * these tests pin the client flow against mocked preview/import responses.
 */

const owners = [
  { id: "creator-1", name: "Priya Creator", phoneNumber: "+919000000001", email: null },
  { id: "creator-2", name: "Rahul Creator", phoneNumber: "+919000000002", email: null },
];

function previewResponse() {
  return {
    totalRows: 5,
    hasOwnerColumn: true,
    owners,
    summary: { ready: 1, "owner-unknown": 1, "owner-missing": 1, exists: 1, invalid: 1 },
    rows: [
      { rowNumber: 2, rawHandle: "@big.page", handle: "big.page", category: "News page", followers: 1200000, rateCards: [{ format: "reel", amount: 12000 }], ownerRef: "+919000000001", owner: owners[0], ownerId: "creator-1", status: "ready", reason: null },
      { rowNumber: 3, rawHandle: "mystery.page", handle: "mystery.page", category: null, followers: null, rateCards: [], ownerRef: "nobody", owner: null, ownerId: null, status: "owner-unknown", reason: 'No creator account matches "nobody".' },
      { rowNumber: 4, rawHandle: "blank.owner", handle: "blank.owner", category: null, followers: 500, rateCards: [], ownerRef: null, owner: null, ownerId: null, status: "owner-missing", reason: "Owner cell is blank." },
      { rowNumber: 5, rawHandle: "taken.page", handle: "taken.page", category: null, followers: null, rateCards: [], ownerRef: "+919000000002", owner: owners[1], ownerId: "creator-2", status: "exists", reason: "Already in Inventory under Rahul Creator." },
      { rowNumber: 6, rawHandle: "bad handle!", handle: null, category: null, followers: null, rateCards: [], ownerRef: null, owner: null, ownerId: null, status: "invalid", reason: "\"bad handle!\" isn't a valid Instagram handle." },
    ],
  };
}

const csvFile = { name: "pages.csv", mimeType: "text/csv", buffer: Buffer.from("handle,owner\nbig.page,+919000000001\n") };

test.describe("Inventory — Create page / Import pages (admin)", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("an ADMIN sees both buttons; a CREATOR keeps its own Add page and never sees Import", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.goto("/inventory");
    await expect(page.getByTestId("import-pages-button")).toBeVisible();
    await expect(page.getByTestId("create-page-button")).toBeVisible();
  });

  test("a CREATOR keeps its own Add page, never the admin Create page button, but can also Import (25 Sep)", async ({ page }) => {
    await signIn(page, "CREATOR");
    await mockApi(page);
    await page.goto("/inventory");
    await expect(page.getByRole("button", { name: "Add page" }).first()).toBeVisible();
    await expect(page.getByTestId("import-pages-button")).toBeVisible();
    await expect(page.getByTestId("create-page-button")).toHaveCount(0);
  });

  test("Create page: admin must pick an account and a valid handle; the request carries ownerId and the cleaned handle", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.route(`${API_URL}/assets/owners`, (route) => route.fulfill({ json: owners }));
    let createBody: Record<string, unknown> | null = null;
    await page.route(`${API_URL}/assets`, (route) => {
      if (route.request().method() === "POST") {
        createBody = route.request().postDataJSON();
        return route.fulfill({ status: 201, json: { id: "asset-new", handle: "demo.page", ownerId: "creator-2" } });
      }
      return route.fulfill({ json: [] });
    });

    await page.goto("/inventory");
    await page.getByTestId("create-page-button").click();
    const form = page.getByTestId("create-page-form");
    await expect(form).toBeVisible();

    // Submit empty → both inline errors, no request.
    await form.getByRole("button", { name: "Create page" }).click();
    await expect(form.getByText("Pick the creator account this page belongs to.")).toBeVisible();
    await expect(form.getByText("Enter the page's Instagram handle.")).toBeVisible();

    // Bad handle stays blocked.
    await form.getByLabel("Instagram handle").fill("bad handle!");
    await expect(form.getByText(/letters, digits, dots and underscores/)).toBeVisible();

    // A pasted profile link is normalized and previewed.
    await form.getByLabel("Instagram handle").fill("https://www.instagram.com/Demo.Page/?hl=en");
    await expect(form.getByText("Will be saved as @Demo.Page")).toBeVisible();

    // Searchable account picker (14 Sep): typing filters by name/phone/email.
    const picker = form.getByRole("combobox", { name: "Creator account" });
    await picker.click();
    await expect(form.getByRole("option")).toHaveCount(2);
    await picker.fill("rah");
    await expect(form.getByRole("option")).toHaveCount(1);
    await form.getByRole("option", { name: /Rahul Creator/ }).click();
    await expect(picker).toHaveValue("Rahul Creator");
    await expect(form.getByText("Pick the creator account this page belongs to.")).toHaveCount(0);

    // Optional starting rate card.
    await form.getByLabel("Reel rate").fill("12000");
    await form.getByRole("button", { name: "Create page" }).click();

    await expect(form).toHaveCount(0);
    expect(createBody).toMatchObject({ handle: "Demo.Page", platform: "instagram", ownerId: "creator-2", rateCards: [{ format: "reel", amount: 12000 }] });
  });

  test("a just-created page shows 'Fetching from Instagram…' and polls until the scrape lands", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    const base = { id: "asset-new", ownerId: "creator-1", platform: "instagram", handle: "fresh.page", category: null, approvalStatus: "approved", createdAt: new Date().toISOString(), rateCards: [], campaigns: [], owner: owners[0] };
    let listCalls = 0;
    await page.route(`${API_URL}/assets`, (route) => {
      listCalls += 1;
      // First two polls: nothing scraped yet. Third: followers + profile-level avg views arrived.
      if (listCalls < 3) return route.fulfill({ json: [{ ...base, followers: 0, scrapeQueuedAt: new Date().toISOString(), lastScrapedAt: null, lastScrapeError: null, engagement: { avgLikes: null, avgComments: null, avgViews: null, sampleSize: 0 } }] });
      return route.fulfill({ json: [{ ...base, followers: 250000, scrapeQueuedAt: null, lastScrapedAt: new Date().toISOString(), lastScrapeError: null, engagement: { avgLikes: 900, avgComments: 30, avgViews: 45000, sampleSize: 12, source: "profile" } }] });
    });

    await page.goto("/inventory");
    await expect(page.getByTestId("scrape-pending")).toBeVisible();
    await expect(page.getByTitle("2,50,000 followers")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("scrape-pending")).toHaveCount(0);
    await expect(page.getByText("45K")).toBeVisible();
  });

  test("a page's handle links to its Instagram profile, and selected pages can be refreshed from Instagram in bulk", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    const asset = (id: string, handle: string) => ({ id, ownerId: "creator-1", platform: "instagram", handle, category: null, approvalStatus: "approved", createdAt: "2026-01-01T00:00:00.000Z", followers: 1000, rateCards: [], campaigns: [], owner: owners[0], scrapeQueuedAt: null, lastScrapedAt: null, lastScrapeError: null, engagement: { avgLikes: null, avgComments: null, avgViews: null, sampleSize: 0 } });
    await page.route(`${API_URL}/assets`, (route) => route.fulfill({ json: [asset("a1", "one.page"), asset("a2", "two.page")] }));
    let refreshBody: { assetIds: string[] } | null = null;
    await page.route(`${API_URL}/assets/refresh-profiles`, (route) => {
      refreshBody = route.request().postDataJSON();
      return route.fulfill({ json: { queued: 2 } });
    });

    await page.goto("/inventory");
    const link = page.getByTestId("asset-instagram-link").first();
    await expect(link).toHaveAttribute("href", "https://www.instagram.com/one.page/");
    await expect(link).toHaveAttribute("target", "_blank");

    await page.getByRole("checkbox", { name: "Select all 2 pages" }).check();
    await page.getByTestId("refresh-selected").click();
    await expect.poll(() => refreshBody).toEqual({ assetIds: ["a1", "a2"] });
    await expect(page.getByTestId("selection-bar")).toHaveCount(0);
  });

  test("a page whose first scrape failed says so instead of silently showing 0 followers", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.route(`${API_URL}/assets`, (route) =>
      route.fulfill({
        json: [{ id: "asset-bad", ownerId: "creator-1", platform: "instagram", handle: "private.page", category: null, approvalStatus: "approved", createdAt: new Date().toISOString(), followers: 0, rateCards: [], campaigns: [], owner: owners[0], scrapeQueuedAt: null, lastScrapedAt: null, lastScrapeError: 'Apify: no profile for handle "private.page" (private account)', engagement: { avgLikes: null, avgComments: null, avgViews: null, sampleSize: 0 } }],
      })
    );
    await page.goto("/inventory");
    await expect(page.getByTestId("scrape-failed")).toBeVisible();
    await expect(page.getByTestId("scrape-pending")).toHaveCount(0);
  });

  test("Import pages: rejects a wrong file type client-side without calling the server", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    let previewCalls = 0;
    await page.route(`${API_URL}/assets/import/preview`, (route) => {
      previewCalls += 1;
      return route.fulfill({ json: previewResponse() });
    });
    await page.goto("/inventory");
    await page.getByTestId("import-pages-button").click();
    await page.getByLabel("Pages sheet (.xlsx or .csv)").setInputFiles({ name: "pages.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF") });
    await expect(page.getByText("Upload an Excel (.xlsx) or CSV file.")).toBeVisible();
    expect(previewCalls).toBe(0);
  });

  test("Import pages: a pasted Google Sheet link is fetched server-side and previewed like a file", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    let urlBody: { url: string } | null = null;
    await page.route(`${API_URL}/assets/import/preview-url`, (route) => {
      urlBody = route.request().postDataJSON();
      return route.fulfill({ json: previewResponse() });
    });
    await page.goto("/inventory");
    await page.getByTestId("import-pages-button").click();

    // Not a Sheets link → client-side message, no request.
    await page.getByLabel("Google Sheet link").fill("https://example.com/pages.csv");
    await page.getByTestId("import-fetch-sheet").click();
    await expect(page.getByText(/Paste a Google Sheets link/)).toBeVisible();
    expect(urlBody).toBeNull();

    await page.getByLabel("Google Sheet link").fill("https://docs.google.com/spreadsheets/d/abc123/edit#gid=0");
    await page.getByLabel("Google Sheet link").press("Enter");
    await expect(page.getByTestId("import-preview-row")).toHaveCount(5);
    expect(urlBody).toEqual({ url: "https://docs.google.com/spreadsheets/d/abc123/edit#gid=0" });
  });

  test("Import pages: live followers fill in after the preview, and a category can be set for all rows or one row", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.route(`${API_URL}/assets/import/preview`, (route) => route.fulfill({ json: previewResponse() }));
    let followersBody: { handles: string[] } | null = null;
    await page.route(`${API_URL}/assets/import/followers`, async (route) => {
      followersBody = route.request().postDataJSON();
      await new Promise((r) => setTimeout(r, 400));
      return route.fulfill({ json: { profiles: { "big.page": { followers: 1350000, avgViews: 82000, avgLikes: 4000, avgComments: 90, fullName: "Big" }, "mystery.page": null, "blank.owner": { followers: 2100, avgViews: null, avgLikes: null, avgComments: null, fullName: null } } } });
    });
    let importBody: { rows: Array<Record<string, unknown>> } | null = null;
    await page.route(`${API_URL}/assets/import`, (route) => {
      importBody = route.request().postDataJSON();
      return route.fulfill({ status: 201, json: { created: [], skipped: [] } });
    });

    await page.goto("/inventory");
    await page.getByTestId("import-pages-button").click();
    await page.getByLabel("Pages sheet (.xlsx or .csv)").setInputFiles(csvFile);
    const rows = page.getByTestId("import-preview-row");
    await expect(rows).toHaveCount(5);

    // Only placeable handles are asked for; the live count replaces the sheet's, a missing profile is flagged.
    await expect(page.getByTestId("live-followers-status")).toContainText("Followers and avg views are live");
    expect(followersBody).toEqual({ handles: ["big.page", "mystery.page", "blank.owner"] });
    await expect(rows.nth(0)).toContainText("1.4M"); // 1,350,000 followers, written as K / M since 8 Oct
    await expect(rows.nth(0)).toContainText("82K avg views");
    // 22 Sep — a page Instagram doesn't know is flagged "link broken / not found" and never imported.
    await expect(rows.nth(1).getByTitle("Not found on Instagram")).toBeVisible();
    await expect(rows.nth(1).getByTestId("import-row-status")).toContainText("Link broken / not found");
    await expect(page.getByTestId("import-not-found")).toContainText("1 link is broken or the page wasn't found on Instagram");

    // Category for all, then a single-row override. Going back to "Keep
    // sheet values" restores the sheet's own categories.
    await page.getByLabel("Category for all rows").selectOption("Lifestyle");
    await expect(rows.nth(0).getByLabel("Category for @big.page")).toHaveValue("Lifestyle");
    await page.getByLabel("Category for all rows").selectOption("");
    await expect(rows.nth(0).getByLabel("Category for @big.page")).toHaveValue("");
    await expect(rows.nth(0)).toContainText("Sheet: News page");
    await page.getByLabel("Category for all rows").selectOption("Fitness");
    await expect(rows.nth(0).getByLabel("Category for @big.page")).toHaveValue("Fitness");
    await rows.nth(2).getByLabel("Category for @blank.owner").selectOption("Food");
    // The not-found row has no pickers — there's nothing to import.
    await expect(rows.nth(1).getByLabel("Category for @mystery.page")).toHaveCount(0);

    await page.getByLabel("Account for all pages").selectOption("creator-1");
    await expect(page.getByTestId("import-confirm")).toHaveText("Import 2 pages");
    await page.getByTestId("import-confirm").click();
    await expect(page.getByTestId("import-result")).toBeVisible();
    expect(importBody!.rows).toEqual([
      { handle: "big.page", ownerId: "creator-1", category: "Fitness", pageName: null, followers: 1350000, rateCards: [{ format: "reel", amount: 12000 }] },
      { handle: "blank.owner", ownerId: "creator-1", category: "Food", pageName: null, followers: 2100, rateCards: [] },
    ]);
  });

  test("Import pages: shows the server's parse error for an unreadable sheet", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.route(`${API_URL}/assets/import/preview`, (route) => route.fulfill({ status: 400, json: { error: { code: "IMPORT_SHEET_INVALID", message: 'Couldn\'t find a page-handle column — add a header named "handle" (or "page" / "username") to the first row.' } } }));
    await page.goto("/inventory");
    await page.getByTestId("import-pages-button").click();
    await page.getByLabel("Pages sheet (.xlsx or .csv)").setInputFiles(csvFile);
    await expect(page.getByText(/Couldn't find a page-handle column/)).toBeVisible();
    await expect(page.getByTestId("import-preview-table")).toHaveCount(0);
  });

  test("Import pages: preview lists every row with its account, unresolved rows need an account, confirm sends only placed rows and refreshes Inventory", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.route(`${API_URL}/assets/import/preview`, (route) => route.fulfill({ json: previewResponse() }));
    // Every placeable page is confirmed on Instagram (the counts match the sheet here).
    await page.route(`${API_URL}/assets/import/followers`, (route) =>
      route.fulfill({
        json: {
          profiles: {
            "big.page": { followers: 1200000, avgViews: null, avgLikes: null, avgComments: null, fullName: null },
            "mystery.page": { followers: 900, avgViews: null, avgLikes: null, avgComments: null, fullName: null },
            "blank.owner": { followers: 500, avgViews: null, avgLikes: null, avgComments: null, fullName: null },
          },
        },
      })
    );
    let importBody: { rows: Array<Record<string, unknown>> } | null = null;
    await page.route(`${API_URL}/assets/import`, (route) => {
      importBody = route.request().postDataJSON();
      return route.fulfill({
        status: 201,
        json: {
          created: [
            { id: "a1", handle: "big.page", ownerId: "creator-1", owner: owners[0] },
            { id: "a2", handle: "mystery.page", ownerId: "creator-2", owner: owners[1] },
            { id: "a3", handle: "blank.owner", ownerId: "creator-1", owner: owners[0] },
          ],
          skipped: [{ handle: "late.page", reason: "Already registered under Rahul Creator." }],
        },
      });
    });
    let assetsListCalls = 0;
    await page.route(`${API_URL}/assets`, (route) => {
      if (route.request().method() === "GET") assetsListCalls += 1;
      return route.fulfill({ json: [] });
    });

    await page.goto("/inventory");
    await expect.poll(() => assetsListCalls).toBe(1);
    await page.getByTestId("import-pages-button").click();
    await page.getByLabel("Pages sheet (.xlsx or .csv)").setInputFiles(csvFile);

    // Every row is listed, with the account it resolved to.
    const rows = page.getByTestId("import-preview-row");
    await expect(rows).toHaveCount(5);
    await expect(page.getByTestId("import-summary")).toContainText("5 rows read.");
    await expect(rows.nth(0)).toContainText("@big.page");
    await expect(rows.nth(0).getByLabel("Account for @big.page")).toHaveValue("creator-1");
    await expect(rows.nth(0)).toContainText("Will be created");
    await expect(rows.nth(1)).toContainText("Sheet said: nobody");
    await expect(rows.nth(3)).toContainText("Rahul Creator");
    await expect(rows.nth(3)).toContainText("Already in Inventory");
    await expect(rows.nth(4)).toContainText("bad handle!");
    await expect(rows.nth(4)).toContainText("Invalid handle");
    // 22 Sep — pages already in Inventory are listed up front with who they're under.
    await expect(page.getByTestId("import-already-exists")).toContainText("1 page is already in Inventory and won't be imported");
    await expect(page.getByTestId("import-already-exists")).toContainText("@taken.page — under Rahul Creator");

    // Two rows have no account yet → only 1 importable, and the count says so.
    await expect(page.getByTestId("import-unplaced")).toHaveText("2 rows still need an account");
    await expect(page.getByTestId("import-confirm")).toHaveText("Import 1 page");

    // One account for every page (22 Sep), then a single-row override.
    await page.getByLabel("Account for all pages").selectOption("creator-1");
    await expect(page.getByTestId("import-unplaced")).toHaveCount(0);
    await expect(page.getByTestId("import-confirm")).toHaveText("Import 3 pages");
    await rows.nth(1).getByLabel("Account for @mystery.page").selectOption("creator-2");
    await expect(page.getByTestId("import-confirm")).toHaveText("Import 3 pages");

    await page.getByTestId("import-confirm").click();
    await expect(page.getByTestId("import-result")).toContainText("3 pages imported");
    await expect(page.getByTestId("import-result")).toContainText("Priya Creator");
    await expect(page.getByTestId("import-result")).toContainText("@big.page, @blank.owner");
    await expect(page.getByTestId("import-result")).toContainText("@late.page — Already registered under Rahul Creator.");

    expect(importBody!.rows).toEqual([
      { handle: "big.page", ownerId: "creator-1", category: "News page", pageName: null, followers: 1200000, rateCards: [{ format: "reel", amount: 12000 }] },
      { handle: "mystery.page", ownerId: "creator-2", category: null, pageName: null, followers: 900, rateCards: [] },
      { handle: "blank.owner", ownerId: "creator-1", category: null, pageName: null, followers: 500, rateCards: [] },
    ]);
    // Inventory refetched after the import.
    await expect.poll(() => assetsListCalls).toBeGreaterThan(1);

    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByTestId("import-pages-modal")).toHaveCount(0);
  });
});

// 25 Sep: Creator and Plan Maker can bulk-import too — scoped differently
// from Admin's (see server/src/modules/assets/service.js): a Creator's sheet
// is always their own pages (no account column, no rate cards, never sees
// other creators); a Plan Maker gets the same account-picker Admin does.
test.describe("Inventory — Import pages: Creator and Plan Maker (25 Sep)", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("a CREATOR's preview never shows an Account or Reel rate column, and confirm sends their own account", async ({ page }) => {
    await signIn(page, "CREATOR");
    await mockApi(page);
    await page.route(`${API_URL}/assets/import/preview`, (route) =>
      route.fulfill({
        json: {
          totalRows: 1,
          hasOwnerColumn: false,
          owners: [],
          summary: { ready: 1 },
          rows: [{ rowNumber: 2, rawHandle: "@my.page", handle: "my.page", category: null, followers: 500, rateCards: [{ format: "reel", amount: 5000 }], ownerRef: null, owner: { id: "test-user-1", name: "Test User", phoneNumber: null, email: null }, ownerId: "test-user-1", status: "ready", reason: null }],
        },
      })
    );
    await page.route(`${API_URL}/assets/import/followers`, (route) => route.fulfill({ json: { profiles: { "my.page": { followers: 500, avgViews: null, avgLikes: null, avgComments: null, fullName: null } } } }));
    let importBody: { rows: Array<Record<string, unknown>> } | null = null;
    await page.route(`${API_URL}/assets/import`, (route) => {
      importBody = route.request().postDataJSON();
      return route.fulfill({ status: 201, json: { created: [{ id: "a1", handle: "my.page", ownerId: "test-user-1", approvalStatus: "pending", owner: { id: "test-user-1", name: "Test User" } }], skipped: [] } });
    });

    await page.goto("/inventory");
    await page.getByTestId("import-pages-button").click();
    await page.getByLabel("Pages sheet (.xlsx or .csv)").setInputFiles(csvFile);

    await expect(page.getByTestId("import-preview-row")).toHaveCount(1);
    // Never an account picker, never a rate-card column — a creator's sheet is always their own pages.
    await expect(page.getByTestId("import-account-picker")).toHaveCount(0);
    await expect(page.getByTestId("import-preview-table").getByText("Reel rate")).toHaveCount(0);
    await expect(page.getByLabel(/^Account for /)).toHaveCount(0);

    await page.getByTestId("import-confirm").click();
    // The client forwards whatever the sheet parsed (rateCards isn't editable/visible
    // for a Creator here) — the *server* is what actually strips it for non-admins
    // (see assets/service.js's importAssets), not the client.
    expect(importBody!.rows).toEqual([{ handle: "my.page", ownerId: "test-user-1", category: null, pageName: null, followers: 500, rateCards: [{ format: "reel", amount: 5000 }] }]);
    await expect(page.getByTestId("import-result")).toContainText("Pending admin approval");
  });

  // Independent review (25 Sep): the "already in Inventory" summary note used
  // r.owner for a conflict row too, but for "conflict" that field is the
  // caller's own intended owner, not who it actually belongs to — for a
  // CREATOR this rendered "under Test User" (their own name) right next to a
  // status badge saying "another account", a visible self-contradiction.
  test("a conflict row's summary note names the real account, not the caller's own, and stays redacted for a CREATOR", async ({ page }) => {
    await signIn(page, "CREATOR");
    await mockApi(page);
    await page.route(`${API_URL}/assets/import/preview`, (route) =>
      route.fulfill({
        json: {
          totalRows: 1,
          hasOwnerColumn: false,
          owners: [],
          summary: { conflict: 1 },
          rows: [
            {
              rowNumber: 2,
              rawHandle: "@taken.page",
              handle: "taken.page",
              category: null,
              followers: null,
              rateCards: [],
              ownerRef: null,
              owner: { id: "test-user-1", name: "Test User", phoneNumber: null, email: null },
              ownerId: "test-user-1",
              status: "conflict",
              reason: "Already registered under another account — a page can't be under two accounts.",
            },
          ],
        },
      })
    );

    await page.goto("/inventory");
    await page.getByTestId("import-pages-button").click();
    await page.getByLabel("Pages sheet (.xlsx or .csv)").setInputFiles(csvFile);

    const note = page.getByTestId("import-already-exists");
    await expect(note).toContainText("@taken.page — Already registered under another account");
    // Never the caller's own name stitched onto someone else's conflict.
    await expect(note).not.toContainText("Test User");
  });

  test("a PLAN_MAKER gets the same account-picker Admin does, and can create a new creator inline", async ({ page }) => {
    await signIn(page, "PLAN_MAKER");
    await mockApi(page);
    await page.route(`${API_URL}/assets/import/preview`, (route) => route.fulfill({ json: previewResponse() }));
    await page.route(`${API_URL}/assets/import/followers`, (route) =>
      route.fulfill({ json: { profiles: { "big.page": { followers: 1200000, avgViews: null, avgLikes: null, avgComments: null, fullName: null }, "mystery.page": { followers: 900, avgViews: null, avgLikes: null, avgComments: null, fullName: null }, "blank.owner": { followers: 500, avgViews: null, avgLikes: null, avgComments: null, fullName: null } } } })
    );
    await page.route(`${API_URL}/assets/import`, (route) =>
      route.fulfill({ status: 201, json: { created: [{ id: "a1", handle: "big.page", ownerId: "creator-1", approvalStatus: "pending", owner: owners[0] }], skipped: [] } })
    );

    await page.goto("/inventory");
    await page.getByTestId("import-pages-button").click();
    await page.getByLabel("Pages sheet (.xlsx or .csv)").setInputFiles(csvFile);

    // Same account-picker and per-row Account column an Admin gets.
    await expect(page.getByTestId("import-account-picker")).toBeVisible();
    await expect(page.getByLabel("Account for @big.page")).toBeVisible();
    // Reel rate stays hidden — a Plan Maker's import lands pending too, no rate card.
    await expect(page.getByTestId("import-preview-table").getByText("Reel rate")).toHaveCount(0);
    await expect(page.getByTestId("import-new-user")).toBeVisible();

    await page.getByLabel("Account for all pages").selectOption("creator-1");
    await page.getByTestId("import-confirm").click();
    await expect(page.getByTestId("import-result")).toContainText("Pending admin approval");
  });

  // Independent review (25 Sep) caught a client/server mismatch: a FINANCE
  // account granted inventory.edit could reach these routes (requireAccess
  // allows any inventory.edit holder), but the server's auto-approval/rate
  // card write is gated on the literal ADMIN role (importAssets/createAsset),
  // not the grant. The UI must not show admin-only extras it can't honor.
  test("a FINANCE account granted inventory.edit sees no rate-card column and 'Pending' copy — not admin extras the server won't honor", async ({ page }) => {
    const grantedFinance = { ...userFor("FINANCE"), permissions: { ...userFor("FINANCE").permissions, "inventory.edit": true } };
    await page.addInitScript(
      (s) => window.localStorage.setItem("taggify_auth", JSON.stringify(s)),
      { user: grantedFinance, accessToken: "test-access-token", refreshToken: "test-refresh-token" }
    );
    await mockApi(page);
    await page.route(`${API_URL}/assets/import/preview`, (route) => route.fulfill({ json: previewResponse() }));
    await page.route(`${API_URL}/assets/import/followers`, (route) =>
      route.fulfill({ json: { profiles: { "big.page": { followers: 1200000, avgViews: null, avgLikes: null, avgComments: null, fullName: null } } } })
    );
    await page.route(`${API_URL}/assets/import`, (route) =>
      route.fulfill({ status: 201, json: { created: [{ id: "a1", handle: "big.page", ownerId: "creator-1", approvalStatus: "pending", owner: owners[0] }], skipped: [] } })
    );

    await page.goto("/inventory");
    // A granted FINANCE account can still reach Import (broad inventory.edit access)...
    await page.getByTestId("import-pages-button").click();
    await page.getByLabel("Pages sheet (.xlsx or .csv)").setInputFiles(csvFile);
    // ...but never the admin-only extras the server won't actually give it.
    await expect(page.getByTestId("import-preview-table").getByText("Reel rate")).toHaveCount(0);

    await page.getByRole("row", { name: /big\.page/ }).getByLabel("Account for @big.page").selectOption("creator-1");
    await page.getByTestId("import-confirm").click();
    await expect(page.getByTestId("import-result")).toContainText("Pending admin approval");
  });
});
