import { expect, test, type Page } from "@playwright/test";

import { API_URL, mockApi, shot, signIn } from "./fixtures";

/** Inventory → tick pages (across pager pages, select all / first N) → "Create plan" → the plan form starts with them (v1 parity). API mocked. */

const OWNER = { id: "v-riya", name: "Riya Mehta", phoneNumber: null, email: "riya@example.com" };
const now = new Date().toISOString();
const asset = (n: number, extra: Record<string, unknown> = {}) => {
  const id = `p${String(n).padStart(2, "0")}`;
  return {
    id,
    ownerId: OWNER.id,
    owner: OWNER,
    platform: "instagram",
    handle: `page.${id}`,
    fullName: null,
    followers: 2_000_000 - n * 100_000,
    category: "Food",
    approvalStatus: "approved",
    isActive: true,
    createdAt: now,
    rateCards: [{ id: `${id}-r`, assetId: id, format: "reel", amount: "10000" }],
    engagement: { avgLikes: null, avgComments: null, avgViews: 50000, sampleSize: 3 },
    lastScrapedAt: now,
    lastScrapeError: null,
    scrapeQueuedAt: null,
    campaigns: [],
    ...extra,
  };
};
// 12 pages, biggest first: two pager pages of 10 + 2. The last one is still waiting for approval.
const ASSETS = Array.from({ length: 12 }, (_, i) => asset(i + 1, i === 11 ? { approvalStatus: "pending" } : {}));

function planFor(id: string, body: Record<string, unknown>) {
  return {
    id,
    name: body.name ?? "Plan",
    clientName: body.clientName ?? "Client",
    clientContact: null,
    clientCompany: null,
    clientGstNumber: null,
    clientAddress: null,
    clientPhone: null,
    clientInvoiceNumber: null,
    invoiceDescription: null,
    hsnSac: null,
    notes: body.notes ?? "",
    budget: null as string | null,
    isGstPlan: true,
    gstPercent: 18,
    status: "DRAFT",
    createdAt: now,
    updatedAt: now,
    items: [] as unknown[],
    totalCost: 0,
    overview: { totalFollowers: 0, totalPosts: 0, expectedImpressions: 0, subtotal: 0, gstAmount: 0, total: 0 },
    internal: { computedFollowers: 0, computedPosts: 0, computedImpressions: 0, computedSubtotal: 0, computedGstAmount: 0, computedTotal: 0 },
    overrideImpressions: null,
    overrideCost: null,
    pitchGroupId: null,
    variantLabel: "Plan A",
    createdBy: { id: "test-plan_maker", name: "Test PLAN_MAKER" },
  };
}

async function api(page: Page) {
  const calls = { created: [] as Record<string, unknown>[], updates: [] as Record<string, unknown>[] };
  await mockApi(page);
  await page.route(`${API_URL}/assets**`, (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api\/assets/, "");
    if (route.request().method() === "GET" && path === "") return route.fulfill({ json: ASSETS });
    if (path.endsWith("/profile-pic")) return route.fulfill({ status: 404, body: "" });
    return route.fulfill({ status: 404, json: {} });
  });
  let current: ReturnType<typeof planFor> | null = null;
  await page.route(`${API_URL}/plans**`, (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(/^\/api\/plans/, "");
    if (req.method() === "GET" && (path === "" || path === "/clients")) return route.fulfill({ json: [] });
    if (req.method() === "POST" && path === "") {
      calls.created.push(req.postDataJSON());
      current = planFor("p-new", req.postDataJSON());
      return route.fulfill({ status: 201, json: current });
    }
    if (req.method() === "PUT" && path === "/p-new") {
      const body = req.postDataJSON();
      calls.updates.push(body);
      const items = (body.items ?? []).map((i: { assetId: string; format: string; postsPerProfile: number }, n: number) => {
        const a = ASSETS.find((x) => x.id === i.assetId)!;
        return { id: `l${n}`, planId: "p-new", assetId: a.id, format: i.format, cost: "10000", clientCost: null, postsPerProfile: i.postsPerProfile, asset: { id: a.id, handle: a.handle, category: a.category, followers: a.followers, platform: a.platform } };
      });
      Object.assign(current!, { budget: String(body.budget), items });
      return route.fulfill({ json: current });
    }
    if (req.method() === "GET" && path === "/p-new") return route.fulfill({ json: current });
    return route.fulfill({ status: 404, json: { error: { code: "NOT_MOCKED", message: path } } });
  });
  return calls;
}

