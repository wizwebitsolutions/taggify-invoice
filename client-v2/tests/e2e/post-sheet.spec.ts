import { expect, test, type Page } from "@playwright/test";

import { API_URL, mockApi, shot, signIn, type MockRole } from "./fixtures";

/** Post details drawer: numbers + refresh, cost + revise (reason required) + history. Campaign detail and Content. API fully mocked. */

const now = new Date().toISOString();
const CAMPAIGN = {
  id: "c1",
  brandName: "Saffron Street",
  title: "Diwali Food Stories",
  deadline: null,
  createdAt: now,
  costCap: "300000",
  spent: 50000,
  postCount: 2,
  phaseCount: 1,
  parentCampaignId: null,
  phases: [{ id: "c1", phaseNumber: 1, title: "Diwali Food Stories", createdAt: now }],
  yourEarnings: 18000,
};
const post = (id: string, caption: string, status: string, cost: number, extra: Record<string, unknown> = {}) => ({
  id,
  campaignId: "c1",
  assetId: "a1",
  submittedById: "o1",
  url: `https://www.instagram.com/reel/${id}/`,
  format: "reel",
  cost: String(cost),
  customRate: false,
  status,
  postedAt: now,
  createdAt: now,
  overQuota: false,
  campaign: { id: "c1", title: "Diwali Food Stories", brandName: "Saffron Street" },
  asset: { id: "a1", handle: "riya.eats", platform: "instagram", followers: 482000, ownerId: "o1" },
  screenshot: { id: `s-${id}`, publicId: "x", approved: true, url: "https://example.com/proof.png" },
  invoiceItem: null,
  payoutItem: null,
  postSnapshots: [{ likeCount: 48210, commentsCount: 912, videoViews: 1204000, capturedAt: now, caption: `${caption}
Full recipe in the comments. #diwali`, thumbnailUrl: null }],
  ...extra,
});
const makePosts = () => [
  post("l1", "Monsoon Cravings", "INSIGHTS_APPROVED", 18000),
  post("l2", "Festive Thali", "INVOICED", 32000, { invoiceItem: { invoiceId: "inv1", invoice: { invoiceNumber: "INV-2026-0140", status: "APPROVED" } } }),
  post("l3", "Sweet Run", "INSIGHTS_APPROVED", 9000, { payoutItem: { payoutId: "po1" } }),
  post("l4", "Lights and Laddoos", "SUBMITTED", 7000, { postSnapshots: [], screenshot: null }),
];
const REVISIONS = [{ id: "r1", linkId: "l1", previousCost: "15000", newCost: "18000", note: "Extra story added", createdAt: now, revisedBy: { id: "u1", name: "Asha Rao" } }];

