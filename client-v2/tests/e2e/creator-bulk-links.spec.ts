import { expect, test, type Page } from "@playwright/test";

import { API_URL, mockApi, shot, signIn } from "./fixtures";

/** Creator /submit "Paste several links" (v1 Upload links): one campaign/page/format, many URLs, skipped ones explained. API fully mocked. */

const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

const page1 = { id: "a1", ownerId: "test-creator", platform: "instagram", handle: "riya.eats", followers: 482000, category: "Food", approvalStatus: "approved", createdAt: ago(900), rateCards: [{ id: "r1", format: "reel", amount: "32000" }], engagement: {} };
const page2 = { id: "a2", ownerId: "test-creator", platform: "instagram", handle: "riyatravels", followers: 310000, category: null, approvalStatus: "approved", createdAt: ago(50), rateCards: [{ id: "r2", format: "story", amount: "9000" }], engagement: {} };
const diwali = { id: "c1", title: "Diwali Food Stories", brandName: "Saffron Street", createdAt: ago(200), deadline: inDays(6), bookedAssetIds: ["a1"], pageQuota: [{ assetId: "a1", booked: 3, submitted: 1 }] };
const monsoon = { id: "c2", title: "Monsoon Escapes", brandName: "Wander Co", createdAt: ago(100), deadline: inDays(9), bookedAssetIds: ["a2"], pageQuota: [{ assetId: "a2", booked: 2, submitted: 0 }] };
const created = (id: string, url: string) => ({ id, campaignId: "c1", assetId: "a1", url, format: "reel", cost: "32000", status: "SUBMITTED", screenshot: null, createdAt: ago(0) });

async function bulkApi(page: Page) {
  const calls = { bulk: [] as Record<string, unknown>[], single: 0, campaignGets: 0 };
  await mockApi(page);
  await page.route(`${API_URL}/campaigns`, (route) => {
    calls.campaignGets++;
    return route.fulfill({ json: [diwali, monsoon] });
  });
  await page.route(`${API_URL}/assets`, (route) => route.fulfill({ json: [page1, page2] }));
  await page.route(`${API_URL}/links**`, (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(/^\/api\/links/, "");
    if (req.method() === "GET" && path === "") return route.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 100 } });
    if (req.method() === "POST" && path === "/bulk") {
      calls.bulk.push(req.postDataJSON());
      return route.fulfill({
        status: 201,
        json: {
          created: [created("l1", "https://www.instagram.com/reel/AAA/"), created("l2", "https://www.instagram.com/reel/BBB/")],
          skipped: [
            { url: "https://www.instagram.com/reel/OLD/", reason: "Already submitted" },
            { url: "https://example.com/post/1", reason: "Not an Instagram or YouTube link" },
          ],
          totalSubmitted: 4,
        },
      });
    }
    if (req.method() === "POST" && path === "") calls.single++;
    return route.fulfill({ status: 404, json: {} });
  });
  return calls;
}

