import { expect, test, type Page } from "@playwright/test";

import { API_URL, mockApi, shot, signIn, userFor, type MockRole } from "./fixtures";

/** Staff Home (Admin / Finance / Planner): decisions first, then live work and money. Every section is gated by permission. API fully mocked. */

const now = new Date().toISOString();
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
const RIYA = { id: "v-riya", name: "Riya Mehta", phoneNumber: null, email: "riya@example.com" };
const PLANNER = { id: "test-plan_maker", name: "Priya Sharma" };

const post = (id: string, status: string, caption: string) => ({
  id,
  campaignId: "c1",
  assetId: "a1",
  submittedById: RIYA.id,
  url: `https://instagram.com/p/${id}`,
  format: "reel",
  cost: "18000",
  status,
  postedAt: now,
  createdAt: now,
  overQuota: false,
  campaign: { id: "c1", title: "Diwali Food Stories", brandName: "Saffron Street" },
  asset: { id: "a1", handle: "riya.eats", platform: "instagram", followers: 482000, ownerId: RIYA.id, owner: RIYA },
  screenshot: null,
  postSnapshots: [{ likeCount: 1, commentsCount: 1, videoViews: 1, capturedAt: now, caption, thumbnailUrl: null }],
});

const plan = (id: string, status: "DRAFT" | "APPROVED" | "REJECTED", name: string) => ({
  id,
  name,
  clientName: "Saffron Street",
  status,
  variantLabel: "Plan A",
  budget: "120000",
  createdAt: now,
  updatedAt: now,
  items: [],
  totalCost: 71000,
  overview: { totalFollowers: 0, totalPosts: 3, expectedImpressions: 0, subtotal: 82000, gstAmount: 0, total: 82000 },
  campaignId: null,
  createdBy: PLANNER,
});

const campaigns = [
  { id: "c1", title: "Diwali Food Stories", brandName: "Saffron Street", createdAt: now, deadline: inDays(4), postCount: 5, costCap: "100000", spent: 54000, pendingAssignmentCount: 2 },
  { id: "c2", title: "Monsoon Getaways", brandName: "Northbound Trips", createdAt: now, deadline: inDays(10), postCount: 2, costCap: "50000", spent: 60000, pendingAssignmentCount: 0 },
  { id: "c0", title: "Summer Sale", brandName: "Loom & Lane", createdAt: now, deadline: inDays(-3), postCount: 9, costCap: null, spent: 0, pendingAssignmentCount: 0 },
];

