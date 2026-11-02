import { expect, test, type Page } from "@playwright/test";

import { API_URL, fillRequiredRates, mockApi, shot, signIn, type MockRole, addRate } from "./fixtures";

/** Creators (v1 Inventory): pages, vendors, approvals, page panel edits, Add page. API fully mocked. */

const now = new Date().toISOString();
const RIYA = { id: "v-riya", name: "Riya Mehta", phoneNumber: null, email: "riya@example.com" };
const DEV = { id: "v-dev", name: "Dev Sharma", phoneNumber: null, email: "dev@example.com" };
const eng = (views: number | null, manual?: Record<string, true>) => ({ avgLikes: 2100, avgComments: 90, avgViews: views, sampleSize: 12, ...(manual ? { manual } : {}) });
const asset = (id: string, handle: string, owner: typeof RIYA, followers: number, extra: Record<string, unknown> = {}) => ({
  id,
  ownerId: owner.id,
  owner,
  platform: "instagram",
  handle,
  fullName: null,
  followers,
  category: "Food",
  approvalStatus: "approved",
  createdAt: now,
  rateCards: [{ id: `${id}-r`, assetId: id, format: "reel", amount: "32000" }],
  engagement: eng(41200),
  lastScrapedAt: now,
  lastScrapeError: null,
  scrapeQueuedAt: null,
  campaigns: [{ id: "c1", title: "Diwali Food Stories", brandName: "Saffron Street" }],
  ...extra,
});
const ASSETS = [
  asset("a1", "riya.eats", RIYA, 482000),
  asset("a2", "riyatravels", RIYA, 310000, { category: "Travel", campaigns: [] }),
  asset("a3", "desi.memes", DEV, 1200000, { category: "Meme page", engagement: eng(240000) }),
  asset("a4", "arjun.fits", DEV, 265000, { category: "Fitness", approvalStatus: "pending", rateCards: [], campaigns: [], createdBy: { id: "pm1", name: "Priya Planner", role: "PLAN_MAKER" } }),
];

