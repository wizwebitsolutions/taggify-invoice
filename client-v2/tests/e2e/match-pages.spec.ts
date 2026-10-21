import { expect, test, type Page } from "@playwright/test";

import { API_URL, fillRequiredRates, mockApi, shot, signIn, type MockRole } from "./fixtures";

/** Campaign detail → Pages: match pending sheet rows to a page, or add the page and match it. API fully mocked. */

const now = new Date().toISOString();
const CAMPAIGN = { id: "c1", brandName: "Saffron Street", title: "Diwali Food Stories", deadline: null, createdAt: now, costCap: "300000", spent: 0, postCount: 0, phaseCount: 1, parentCampaignId: null, phases: [{ id: "c1", phaseNumber: 1, title: "Diwali Food Stories", createdAt: now }] };
const OWNER = { id: "o1", name: "Riya Mehta", email: "riya@example.com", phoneNumber: null };
const page_ = (id: string, handle: string, followers: number, approvalStatus = "approved") => ({ id, ownerId: OWNER.id, owner: OWNER, platform: "instagram", handle, followers, approvalStatus, createdAt: now, rateCards: [], engagement: {}, campaigns: [] });
const PAGES = [page_("a1", "riya.eats", 482000), page_("a2", "newpage_official", 91000, "pending")];
const matched = (id: string, assetId: string, handle: string) => ({ id, campaignId: "c1", assetId, pageHandle: handle, creatorPhone: null, postUrl: null, format: null, cost: null, linkId: null, status: "matched", createdAt: now, asset: { id: assetId, handle, category: "Food", approvalStatus: "approved" } });
const pending = (id: string, handle: string, creatorPhone: string | null) => ({ id, campaignId: "c1", assetId: null, pageHandle: handle, creatorPhone, postUrl: null, format: "reel", cost: null, linkId: null, status: "pending", createdAt: now });