test.describe("Inventory → Create plan", () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test("a planner ticks pages across pager pages and the plan form starts with them", async ({ page }) => {
    await signIn(page, "PLAN_MAKER");
    const calls = await api(page);
    await page.goto("/creators");
    const bar = page.getByTestId("selection-bar");
    await expect(bar).toContainText("Select all 12");

    // Select first 10, then the selection survives moving to the next pager page.
    await bar.getByRole("button", { name: "10", exact: true }).click();
    await expect(bar).toContainText("10 of 12 selected");
    await page.getByRole("button", { name: "Next page" }).click();
    await page.getByRole("checkbox", { name: "Select page.p11" }).click();
    await expect(bar).toContainText("11 of 12 selected");
    // No inventory.edit for a planner: no bulk Instagram refresh, but they can plan.
    await expect(bar.getByRole("button", { name: "Refresh from Instagram" })).toHaveCount(0);
    await bar.getByRole("button", { name: "Clear" }).click();
    await expect(bar).toContainText("Select all 12");

    await page.getByRole("checkbox", { name: "Select page.p12" }).click();
    await page.getByRole("button", { name: "Previous page" }).click();
    await page.getByRole("checkbox", { name: "Select page.p01" }).click();
    await page.getByRole("checkbox", { name: "Select page.p02" }).click();
    await shot(page, "inventory-selection");
    await bar.getByRole("button", { name: "Create plan (3)" }).click();
    await expect(page).toHaveURL(/\/plans\/new\?assetIds=p01,p02,p12$/);
    // p12 is still waiting for approval, so it can't go on a plan.
    await expect(page.getByText("1 selected page isn't approved and active, so it was left out.")).toBeVisible();

    await page.getByLabel("Plan name").fill("Monsoon Menu");
    await page.getByLabel("Client", { exact: true }).fill("Saffron Street");
    await page.getByLabel("Brief").fill("Rainy-day food reels");
    await page.getByRole("button", { name: "Next: budget & pages" }).click();
    await expect.poll(() => calls.created.length).toBe(1);

    await expect(page.getByRole("checkbox", { name: "Add page.p01" })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: "Add page.p02" })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: "Add page.p03" })).not.toBeChecked();
    // The budget still caps Next: none set yet, then one too small, then enough.
    const next = page.getByRole("button", { name: "Next: pricing" });
    await expect(next).toBeDisabled();
    await page.getByLabel("Internal budget (₹)").fill("15000");
    await expect(next).toBeDisabled();
    await page.getByLabel("Internal budget (₹)").fill("20000");
    await shot(page, "inventory-plan-seeded");
    await next.click();
    await expect.poll(() => calls.updates.length).toBe(1);
    expect(calls.updates[0]).toEqual({
      budget: 20000,
      items: [
        { assetId: "p01", format: "reel", postsPerProfile: 1 },
        { assetId: "p02", format: "reel", postsPerProfile: 1 },
      ],
    });
  });

  test("admin: select all, or the first N typed, across every pager page", async ({ page }) => {
    await signIn(page, "ADMIN");
    await api(page);
    await page.goto("/creators");
    const bar = page.getByTestId("selection-bar");
    await bar.getByRole("checkbox", { name: "Select all 12 pages" }).click();
    await expect(bar).toContainText("12 of 12 selected");
    await expect(bar.getByRole("button", { name: "Refresh from Instagram" })).toBeVisible();
    await bar.getByRole("checkbox", { name: "Deselect all 12 pages" }).click();
    await expect(bar).toContainText("Select all 12");

    await bar.getByLabel("Number of pages to select (out of 12)").fill("11");
    await bar.getByRole("button", { name: "Select", exact: true }).click();
    await expect(bar).toContainText("11 of 12 selected");
    await page.getByRole("button", { name: "Next page" }).click();
    await expect(page.getByRole("checkbox", { name: "Select page.p11" })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: "Select page.p12" })).not.toBeChecked();
    // A filter change clears the selection, so nothing hidden stays ticked.
    await page.getByRole("searchbox", { name: "Search creators" }).fill("p0");
    await expect(bar).toContainText("Select all 9");
    await page.getByRole("checkbox", { name: "Select page.p03" }).click();
    await bar.getByRole("button", { name: "Create plan (1)" }).click();
    await expect(page).toHaveURL(/\/plans\/new\?assetIds=p03$/);
  });

  test("no Create plan for someone who can't make plans", async ({ page }) => {
    await signIn(page, "FINANCE");
    await api(page);
    await page.goto("/creators");
    await expect(page.getByRole("tab", { name: "Pages (12)" })).toBeVisible();
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    await expect(page.getByTestId("selection-bar")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Create plan/ })).toHaveCount(0);
  });

  test("a planner whose own plans switch is off can't tick pages or create a plan", async ({ page }) => {
    await signIn(page, "PLAN_MAKER", { ownAccess: { "plans.edit": false } });
    await api(page);
    await page.goto("/creators");
    await expect(page.getByRole("tab", { name: "Pages (12)" })).toBeVisible();
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Create plan/ })).toHaveCount(0);
  });
});
