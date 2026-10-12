import { test, expect, type Page } from "@playwright/test";

import { signIn, mockApi, userFor, API_URL } from "./fixtures";

/**
 * Bulk Tracker (12 Oct) — replaced "Job runs" in the sidebar. The page is
 * gated on the opt-in `bulkTrack.view` key (ADMIN by default, any other
 * account once granted). API calls are mocked; the server's own tests
 * (server/src/modules/bulkTrack/*.test.js) cover scraping, scoping and the
 * 403s.
 */
const BATCH = {
  id: "b1",
  sourceType: "manual",
  sheetSourceId: null,
  status: "done",
  totalCount: 2,
  successCount: 1,
  failedCount: 1,
  createdAt: new Date().toISOString(),
  sheetSource: null,
};
const DETAIL = {
  batch: BATCH,
  profiles: [{ id: "pr1", username: "some.page", profileUrl: "https://www.instagram.com/some.page/", category: null, status: "done", failureReason: null, followers: 45200 }],
  posts: [
    { id: "po1", permalink: "https://www.instagram.com/reel/abc/", status: "broken", postType: null, failureReason: "Broken link: deleted", views: null, likes: null, comments: null, shares: null, reposts: null, saves: null },
  ],
};

async function mockBulkTrack(page: Page) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  let batches: (typeof BATCH)[] = [];
  await page.route(`${API_URL}/bulk-track/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace("/api", "");
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
    if (path === "/bulk-track/sheet-sources") return route.fulfill({ json: { sources: [], total: 0 } });
    if (path === "/bulk-track/posts") return route.fulfill({ json: [] });
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

    const track = page.getByRole("button", { name: "Track links" });
    await expect(track).toBeDisabled();
    await page.getByLabel("Profile links (one per line, max 50)").fill("https://www.instagram.com/some.page/\n\n");
    await page.getByLabel("Post / reel links (one per line, max 50)").fill("https://www.instagram.com/reel/abc/");
    await track.click();

    const create = calls.find((c) => c.method === "POST" && c.path === "/bulk-track/batches");
    expect(create?.body).toEqual({ profileLinks: ["https://www.instagram.com/some.page/"], postLinks: ["https://www.instagram.com/reel/abc/"] });
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

    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export Excel" }).click();
    expect((await download).suggestedFilename()).toBe("bulk-track-b1.xlsx");

    await page.getByRole("button", { name: "Delete batch" }).click();
    await expect(page.getByText("Delete this batch?")).toBeVisible();
    await page.getByRole("button", { name: "Confirm" }).click();
    expect(calls.some((c) => c.method === "DELETE" && c.path === "/bulk-track/batches/b1")).toBe(true);
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

  test("a CREATOR without the grant has no nav item and is sent away from /bulk-track", async ({ page }) => {
    await signIn(page, "CREATOR");
    await mockApi(page);
    await page.goto("/dashboard");
    await expect(page.getByRole("complementary").getByRole("link", { name: "Bulk Tracker" })).toHaveCount(0);

    await page.goto("/bulk-track");
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test("a CREATOR an admin granted Bulk Tracker sees it and can open it", async ({ page }) => {
    const granted = { ...userFor("CREATOR"), permissions: { ...userFor("CREATOR").permissions, "bulkTrack.view": true } };
    await page.addInitScript((session) => window.localStorage.setItem("taggify_auth", JSON.stringify(session)), {
      user: granted,
      accessToken: "test-access-token",
      refreshToken: "test-refresh-token",
    });
    await mockApi(page);
    await page.route(`${API_URL}/users/me`, (route) => route.fulfill({ json: granted }));
    await mockBulkTrack(page);

    await page.goto("/dashboard");
    await page.getByRole("complementary").getByRole("link", { name: "Bulk Tracker", exact: true }).click();
    await expect(page).toHaveURL(/\/bulk-track$/);
    await expect(page.getByRole("heading", { name: "Bulk Tracker" })).toBeVisible();
  });
});

test.describe("People → access editor offers Bulk Tracker to every role", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("Add user: Bulk Tracker is off by default for a Creator and Finance, and a grant is sent", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    let signupBody: Record<string, unknown> | null = null;
    await page.route(`${API_URL}/auth/signup`, (route) => {
      signupBody = route.request().postDataJSON();
      return route.fulfill({ status: 201, json: { user: { ...userFor("CREATOR"), id: "new-1", email: "new@test.local" }, password: "pw" } });
    });
    await page.goto("/users");
    await page.getByRole("button", { name: "Add user" }).click();

    // Default role is Creator.
    await expect(page.getByTestId("access-section-bulkTrack")).toContainText("Bulk Tracker");
    const bulk = page.getByLabel("Bulk Tracker access");
    await expect(bulk).not.toBeChecked();

    await page.getByRole("combobox").selectOption("FINANCE");
    await expect(page.getByLabel("Bulk Tracker access")).not.toBeChecked();
    await page.getByRole("combobox").selectOption("CREATOR");

    await page.getByLabel("Bulk Tracker access").check();
    await page.getByLabel(/^Email/).fill("new@test.local");
    await page.getByPlaceholder(/handle|username/i).first().fill("newpage");
    await page.getByRole("button", { name: /^Create/ }).click();
    await expect.poll(() => signupBody).not.toBeNull();
    expect((signupBody as unknown as { permissions: Record<string, boolean> }).permissions["bulkTrack.view"]).toBe(true);
  });
});
