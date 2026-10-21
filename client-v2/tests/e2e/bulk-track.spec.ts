import { expect, test, type Page } from "@playwright/test";

import { API_URL, mockApi, shot, signIn, userFor } from "./fixtures";

/**
 * Bulk Tracker: the v1 screen (client/app/bulk-track) ported as-is. Gated on
 * the opt-in `bulkTrack.view` key (ADMIN by default, any other account once
 * granted). API fully mocked; the server's tests cover scraping, scoping and
 * the 403s. Ported from client/tests/e2e/bulk-track.spec.ts.
 */
const now = new Date().toISOString();
const BATCH = { id: "b1", sourceType: "manual", sheetSourceId: null, status: "done", totalCount: 2, successCount: 1, failedCount: 1, createdAt: now, sheetSource: null };
const DETAIL = {
  batch: BATCH,
  profiles: [{ id: "pr1", username: "some.page", profileUrl: "https://www.instagram.com/some.page/", category: null, status: "done", failureReason: null, followers: 45200 }],
  posts: [{ id: "po1", permalink: "https://www.instagram.com/reel/abc/", status: "broken", postType: null, failureReason: "Broken link: deleted", views: null, likes: null, comments: null, shares: null, reposts: null, saves: null }],
};
const SHEET = { id: "s1", sheetUrl: "https://docs.google.com/spreadsheets/d/abc/edit", name: "Competitor reels", profileLinkCol: "Page link", postLinkCol: "Post link", fetchFollowers: true, fetchEngagement: true, lastCheckedAt: null, createdAt: now };
const POST = { id: "po2", permalink: "https://www.instagram.com/reel/xyz/", status: "done", postType: "reel", failureReason: null, views: 125000, likes: 4300, comments: 210, shares: 90, reposts: 12, saves: 340, createdAt: now };

async function mockBulkTrack(page: Page, opts: { sheets?: (typeof SHEET)[]; posts?: (typeof POST)[] } = {}) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  let batches: (typeof BATCH)[] = [];
  let sheets = opts.sheets ?? [];
  await page.route(`${API_URL}/bulk-track/**`, async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(/^\/api/, "");
    calls.push({ method: req.method(), path, body: req.postDataJSON?.() ?? null });
    if (req.method() === "POST" && path === "/bulk-track/batches") {
      batches = [BATCH];
      return route.fulfill({ status: 201, json: { batchId: "b1", queued: { profiles: 1, posts: 1 }, skipped: { profiles: 0, posts: 0 } } });
    }
    if (req.method() === "GET" && path === "/bulk-track/batches") return route.fulfill({ json: batches });
    if (req.method() === "GET" && path === "/bulk-track/batches/b1") return route.fulfill({ json: DETAIL });
    if (req.method() === "GET" && path === "/bulk-track/batches/b1/export") {
      return route.fulfill({ body: Buffer.from("xlsx"), headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" } });
    }
    if (req.method() === "DELETE" && path === "/bulk-track/batches/b1") {
      batches = [];
      return route.fulfill({ json: { success: true, deleted: { posts: 1, profiles: 1 } } });
    }
    if (req.method() === "DELETE" && path === "/bulk-track/sheet-sources/s1") {
      sheets = [];
      return route.fulfill({ json: { success: true } });
    }
    if (req.method() === "POST" && path === "/bulk-track/sheet-sources/preview") {
      return route.fulfill({ json: { headers: ["Page name", "Page link", "Post link"], sampleRow: null, rowCount: 1, rows: [{ "Page name": "Some", "Page link": "https://www.instagram.com/some.page/", "Post link": "https://www.instagram.com/reel/abc/" }] } });
    }
    if (req.method() === "POST" && path === "/bulk-track/sheet-sources") {
      sheets = [SHEET];
      return route.fulfill({ status: 201, json: { sheetSourceId: "s1", batchId: "b2", imported: { rows: 1 } } });
    }
    if (path === "/bulk-track/sheet-sources") return route.fulfill({ json: { sources: sheets, total: sheets.length } });
    if (path === "/bulk-track/posts") return route.fulfill({ json: opts.posts ?? [] });
    return route.fulfill({ json: {} });
  });
  return calls;
}