async function postApi(page: Page, opts: { refreshFails?: boolean; deleteFails?: boolean } = {}) {
  const POSTS = makePosts();
  const REVS = [...REVISIONS];
  const calls = { revise: [] as { id: string; body: { cost: number; note?: string } }[], refresh: [] as string[], revisions: 0, deleted: [] as string[] };
  await mockApi(page);
  await page.route(`${API_URL}/campaigns**`, (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api\/campaigns/, "");
    if (path === "") return route.fulfill({ json: [CAMPAIGN] });
    if (path === "/c1") return route.fulfill({ json: CAMPAIGN });
    if (path === "/c1/assignments") return route.fulfill({ json: [] });
    return route.fulfill({ status: 404, json: {} });
  });
  await page.route(`${API_URL}/links**`, (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace(/^\/api\/links/, "");
    let m = path.match(/^\/([^/]+)\/cost-revisions$/);
    if (req.method() === "GET" && m) {
      calls.revisions++;
      return route.fulfill({ json: REVS.filter((r) => r.linkId === m![1]) });
    }
    m = path.match(/^\/([^/]+)\/cost$/);
    if (req.method() === "PUT" && m) {
      const body = req.postDataJSON();
      calls.revise.push({ id: m[1], body });
      const target = POSTS.find((p) => p.id === m![1])!;
      REVS.unshift({ id: `r${REVS.length + 1}`, linkId: target.id, previousCost: target.cost, newCost: String(body.cost), note: body.note, createdAt: now, revisedBy: { id: "u2", name: "Test ADMIN" } });
      target.cost = String(body.cost);
      return route.fulfill({ json: target });
    }
    m = path.match(/^\/([^/]+)\/refresh-metrics$/);
    if (req.method() === "POST" && m) {
      calls.refresh.push(m[1]);
      return route.fulfill({ json: opts.refreshFails ? { ok: false, reason: "Post is private" } : { ok: true } });
    }
    m = path.match(/^\/([^/]+)$/);
    if (req.method() === "DELETE" && m) {
      calls.deleted.push(m[1]);
      if (opts.deleteFails) return route.fulfill({ status: 409, json: { error: { code: "ALREADY_INVOICED", message: "This link is already on an invoice — reject that invoice before you delete it" } } });
      POSTS.splice(POSTS.findIndex((p) => p.id === m![1]), 1);
      return route.fulfill({ json: { id: m[1] } });
    }
    if (req.method() === "GET" && path === "") {
      const size = Number(url.searchParams.get("pageSize")) || 100;
      return route.fulfill({ json: { items: size === 1 ? [] : POSTS, total: POSTS.length, page: 1, pageSize: size } });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  return calls;
}

async function open(page: Page, role: MockRole, opts: { refreshFails?: boolean; deleteFails?: boolean } = {}) {
  await signIn(page, role);
  const calls = await postApi(page, opts);
  await page.goto("/campaigns/c1");
  await expect(page.getByRole("heading", { name: "Diwali Food Stories" })).toBeVisible();
  return calls;
}

test.describe("Post details drawer", () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test("admin: clicking a post opens its numbers, cost and history; refresh asks the server", async ({ page }) => {
    const calls = await open(page, "ADMIN");
    await page.getByRole("button", { name: "Monsoon Cravings", exact: true }).click();
    const drawer = page.getByRole("dialog");
    await expect(drawer.getByRole("heading", { name: "Monsoon Cravings" })).toBeVisible();
    await expect(drawer.getByText("12,04,000")).toBeVisible();
    await expect(drawer.getByText("48,210")).toBeVisible();
    await expect(drawer.getByText("Extra story added")).toBeVisible();
    await expect(drawer.getByText(/Asha Rao/)).toBeVisible();
    await expect(drawer.getByText(/Full recipe in the comments/)).toBeVisible();
    await expect(drawer.getByRole("link", { name: "View proof" })).toHaveAttribute("href", "https://example.com/proof.png");
    await shot(page, "post-sheet");
    await drawer.getByRole("button", { name: "Refresh" }).click();
    await expect(page.getByText("Numbers updated.")).toBeVisible();
    expect(calls.refresh).toEqual(["l1"]);
  });

  test("admin: revising a cost needs a new amount and a reason, then sends both", async ({ page }) => {
    const calls = await open(page, "ADMIN");
    await page.getByRole("row", { name: /Monsoon Cravings/ }).getByRole("button", { name: /Actions for/ }).click();
    await page.getByRole("menuitem", { name: "Revise cost…" }).click();
    const drawer = page.getByRole("dialog");
    const save = drawer.getByRole("button", { name: "Save new cost" });
    await expect(drawer.getByLabel("New cost (₹)")).toBeFocused();
    await drawer.getByLabel("New cost (₹)").fill("18000");
    await expect(drawer.getByText("That's the current cost.")).toBeVisible();
    await drawer.getByLabel("New cost (₹)").fill("21,000");
    await expect(drawer.getByText("Enter a whole amount in rupees.")).toBeVisible();
    await drawer.getByLabel("New cost (₹)").fill("21000");
    await expect(save).toBeDisabled();
    await drawer.getByLabel("Reason").fill("Brand asked for a longer reel");
    await shot(page, "post-sheet-revise");
    await save.click();
    await expect(page.getByText("Cost revised.")).toBeVisible();
    expect(calls.revise).toEqual([{ id: "l1", body: { cost: 21000, note: "Brand asked for a longer reel" } }]);
    // The refetch shows the new cost in the drawer, its history and the table, and focus returns to "Revise cost".
    await expect(drawer.getByText("Brand asked for a longer reel")).toBeVisible();
    await expect(drawer.getByRole("region", { name: "Cost" })).toContainText("₹21,000");
    await expect(drawer.getByRole("button", { name: "Revise cost" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("row", { name: /Monsoon Cravings/ })).toContainText("₹21,000");
  });

  test("admin: cancel closes the form without saving; a failed refresh says why", async ({ page }) => {
    const calls = await open(page, "ADMIN", { refreshFails: true });
    await page.getByRole("button", { name: "Monsoon Cravings", exact: true }).click();
    const drawer = page.getByRole("dialog");
    await drawer.getByRole("button", { name: "Revise cost" }).click();
    await drawer.getByLabel("New cost (₹)").fill("123456789");
    await expect(drawer.getByText(/more than ₹99,99,999/)).toBeVisible();
    await drawer.getByRole("button", { name: "Cancel" }).click();
    await expect(drawer.getByLabel("New cost (₹)")).toHaveCount(0);
    await expect(drawer.getByRole("button", { name: "Revise cost" })).toBeFocused();
    expect(calls.revise).toEqual([]);
    await drawer.getByRole("button", { name: "Refresh" }).click();
    await expect(page.getByText("Couldn't fetch the numbers: Post is private")).toBeVisible();
  });

  test("admin: a post on a payout can't be revised; a post waiting for proof explains when numbers arrive", async ({ page }) => {
    await open(page, "ADMIN");
    await page.getByRole("row", { name: /Sweet Run/ }).getByRole("button", { name: /Actions for/ }).click();
    await expect(page.getByRole("menuitem", { name: "Revise cost…" })).toHaveCount(0);
    await page.getByRole("menuitem", { name: "Details" }).click();
    const drawer = page.getByRole("dialog");
    await expect(drawer.getByText("Already on a payout, so the cost can't change here.")).toBeVisible();
    await expect(drawer.getByRole("button", { name: "Revise cost" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    // No fetched numbers yet, so the row's title is its format.
    await page.getByRole("row", { name: /Needs proof/ }).getByRole("button", { name: "Reel", exact: true }).click();
    await expect(page.getByRole("dialog").getByText("Numbers start coming in once the proof is approved.")).toBeVisible();
  });

  test("admin: a billed post shows where it's billed and can't be revised", async ({ page }) => {
    await open(page, "ADMIN");
    await page.getByRole("row", { name: /Festive Thali/ }).getByRole("button", { name: /Actions for/ }).click();
    await expect(page.getByRole("menuitem", { name: "Revise cost…" })).toHaveCount(0);
    await page.getByRole("menuitem", { name: "Details" }).click();
    const drawer = page.getByRole("dialog");
    await expect(drawer.getByText(/On INV-2026-0140, so the cost can't change here/)).toBeVisible();
    await expect(drawer.getByRole("button", { name: "Revise cost" })).toHaveCount(0);
    await expect(drawer.getByText("Unchanged since it was submitted.")).toBeVisible();
  });

  test("admin: deleting a post asks first, then removes it and closes the drawer", async ({ page }) => {
    const calls = await open(page, "ADMIN");
    await page.getByRole("button", { name: "Monsoon Cravings", exact: true }).click();
    const drawer = page.getByRole("dialog", { name: "Monsoon Cravings" });
    await drawer.getByRole("button", { name: "Delete post…" }).click();
    const confirm = page.getByRole("dialog", { name: "Delete this post?" });
    await expect(confirm).toContainText("riya.eats");
    await confirm.getByRole("button", { name: "Keep post" }).click();
    await expect(confirm).toBeHidden();
    expect(calls.deleted).toEqual([]);

    await drawer.getByRole("button", { name: "Delete post…" }).click();
    await page.getByRole("dialog", { name: "Delete this post?" }).getByRole("button", { name: "Delete post", exact: true }).click();
    await expect(page.getByText("Post deleted.")).toBeVisible();
    expect(calls.deleted).toEqual(["l1"]);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Monsoon Cravings", exact: true })).toHaveCount(0);
  });

  test("admin: a refused delete shows the server's reason and can't be retried", async ({ page }) => {
    await open(page, "ADMIN", { deleteFails: true });
    await page.getByRole("button", { name: "Monsoon Cravings", exact: true }).click();
    await page.getByRole("dialog", { name: "Monsoon Cravings" }).getByRole("button", { name: "Delete post…" }).click();
    const confirm = page.getByRole("dialog", { name: "Delete this post?" });
    await confirm.getByRole("button", { name: "Delete post", exact: true }).click();
    await expect(confirm.getByRole("alert")).toContainText("reject that invoice before you delete it");
    await expect(confirm.getByRole("button", { name: "Delete post", exact: true })).toBeDisabled();
  });

  test("admin: billed and paid-out posts have no Delete post", async ({ page }) => {
    await open(page, "ADMIN");
    for (const name of ["Festive Thali", "Sweet Run"]) {
      await page.getByRole("button", { name, exact: true }).click();
      await expect(page.getByRole("dialog", { name })).toBeVisible();
      await expect(page.getByRole("button", { name: "Delete post…" })).toHaveCount(0);
      await page.keyboard.press("Escape");
    }
  });

  test("creator: sees what they earn, no refresh, no revise, no history", async ({ page }) => {
    const calls = await open(page, "CREATOR");
    await page.getByRole("button", { name: "Monsoon Cravings", exact: true }).click();
    const drawer = page.getByRole("dialog");
    await expect(drawer.getByRole("heading", { name: "You earn" })).toBeVisible();
    await expect(drawer.getByRole("button", { name: "Refresh" })).toHaveCount(0);
    await expect(drawer.getByRole("button", { name: "Revise cost" })).toHaveCount(0);
    await expect(drawer.getByText("History")).toHaveCount(0);
    await expect(drawer.getByRole("button", { name: "Delete post…" })).toHaveCount(0);
    expect(calls.revisions).toBe(0);
  });

  test("finance (no links.edit): reads the history but can't revise or refresh", async ({ page }) => {
    await open(page, "FINANCE");
    await page.getByRole("button", { name: "Monsoon Cravings", exact: true }).click();
    const drawer = page.getByRole("dialog");
    await expect(drawer.getByText("Extra story added")).toBeVisible();
    await expect(drawer.getByRole("button", { name: "Revise cost" })).toHaveCount(0);
    await expect(drawer.getByRole("button", { name: "Refresh" })).toHaveCount(0);
    await expect(drawer.getByRole("button", { name: "Delete post…" })).toHaveCount(0);
  });

  test("planner and team member: see the cost, no tools, no history request", async ({ page, browser }) => {
    for (const role of ["PLAN_MAKER", "TEAM_MEMBER"] as const) {
      const ctx = role === "PLAN_MAKER" ? page : await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
      const calls = await open(ctx, role);
      await ctx.getByRole("button", { name: "Monsoon Cravings", exact: true }).click();
      const drawer = ctx.getByRole("dialog");
      await expect(drawer.getByRole("heading", { name: role === "PLAN_MAKER" ? "Cost" : "You earn" })).toBeVisible();
      await expect(drawer.getByRole("button", { name: "Revise cost" })).toHaveCount(0);
      await expect(drawer.getByRole("button", { name: "Refresh" })).toHaveCount(0);
      await expect(drawer.getByText("History")).toHaveCount(0);
      expect(calls.revisions).toBe(0);
    }
  });

  test("content page opens the same drawer", async ({ page }) => {
    await signIn(page, "ADMIN");
    await postApi(page);
    await page.goto("/content");
    await page.getByRole("button", { name: "Monsoon Cravings", exact: true }).click();
    await expect(page.getByRole("dialog").getByRole("heading", { name: "Cost" })).toBeVisible();
    await expect(page.getByRole("dialog").getByRole("button", { name: "Revise cost" })).toBeVisible();
  });
});

test.describe("Post details drawer · phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("fits a phone screen without sideways scroll", async ({ page }) => {
    await open(page, "ADMIN");
    await page.getByRole("button", { name: "Monsoon Cravings", exact: true }).click();
    await expect(page.getByRole("dialog").getByRole("heading", { name: "Cost" })).toBeVisible();
    await shot(page, "post-sheet-390");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