async function homeApi(page: Page, opts: { empty?: boolean; proofTotal?: number; failPlans?: boolean } = {}) {
  const requested = new Set<string>();
  await mockApi(page);
  page.on("request", (req) => {
    if (req.url().startsWith(API_URL)) requested.add(new URL(req.url()).pathname.replace(/^\/api/, "").split("/")[1]);
  });
  await page.route(`${API_URL}/links**`, (route) => {
    const url = new URL(route.request().url());
    const status = url.searchParams.get("status");
    // Count calls (one status, pageSize 1): the server's `total` is the real number, past the 100-row page cap.
    if (status === "PENDING_SCREENSHOT_REVIEW") return route.fulfill({ json: { items: [], total: opts.empty ? 0 : (opts.proofTotal ?? 2), page: 1, pageSize: 1 } });
    if (status === "INSIGHTS_PENDING") return route.fulfill({ json: { items: [], total: opts.empty ? 0 : 1, page: 1, pageSize: 1 } });
    if (status) return route.fulfill({ json: { items: opts.empty ? [] : [post("l1", "PENDING_SCREENSHOT_REVIEW", "Thali hacks"), post("l2", "PENDING_SCREENSHOT_REVIEW", "Sweet run"), post("l3", "INSIGHTS_PENDING", "Goa tips")], total: 3, page: 1, pageSize: 100 } });
    return route.fulfill({ json: { items: [post("l9", "INSIGHTS_APPROVED", "Monsoon cravings")], total: 1, page: 1, pageSize: 6 } });
  });
  await page.route(`${API_URL}/plans`, (route) => opts.failPlans ? route.fulfill({ status: 500, json: {} }) : route.fulfill({ json: opts.empty ? [] : [plan("p1", "DRAFT", "Diwali Food Stories"), plan("p2", "REJECTED", "Festive Edit"), plan("p3", "APPROVED", "Hill Escapes")] }));
  await page.route(`${API_URL}/campaigns`, (route) => route.fulfill({ json: opts.empty ? [] : campaigns }));
  await page.route(`${API_URL}/invoices?**`, (route) => route.fulfill({ json: { items: [], total: opts.empty ? 0 : 2, page: 1, pageSize: 1 } }));
  await page.route(`${API_URL}/assets`, (route) => route.fulfill({ json: [{ id: "a1", ownerId: RIYA.id, platform: "instagram", handle: "riya.eats", followers: 482000, approvalStatus: "approved", createdAt: now, rateCards: [], engagement: {}, owner: RIYA }] }));
  await page.route(`${API_URL}/billing-profiles**`, (route) => route.fulfill({ json: opts.empty ? [] : [{ id: "b1", userId: RIYA.id, pan: "X", name: "RIYA", bankAccountNumber: "50100012344321", ifscCode: "HDFC0001234", approvalStatus: "pending", createdAt: now, user: RIYA }] }));
  await page.route(`${API_URL}/payments/**`, (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api\/payments/, "");
    if (path === "/pending") return route.fulfill({ json: { items: opts.empty ? [] : [post("d1", "INSIGHTS_APPROVED", "A"), post("d2", "INSIGHTS_APPROVED", "B")], total: 2, invoices: [] } });
    if (path === "/summary") return route.fulfill({ json: { pending: { amount: 36000, links: 2, invoices: 0 }, paid: { amount: 29700, links: 1, payments: 1 } } });
    if (path === "/paid" || path === "/me/paid") return route.fulfill({ json: { items: [], total: 0 } });
    if (path === "/me/pending") return route.fulfill({ json: { items: [], total: 0, invoices: [] } });
    // 30 drafts, first page of 25: the tile reads `total`.
    if (path === "/payouts") return route.fulfill({ json: { items: opts.empty ? [] : Array.from({ length: 25 }, (_, i) => ({ id: `dr${i}`, status: "DRAFT" })), total: opts.empty ? 0 : 30, page: 1, pageSize: 25 } });
    return route.fulfill({ json: {} });
  });
  return requested;
}

const decision = (page: Page) => page.getByRole("region", { name: "Needs your decision" });