async function creatorsApi(page: Page, opts: { createStatus?: number; createError?: { code: string; message: string }; assets?: unknown[] } = {}) {
  const calls = { active: [] as unknown[], rate: [] as unknown[], details: [] as unknown[], approval: [] as unknown[], refresh: [] as unknown[], created: [] as unknown[], signup: [] as unknown[], bulkDelete: [] as unknown[], requested: new Set<string>() };
  await mockApi(page);
  page.on("request", (req) => {
    if (req.url().startsWith(API_URL)) calls.requested.add(new URL(req.url()).pathname.replace(/^\/api/, ""));
  });
  await page.route(`${API_URL}/assets**`, (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(/^\/api\/assets/, "");
    const m = req.method();
    if (m === "GET" && path === "") return route.fulfill({ json: opts.assets ?? ASSETS });
    if (m === "GET" && path === "/owners") return route.fulfill({ json: [RIYA, DEV] });
    if (m === "GET" && path.endsWith("/profile-pic")) return route.fulfill({ status: 404, body: "" });
    if (m === "PUT" && path.endsWith("/rate-card")) {
      calls.rate.push({ id: path.split("/")[1], ...req.postDataJSON() });
      return route.fulfill({ json: [] });
    }
    if (m === "PUT" && path.endsWith("/details")) {
      calls.details.push({ id: path.split("/")[1], ...req.postDataJSON() });
      return route.fulfill({ json: ASSETS[0] });
    }
    if (m === "PUT" && path.endsWith("/active")) {
      calls.active.push({ id: path.split("/")[1], ...req.postDataJSON() });
      return route.fulfill({ json: {} });
    }
    if (m === "PUT" && path.endsWith("/approval")) {
      calls.approval.push({ id: path.split("/")[1], ...req.postDataJSON() });
      return route.fulfill({ json: {} });
    }
    if (m === "POST" && path === "/refresh-profiles") {
      calls.refresh.push(req.postDataJSON());
      return route.fulfill({ json: { queued: req.postDataJSON().assetIds.length } });
    }
    if (m === "POST" && path === "/bulk-delete") {
      const { assetIds } = req.postDataJSON() as { assetIds: string[] };
      calls.bulkDelete.push({ assetIds });
      // desi.memes has posts on record, so the server keeps it.
      return route.fulfill({ json: { deleted: assetIds.filter((id) => id !== "a3"), skipped: assetIds.filter((id) => id === "a3").map((id) => ({ id, reason: "ASSET_IN_USE" })) } });
    }
    if (m === "POST" && path === "") {
      const body = req.postDataJSON();
      calls.created.push(body);
      if (opts.createError) return route.fulfill({ status: 400, json: { error: opts.createError } });
      if (opts.createStatus) return route.fulfill({ status: opts.createStatus, json: { error: { code: "ASSET_ALREADY_EXISTS", message: `@${body.handle} is already registered under another account.` } } });
      return route.fulfill({ status: 201, json: { ...asset("a9", body.handle, RIYA, 0), approvalStatus: "approved" } });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  await page.route(`${API_URL}/auth/signup`, (route) => {
    calls.signup.push(route.request().postDataJSON());
    return route.fulfill({ status: 201, json: { user: { id: "v-new", name: "Kabir Malhotra", email: "kabir@example.com", role: "CREATOR" }, generatedPassword: "Tg-7xQ2-pL9m" } });
  });
  return calls;
}

test.describe("Creators", () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test("inventory keeps vendor names and complete rate summaries horizontal at narrow widths", async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 900 });
    await signIn(page, "ADMIN");
    await creatorsApi(page, { assets: [asset("a1", "riya.eats", { ...RIYA, name: "Test Creator Two With A Long Name" }, 482000, {
      rateCards: [{ format: "reel", amount: "25000" }, { format: "story", amount: "5000" }],
    })] });
    await page.goto("/creators");
    const row = page.getByRole("row", { name: /riya.eats/ });
    await expect(row.getByRole("cell", { name: "Test Creator Two With A Long Name", exact: true })).toHaveCSS("white-space", "nowrap");
    const rate = row.locator(".inventory-rate");
    await expect(rate).toHaveText(/Reel\s*₹25,000\s*\+1 more/);
    await expect(rate).toHaveCSS("flex-wrap", "nowrap");
    await expect(row.getByRole("cell", { name: /Reel.*₹25,000/ })).toHaveAttribute("title", /Story: ₹5,000/);
  });

  test("page details prioritize audience values and keep rates in labelled rows", async ({ page }) => {
    await signIn(page, "ADMIN");
    await creatorsApi(page);
    await page.goto("/creators");
    await page.getByRole("button", { name: "View riya.eats", exact: true }).click();
    const panel = page.getByRole("dialog");
    await expect(panel.getByRole("region", { name: "Audience & engagement" })).toBeVisible();
    const values = panel.locator(".detail-metrics dd");
    await expect(values.nth(0)).toContainText("4,82,000");
    await expect(values.nth(0)).toHaveCSS("font-size", "32px");
    await expect(values.nth(2)).toHaveCSS("font-size", "16px");
    await expect(panel.getByRole("region", { name: "Rates", exact: true }).locator(".detail-key-value").filter({ hasText: "Reel" }).first()).toContainText("₹32,000");
    await expect(panel.getByRole("switch", { name: "Available for new plans", exact: true })).toBeChecked();
  });

  test("admin: pages list with search, the page panel, and edits that hit the right routes", async ({ page }) => {
    await signIn(page, "ADMIN");
    const calls = await creatorsApi(page);
    await page.goto("/creators");
    await expect(page.getByRole("tab", { name: "Pages (4)" })).toBeVisible();
    // Biggest audience first.
    await expect(page.getByRole("row").nth(1)).toContainText("desi.memes");
    await page.getByRole("searchbox", { name: "Search creators" }).fill("riya");
    await expect(page.getByRole("row")).toHaveCount(3); // header + Riya's two pages
    await shot(page, "creators-pages");

    // The view icon (1 Nov) opens the same panel as the handle; every format is listed, "—" where there's no rate.
    await page.getByRole("button", { name: "View riya.eats" }).click();
    const panel = page.getByRole("dialog");
    await expect(panel.getByRole("link", { name: /Diwali Food Stories/ })).toHaveAttribute("href", "/campaigns/c1");
    await expect(panel.getByText("Added by")).toBeVisible();
    await expect(panel.getByText("Before tracking")).toBeVisible();
    await expect(panel.getByRole("region", { name: "Rates" }).getByText("PR", { exact: true })).toBeVisible();
    await panel.getByRole("button", { name: "Edit details" }).click();
    // A saved rate is a line that can be changed but not removed (the server only upserts); a ₹0 amount is refused.
    await expect(panel.getByRole("button", { name: "Remove Reel rate" })).toHaveCount(0);
    await panel.getByLabel("Reel", { exact: true }).fill("0");
    await expect(panel.getByText("A rate can't be ₹0.")).toBeVisible();
    await expect(panel.getByRole("button", { name: "Save" })).toBeDisabled();
    // Rates are edited on their lines or added one format at a time; every rate is optional (16 Oct).
    await panel.getByLabel("Reel", { exact: true }).fill("35000");
    await panel.getByLabel("Story", { exact: true }).fill("9000");
    await panel.getByLabel("Static / Carousel", { exact: true }).fill("15000");
    await addRate(panel, "Political reel", "40000");
    await addRate(panel, "Reel + Story", "38000");
    await expect(panel.getByText("Every rate is optional.", { exact: false })).toBeVisible();
    await panel.getByLabel("Avg views").fill("50000");
    await panel.getByLabel("Category").fill("Food & recipes");
    await panel.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Page updated.")).toBeVisible();
    expect(calls.rate).toEqual([
      {
        id: "a1",
        rateCards: [
          { format: "reel", amount: 35000 },
          { format: "story", amount: 9000 },
          { format: "post", amount: 15000 },
          { format: "political_reel", amount: 40000 },
          { format: "reel_story", amount: 38000 },
        ],
      },
    ]);
    expect(calls.details).toEqual([{ id: "a1", category: "Food & recipes", avgViews: 50000, avgLikes: null, avgComments: null }]);
  });

  test("admin: approve a waiting page inline; refresh selected pages in bulk", async ({ page }) => {
    await signIn(page, "ADMIN");
    const calls = await creatorsApi(page);
    await page.goto("/creators");
    await page.getByRole("tab", { name: "Waiting for approval (1)" }).click();
    await expect(page.getByRole("row")).toHaveCount(2);
    // A waiting page can be opened too (1 Nov), and says who added it.
    await page.getByRole("button", { name: "View arjun.fits" }).click();
    await expect(page.getByRole("dialog").getByText("Priya Planner · Plan maker")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(page.getByText("arjun.fits approved.")).toBeVisible();
    expect(calls.approval).toEqual([{ id: "a4", approvalStatus: "approved" }]);

    await page.getByRole("tab", { name: "Pages (4)" }).click();
    await page.getByRole("checkbox", { name: "Select riya.eats" }).click();
    await page.getByRole("checkbox", { name: "Select desi.memes" }).click();
    await page.getByRole("button", { name: "Refresh from Instagram" }).click();
    await expect(page.getByText("Fetching 2 pages from Instagram.")).toBeVisible();
    expect(calls.refresh).toEqual([{ assetIds: ["a3", "a1"] }]);
  });

  test("a page that failed the Instagram check shows Not on Instagram in the list and its panel (17 Oct)", async ({ page }) => {
    await signIn(page, "ADMIN");
    await creatorsApi(page, { assets: [asset("a1", "riya.eats", RIYA, 482000, { profileBroken: true, lastScrapeError: "Profile not found" }), ASSETS[2]] });
    await page.goto("/creators");
    const row = page.getByRole("row").filter({ hasText: "riya.eats" });
    await expect(row.getByText("Not on Instagram")).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: "desi.memes" }).getByText("Not on Instagram")).toHaveCount(0);
    await shot(page, "creators-not-on-instagram");
    await page.getByRole("button", { name: /riya\.eats/ }).click();
    await expect(page.getByRole("dialog").getByText("Not on Instagram")).toBeVisible();
  });

  test("admin removes selected pages in bulk; a page the server keeps stays selected (19 Oct)", async ({ page }) => {
    await signIn(page, "ADMIN");
    const calls = await creatorsApi(page);
    await page.goto("/creators");
    await page.getByRole("checkbox", { name: "Select riya.eats" }).click();
    await page.getByRole("checkbox", { name: "Select desi.memes" }).click();
    await page.getByTestId("selection-bar").getByRole("button", { name: "Remove (2)" }).click();
    const confirm = page.getByRole("dialog");
    await expect(confirm.getByRole("heading", { name: "Remove 2 pages?" })).toBeVisible();
    await shot(page, "creators-bulk-remove-confirm");
    // Backing out sends nothing.
    await confirm.getByRole("button", { name: "Keep them" }).click();
    expect(calls.bulkDelete).toHaveLength(0);
    await page.getByTestId("selection-bar").getByRole("button", { name: "Remove (2)" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Remove 2 pages" }).click();
    await expect.poll(() => calls.bulkDelete).toEqual([{ assetIds: expect.arrayContaining(["a1", "a3"]) }]);
    await expect(page.getByText("1 page removed. 1 page couldn't be", { exact: false })).toBeVisible();
    await expect(page.getByTestId("selection-bar")).toContainText("1 of 4 selected");
    await expect(page.getByRole("checkbox", { name: "Select desi.memes" })).toBeChecked();
    await shot(page, "creators-bulk-remove-result");
  });

  test("bulk Remove is admin-only: a planner who can tick pages for a plan gets no Remove", async ({ page }) => {
    await signIn(page, "PLAN_MAKER");
    await creatorsApi(page);
    await page.goto("/creators");
    await page.getByRole("checkbox", { name: "Select riya.eats" }).click();
    await expect(page.getByTestId("selection-bar").getByRole("button", { name: /Create plan/ })).toBeVisible();
    await expect(page.getByTestId("selection-bar").getByRole("button", { name: /^Remove/ })).toHaveCount(0);
  });

  test("vendors tab groups pages by who gets paid and links to their payouts", async ({ page }) => {
    await signIn(page, "ADMIN");
    await creatorsApi(page);
    await page.goto("/creators?tab=vendors");
    await expect(page.getByRole("tab", { name: "Vendors (2)" })).toHaveAttribute("data-state", "active");
    const riya = page.getByRole("row", { name: /Riya Mehta/ });
    await expect(riya.getByRole("button", { name: "Open riya.eats" })).toBeVisible();
    await expect(riya.getByRole("button", { name: "Open riyatravels" })).toBeVisible();
    await expect(riya.getByRole("cell", { name: "792K" })).toBeVisible();
    await expect(riya.getByRole("link", { name: "Payouts" })).toHaveAttribute("href", "/finance/payouts/v-riya");
    await expect(page.getByRole("row", { name: /Dev Sharma/ }).getByText("1 page waiting")).toBeVisible();
    await shot(page, "creators-vendors");
  });

  test("vendors tab shows up to 3 page photos then +N, and a photo opens that page (design-fix #1)", async ({ page }) => {
    await signIn(page, "ADMIN");
    const many = ["one", "two", "three", "four", "five"].map((n, i) => asset(`m${i}`, `riya.${n}`, RIYA, 100000 - i));
    await creatorsApi(page, { assets: many });
    await page.goto("/creators?tab=vendors");
    const riya = page.getByRole("row", { name: /Riya Mehta/ });
    await expect(riya.getByRole("button", { name: /^Open riya\./ })).toHaveCount(3);
    await expect(riya.getByText("+2")).toBeVisible();
    // Handles read without "@" and pages show their photo, not the Instagram logo (design-fix #3).
    await expect(riya.getByRole("img", { name: "Instagram" })).toHaveCount(0);
    await riya.getByRole("button", { name: "Open riya.two" }).click();
    await expect(page.getByRole("dialog").getByText("riya.two", { exact: true })).toBeVisible();
  });

  test("admin adds a page under an existing creator: rates are added one format at a time and none is required (16 Oct)", async ({ page }) => {
    await signIn(page, "ADMIN");
    const calls = await creatorsApi(page);
    await page.goto("/creators");
    await page.getByRole("button", { name: "Add page" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Add page" }).click();
    await expect(dialog.getByText("Pick the creator this page belongs to.")).toBeVisible();
    await dialog.getByRole("searchbox", { name: "Find a creator" }).fill("riya");
    await dialog.getByRole("button", { name: /Riya Mehta/ }).click();
    await dialog.getByLabel("Instagram handle or link").fill("https://www.instagram.com/Riya.Bakes/");
    await expect(dialog.getByText("No rates yet. Pick a format below to add one.")).toBeVisible();
    await addRate(dialog, "Reel", "20000");
    await expect(dialog.getByLabel("Reel", { exact: true })).toHaveValue("20000");
    // An added line can be removed again before saving; a format already priced leaves the select.
    await addRate(dialog, "Repost", "1000");
    await dialog.getByRole("button", { name: "Remove Repost rate" }).click();
    await expect(dialog.getByLabel("Repost", { exact: true })).toHaveCount(0);
    await addRate(dialog, "Story", "8000");
    await addRate(dialog, "Static / Carousel", "12000");
    await addRate(dialog, "Reel + Story", "25000");
    await shot(page, "add-page-rates");
    await dialog.getByRole("button", { name: "Add page" }).click();
    await expect(page.getByText("riya.bakes added.")).toBeVisible();
    expect(calls.created).toEqual([
      {
        handle: "riya.bakes",
        platform: "instagram",
        ownerId: "v-riya",
        rateCards: [
          { format: "reel", amount: 20000 },
          { format: "story", amount: 8000 },
          { format: "post", amount: 12000 },
          { format: "reel_story", amount: 25000 },
        ],
      },
    ]);
    expect(calls.signup).toEqual([]);
  });

  test("admin: a page can be added with no rates at all, and a server refusal is shown in its own words", async ({ page }) => {
    await signIn(page, "ADMIN");
    await creatorsApi(page, { createError: { code: "ASSET_ALREADY_EXISTS", message: "@riya.bakes is already in Inventory." } });
    await page.goto("/creators");
    await page.getByRole("button", { name: "Add page" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: /Riya Mehta/ }).click();
    await dialog.getByLabel("Instagram handle or link").fill("riya.bakes");
    await dialog.getByRole("button", { name: "Add page" }).click();
    await expect(dialog.getByRole("alert")).toHaveText("@riya.bakes is already in Inventory.");
  });

  test("planner onboards a new vendor: login + page in one go, password shown once, no rates", async ({ page }) => {
    await signIn(page, "PLAN_MAKER");
    const calls = await creatorsApi(page);
    await page.goto("/creators");
    // Planners tick pages to start a plan; without inventory.edit there's no bulk Instagram refresh.
    await page.getByRole("checkbox", { name: "Select riya.eats" }).click();
    await expect(page.getByRole("button", { name: "Create plan (1)" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Refresh from Instagram" })).toHaveCount(0);
    await page.getByRole("button", { name: "Clear" }).click();
    await page.getByRole("button", { name: "Add page" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("radio", { name: "New creator" }).click();
    await expect(dialog.getByLabel("Reel", { exact: true })).toHaveCount(0);
    await expect(dialog.getByText("The page waits for an admin to set its rates and approve it.")).toBeVisible();
    await dialog.getByLabel(/Name/).fill("Kabir Malhotra");
    await dialog.getByLabel("Email (their login)").fill("kabir@example.com");
    await dialog.getByLabel("Instagram handle or link").fill("@kabir.shorts");
    await dialog.getByRole("button", { name: "Add page" }).click();
    await expect(dialog.getByTestId("generated-password")).toHaveText("Tg-7xQ2-pL9m");
    expect(calls.signup).toEqual([{ email: "kabir@example.com", name: "Kabir Malhotra", role: "CREATOR" }]);
    expect(calls.created).toEqual([{ handle: "kabir.shorts", platform: "instagram", ownerId: "v-new" }]);
  });

  test("a post or reel link isn't taken as a handle", async ({ page }) => {
    await signIn(page, "ADMIN");
    const calls = await creatorsApi(page);
    await page.goto("/creators");
    await page.getByRole("button", { name: "Add page" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: /Riya Mehta/ }).click();
    await fillRequiredRates(dialog);
    await dialog.getByLabel("Instagram handle or link").fill("https://www.instagram.com/reel/C9xYz12/");
    await dialog.getByRole("button", { name: "Add page" }).click();
    await expect(dialog.getByText("That isn't an Instagram handle or profile link.")).toBeVisible();
    await dialog.getByLabel("Instagram handle or link").fill("instagram.com/stories/riya.bakes/123");
    await dialog.getByRole("button", { name: "Add page" }).click();
    await expect(page.getByText("riya.bakes added.")).toBeVisible();
    expect(calls.created).toHaveLength(1);
  });

  test("a new login whose page fails keeps its password, asks before closing, and a retry makes no second account", async ({ page }) => {
    await signIn(page, "ADMIN");
    const calls = await creatorsApi(page, { createStatus: 409 });
    await page.goto("/creators");
    await page.getByRole("button", { name: "Add page" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("radio", { name: "New creator" }).click();
    await dialog.getByLabel("Email (their login)").fill("kabir@example.com");
    await dialog.getByLabel("Instagram handle or link").fill("@kabir.shorts");
    await fillRequiredRates(dialog);
    await dialog.getByRole("button", { name: "Add page" }).click();
    await expect(dialog.getByText("@kabir.shorts is already registered under another account.")).toBeVisible();
    await expect(dialog.getByText("Tg-7xQ2-pL9m")).toBeVisible();
    // Closing asks first and shows the password again.
    await page.keyboard.press("Escape");
    await expect(dialog.getByRole("heading", { name: "Close without the page?" })).toBeVisible();
    await dialog.getByRole("button", { name: "Keep adding" }).click();
    await dialog.getByLabel("Instagram handle or link").fill("@kabir.clips");
    await fillRequiredRates(dialog);
    await dialog.getByRole("button", { name: "Add page" }).click();
    await expect(dialog.getByText("@kabir.clips is already registered")).toBeVisible();
    expect(calls.signup).toHaveLength(1);
    expect(calls.created.map((c) => (c as { ownerId: string }).ownerId)).toEqual(["v-new", "v-new"]);
  });

  test("a restricted admin without inventory.edit gets no Add page and no owners call", async ({ page }) => {
    await signIn(page, "ADMIN", { permissions: { ...Object.fromEntries(["users", "campaigns", "inventory", "links", "finance", "plans"].flatMap((s) => ["view", "edit", "approve", "pay"].map((a) => [`${s}.${a}`, true]))), "inventory.edit": false } });
    const calls = await creatorsApi(page);
    await page.goto("/creators");
    await expect(page.getByRole("tab", { name: "Pages (4)" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add page" })).toHaveCount(0);
    // Still plans.edit, so pages can be ticked for a plan, but not refreshed in bulk.
    await page.getByRole("checkbox", { name: "Select riya.eats" }).click();
    await expect(page.getByRole("button", { name: "Refresh from Instagram" })).toHaveCount(0);
    expect(calls.requested.has("/assets/owners")).toBe(false);
  });

  test("a planner whose own Add pages switch is off gets no Add page", async ({ page }) => {
    await signIn(page, "PLAN_MAKER", { ownAccess: { "inventory.edit": false } });
    await creatorsApi(page);
    await page.goto("/creators");
    await expect(page.getByRole("tab", { name: "Pages (4)" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add page" })).toHaveCount(0);
  });

  test("finance: read-only — no add, select, edit or approve", async ({ page }) => {
    await signIn(page, "FINANCE");
    await creatorsApi(page);
    await page.goto("/creators");
    await expect(page.getByRole("tab", { name: "Pages (4)" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add page" })).toHaveCount(0);
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    await page.getByRole("tab", { name: /Waiting/ }).click();
    await expect(page.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: /arjun\.fits/ }).click();
    await expect(page.getByRole("dialog").getByRole("button", { name: "Edit details" })).toHaveCount(0);
  });

  for (const role of ["CREATOR", "TEAM_MEMBER"] as MockRole[]) {
    test(`${role} can't open Inventory and it isn't in their nav`, async ({ page }) => {
      await signIn(page, role);
      const calls = await creatorsApi(page);
      await page.goto("/creators");
      await expect(page.getByText(/don.t have access to Inventory/)).toBeVisible();
      await expect(page.getByRole("link", { name: "Inventory" })).toHaveCount(0);
      expect([...calls.requested].some((p) => p === "/assets/owners")).toBe(false);
    });
  }

  test("admin marks a page inactive from its panel; an inactive page shows it in the list (8 Oct)", async ({ page }) => {
    await signIn(page, "ADMIN");
    const calls = await creatorsApi(page, { assets: [...ASSETS.slice(0, 2), asset("a3", "desi.memes", DEV, 1200000, { isActive: false })] });
    await page.goto("/creators");
    await expect(page.getByRole("row", { name: /desi\.memes/ }).getByText("Inactive")).toBeVisible();
    await page.getByRole("button", { name: /riya\.eats/ }).click();
    const panel = page.getByRole("dialog");
    await expect(panel.getByRole("switch", { name: "Available for new plans" })).toBeChecked();
    await panel.getByRole("switch", { name: "Available for new plans" }).click();
    await expect(page.getByText("riya.eats is inactive.")).toBeVisible();
    expect(calls.active).toEqual([{ id: "a1", isActive: false }]);
  });

  test("only an admin gets the Active switch: finance and a planner don't", async ({ page }) => {
    for (const role of ["FINANCE", "PLAN_MAKER"] as MockRole[]) {
      await signIn(page, role);
      await creatorsApi(page);
      await page.goto("/creators");
      await page.getByRole("button", { name: /riya\.eats/ }).first().click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await expect(page.getByRole("dialog").getByRole("switch", { name: "Available for new plans" })).toHaveCount(0);
      await page.keyboard.press("Escape");
    }
  });
});