test.describe("Bulk Tracker", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("ADMIN: paste links → batch appears → detail → export → delete", async ({ page }) => {
    const errors: Error[] = [];
    page.on("pageerror", (e) => errors.push(e));
    await signIn(page, "ADMIN");
    await mockApi(page);
    const calls = await mockBulkTrack(page);

    await page.goto("/bulk-track");
    await expect(page.getByRole("heading", { name: "Bulk Tracker" })).toBeVisible();
    await expect(page.getByText("Market-research Instagram scraping — outside your managed pages, not tied to payouts.")).toBeVisible();
    await expect(page.getByText("No batches here yet.")).toBeVisible();
    await shot(page, "bulk-track");

    const track = page.getByRole("button", { name: "Track links" });
    await expect(track).toBeDisabled();
    await page.getByLabel("Profile links (one per line, max 50)").fill("https://www.instagram.com/some.page/\n\n");
    await page.getByLabel("Post / reel links (one per line, max 50)").fill("https://www.instagram.com/reel/abc/");
    await track.click();

    await expect.poll(() => calls.find((c) => c.method === "POST" && c.path === "/bulk-track/batches")?.body).toEqual({
      profileLinks: ["https://www.instagram.com/some.page/"],
      postLinks: ["https://www.instagram.com/reel/abc/"],
    });
    await expect(page.getByLabel("Profile links (one per line, max 50)")).toHaveValue("");

    // The batch row + stat totals.
    const row = page.getByTestId("bulk-batch-row");
    await expect(row).toContainText("Manual");
    await expect(row).toContainText("2/2");
    await expect(page.getByTestId("bulk-stat-rows-tracked")).toContainText("2");
    await expect(page.getByTestId("bulk-stat-failed")).toContainText("1");

    // Detail modal.
    await row.click();
    const detail = page.getByTestId("bulk-batch-detail");
    await expect(detail).toContainText("Manual paste");
    await expect(page.getByRole("link", { name: "@some.page" })).toHaveAttribute("href", "https://www.instagram.com/some.page/");
    await expect(page.getByText("45.2K")).toBeVisible();
    await expect(page.getByText("broken", { exact: true })).toBeVisible();
    await expect(page.getByText(/Broken links were deleted, made private, or invalid/)).toBeVisible();
    await shot(page, "bulk-track-detail");

    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export Excel" }).click();
    expect((await download).suggestedFilename()).toBe("bulk-track-b1.xlsx");

    await page.getByRole("button", { name: "Delete batch" }).click();
    await expect(page.getByText("Delete this batch?")).toBeVisible();
    await page.getByRole("button", { name: "Confirm" }).click();
    await expect.poll(() => calls.some((c) => c.method === "DELETE" && c.path === "/bulk-track/batches/b1")).toBe(true);
    await expect(page.getByTestId("bulk-batch-detail")).toHaveCount(0);
    await expect(page.getByText("No batches here yet.")).toBeVisible();

    // Posts tab.
    await page.getByRole("tab", { name: "posts" }).click();
    await expect(page.getByText("No posts here yet.")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("the server's error shows under the form", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await mockBulkTrack(page);
    await page.route(`${API_URL}/bulk-track/batches`, (route) =>
      route.request().method() === "POST"
        ? route.fulfill({ status: 400, json: { error: { code: "NO_VALID_LINKS", message: "None of the links you pasted look like valid Instagram profile or post URLs" } } })
        : route.fallback()
    );
    await page.goto("/bulk-track");
    await page.getByLabel("Profile links (one per line, max 50)").fill("https://www.instagram.com/explore/");
    await page.getByRole("button", { name: "Track links" }).click();
    await expect(page.getByText("None of the links you pasted look like valid Instagram profile or post URLs")).toBeVisible();
  });

  test("ADMIN: connect a sheet → it's listed and filters → remove it", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    const calls = await mockBulkTrack(page);
    await page.goto("/bulk-track");

    const card = page.getByTestId("bulk-connect-sheet");
    await card.getByLabel("Google Sheet URL").fill(SHEET.sheetUrl);
    await card.getByRole("button", { name: "Preview columns" }).click();
    // Columns are auto-picked from the header names.
    await expect(card.getByLabel("Profile link column")).toHaveValue("Page link");
    await expect(card.getByLabel("Post link column")).toHaveValue("Post link");
    await expect(card.getByText("1 rows")).toBeVisible();
    await card.getByRole("button", { name: "Connect & import" }).click();
    await expect.poll(() => calls.find((c) => c.method === "POST" && c.path === "/bulk-track/sheet-sources")?.body).toMatchObject({
      sheetUrl: SHEET.sheetUrl,
      profileLinkCol: "Page link",
      postLinkCol: "Post link",
      fetchFollowers: true,
      fetchEngagement: true,
    });

    const list = page.getByTestId("bulk-sheet-sources");
    await expect(list).toContainText("Competitor reels");
    await list.getByTestId("bulk-sheet-source").getByText("Competitor reels").click();
    await expect(page.getByText("Showing:")).toContainText("Competitor reels");

    await list.getByRole("button", { name: "Remove sheet" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Remove everything" }).click();
    await expect(list).toHaveCount(0);
    await expect(page.getByText("Showing:")).toContainText("Manual entries");
  });

  test("ADMIN: Posts tab shows a metric card per post and refreshes them", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    const calls = await mockBulkTrack(page, { posts: [POST] });
    await page.goto("/bulk-track");
    await page.getByRole("tab", { name: "posts" }).click();
    const card = page.getByTestId("bulk-post-card");
    await expect(card).toContainText("reel/xyz/");
    await expect(card).toContainText("1.3L"); // v2 shows Indian compact numbers app-wide
    await expect(card).toContainText("Saves");
    await page.getByRole("button", { name: "Refresh posts" }).click();
    await expect.poll(() => calls.some((c) => c.method === "POST" && c.path.startsWith("/bulk-track/posts/refresh"))).toBe(true);
  });

  test("a CREATOR without the grant has no nav item and is sent away from /bulk-track", async ({ page }) => {
    await signIn(page, "CREATOR");
    await mockApi(page);
    await page.goto("/dashboard");
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Bulk Tracker" })).toHaveCount(0);

    await page.goto("/bulk-track");
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test("a CREATOR an admin granted Bulk Tracker sees it and can open it", async ({ page }) => {
    await signIn(page, "CREATOR", { permissions: { ...userFor("CREATOR").permissions, "bulkTrack.view": true } });
    await mockApi(page);
    await mockBulkTrack(page);

    await page.goto("/dashboard");
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Bulk Tracker", exact: true }).click();
    await expect(page).toHaveURL(/\/bulk-track$/);
    await expect(page.getByRole("heading", { name: "Bulk Tracker" })).toBeVisible();
  });
});

test.describe("Bulk Tracker · phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the screen fits a phone without sideways scroll", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await mockBulkTrack(page, { sheets: [SHEET], posts: [POST] });
    await page.goto("/bulk-track");
    await expect(page.getByRole("heading", { name: "Bulk Tracker" })).toBeVisible();
    await expect(page.getByTestId("bulk-sheet-sources")).toBeVisible();
    await shot(page, "bulk-track-390");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("a granted TEAM_MEMBER gets a Tracker tab in the free slot of the bottom bar", async ({ page }) => {
    await signIn(page, "TEAM_MEMBER", { permissions: { ...userFor("TEAM_MEMBER").permissions, "bulkTrack.view": true } });
    await mockApi(page);
    await mockBulkTrack(page);
    await page.goto("/dashboard");
    // Team members have no Money tab, so the bar has room: Home, Submit, Campaigns, Pages, Tracker.
    const tabs = page.getByRole("navigation", { name: "Main" }).getByRole("link");
    await expect(tabs).toHaveCount(5);
    await tabs.filter({ hasText: "Tracker" }).click();
    await expect(page).toHaveURL(/\/bulk-track$/);
    await expect(page.getByRole("heading", { name: "Bulk Tracker" })).toBeVisible();
  });

  test("a granted CREATOR, whose bar is full, finds Bulk Tracker in the menu", async ({ page }) => {
    await signIn(page, "CREATOR", { permissions: { ...userFor("CREATOR").permissions, "bulkTrack.view": true } });
    await mockApi(page);
    await mockBulkTrack(page);
    await page.goto("/dashboard");
    const bar = page.getByRole("navigation", { name: "Main" });
    await expect(bar.getByRole("link")).toHaveCount(5);
    await expect(bar.getByRole("link", { name: "Tracker" })).toHaveCount(0);
    await page.getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("dialog").getByRole("link", { name: "Bulk Tracker" }).click();
    await expect(page).toHaveURL(/\/bulk-track$/);
  });
});
