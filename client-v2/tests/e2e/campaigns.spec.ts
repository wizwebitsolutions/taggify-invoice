import { expect, test, type Page } from "@playwright/test";

import { API_URL, mockApi, shot, signIn } from "./fixtures";

/** Campaigns list + control room. API fully mocked. */

const future = new Date(Date.now() + 10 * 86_400_000).toISOString();
const CAMPAIGN = {
  id: "c1",
  brandName: "Saffron Street",
  title: "Diwali Food Stories",
  deadline: future,
  createdAt: new Date().toISOString(),
  costCap: "300000",
  spent: 186500,
  remainingBudget: 113500,
  postCount: 3,
  pendingAssignmentCount: 1,
  phaseCount: 1,
  parentCampaignId: null,
  phases: [{ id: "c1", phaseNumber: 1, title: "Diwali Food Stories", createdAt: "" }],
  yourEarnings: 18000,
  pageQuota: [{ assetId: "a1", booked: 2, submitted: 1 }],
};
const asset = (id: string, handle: string, followers: number) => ({ id, handle, platform: "instagram", followers, category: "Food", ownerId: "o1" });
const post = (id: string, assetId: string, handle: string, caption: string, status: string, cost: number) => ({
  id,
  campaignId: "c1",
  assetId,
  submittedById: "o1",
  url: `https://instagram.com/p/${id}`,
  format: "reel",
  cost: String(cost),
  customRate: false,
  status,
  postedAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  asset: asset(assetId, handle, 482000),
  screenshot: { id: `s-${id}`, publicId: "x", approved: null, url: "https://example.com/proof.png" },
  postSnapshots: [{ likeCount: 1, commentsCount: 1, videoViews: 1, capturedAt: "", caption, thumbnailUrl: null }],
});
const POSTS = [post("l1", "a1", "riya.eats", "Monsoon Cravings", "INSIGHTS_APPROVED", 18000), post("l2", "a2", "desi.memes", "Diwali Thali Hacks", "PENDING_SCREENSHOT_REVIEW", 32000), post("l3", "a2", "desi.memes", "Lights and Laddoos", "SCREENSHOT_REJECTED", 9000)];
const ASSIGNMENTS = [
  { id: "as1", campaignId: "c1", assetId: "a1", pageHandle: "riya.eats", creatorPhone: null, postUrl: null, format: null, cost: null, linkId: null, status: "matched", createdAt: "", asset: { id: "a1", handle: "riya.eats", category: "Food", approvalStatus: "approved" } },
  { id: "as2", campaignId: "c1", assetId: "a1", pageHandle: "riya.eats", creatorPhone: null, postUrl: null, format: null, cost: null, linkId: null, status: "matched", createdAt: "", asset: { id: "a1", handle: "riya.eats", category: "Food", approvalStatus: "approved" } },
  { id: "as3", campaignId: "c1", assetId: "a2", pageHandle: "desi.memes", creatorPhone: null, postUrl: null, format: null, cost: null, linkId: null, status: "matched", createdAt: "", asset: { id: "a2", handle: "desi.memes", category: "Meme page", approvalStatus: "approved" } },
  { id: "as4", campaignId: "c1", assetId: null, pageHandle: "newpage.official", creatorPhone: "+919000000099", postUrl: null, format: null, cost: null, linkId: null, status: "pending", createdAt: "" },
];