test.describe("Staff home", () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test("admin: every decision with a count that opens the right inbox filter; live work and money below", async ({ page }) => {
    await signIn(page, "ADMIN");
    await homeApi(page);
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Here's what needs you today" })).toBeVisible();
    const d = decision(page);
    await expect(d.getByRole("link", { name: /2\s*Proofs to review/ })).toHaveAttribute("href", "/approvals?type=proof");
    await expect(d.getByRole("link", { name: /1\s*Insights to verify/ })).toHaveAttribute("href", "/approvals?type=insights");
    await expect(d.getByRole("link", { name: /1\s*Plan awaiting approval/ })).toHaveAttribute("href", "/approvals?type=plan");
    await expect(d.getByRole("link", { name: /1\s*Campaign with pages to match/ })).toHaveAttribute("href", "/approvals?type=people");
    await expect(d.getByRole("link", { name: /1\s*Bank details to check/ })).toHaveAttribute("href", "/approvals?type=billing");
    await expect(d.getByRole("link", { name: /30\s*Payouts waiting for receipts/ })).toHaveAttribute("href", "/finance/payouts");
    await expect(d.getByRole("link", { name: /2\s*Creator invoices to approve/ })).toHaveAttribute("href", "/finance/invoices");
    // No zero tiles: nothing for new pages.
    await expect(d.getByText(/New page/)).toHaveCount(0);

    const camps = page.getByRole("region", { name: "Active campaigns" });
    await expect(camps.getByRole("link", { name: /Diwali Food Stories/ })).toHaveAttribute("href", "/campaigns/c1");
    await expect(camps.getByText("Summer Sale")).toHaveCount(0); // ended
    await expect(camps.getByText("Over budget")).toBeVisible();
    await expect(page.getByRole("region", { name: "Vendors to pay" }).getByRole("link", { name: /Riya Mehta/ })).toHaveAttribute("href", "/finance/payouts/v-riya");
    await expect(page.getByRole("region", { name: "Recent content" }).getByRole("link", { name: /Monsoon cravings/ })).toHaveAttribute("href", "/campaigns/c1");
    await expect(page.getByRole("region", { name: "Money this month" }).getByText("₹36,000")).toBeVisible();
    await shot(page, "home-admin");

    await d.getByRole("link", { name: /Proofs to review/ }).click();
    await expect(page).toHaveURL(/\/approvals\?type=proof$/);
  });

  test("finance: bank details, payouts and money; no plans asked for", async ({ page }) => {
    await signIn(page, "FINANCE");
    const requested = await homeApi(page);
    await page.goto("/dashboard");
    const d = decision(page);
    await expect(d.getByRole("link", { name: /Bank details to check/ })).toBeVisible();
    await expect(d.getByRole("link", { name: /Payouts? waiting/ })).toBeVisible();
    await expect(d.getByText(/Proofs to review|Plan awaiting/)).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Vendors to pay" })).toBeVisible();
    await expect(page.getByRole("link", { name: "New plan" })).toHaveCount(0);
    await shot(page, "home-finance");
    expect(requested.has("plans")).toBe(false);
  });

  test("planner: own drafts and rejected plans, own campaigns; no money asked for", async ({ page }) => {
    await signIn(page, "PLAN_MAKER");
    const requested = await homeApi(page);
    await page.goto("/dashboard");
    const d = decision(page);
    await expect(d.getByRole("link", { name: /1\s*Your plan to approve/ })).toHaveAttribute("href", "/plans");
    await expect(d.getByRole("link", { name: /1\s*Rejected plan to revise/ })).toHaveAttribute("href", "/plans");
    // Inbox counts are for global approvers; a planner's own plans must not be double-counted from the shared cache.
    await expect(d.getByText(/Plan awaiting approval|pages to match/)).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Your plans" }).getByRole("link", { name: /Festive Edit/ })).toHaveAttribute("href", "/plans/p2");
    await expect(page.getByRole("region", { name: "Your campaigns" })).toBeVisible();
    await expect(page.getByRole("link", { name: "New plan" })).toHaveAttribute("href", "/plans/new");
    await expect(page.getByRole("region", { name: "Vendors to pay" })).toHaveCount(0);
    await shot(page, "home-planner");
    expect(requested.has("payments")).toBe(false);
    expect(requested.has("billing-profiles")).toBe(false);
    expect(requested.has("invoices")).toBe(false);
  });

  test("nothing waiting: says all clear instead of empty tiles", async ({ page }) => {
    await signIn(page, "ADMIN");
    await homeApi(page, { empty: true });
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Nothing needs you right now" })).toBeVisible();
    await expect(decision(page).getByText(/All clear/)).toBeVisible();
  });

  test("counts come from the server's totals, past the 100-row page", async ({ page }) => {
    await signIn(page, "ADMIN");
    await homeApi(page, { proofTotal: 150 });
    await page.goto("/dashboard");
    await expect(decision(page).getByRole("link", { name: /150\s*Proofs to review/ })).toBeVisible();
  });

  test("a source that fails to load is never reported as all clear", async ({ page }) => {
    await signIn(page, "ADMIN");
    await homeApi(page, { empty: true, failPlans: true });
    await page.goto("/dashboard");
    await expect(decision(page).getByText("Couldn't check what needs you.")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/All clear/)).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Nothing needs you right now" })).toHaveCount(0);
  });

  test("finance granted proof review gets proofs, but not page matching (that needs campaigns.edit)", async ({ page }) => {
    await signIn(page, "FINANCE", { permissions: { ...userFor("FINANCE").permissions, "links.approve": true } });
    await homeApi(page);
    await page.goto("/dashboard");
    await expect(decision(page).getByRole("link", { name: /Proofs to review/ })).toBeVisible();
    await expect(decision(page).getByText(/pages to match/)).toHaveCount(0);
  });

  for (const role of ["CREATOR", "TEAM_MEMBER"] as MockRole[]) {
    test(`${role} gets the creator home, not the staff one`, async ({ page }) => {
      await signIn(page, role);
      const requested = await homeApi(page);
      await page.goto("/dashboard");
      await expect(page.getByRole("button", { name: "Submit a post" }).or(page.getByRole("link", { name: "Submit a post" }))).toBeVisible();
      await expect(decision(page)).toHaveCount(0);
      expect(requested.has("billing-profiles")).toBe(false);
    });
  }
});