test.describe("Creator bulk links", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("paste several links: one request, created count and each skipped reason", async ({ page }) => {
    await signIn(page, "CREATOR");
    const calls = await bulkApi(page);
    await page.goto("/submit");
    await page.getByRole("radio", { name: "Paste several links" }).click();
    // First open campaign and its only booked page are picked; the page has no story rate.
    await expect(page.getByLabel("Campaign")).toContainText("Diwali Food Stories");
    await expect(page.getByLabel("Page")).toContainText("riya.eats");
    await expect(page.getByTestId("bulk-quota")).toContainText("1 of 3 booked posts up · 2 posts to go");
    await expect(page.getByRole("radiogroup", { name: "Content type" }).getByRole("radio")).toHaveText(["Reel", "Entertainment / Brand (no rate set)", "PR (no rate set)", "Political reel (no rate set)", "Static / Carousel (no rate set)", "Repost (no rate set)", "Story (no rate set)", "Political story (no rate set)"]);
    await expect(page.getByRole("radio", { name: "Reel", exact: true })).toHaveAttribute("aria-checked", "true");
    // A line that isn't a web address would fail the whole request on the server, so it's caught first.
    await page.getByLabel(/Post links/).fill("https://www.instagram.com/reel/AAA/\nnot-a-link\n");
    await expect(page.getByRole("alert").filter({ hasText: "This line isn't a link" })).toContainText("not-a-link");
    await expect(page.getByRole("button", { name: "Submit 2 links" })).toBeDisabled();
    await page.getByLabel(/Post links/).fill("https://www.instagram.com/reel/AAA/\n\n  https://www.instagram.com/reel/BBB/ \nhttps://www.instagram.com/reel/OLD/\nhttps://example.com/post/1\n");
    await expect(page.getByRole("alert").filter({ hasText: "isn't a link" })).toHaveCount(0);
    await shot(page, "creator-bulk-links");
    await page.getByRole("button", { name: "Submit 4 links" }).click();

    const result = page.getByTestId("bulk-result");
    await expect(result.getByRole("heading", { name: "2 links submitted" })).toBeVisible();
    await expect(result.getByText("2 skipped")).toBeVisible();
    await expect(result.getByText("Already submitted")).toBeVisible();
    await expect(result.getByText("Not an Instagram or YouTube link")).toBeVisible();
    await expect(result.getByText(/Fix these/)).toBeVisible();
    expect(calls.bulk).toEqual([
      {
        campaignId: "c1",
        assetId: "a1",
        format: "reel",
        urls: ["https://www.instagram.com/reel/AAA/", "https://www.instagram.com/reel/BBB/", "https://www.instagram.com/reel/OLD/", "https://example.com/post/1"],
      },
    ]);
    expect(calls.single).toBe(0);
    // Campaign quotas are refetched after the submit.
    await expect.poll(() => calls.campaignGets).toBeGreaterThan(1);
  });

  test("?campaign= preselects the campaign in both modes", async ({ page }) => {
    await signIn(page, "CREATOR");
    const calls = await bulkApi(page);
    await page.goto("/submit?campaign=c2");
    // One post: straight to the page step for that campaign.
    await expect(page.getByText("Monsoon Escapes")).toBeVisible();
    await expect(page.getByRole("button", { name: /riyatravels/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /riya\.eats/ })).toHaveCount(0);
    await page.getByRole("radio", { name: "Paste several links" }).click();
    await expect(page.getByLabel("Campaign")).toContainText("Monsoon Escapes");
    await expect(page.getByLabel("Page")).toContainText("riyatravels");
    // This page only has a story rate, so story is picked.
    await expect(page.getByRole("radio", { name: "Story", exact: true })).toHaveAttribute("aria-checked", "true");
    await page.getByLabel(/Post links/).fill("https://www.instagram.com/stories/x/1/");
    await page.getByRole("button", { name: "Submit link" }).click();
    await expect(page.getByTestId("bulk-result")).toBeVisible();
    expect(calls.bulk).toEqual([{ campaignId: "c2", assetId: "a2", format: "story", urls: ["https://www.instagram.com/stories/x/1/"] }]);
  });

  test("&mode=bulk opens the paste box straight away", async ({ page }) => {
    await signIn(page, "CREATOR");
    await bulkApi(page);
    await page.goto("/submit?campaign=c1&mode=bulk");
    await expect(page.getByRole("radio", { name: "Paste several links" })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByLabel("Campaign")).toContainText("Diwali Food Stories");
  });

  test("staff can't use creator submit", async ({ page }) => {
    await signIn(page, "FINANCE");
    await bulkApi(page);
    await page.goto("/submit?campaign=c1&mode=bulk");
    await expect(page.getByText(/don.t have access/i)).toBeVisible();
    await expect(page.getByLabel(/Post links/)).toHaveCount(0);
  });
});