async function campaignApi(page: Page) {
  const calls = { invalid: [] as { id: string; note: string }[], assignments: 0 };
  await mockApi(page);
  await page.route(`${API_URL}/campaigns**`, (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api\/campaigns/, "");
    if (path === "") return route.fulfill({ json: [CAMPAIGN] });
    if (path === "/c1") return route.fulfill({ json: CAMPAIGN });
    if (path === "/c1/assignments") {
      calls.assignments++;
      return route.fulfill({ json: ASSIGNMENTS });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  await page.route(`${API_URL}/links**`, (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(/^\/api\/links/, "");
    if (req.method() === "GET" && path === "") return route.fulfill({ json: { items: POSTS, total: POSTS.length, page: 1, pageSize: 100 } });
    const m = path.match(/^\/([^/]+)\/mark-invalid$/);
    if (req.method() === "POST" && m) {
      calls.invalid.push({ id: m[1], note: req.postDataJSON().note });
      return route.fulfill({ json: { ...POSTS.find((p) => p.id === m[1]), status: "INVALID" } });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  return calls;
}

test.describe("Campaigns", () => {
  test.use({ viewport: { width: 1536, height: 1000 } });

  test("admin: list shows progress and spend; control room filters and marks a broken link", async ({ page }) => {
    await signIn(page, "ADMIN");
    const calls = await campaignApi(page);
    await page.goto("/campaigns");
    const row = page.getByRole("row", { name: /Diwali Food Stories/ });
    await expect(row).toContainText("₹1,86,500");
    await expect(row).toContainText("1 page not in Inventory");
    await shot(page, "campaigns-list");
    await row.getByRole("link", { name: /Diwali Food Stories/ }).click();

    await expect(page.getByRole("heading", { name: "Diwali Food Stories" })).toBeVisible();
    await expect(page.getByText("2 / 3")).toBeVisible(); // riya.eats 1 of 2 + desi.memes 1 of 1 (its 2nd post is extra)
    await page.getByRole("radio", { name: /Needs fixing/ }).click();
    await expect(page.getByRole("row", { name: /Lights and Laddoos/ })).toBeVisible();
    await expect(page.getByRole("row", { name: /Monsoon Cravings/ })).toHaveCount(0);
    await shot(page, "campaign-room");

    await page.getByRole("radio", { name: /^All/ }).click();
    await page.getByRole("button", { name: "Actions for Diwali Thali Hacks" }).click();
    await page.getByRole("menuitem", { name: "Mark as broken…" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: "Mark as broken" })).toBeDisabled();
    await dialog.getByLabel("What's wrong").fill("Post deleted");
    await dialog.getByRole("button", { name: "Mark as broken" }).click();
    await expect(dialog).toBeHidden();
    expect(calls.invalid).toEqual([{ id: "l2", note: "Post deleted" }]);

    await page.getByRole("tab", { name: /Pages/ }).click();
    await expect(page.getByRole("row", { name: /riya\.eats/ })).toContainText("1 missing");
    await expect(page.getByText("newpage.official")).toBeVisible();
  });

  test("clicking anywhere on a campaign row opens it, not only the name (design-fix #2)", async ({ page }) => {
    await signIn(page, "ADMIN");
    await campaignApi(page);
    await page.goto("/campaigns");
    await page.getByRole("row", { name: /Diwali Food Stories/ }).getByRole("cell").nth(1).click();
    await expect(page).toHaveURL(/\/campaigns\/[^/]+$/);
    await expect(page.getByRole("heading", { name: "Diwali Food Stories" })).toBeVisible();
  });

  test("a planner sees spend, bookings and Add phase on their campaign, not 'Your earnings'", async ({ page }) => {
    await signIn(page, "PLAN_MAKER");
    await campaignApi(page);
    await page.goto("/campaigns/c1");
    await expect(page.getByText("Spend", { exact: true })).toBeVisible();
    await expect(page.getByText("Your earnings")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Add phase" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit details" })).toHaveCount(0);
    // Mark as broken needs links.edit, which a planner doesn't have.
    await page.getByRole("button", { name: "Actions for Monsoon Cravings" }).click();
    await expect(page.getByRole("menuitem", { name: "Mark as broken…" })).toHaveCount(0);
  });

  test("creator sees their earnings and posts, never spend, budget or bookings", async ({ page }) => {
    await signIn(page, "CREATOR");
    const calls = await campaignApi(page);
    await page.goto("/campaigns");
    await expect(page.getByRole("heading", { name: "My campaigns" })).toBeVisible();
    const row = page.getByRole("row", { name: /Diwali Food Stories/ });
    await expect(row).toContainText("1 of 2 posted");
    await expect(row).toContainText("₹18,000");
    await expect(row).not.toContainText("₹1,86,500");
    await row.getByRole("link", { name: /Diwali Food Stories/ }).click();
    await expect(page.getByText("Your earnings")).toBeVisible();
    await expect(page.getByText("Spend", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: /Pages/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Edit details" })).toHaveCount(0);
    expect(calls.assignments).toBe(0);
  });
});
