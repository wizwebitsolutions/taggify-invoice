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
    if (req.method() === "GET") return route.fulfill({ json: { items: [link("l1", "Diwali Thali Hacks", "PENDING_SCREENSHOT_REVIEW", 50), link("l2", "Goa Budget Tips", "INSIGHTS_PENDING", 5)], total: 2, page: 1, pageSize: 100 } });
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

  test("admin: every kind in one queue; a rejected proof needs a reason; Approve & next moves on", async ({ page }) => {
    await signIn(page, "ADMIN");
    const calls = await approvalsApi(page);
    await page.goto("/approvals");
    const queue = page.getByRole("list", { name: "Queue" });
    await expect(queue.getByRole("button")).toHaveCount(6); // proof, insights, 3 pages, bank details
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

    // Moved on to the next item (bank details, 30h).
    await expect(page.getByRole("heading", { name: "Kabir Malhotra" })).toBeVisible();
    // Kinds sit under categories (1 Nov): Posts → Insights.
    await page.getByRole("radio", { name: /Posts/ }).click();
    await page.getByRole("radio", { name: /Insights/ }).click();
    await expect(page.getByText("41,200")).toBeVisible();
    await expect(page.getByRole("button", { name: "Reject…" })).toHaveCount(0);
    await page.getByRole("button", { name: "Approve & next" }).click();
    await expect.poll(() => calls.insights).toEqual(["l2"]);
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
    await page.goto("/approvals");
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

  // 1 Nov: Inventory → New page groups the waiting pages by who added them; a whole group (or single pages) can be approved at once.
  test("admin: new pages are grouped by who added them and a group can be approved in one go", async ({ page }) => {
    await signIn(page, "ADMIN");
    const calls = await approvalsApi(page);
    await page.route(`${API_URL}/assets/*/profile-pic`, (route) => route.fulfill({ status: 404, body: "" }));
    await page.goto("/approvals");
    await page.getByRole("radio", { name: /Inventory/ }).click();
    await page.getByRole("radio", { name: /New page/ }).click();
    const priya = page.getByRole("group", { name: "Priya Planner" });
    await expect(priya).toContainText("Plan maker");
    await expect(priya).toContainText("2 pages");
    await expect(page.getByRole("group", { name: "Added before tracking" })).toBeVisible();
    // The focused page's context says who added it.
    await expect(page.getByRole("region", { name: "Context" })).toContainText("Added by · Plan maker");
    await shot(page, "approvals-pages-grouped");

    await page.getByRole("checkbox", { name: "Select all from Priya Planner" }).click();
    const bar = page.getByRole("region", { name: "Selected pages" });
    await expect(bar).toContainText("2 pages selected");
    // Untick one and tick the untracked page: any mix works.
    await page.getByRole("checkbox", { name: "Select arjun.eats" }).click();
    await page.getByRole("checkbox", { name: "Select old.page" }).click();
    await expect(bar).toContainText("2 pages selected");
    await bar.getByRole("button", { name: "Approve selected" }).click();
    await expect.poll(() => calls.bulk).toEqual([{ assetIds: ["a9", "a11"], approvalStatus: "approved" }]);
    await expect(page.getByText("2 pages approved.")).toBeVisible();
  });

  test("a deep link to one kind lands on its category with that kind picked", async ({ page }) => {
    await signIn(page, "ADMIN");
    await approvalsApi(page);
    await page.goto("/approvals?type=page");
    await expect(page.getByRole("radio", { name: /Inventory/ })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("radio", { name: /New page/ })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("group", { name: "Priya Planner" })).toBeVisible();
  });

  test("finance only sees bank-detail approvals and approves one", async ({ page }) => {
    await signIn(page, "FINANCE");
    const calls = await approvalsApi(page);
    await page.goto("/approvals");
    await expect(page.getByRole("radio", { name: /Bank details/ })).toBeVisible();
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
    await expect(page.getByRole("list", { name: "Queue" }).getByRole("button")).toHaveCount(3); // proof, insights, bank details — never the plan
    await expect(page.getByRole("list", { name: "Queue" }).getByText(/Plan A/)).toHaveCount(0);
  });
});
