import { expect, test, type Page } from "@playwright/test";

import { API_URL, mockApi, shot, signIn, type MockRole } from "./fixtures";

/** Creator side: submit a post, fix a rejected proof, raise an invoice, own pages; team members never see Money. API fully mocked. */

const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

const page1 = { id: "a1", ownerId: "test-creator", platform: "instagram", handle: "riya.eats", followers: 482000, category: "Food", approvalStatus: "approved", createdAt: ago(900), rateCards: [{ id: "r1", format: "reel", amount: "32000" }], engagement: {} };
const page2 = { id: "a2", ownerId: "test-creator", platform: "instagram", handle: "riyatravels", followers: 310000, category: null, approvalStatus: "pending", createdAt: ago(5), rateCards: [], engagement: {} };
const campaign = { id: "c1", title: "Diwali Food Stories", brandName: "Saffron Street", createdAt: ago(200), deadline: inDays(6), bookedAssetIds: ["a1"], pageQuota: [{ assetId: "a1", booked: 2, submitted: 1 }] };
const post = (id: string, status: string, extra: Record<string, unknown> = {}) => ({
  id,
  campaignId: "c1",
  assetId: "a1",
  submittedById: "test-creator",
  url: `https://www.instagram.com/reel/${id}/`,
  format: "reel",
  cost: "32000",
  customRate: false,
  status,
  postedAt: ago(30),
  createdAt: ago(30),
  campaign: { id: "c1", title: "Diwali Food Stories", brandName: "Saffron Street" },
  asset: { id: "a1", handle: "riya.eats", platform: "instagram", followers: 482000 },
  screenshot: { id: `s${id}`, publicId: "x", approved: status === "SCREENSHOT_REJECTED" ? false : null, url: "https://example.com/proof.png" },
  postSnapshots: [],
  ...extra,
});

async function creatorApi(page: Page) {
  const calls = { created: [] as Record<string, unknown>[], confirmed: [] as string[], invoices: [] as Record<string, unknown>[], assets: [] as Record<string, unknown>[] };
  await mockApi(page);
  await page.route(`${API_URL}/campaigns`, (route) => route.fulfill({ json: [campaign] }));
  await page.route(`${API_URL}/assets`, (route) => {
    if (route.request().method() === "POST") {
      calls.assets.push(route.request().postDataJSON());
      return route.fulfill({ status: 201, json: { ...page2, id: "a3", handle: "riya.bakes" } });
    }
    return route.fulfill({ json: [page1, page2] });
  });
  await page.route(`${API_URL}/links**`, (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(/^\/api\/links/, "");
    if (req.method() === "GET" && path === "") return route.fulfill({ json: { items: [post("l1", "SCREENSHOT_REJECTED")], total: 1, page: 1, pageSize: 100 } });
    if (req.method() === "GET" && path === "/l1/timeline") return route.fulfill({ json: [{ status: "SCREENSHOT_REJECTED", note: "Views are cropped out", createdAt: ago(2) }] });
    if (req.method() === "POST" && path === "") {
      calls.created.push(req.postDataJSON());
      return route.fulfill({ status: 201, json: post("l9", "SUBMITTED", { screenshot: null }) });
    }
    if (path.endsWith("/screenshot/upload-url")) return route.fulfill({ json: { uploadUrl: "https://upload.test/image", apiKey: "k", timestamp: 1, signature: "s", publicId: "p" } });
    const confirm = path.match(/^\/([^/]+)\/screenshot$/);
    if (confirm) {
      calls.confirmed.push(confirm[1]);
      return route.fulfill({ json: { id: "s", publicId: "p", url: null } });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  await page.route("https://upload.test/**", (route) => route.fulfill({ json: {} }));
  await page.route(`${API_URL}/payments/me/pending**`, (route) =>
    route.fulfill({ json: { items: [post("l2", "INSIGHTS_APPROVED"), post("l3", "INSIGHTS_APPROVED", { cost: "18500" })], total: 2, invoices: [] } })
  );
  await page.route(`${API_URL}/payments/me/summary**`, (route) => route.fulfill({ json: { pending: { amount: 50500, links: 2, invoices: 0 }, paid: { amount: 31680, links: 1, payments: 1 } } }));
  await page.route(`${API_URL}/payments/me/paid**`, (route) =>
    route.fulfill({ json: { items: [{ kind: "payout", paidAt: ago(400), payout: { id: "p1", netAmount: "31680", tdsPercent: "1", utr: "HDFC123", receipt: { url: "https://example.com/r.pdf" } } }], total: 1 } })
  );
  await page.route(`${API_URL}/invoices**`, (route) => {
    const req = route.request();
    if (req.method() === "POST") {
      calls.invoices.push(req.postDataJSON());
      return route.fulfill({ status: 201, json: { id: "i9", invoiceNumber: "INV-2026-0042", amount: "59590", status: "RAISED", createdAt: ago(0) } });
    }
    return route.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 100 } });
  });
  return calls;
}