async function matchApi(page: Page, role: MockRole, permissions?: Record<string, boolean>) {
  const user = await signIn(page, role);
  if (permissions) await signIn(page, role, { permissions: { ...user.permissions, ...permissions } });
  const rows = [matched("as1", "a1", "riya.eats"), pending("as2", "newpage.official", "+919000000099"), pending("as3", "chai.diaries", null)];
  const calls = { resolved: [] as { id: string; assetId: string }[], created: [] as Record<string, unknown>[] };
  await mockApi(page);
  await page.route(`${API_URL}/campaigns**`, (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(/^\/api\/campaigns/, "");
    const put = path.match(/^\/c1\/assignments\/([^/]+)$/);
    if (req.method() === "PUT" && put) {
      const { assetId } = req.postDataJSON();
      calls.resolved.push({ id: put[1], assetId });
      const i = rows.findIndex((r) => r.id === put[1]);
      rows[i] = matched(put[1], assetId, rows[i].pageHandle);
      return route.fulfill({ json: rows[i] });
    }
    if (path === "/c1/assignments") return route.fulfill({ json: rows });
    if (path === "/c1") return route.fulfill({ json: CAMPAIGN });
    if (path === "") return route.fulfill({ json: [CAMPAIGN] });
    return route.fulfill({ status: 404, json: {} });
  });
  await page.route(`${API_URL}/auth/signup`, (route) =>
    route.fulfill({ json: { user: { id: "o2", name: null, email: route.request().postDataJSON().email, role: "CREATOR" }, generatedPassword: "Tg-7hQ2-xP9w" } })
  );
  await page.route(`${API_URL}/links**`, (route) => route.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 100 } }));
  await page.route(`${API_URL}/assets**`, (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(/^\/api\/assets/, "");
    if (path === "/owners") return route.fulfill({ json: [OWNER] });
    if (req.method() === "POST" && path === "") {
      const body = req.postDataJSON();
      calls.created.push(body);
      return route.fulfill({ json: page_("a9", body.handle, 0) });
    }
    if (req.method() === "GET" && path === "") return route.fulfill({ json: PAGES });
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto("/campaigns/c1");
  await expect(page.getByRole("heading", { name: "Diwali Food Stories" })).toBeVisible();
  return calls;
}

test.describe("Match pending pages", () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test("admin: the tab counts rows to match; matching one to an existing page books it", async ({ page }) => {
    const calls = await matchApi(page, "ADMIN");
    await page.getByRole("tab", { name: /Pages \(1\)\s*· 2 to match/ }).click();
    const pendingCard = page.getByRole("heading", { name: "Waiting for a page (2)" });
    await expect(pendingCard).toBeVisible();
    await expect(page.getByText("+919000000099 · Reel")).toBeVisible();
    await shot(page, "match-pending-list");

    await page.getByRole("listitem").filter({ hasText: "newpage.official" }).getByRole("button", { name: "Match" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Match newpage.official" })).toBeVisible();
    await expect(dialog.getByRole("searchbox", { name: "Find a page" })).toHaveValue("newpage.official");
    await expect(dialog.getByText(/No page matches/)).toBeVisible();
    const matchBtn = dialog.getByRole("button", { name: "Match page" });
    await expect(matchBtn).toBeDisabled();
    await dialog.getByRole("searchbox", { name: "Find a page" }).fill("newpage");
    await dialog.getByRole("button", { name: /newpage_official/ }).click();
    await expect(dialog.getByText("Waiting for approval")).toBeVisible();
    await shot(page, "match-dialog");
    await matchBtn.click();
    await expect(page.getByText("newpage.official matched to newpage_official.")).toBeVisible();
    expect(calls.resolved).toEqual([{ id: "as2", assetId: "a2" }]);
    await expect(page.getByRole("heading", { name: "Waiting for a page (1)" })).toBeVisible();
    await expect(page.getByRole("tab", { name: /Pages \(2\)\s*· 1 to match/ })).toBeVisible();
  });

  test("admin: a page that isn't in Inventory is added with the sheet's handle and matched", async ({ page }) => {
    const calls = await matchApi(page, "ADMIN");
    await page.getByRole("tab", { name: /Pages/ }).click();
    await page.getByRole("listitem").filter({ hasText: "chai.diaries" }).getByRole("button", { name: "Match" }).click();
    await page.getByRole("button", { name: "Add chai.diaries as a new page" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Add as a new page" })).toBeVisible();
    await expect(dialog.getByLabel("Instagram handle or link")).toHaveValue("chai.diaries");
    await dialog.getByRole("button", { name: /Riya Mehta/ }).click();
    // Rates are optional since 16 Oct; these three are added so the create body has something to check.
    await fillRequiredRates(dialog);
    await shot(page, "match-add-new");
    await dialog.getByRole("button", { name: "Add and match" }).click();
    await expect(page.getByText("chai.diaries added and matched.")).toBeVisible();
    expect(calls.created).toEqual([expect.objectContaining({ handle: "chai.diaries", ownerId: "o1" })]);
    expect(calls.resolved).toEqual([{ id: "as3", assetId: "a9" }]);
    await expect(page.getByRole("heading", { name: "Waiting for a page (1)" })).toBeVisible();
  });

  test("admin: adding the page under a new creator login still shows the one-time password, then matches", async ({ page }) => {
    const calls = await matchApi(page, "ADMIN");
    await page.getByRole("tab", { name: /Pages/ }).click();
    await page.getByRole("listitem").filter({ hasText: "newpage.official" }).getByRole("button", { name: "Match" }).click();
    await page.getByRole("button", { name: "Add newpage.official as a new page" }).click();
    const dialog = page.getByRole("dialog");
    // The sheet's phone number seeds the creator search.
    await expect(dialog.getByRole("searchbox", { name: "Find a creator" })).toHaveValue("+919000000099");
    await dialog.getByRole("radio", { name: "New creator" }).click();
    await dialog.getByLabel("Email (their login)").fill("newpage@example.com");
    await fillRequiredRates(dialog);
    await dialog.getByRole("button", { name: "Add and match" }).click();
    await expect(dialog.getByTestId("generated-password")).toHaveText("Tg-7hQ2-xP9w");
    await expect(page.getByText("newpage.official added and matched.")).toBeVisible();
    expect(calls.resolved).toEqual([{ id: "as2", assetId: "a9" }]);
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(page.getByRole("heading", { name: "Waiting for a page (1)" })).toBeVisible();
  });

  test("campaigns.edit without Inventory access: no Match (the page list would be empty)", async ({ page }) => {
    await matchApi(page, "ADMIN", { "inventory.view": false });
    await page.getByRole("tab", { name: /Pages/ }).click();
    await expect(page.getByRole("heading", { name: "Waiting for a page (2)" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Match" })).toHaveCount(0);
  });

  test("finance (no campaigns.edit) sees what's waiting but can't match", async ({ page }) => {
    await matchApi(page, "FINANCE");
    await page.getByRole("tab", { name: /Pages/ }).click();
    await expect(page.getByRole("heading", { name: "Waiting for a page (2)" })).toBeVisible();
    await expect(page.getByText(/Someone with campaign edit and Inventory access can match them/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Match" })).toHaveCount(0);
  });
});

test.describe("Match pending pages · phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("list and dialog fit a phone screen", async ({ page }) => {
    await matchApi(page, "ADMIN");
    await page.getByRole("tab", { name: /Pages/ }).click();
    await page.getByRole("listitem").filter({ hasText: "newpage.official" }).getByRole("button", { name: "Match" }).click();
    await expect(page.getByRole("dialog").getByRole("button", { name: "Match page" })).toBeVisible();
    await shot(page, "match-dialog-390");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
