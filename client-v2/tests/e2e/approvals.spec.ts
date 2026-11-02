import { expect, test, type Page } from "@playwright/test";

import { API_URL, mockApi, shot, signIn, userFor } from "./fixtures";

/** Approvals inbox: kinds per permission, reject with reason, Approve & next. API fully mocked. */

const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const link = (id: string, caption: string, status: string, hoursAgo: number) => ({
  id,
  campaignId: "c1",
  assetId: "a1",
  submittedById: "o1",
  url: `https://instagram.com/p/${id}`,
  format: "reel",
  cost: "32000",
  customRate: false,
  status,
  postedAt: ago(hoursAgo),
  createdAt: ago(hoursAgo),
  campaign: { id: "c1", title: "Diwali Food Stories", brandName: "Saffron Street" },
  asset: { id: "a1", handle: "desi.memes", platform: "instagram", followers: 1200000, owner: { id: "o1", name: "Dev Sharma" } },
  screenshot: { id: `s${id}`, publicId: "x", approved: null, url: "https://example.com/proof.png" },
  postSnapshots: [{ likeCount: 2140, commentsCount: 96, videoViews: 41200, capturedAt: ago(1), caption, thumbnailUrl: null }],
});

async function approvalsApi(page: Page) {
  const calls = { reviews: [] as Record<string, unknown>[], insights: [] as string[], billing: [] as Record<string, unknown>[], bulk: [] as Record<string, unknown>[], requested: new Set<string>() };
  await mockApi(page);
  await page.route(`${API_URL}/links**`, (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(/^\/api\/links/, "");
    calls.requested.add("links");
    if (req.method() === "GET") return route.fulfill({ json: { items: [link("l1", "Diwali Thali Hacks", "PENDING_SCREENSHOT_REVIEW", 50), link("l2", "Goa Budget Tips", "INSIGHTS_PENDING", 5)], total: new URL(req.url()).searchParams.get("status")?.includes(",") ? 2 : 1, page: 1, pageSize: 100 } });
    const review = path.match(/^\/([^/]+)\/review-screenshot$/);
    if (review) {
      calls.reviews.push({ id: review[1], ...req.postDataJSON() });
      return route.fulfill({ json: {} });
    }
    const ins = path.match(/^\/([^/]+)\/approve-insights$/);
    if (ins) {
      calls.insights.push(ins[1]);
      return route.fulfill({ json: {} });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  await page.route(`${API_URL}/plans`, (route) => {
    calls.requested.add("plans");
    return route.fulfill({ json: [] });
  });
  // Three waiting pages: two added by one planner (1 Nov grouping), one from before the adder was recorded.
  const PRIYA = { id: "pm1", name: "Priya Planner", role: "PLAN_MAKER" };
  const pending = (id: string, handle: string, hoursAgo: number, createdBy: typeof PRIYA | null) => ({ id, ownerId: "o9", platform: "instagram", handle, followers: 265000, category: "Fitness", approvalStatus: "pending", createdAt: ago(hoursAgo), rateCards: [], engagement: {}, owner: { name: "Arjun Nair" }, createdBy });
  await page.route(`${API_URL}/assets`, (route) => {
    calls.requested.add("assets");
    return route.fulfill({ json: [pending("a9", "arjun.fits", 20, PRIYA), pending("a10", "arjun.eats", 18, PRIYA), pending("a11", "old.page", 15, null)] });
  });
  await page.route(`${API_URL}/assets/bulk-approval`, (route) => {
    const body = route.request().postDataJSON();
    calls.bulk.push(body);
    return route.fulfill({ json: { updated: body.assetIds, skipped: [] } });
  });
  await page.route(`${API_URL}/campaigns`, (route) => route.fulfill({ json: [] }));
  await page.route(`${API_URL}/billing-profiles**`, (route) => {
    const req = route.request();
    calls.requested.add("billing");
    if (req.method() === "PUT") {
      calls.billing.push({ url: req.url(), ...req.postDataJSON() });
      return route.fulfill({ json: {} });
    }
    return route.fulfill({ json: [{ id: "b1", userId: "u1", pan: "ABCPM4567K", name: "KABIR MALHOTRA", gstin: null, msme: null, bankAccountNumber: "80400078903333", ifscCode: "UTIB0004040", approvalStatus: "pending", createdAt: ago(30), user: { id: "u1", name: "Kabir Malhotra", phoneNumber: null, email: "kabir@example.com" } }] });
  });
  return calls;
}

test.describe("Approvals", () => {
  test.use({ viewport: { width: 1536, height: 1000 } });

  test("admin: Approvals opens on category cards; a rejected proof needs a reason; Approve & next moves on", async ({ page }) => {
    await signIn(page, "ADMIN");
    const calls = await approvalsApi(page);
    await page.goto("/approvals");
    const cards = page.getByRole("list", { name: "Approval categories" });
    await expect(cards.getByRole("link", { name: /Posts/ })).toContainText("2 waiting");
    await expect(cards.getByRole("link", { name: /Inventory/ })).toContainText("3 waiting");
    await expect(cards.getByRole("link", { name: /Users/ })).toContainText("1 waiting");
    await expect(cards.getByRole("link", { name: /Plans/ })).toContainText("All clear");
    await shot(page, "approvals-categories");

    await cards.getByRole("link", { name: /Posts/ }).click();
    const queue = page.getByRole("list", { name: "Queue" });
    await expect(queue.getByRole("button")).toHaveCount(2); // proof, insights
    // Oldest first: the proof (50h) is selected.
    await expect(page.getByRole("heading", { name: "Diwali Thali Hacks" })).toBeVisible();
    // The mocked screenshot URL doesn't resolve, so the fallback shows with a direct link.
    await expect(page.getByRole("link", { name: "Open it directly" })).toHaveAttribute("href", "https://example.com/proof.png");
    await shot(page, "approvals");

    await page.getByRole("button", { name: "Reject…" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: "Reject" })).toBeDisabled();
    await dialog.getByLabel("Reason for the creator").fill("Screenshot is cut off");
    await dialog.getByRole("button", { name: "Reject" }).click();
    await expect.poll(() => calls.reviews).toEqual([{ id: "l1", approved: false, note: "Screenshot is cut off" }]);

    // Moved on to the next item.
    await expect(page.getByRole("heading", { name: "Goa Budget Tips" })).toBeVisible();
    await page.getByRole("radio", { name: /Insights/ }).click();
    await expect(page.getByText("41,200")).toBeVisible();
    await expect(page.getByRole("button", { name: "Reject…" })).toHaveCount(0);
    await page.getByRole("button", { name: "Approve & next" }).click();
    await expect.poll(() => calls.insights).toEqual(["l2"]);

    // Back up to the cards.
    await page.getByRole("link", { name: "Back to Approvals" }).click();
    await expect(page.getByRole("list", { name: "Approval categories" })).toBeVisible();
  });

  // 16 Oct: no rate is mandatory. A page with no rates shows "None yet (optional)" and can be approved; the card still opens the page editor.
  test("admin: a page with no rates can be approved; the card says rates are optional and opens the page to edit", async ({ page }) => {
    await signIn(page, "ADMIN");
    await approvalsApi(page);
    const approvals: string[] = [];
    await page.route(`${API_URL}/assets/*/approval`, (route) => {
      approvals.push(route.request().url());
      return route.fulfill({ json: { id: "a-arjun", approvalStatus: "approved" } });
    });
    await page.route(`${API_URL}/assets/*/profile-pic`, (route) => route.fulfill({ status: 404, body: "" }));
    await page.goto("/approvals?category=inventory&by=pm1");
    await page.getByRole("list", { name: "Queue" }).getByRole("button", { name: /arjun\.fits/ }).click();
    const evidence = page.getByRole("region", { name: "Evidence" });
    await expect(evidence.getByText("None yet (optional)")).toBeVisible();
    await evidence.getByRole("button", { name: "Edit page details" }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByText("arjun.fits", { exact: true })).toBeVisible();
    await expect(sheet.getByTestId("page-edit-form")).toBeVisible();
    await expect(sheet.getByRole("combobox", { name: "Add a rate for" })).toBeVisible();
    await sheet.getByRole("button", { name: "Cancel" }).click();
    await page.keyboard.press("Escape");
    await evidence.getByRole("button", { name: "Approve", exact: true }).click();
    await expect.poll(() => approvals).toHaveLength(1);
  });

  // 2 Nov: Inventory opens on the people with pages waiting; a person's page offers select all, first N or single pages.
  test("admin: Inventory lists who sent pages; open a name and approve the first N of their pages", async ({ page }) => {
    await signIn(page, "ADMIN");
    const calls = await approvalsApi(page);
    await page.route(`${API_URL}/assets/*/profile-pic`, (route) => route.fulfill({ status: 404, body: "" }));
    await page.goto("/approvals");
    await page.getByRole("list", { name: "Approval categories" }).getByRole("link", { name: /Inventory/ }).click();

    const people = page.getByRole("table", { name: "People with inventory waiting" });
    await expect(people.getByRole("row")).toHaveCount(3); // header + Priya + untracked
    await expect(people.getByRole("row").nth(1)).toContainText("Priya Planner");
    await expect(people.getByRole("row").nth(1)).toContainText("Plan maker");
    await expect(people.getByRole("row").nth(2)).toContainText("Added before tracking");
    await shot(page, "approvals-inventory-people");

    await people.getByRole("link", { name: /Priya Planner/ }).click();
    await expect(page.getByRole("heading", { name: "Priya Planner" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Queue" }).getByRole("button")).toHaveCount(2);
    await expect(page.getByRole("complementary", { name: "Context" })).toContainText("Added by · Plan maker");
    await shot(page, "approvals-person-pages");

    // First N, in the queue's order (oldest first).
    await page.getByLabel("Number of pages to select (out of 2)").fill("1");
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await expect(page.getByTestId("selection-bar")).toContainText("1 of 2 selected");
    await expect(page.getByRole("checkbox", { name: "Select arjun.fits" })).toBeChecked();
    // Single pages can be ticked too.
    await page.getByRole("checkbox", { name: "Select arjun.eats" }).click();
    await expect(page.getByTestId("selection-bar")).toContainText("2 of 2 selected");
    await page.getByRole("button", { name: "Approve 2 pages" }).click();
    await expect.poll(() => calls.bulk).toEqual([{ assetIds: expect.arrayContaining(["a9", "a10"]), approvalStatus: "approved" }]);
    await expect(page.getByText("2 pages approved.")).toBeVisible();

    // Browser Back returns to the list of people.
    await page.goBack();
    await expect(page.getByRole("table", { name: "People with inventory waiting" })).toBeVisible();
  });

  test("admin: rejecting selected pages asks first", async ({ page }) => {
    await signIn(page, "ADMIN");
    const calls = await approvalsApi(page);
    await page.route(`${API_URL}/assets/*/profile-pic`, (route) => route.fulfill({ status: 404, body: "" }));
    await page.goto("/approvals?category=inventory&by=pm1");
    await page.getByRole("checkbox", { name: "Select all 2 pages" }).click();
    await page.getByRole("region", { name: "Selected pages" }).getByRole("button", { name: "Reject…" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Keep them" }).click();
    expect(calls.bulk).toEqual([]);
    await page.getByRole("region", { name: "Selected pages" }).getByRole("button", { name: "Reject…" }).click();
    await dialog.getByRole("button", { name: "Reject 2 pages" }).click();
    await expect.poll(() => calls.bulk).toEqual([{ assetIds: expect.arrayContaining(["a9", "a10"]), approvalStatus: "rejected" }]);
  });

  test("a kind running out says so, keeps the pills, and never claims the person is all done", async ({ page }) => {
    await signIn(page, "ADMIN");
    await approvalsApi(page);
    await page.route(`${API_URL}/assets`, (route) => route.fulfill({ json: [{ id: "a9", ownerId: "o9", platform: "instagram", handle: "arjun.fits", followers: 1, approvalStatus: "approved", createdAt: ago(9), rateCards: [], engagement: {}, owner: { name: "Arjun Nair" }, pendingEdit: { grade: "A" }, pendingEditAt: ago(9), pendingEditBy: { id: "pm1", name: "Priya Planner", role: "PLAN_MAKER" } }] }));
    await page.route(`${API_URL}/assets/*/profile-pic`, (route) => route.fulfill({ status: 404, body: "" }));
    await page.goto("/approvals?category=inventory&by=pm1&type=page");
    await expect(page.getByText("No new page waiting")).toBeVisible();
    await expect(page.getByText("All done here")).toHaveCount(0);
    await page.getByRole("radio", { name: /Page edit/ }).click();
    await expect(page.getByTestId("page-edit-diff")).toBeVisible();
  });

  test("a list that failed to load never reads as all clear", async ({ page }) => {
    await signIn(page, "ADMIN");
    await approvalsApi(page);
    await page.route(`${API_URL}/assets`, (route) => route.fulfill({ status: 500, json: { error: { code: "X", message: "Down" } } }));
    await page.goto("/approvals");
    await expect(page.getByRole("list", { name: "Approval categories" }).getByRole("link", { name: /Inventory/ })).toContainText("load", { timeout: 15000 });
  });

  test("deep links land on the right category", async ({ page }) => {
    await signIn(page, "ADMIN");
    await approvalsApi(page);
    await page.route(`${API_URL}/assets/*/profile-pic`, (route) => route.fulfill({ status: 404, body: "" }));
    await page.goto("/approvals?type=page");
    await expect(page.getByRole("table", { name: "People with inventory waiting" })).toBeVisible();
    await page.goto("/approvals?type=insights");
    await expect(page.getByRole("radio", { name: /Insights/ })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("heading", { name: "Goa Budget Tips" })).toBeVisible();
  });

  test("finance only sees bank-detail approvals and approves one", async ({ page }) => {
    await signIn(page, "FINANCE");
    const calls = await approvalsApi(page);
    await page.goto("/approvals");
    // One category only: straight to the queue, with no cards and no way "back" to them.
    await expect(page.getByRole("link", { name: "Back to Approvals" })).toHaveCount(0);
    await expect(page.getByRole("radio", { name: /Proof/ })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Kabir Malhotra" })).toBeVisible();
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    await expect.poll(() => calls.billing.length).toBe(1);
    expect(calls.billing[0]).toMatchObject({ approvalStatus: "approved" });
    expect([...calls.requested].sort()).toEqual(["billing"]);
  });

  test("a creator can't open approvals", async ({ page }) => {
    await signIn(page, "CREATOR");
    await approvalsApi(page);
    await page.goto("/approvals");
    await expect(page.getByRole("heading", { name: "You don't have access to approvals" })).toBeVisible();
  });

  test("plans another screen loaded never show up for someone who can't decide plans", async ({ page }) => {
    await signIn(page, "FINANCE", { permissions: { ...userFor("FINANCE").permissions, "links.approve": true, "plans.view": true, "plans.approve": false } });
    await approvalsApi(page);
    await page.route(`${API_URL}/plans`, (route) => route.fulfill({ json: [{ id: "p1", name: "Diwali Food Stories", variantLabel: "Plan A", clientName: "Saffron Street", status: "DRAFT", createdAt: ago(10), updatedAt: ago(10), items: [], totalCost: 0, overview: { subtotal: 0, gstAmount: 0, total: 0, totalFollowers: 0, totalPosts: 0, expectedImpressions: 0 }, createdBy: { id: "x", name: "Priya" } }] }));
    await page.goto("/plans");
    await expect(page.getByText("Diwali Food Stories").first()).toBeVisible();
    // Client-side navigation keeps the Plans list in the query cache.
    await page.getByRole("link", { name: "Approvals" }).first().click();
    const cards = page.getByRole("list", { name: "Approval categories" });
    await expect(cards.getByRole("link", { name: /Posts/ })).toContainText("2 waiting");
    await expect(cards.getByRole("link", { name: /Users/ })).toContainText("1 waiting");
    await expect(cards.getByRole("link", { name: /Plans/ })).toHaveCount(0);
    await expect(page.getByText(/Plan A/)).toHaveCount(0);
  });
});