test.describe("Creator", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("submit a post: campaign → booked page → link + proof, then confirm the screenshot", async ({ page }) => {
    await signIn(page, "CREATOR");
    const calls = await creatorApi(page);
    await page.goto("/submit");
    await page.getByRole("button", { name: /Diwali Food Stories/ }).click();
    // Only the page booked on this campaign is offered.
    await expect(page.getByRole("button", { name: /riyatravels/ })).toHaveCount(0);
    await page.getByRole("button", { name: /riya\.eats/ }).click();
    // Only the four bookable formats (a Reel + Story combo is posted as its reel and its story); unpriced ones say so.
    const types = page.getByRole("radiogroup", { name: "Content type" });
    await expect(types.getByRole("radio")).toHaveText(["Reel", "Entertainment / Brand (no rate set)", "PR (no rate set)", "Political reel (no rate set)", "Static / Carousel (no rate set)", "Repost (no rate set)", "Story (no rate set)", "Political story (no rate set)"]);
    await expect(types.getByRole("radio", { name: "Reel", exact: true })).toHaveAttribute("aria-checked", "true");
    const submit = page.getByRole("button", { name: "Submit post" });
    await page.getByLabel("Post link").fill("not a link");
    await expect(page.getByText("Paste the full Instagram or YouTube link")).toBeVisible();
    await page.getByLabel("Post link").fill("https://www.instagram.com/reel/ABC123/");
    await expect(submit).toBeDisabled(); // proof still missing
    await page.locator('input[type="file"]').setInputFiles({ name: "proof.png", mimeType: "image/png", buffer: PNG });
    await shot(page, "creator-submit");
    await submit.click();
    await expect(page.getByRole("heading", { name: "Post submitted" })).toBeVisible();
    expect(calls.created).toEqual([{ campaignId: "c1", assetId: "a1", url: "https://www.instagram.com/reel/ABC123/", format: "reel" }]);
    expect(calls.confirmed).toEqual(["l9"]);
  });

  test("home lists a rejected proof with the reviewer's reason and re-uploads it", async ({ page }) => {
    await signIn(page, "CREATOR");
    const calls = await creatorApi(page);
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Fix these" })).toBeVisible();
    await shot(page, "creator-home");
    await page.getByRole("button", { name: "Upload new proof" }).click();
    await expect(page.getByText("Why it was rejected: Views are cropped out")).toBeVisible();
    await page.locator('[role="dialog"] input[type="file"]').setInputFiles({ name: "proof.png", mimeType: "image/png", buffer: PNG });
    await page.getByRole("button", { name: "Upload proof" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(calls.confirmed).toEqual(["l1"]);
    // Phone tab bar is there for creators.
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Money" })).toBeVisible();
  });

  test("money: select posts, add GST, raise one invoice", async ({ page }) => {
    await signIn(page, "CREATOR");
    const calls = await creatorApi(page);
    await page.goto("/money");
    await page.getByRole("checkbox", { name: "Select all posts" }).click();
    await page.getByRole("button", { name: "Raise invoice" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("radio", { name: "Add 18% GST" }).click();
    // 32,000 + 18,500 = 50,500 → +18% = 59,590
    await expect(dialog.getByText("₹59,590")).toBeVisible();
    await shot(page, "creator-money");
    await dialog.getByRole("button", { name: "Send invoice" }).click();
    await expect(page.getByText("Invoice INV-2026-0042 sent.")).toBeVisible();
    expect(calls.invoices).toEqual([{ linkIds: ["l2", "l3"], dueInDays: 15, isGstInvoice: true }]);
  });

  test("my pages: add a page; it lands waiting for approval", async ({ page }) => {
    await signIn(page, "CREATOR");
    const calls = await creatorApi(page);
    await page.goto("/pages");
    await expect(page.getByText("Waiting for approval")).toBeVisible();
    // Rate badges read as labels; a waiting page says an admin sets its rates.
    await expect(page.getByText("Reel ₹32,000")).toBeVisible();
    await expect(page.getByText("Waiting for an admin to set rates.")).toBeVisible();
    await page.getByRole("button", { name: "Add page" }).click();
    await page.getByLabel("Instagram handle").fill("@riya.bakes");
    await page.getByRole("dialog").getByRole("button", { name: "Add page" }).click();
    await expect(page.getByText("riya.bakes added. It's waiting for approval.")).toBeVisible();
    expect(calls.assets).toEqual([{ handle: "riya.bakes", platform: "instagram" }]);
  });

  test("team member: no Money, can't add pages", async ({ page }) => {
    await signIn(page, "TEAM_MEMBER");
    await creatorApi(page);
    await page.goto("/money");
    await expect(page.getByText(/don.t have access/i)).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Money" })).toHaveCount(0);
    await page.goto("/pages");
    await expect(page.getByText("riya.eats")).toBeVisible();
    await expect(page.getByRole("button", { name: "Add page" })).toHaveCount(0);
  });

  test("a post saved without its proof says so and sends the creator to Fix these", async ({ page }) => {
    await signIn(page, "CREATOR");
    const calls = await creatorApi(page);
    await page.route("https://upload.test/**", (route) => route.fulfill({ status: 500, body: "" }));
    await page.goto("/submit");
    await page.getByRole("button", { name: /Diwali Food Stories/ }).click();
    await page.getByRole("button", { name: /riya\.eats/ }).click();
    await page.getByLabel("Post link").fill("https://www.instagram.com/reel/ABC123/");
    await page.locator('input[type="file"]').setInputFiles({ name: "proof.png", mimeType: "image/png", buffer: PNG });
    await page.getByRole("button", { name: "Submit post" }).click();
    await expect(page.getByRole("heading", { name: "Post saved, but the proof didn't upload" })).toBeVisible();
    expect(calls.created).toHaveLength(1);
    expect(calls.confirmed).toEqual([]);
  });

  test("fix-proof dialog never carries one post's screenshot over to another", async ({ page }) => {
    await signIn(page, "CREATOR");
    await creatorApi(page);
    await page.route(`${API_URL}/campaigns/c1`, (route) => route.fulfill({ json: campaign }));
    await page.route(`${API_URL}/links**`, (route) => {
      const path = new URL(route.request().url()).pathname.replace(/^\/api\/links/, "");
      if (path === "") return route.fulfill({ json: { items: [post("l1", "SCREENSHOT_REJECTED"), post("l4", "SUBMITTED", { screenshot: null })], total: 2, page: 1, pageSize: 100 } });
      return route.fulfill({ json: [] });
    });
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Upload new proof" }).click();
    await page.locator('[role="dialog"] input[type="file"]').setInputFiles({ name: "first.png", mimeType: "image/png", buffer: PNG });
    await expect(page.getByRole("dialog").getByText("first.png")).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
    await page.getByRole("button", { name: "Add proof" }).click();
    await expect(page.getByRole("dialog").getByText("first.png")).toHaveCount(0);
    await expect(page.getByRole("dialog").getByRole("button", { name: "Upload proof" })).toBeDisabled();
    await page.keyboard.press("Escape");
    // The campaign room offers the same fix on the poster's own row.
    await page.goto("/campaigns/c1");
    await page.getByRole("button", { name: /Actions for/ }).first().click();
    await expect(page.getByRole("menuitem", { name: "Upload new proof…" })).toBeVisible();
  });

  test("money: a post that leaves the list is dropped from the invoice", async ({ page }) => {
    await signIn(page, "CREATOR");
    const calls = await creatorApi(page);
    await page.clock.install();
    await page.goto("/money");
    await page.getByRole("checkbox", { name: "Select all posts" }).click();
    // l3 gets picked up elsewhere; the next refetch (data stale, tab refocused) no longer returns it.
    await page.route(`${API_URL}/payments/me/pending**`, (route) => route.fulfill({ json: { items: [post("l2", "INSIGHTS_APPROVED")], total: 1, invoices: [] } }));
    await page.clock.fastForward(20_000);
    await page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
    await expect(page.getByRole("tab", { name: "Ready to invoice (1)" })).toBeVisible();
    await expect(page.getByText("1 post selected")).toBeVisible();
    await page.getByRole("button", { name: "Raise invoice" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Send invoice" }).click();
    await expect(page.getByText("Invoice INV-2026-0042 sent.")).toBeVisible();
    expect(calls.invoices).toEqual([{ linkIds: ["l2"], dueInDays: 15, isGstInvoice: false }]);
  });

  test("creator with invoicing switched off sees Money but can't raise an invoice", async ({ page }) => {
    await signIn(page, "CREATOR", { ownAccess: { "finance.edit": false } });
    await creatorApi(page);
    await page.goto("/money");
    await expect(page.getByRole("tab", { name: "Ready to invoice (2)" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Raise invoice" })).toHaveCount(0);
  });

  test("team member whose pages list comes back empty gets a clear message, not a blank step", async ({ page }) => {
    await signIn(page, "TEAM_MEMBER");
    await creatorApi(page);
    await page.route(`${API_URL}/assets`, (route) => route.fulfill({ json: [] }));
    await page.goto("/submit");
    await page.getByRole("button", { name: /Diwali Food Stories/ }).click();
    await expect(page.getByText("No booked page found")).toBeVisible();
  });

  for (const role of ["ADMIN", "FINANCE", "PLAN_MAKER"] as MockRole[]) {
    test(`${role}: creator-only screens are off`, async ({ page }) => {
      await signIn(page, role);
      await creatorApi(page);
      for (const path of ["/submit", "/money", "/pages"]) {
        await page.goto(path);
        await expect(page.getByText(/don.t have access/i)).toBeVisible();
      }
    });
  }
});
