import { expect, test, type Page } from "@playwright/test";

import { API_URL, mockApi, shot, signIn, userFor, addPlanFormat } from "./fixtures";

/** Plans: overview → detail → approve (creates the campaign), Planner own-scope, Create plan. API fully mocked. */

const PRIYA = { id: "u-priya", name: "Priya Sharma" };
const ROHAN = { id: "u-rohan", name: "Rohan Verma" };

const asset = (id: string, handle: string, followers: number, category: string, reel: number) => ({
  id,
  ownerId: `o-${id}`,
  platform: "instagram",
  handle,
  followers,
  category,
  approvalStatus: "approved",
  createdAt: "",
  rateCards: [{ id: `r-${id}`, assetId: id, format: "reel", amount: String(reel), effectiveFrom: "" }],
  engagement: { avgLikes: null, avgComments: null, avgViews: 120000, sampleSize: 3 },
});
const ASSETS = [asset("a1", "desi.memes", 1200000, "Meme page", 32000), asset("a2", "citynews.daily", 840000, "News page", 24000), asset("a3", "riya.eats", 482000, "Food", 18000)];

function plan(id: string, owner: { id: string; name: string }, status: "DRAFT" | "APPROVED" | "REJECTED", overrides: Record<string, unknown> = {}) {
  const items = [
    { id: `${id}-i1`, planId: id, assetId: "a1", format: "reel", cost: "28000", clientCost: "32000" as string | null, postsPerProfile: 2, asset: { id: "a1", handle: "desi.memes", category: "Meme page", followers: 1200000, platform: "instagram" } },
    { id: `${id}-i2`, planId: id, assetId: "a3", format: "reel", cost: "15000", clientCost: "18000", postsPerProfile: 1, asset: { id: "a3", handle: "riya.eats", category: "Food", followers: 482000, platform: "instagram" } },
  ];
  return {
    id,
    name: "Diwali Food Stories",
    clientName: "Saffron Street",
    clientContact: null,
    clientCompany: "Saffron Street Foods",
    clientGstNumber: null,
    clientAddress: null,
    clientPhone: null,
    clientInvoiceNumber: null,
    clientInvoiceAt: null,
    invoiceDescription: null,
    hsnSac: null,
    notes: "Festive food reels",
    budget: "120000",
    isGstPlan: true,
    gstPercent: 18,
    status,
    approvedAt: status === "APPROVED" ? new Date().toISOString() : null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    items,
    totalCost: 71000,
    budgetVariance: 38000,
    expectedEngagement: { likes: 0, views: 0 },
    overview: { totalFollowers: 1682000, totalPosts: 3, expectedImpressions: 0, subtotal: 82000, gstAmount: 14760, total: 96760 },
    internal: { computedFollowers: 1682000, computedPosts: 3, computedImpressions: 0, computedSubtotal: 82000, computedGstAmount: 14760, computedTotal: 96760 },
    overrideFollowers: null,
    overridePosts: null,
    overrideImpressions: null,
    overrideCost: null,
    pitchGroupId: null,
    variantLabel: "Plan A",
    clientSheetUrl: null,
    internalSheetUrl: null,
    executionSheetUrl: null,
    campaignId: status === "APPROVED" ? "camp-1" : null,
    createdBy: owner,
    ...overrides,
  };
}

/** Server-shaped plan lines from what the form sends: cost from the rate card when not given, no per-line client price. */
function lines(planId: string, items: { assetId: string; format: string; cost?: number; postsPerProfile: number }[]) {
  return items.map((i, n) => {
    const a = ASSETS.find((x) => x.id === i.assetId)!;
    return { id: `${planId}-l${n}`, planId, assetId: i.assetId, format: i.format, cost: String(i.cost ?? Number(a.rateCards[0].amount)), clientCost: null as string | null, postsPerProfile: i.postsPerProfile, asset: { id: a.id, handle: a.handle, category: a.category, followers: a.followers, platform: a.platform } };
  });
}

async function plansApi(page: Page, list: ReturnType<typeof plan>[], opts: { hidden?: string[] } = {}) {
  const calls = { approve: 0, plansRequests: 0, created: [] as Record<string, unknown>[], variants: [] as { from: string; body: Record<string, unknown> }[], updates: [] as { id: string; body: Record<string, unknown> }[], sheetRows: [] as unknown[] };
  await mockApi(page);
  await page.route(`${API_URL}/assets`, (r) => r.fulfill({ json: ASSETS }));
  await page.route(`${API_URL}/plans**`, async (route) => {
    calls.plansRequests++;
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(/^\/api\/plans/, "");
    if (req.method() === "GET" && path === "") return route.fulfill({ json: list });
    if (req.method() === "GET" && path === "/clients") return route.fulfill({ json: [{ clientName: "Saffron Street", clientCompany: "Saffron Street Foods", clientGstNumber: "27AAKCS1234L1Z5", clientAddress: "Mumbai", clientPhone: null }] });
    const variant = path.match(/^\/([^/]+)\/variant$/);
    if (req.method() === "POST" && variant) {
      const body = req.postDataJSON();
      calls.variants.push({ from: variant[1], body });
      const created = plan("p-b", PRIYA, "DRAFT", { variantLabel: "Plan B", pitchGroupId: variant[1], budget: body.budget ? String(body.budget) : null, items: lines("p-b", body.items ?? []) });
      list.push(created);
      return route.fulfill({ status: 201, json: created });
    }
    if (req.method() === "POST" && path === "/import-sheet-url") return route.fulfill({ json: { csv: "handle,posts\ncitynews.daily,2\n" } });
    const sheet = path.match(/^\/([^/]+)\/import-sheet-pages$/);
    if (req.method() === "POST" && sheet) {
      calls.sheetRows.push(...req.postDataJSON().rows);
      const p = list.find((x) => x.id === sheet[1])!;
      p.items = [...p.items, ...lines(p.id, [{ assetId: "a2", format: "reel", postsPerProfile: 2 }])];
      return route.fulfill({ json: { matchedCount: 1, createdCount: 0, addedCount: 1, failures: [], plan: p } });
    }
    const approve = path.match(/^\/([^/]+)\/approve$/);
    if (req.method() === "POST" && approve) {
      calls.approve++;
      const p = list.find((x) => x.id === approve[1])!;
      Object.assign(p, { status: "APPROVED", campaignId: "camp-1", approvedAt: new Date().toISOString() });
      return route.fulfill({ json: p });
    }
    if (req.method() === "POST" && path === "") {
      const body = req.postDataJSON();
      calls.created.push(body);
      const created = plan("p-new", PRIYA, "DRAFT", { name: body.name, items: [], budget: null, overrideCost: null });
      list.push(created);
      return route.fulfill({ status: 201, json: created });
    }
    const one = path.match(/^\/([^/]+)$/);
    if (req.method() === "PUT" && one) {
      const body = req.postDataJSON();
      calls.updates.push({ id: one[1], body });
      const p = list.find((x) => x.id === one[1])!;
      const { items, ...fields } = body;
      Object.assign(p, fields, items ? { items: lines(p.id, items) } : {});
      return route.fulfill({ json: p });
    }
    // The server 404s a planner reading another planner's plan.
    if (req.method() === "GET" && one && opts.hidden?.includes(one[1])) return route.fulfill({ status: 404, json: { error: { code: "PLAN_NOT_FOUND", message: "Plan not found" } } });
    if (req.method() === "GET" && one) return route.fulfill({ json: list.find((x) => x.id === one[1]) });
    return route.fulfill({ status: 404, json: { error: { code: "NOT_MOCKED", message: path } } });
  });
  return calls;
}

test.describe("Plans", () => {
  test.use({ viewport: { width: 1536, height: 1000 } });

  test("admin sees every plan and planner, and approving creates the campaign", async ({ page }) => {
    await signIn(page, "ADMIN");
    const calls = await plansApi(page, [plan("p1", PRIYA, "DRAFT"), plan("p2", ROHAN, "APPROVED", { name: "Festive Edit", clientName: "Loom & Lane" })]);
    await page.goto("/plans");
    await expect(page.getByRole("heading", { name: "Plans", exact: true })).toBeVisible();
    await expect(page.getByRole("row", { name: /Diwali Food Stories/ })).toContainText("Draft · awaiting approval");
    await shot(page, "plans-list");
    await page.getByRole("tab", { name: /Planners/ }).click();
    await expect(page.getByRole("row", { name: /Priya Sharma/ })).toBeVisible();
    await expect(page.getByRole("row", { name: /Rohan Verma/ })).toBeVisible();

    await page.getByRole("tab", { name: /All plans/ }).click();
    await page.getByRole("link", { name: /Diwali Food Stories/ }).click();
    await expect(page.getByRole("heading", { name: "Diwali Food Stories" })).toBeVisible();
    await expect(page.getByText("Margin")).toBeVisible();
    await shot(page, "plan-detail-draft");
    await page.getByRole("button", { name: "Approve plan" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Approve plan" }).click();
    await expect(page.getByRole("link", { name: "Open campaign" })).toHaveAttribute("href", "/campaigns/camp-1");
    await shot(page, "plan-detail-approved");
    expect(calls.approve).toBe(1);
  });

  test("clicking a planner row shows only their plans; clicking anywhere on a plan row opens it (design-fix #7)", async ({ page }) => {
    await signIn(page, "ADMIN");
    await plansApi(page, [plan("p1", PRIYA, "DRAFT"), plan("p2", ROHAN, "APPROVED", { name: "Festive Edit", clientName: "Loom & Lane" })]);
    await page.goto("/plans");
    await page.getByRole("tab", { name: /Planners/ }).click();
    await expect(page.getByRole("button", { name: "See plans" })).toHaveCount(0);
    // Click a number cell, not the name: the whole row is the target.
    await page.getByRole("row", { name: /Rohan Verma/ }).getByRole("cell").nth(1).click();
    await expect(page.getByRole("tab", { name: /All plans/ })).toHaveAttribute("data-state", "active");
    await expect(page.getByRole("combobox", { name: "Planner: Rohan Verma" })).toBeVisible();
    await expect(page.getByRole("row", { name: /Festive Edit/ })).toBeVisible();
    await expect(page.getByRole("row", { name: /Diwali Food Stories/ })).toHaveCount(0);

    await page.getByRole("row", { name: /Festive Edit/ }).getByRole("cell").nth(2).click();
    await expect(page).toHaveURL(/\/plans\/p2$/);
    await expect(page.getByRole("heading", { name: "Festive Edit" })).toBeVisible();
  });

  test("a planner can approve their own draft; another planner's plan isn't readable", async ({ page }) => {
    const planner = userFor("PLAN_MAKER");
    await signIn(page, "PLAN_MAKER");
    await plansApi(page, [plan("mine", { id: planner.id, name: "Test PLAN_MAKER" }, "DRAFT")], { hidden: ["theirs"] });
    await page.goto("/plans/mine");
    await expect(page.getByRole("button", { name: "Approve plan" })).toBeVisible();
    // Client invoices only exist for approved plans.
    await expect(page.getByRole("button", { name: "Generate client invoice" })).toHaveCount(0);
    await expect(page.getByText("Available once the plan is approved.")).toBeVisible();
    await page.goto("/plans/theirs");
    await expect(page.getByText("Couldn't load this plan")).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve plan" })).toHaveCount(0);
  });

  test("a legacy 'pending approval' plan can't be approved (the server only decides drafts)", async ({ page }) => {
    await signIn(page, "ADMIN");
    await plansApi(page, [plan("old", PRIYA, "DRAFT", { status: "PENDING_APPROVAL" })]);
    await page.goto("/plans/old");
    await expect(page.getByText("Draft · awaiting approval")).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve plan" })).toHaveCount(0);
  });

  test("a creator can't open plans and no plans data is requested", async ({ page }) => {
    await signIn(page, "CREATOR");
    const calls = await plansApi(page, [plan("p1", PRIYA, "DRAFT")]);
    await page.goto("/plans");
    await expect(page.getByRole("heading", { name: "You don't have access to plans" })).toBeVisible();
    expect(calls.plansRequests).toBe(0);
  });

  test("create plan: brief saves the draft, budget caps the picks, pricing quote and GST, then review (v1 flow)", async ({ page }) => {
    await signIn(page, "ADMIN");
    const calls = await plansApi(page, []);
    await page.goto("/plans/new");
    await expect(page.getByRole("button", { name: "Next: budget & pages" })).toBeDisabled();
    await page.getByLabel("Plan name").fill("Diwali Food Stories");
    await page.getByLabel("Client", { exact: true }).fill("Saffron Street");
    await expect(page.getByText("Saved client: Saffron Street Foods · 27AAKCS1234L1Z5")).toBeVisible();
    await page.getByLabel("Brief").fill("Festive food reels");
    await shot(page, "plan-form-basics");
    await page.getByRole("button", { name: "Next: budget & pages" }).click();
    // Step 1 creates the draft; the budget isn't part of it.
    await expect.poll(() => calls.created.length).toBe(1);
    expect(calls.created[0]).toMatchObject({ name: "Diwali Food Stories", clientName: "Saffron Street", notes: "Festive food reels", gstPercent: 18 });
    expect(calls.created[0]).not.toHaveProperty("budget");

    // No budget yet: nothing can be picked.
    await expect(page.getByRole("checkbox", { name: "Add desi.memes" })).toBeDisabled();
    await page.getByLabel("Internal budget (₹)").fill("50000");
    await page.getByRole("checkbox", { name: "Add desi.memes" }).click();
    // ₹18,000 left: citynews (₹24,000) doesn't fit, riya.eats (₹18,000) does.
    await expect(page.getByRole("checkbox", { name: "Add citynews.daily" })).toBeDisabled();
    await page.getByLabel("Add top").fill("3");
    await page.getByRole("button", { name: "by followers" }).click();
    await expect(page.getByText("Added 1 of 2.", { exact: false })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "Add riya.eats" })).toBeChecked();
    await expect(page.getByTestId("budget-meter")).toContainText("₹50,000 of ₹50,000 used");
    // Raising posts past the budget is refused.
    await page.getByLabel("Reel posts on desi.memes").fill("2");
    await expect(page.getByText("over the budget left", { exact: false })).toBeVisible();
    await shot(page, "plan-form-pages");
    await page.getByRole("button", { name: "Next: pricing" }).click();
    await expect.poll(() => calls.updates.length).toBe(1);
    expect(calls.updates[0]).toEqual({ id: "p-new", body: { budget: 50000, items: [{ assetId: "a1", format: "reel", postsPerProfile: 1 }, { assetId: "a3", format: "reel", postsPerProfile: 1 }] } });

    await page.getByLabel("Total quoted to client (₹)").fill("60000");
    await expect(page.getByText("₹70,800").first()).toBeVisible(); // 60,000 + 18% GST
    await shot(page, "plan-form-pricing");
    await page.getByRole("button", { name: "Next: review" }).click();
    await expect.poll(() => calls.updates.length).toBe(2);
    expect(calls.updates[1].body).toMatchObject({ budget: 50000, overrideCost: 60000, overrideImpressions: null, gstPercent: 18 });
    await expect(page.getByText("2 pages · 2 posts")).toBeVisible();
    await shot(page, "plan-form-review");
    await page.getByRole("button", { name: "Save draft plan" }).click();
    await expect(page).toHaveURL(/\/plans\/p-new$/);
    expect(calls.created).toHaveLength(1);
  });

  test("Edit plan reopens a draft prefilled and saves to the same plan; a per-page client price keeps its quote; approved plans can't be edited", async ({ page }) => {
    await signIn(page, "ADMIN");
    const calls = await plansApi(page, [plan("p1", PRIYA, "DRAFT"), plan("p2", ROHAN, "APPROVED", { name: "Festive Edit" })]);
    await page.goto("/plans/p2");
    await expect(page.getByRole("heading", { name: "Festive Edit" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Edit plan" })).toHaveCount(0);

    await page.goto("/plans/p1");
    await page.getByRole("link", { name: "Edit plan" }).click();
    await expect(page).toHaveURL(/\/plans\/p1\/edit$/);
    await expect(page.getByLabel("Plan name")).toHaveValue("Diwali Food Stories");
    await page.getByLabel("Brief").fill("Festive food reels, 2 rounds");
    await page.getByRole("button", { name: "Next: budget & pages" }).click();
    await expect.poll(() => calls.updates.length).toBe(1);
    expect(calls.updates[0]).toMatchObject({ id: "p1", body: { notes: "Festive food reels, 2 rounds" } });
    expect(calls.created).toEqual([]);

    await expect(page.getByLabel("Internal budget (₹)")).toHaveValue("120000");
    await expect(page.getByRole("checkbox", { name: "Add desi.memes" })).toBeChecked();
    await page.getByRole("button", { name: "Next: pricing" }).click();
    // Lines save cost-only, so the old client total is saved as the quote right away (closing here can't reprice the plan).
    await expect.poll(() => calls.updates.length).toBe(2);
    expect(calls.updates[1].body).toMatchObject({ overrideCost: 82000 });
    // The fixture's lines carry client prices (₹82,000 in total): that becomes the quote, so the price doesn't change on save.
    await expect(page.getByLabel("Total quoted to client (₹)")).toHaveValue("82000");
    await page.getByRole("button", { name: "Next: review" }).click();
    await expect.poll(() => calls.updates.length).toBe(3);
    expect(calls.updates[2].body).toMatchObject({ overrideCost: 82000, items: [{ assetId: "a1", format: "reel", cost: 28000, postsPerProfile: 2 }, { assetId: "a3", format: "reel", cost: 15000, postsPerProfile: 1 }] });
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page).toHaveURL(/\/plans\/p1$/);

    await page.goto("/plans/p2/edit");
    await expect(page.getByText("can't be edited", { exact: false })).toBeVisible();
  });

  test("New variant: client carried over, first saved on the pages step with its budget and pages in one call", async ({ page }) => {
    await signIn(page, "ADMIN");
    const calls = await plansApi(page, [plan("p1", PRIYA, "DRAFT")]);
    await page.goto("/plans/p1");
    await page.getByRole("link", { name: "New variant" }).click();
    await expect(page).toHaveURL(/\/plans\/new\?variantOf=p1$/);
    await expect(page.getByRole("heading", { name: "New variant" })).toBeVisible();
    await expect(page.getByText("Carried over from Plan A.", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Next: budget & pages" }).click();
    expect(calls.variants).toEqual([]);

    await page.getByLabel("Internal budget (₹)").fill("100000");
    await page.getByRole("checkbox", { name: "Add riya.eats" }).click();
    await page.getByRole("button", { name: "Next: pricing" }).click();
    await expect.poll(() => calls.variants.length).toBe(1);
    expect(calls.variants[0]).toEqual({ from: "p1", body: { budget: 100000, items: [{ assetId: "a3", format: "reel", postsPerProfile: 1 }] } });
    await page.getByRole("button", { name: "Next: review" }).click();
    await expect.poll(() => calls.updates.at(-1)?.id).toBe("p-b");
    await page.getByRole("button", { name: "Save draft plan" }).click();
    await expect(page).toHaveURL(/\/plans\/p-b$/);
    expect(calls.created).toEqual([]);
  });

  test("a variant of an older plan with no brief can still be made (the brief isn't editable there)", async ({ page }) => {
    await signIn(page, "ADMIN");
    await plansApi(page, [plan("p1", PRIYA, "DRAFT", { notes: null })]);
    await page.goto("/plans/new?variantOf=p1");
    await expect(page.getByText("Carried over from Plan A.", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: "Next: budget & pages" })).toBeEnabled();
  });

  test("attaching a Google Sheet of pages adds them to the selection", async ({ page }) => {
    await signIn(page, "ADMIN");
    const calls = await plansApi(page, [plan("p1", PRIYA, "DRAFT")]);
    await page.goto("/plans/p1/edit");
    await page.getByRole("button", { name: "Next: budget & pages" }).click();
    await page.getByLabel("Google Sheet link").fill("https://docs.google.com/spreadsheets/d/abc/edit");
    await page.getByRole("button", { name: "Fetch" }).click();
    await expect(page.getByText("1 matched, 0 new pages created.")).toBeVisible();
    expect(calls.sheetRows).toEqual([{ handle: "citynews.daily", postsPerProfile: 2 }]);
    await expect(page.getByRole("button", { name: "Remove citynews.daily" })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "Add citynews.daily" })).toBeChecked();
  });

  test("a sheet listing a page that's already picked doesn't duplicate it, and unsaved edits survive the import", async ({ page }) => {
    await signIn(page, "ADMIN");
    await plansApi(page, [plan("p1", PRIYA, "DRAFT")]);
    await page.goto("/plans/p1/edit");
    await page.getByRole("button", { name: "Next: budget & pages" }).click();
    await page.getByRole("checkbox", { name: "Add citynews.daily" }).click();
    await page.getByLabel("Reel posts on riya.eats").fill("2");
    await page.getByLabel("Google Sheet link").fill("https://docs.google.com/spreadsheets/d/abc/edit");
    await page.getByRole("button", { name: "Fetch" }).click();
    await expect(page.getByText("1 matched, 0 new pages created.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Remove citynews.daily" })).toHaveCount(1);
    await expect(page.getByLabel("Reel posts on riya.eats")).toHaveValue("2");
  });

  test("posts are whole numbers and pricing the server would refuse blocks Next", async ({ page }) => {
    await signIn(page, "ADMIN");
    const calls = await plansApi(page, [plan("p1", PRIYA, "DRAFT")]);
    await page.goto("/plans/p1/edit");
    await page.getByRole("button", { name: "Next: budget & pages" }).click();
    await page.getByLabel("Reel posts on riya.eats").fill("1.5");
    await expect(page.getByLabel("Reel posts on riya.eats")).toHaveValue("1");
    await page.getByRole("button", { name: "Next: pricing" }).click();
    await expect(page.getByLabel("Expected impressions")).toBeVisible();
    await page.getByLabel("Expected impressions").fill("12.5");
    await expect(page.getByText("Use a whole number, or leave it blank.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Next: review" })).toBeDisabled();
    await page.getByLabel("Expected impressions").fill("");
    await page.getByLabel("Total quoted to client (₹)").fill("-5");
    await expect(page.getByRole("button", { name: "Next: review" })).toBeDisabled();
    const saves = calls.updates.length;
    await page.getByLabel("Total quoted to client (₹)").fill("90000");
    await page.getByRole("button", { name: "Next: review" }).click();
    await expect.poll(() => calls.updates.length).toBe(saves + 1);
  });

  test("an inactive page isn't offered when picking pages for a plan (8 Oct)", async ({ page }) => {
    await signIn(page, "ADMIN");
    await plansApi(page, []);
    await page.route(`${API_URL}/assets`, (r) => r.fulfill({ json: [ASSETS[0], { ...ASSETS[1], isActive: false }, ASSETS[2]] }));
    await page.goto("/plans/new");
    await page.getByLabel("Plan name").fill("Diwali Food Stories");
    await page.getByLabel("Client", { exact: true }).fill("Saffron Street");
    await page.getByLabel("Brief").fill("Festive food reels");
    await page.getByRole("button", { name: "Next: budget & pages" }).click();
    await expect(page.getByRole("checkbox", { name: "Add desi.memes" })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "Add citynews.daily" })).toHaveCount(0);
  });

  test("a page can have both a reel and a story, each with its own posts (8 Oct)", async ({ page }) => {
    await signIn(page, "ADMIN");
    const calls = await plansApi(page, []);
    const both = { ...ASSETS[0], rateCards: [...ASSETS[0].rateCards, { id: "r-a1-s", assetId: "a1", format: "story", amount: "12000", effectiveFrom: "" }] };
    await page.route(`${API_URL}/assets`, (r) => r.fulfill({ json: [both, ASSETS[1], ASSETS[2]] }));
    await page.goto("/plans/new");
    await page.getByLabel("Plan name").fill("Diwali Food Stories");
    await page.getByLabel("Client", { exact: true }).fill("Saffron Street");
    await page.getByLabel("Brief").fill("Festive food reels");
    await page.getByRole("button", { name: "Next: budget & pages" }).click();
    await page.getByLabel("Internal budget (₹)").fill("100000");
    await page.getByRole("checkbox", { name: "Add desi.memes" }).click();
    // The page starts on its first priced format (Reel); more formats come from the "Add a format…" select (16 Oct).
    await expect(page.getByTestId("plan-line-a1-reel")).toBeVisible();
    await addPlanFormat(page, "desi.memes", "Story");
    await page.getByLabel("Story posts on desi.memes").fill("2");
    await expect(page.getByTestId("budget-meter")).toContainText("₹56,000 of ₹1,00,000 used"); // 32,000 + 2 × 12,000
    // The last format can't be removed; × on the page removes the page.
    await page.getByRole("button", { name: "Remove Story on desi.memes" }).click();
    await page.getByRole("button", { name: "Remove Reel on desi.memes" }).click();
    await expect(page.getByText("needs at least one format", { exact: false })).toBeVisible();
    await addPlanFormat(page, "desi.memes", "Story");
    await page.getByLabel("Story posts on desi.memes").fill("2");
    await page.getByRole("button", { name: "Next: pricing" }).click();
    await expect.poll(() => calls.updates.length).toBe(1);
    expect(calls.updates[0].body.items).toEqual([
      { assetId: "a1", format: "reel", postsPerProfile: 1 },
      { assetId: "a1", format: "story", postsPerProfile: 2 },
    ]);
  });

  test("every format can be added from the select; an unpriced one needs its cost typed; a Reel + Story combo shows its split and counts as 2 posts (14 Oct, 16 Oct)", async ({ page }) => {
    await signIn(page, "ADMIN");
    const calls = await plansApi(page, []);
    const rate = (format: string, amount: number) => ({ id: `r-a1-${format}`, assetId: "a1", format, amount: String(amount), effectiveFrom: "" });
    const combo = { ...ASSETS[0], rateCards: [rate("reel", 20000), rate("story", 15000), rate("post", 12000), rate("reel_story", 30000)] };
    await page.route(`${API_URL}/assets`, (r) => r.fulfill({ json: [combo, ASSETS[1], ASSETS[2]] }));
    await page.goto("/plans/new");
    await page.getByLabel("Plan name").fill("Diwali Food Stories");
    await page.getByLabel("Client", { exact: true }).fill("Saffron Street");
    await page.getByLabel("Brief").fill("Festive food reels");
    await page.getByRole("button", { name: "Next: budget & pages" }).click();
    await page.getByLabel("Internal budget (₹)").fill("100000");
    await page.getByRole("checkbox", { name: "Add desi.memes" }).click();
    // The select lists every format not yet on the page, with its rate or "no rate".
    await page.getByRole("combobox", { name: "Add a format for desi.memes" }).click();
    for (const f of ["Story", "Static / Carousel", "Political reel", "Reel + Story", "Repost + Story"]) await expect(page.getByRole("option", { name: new RegExp(`^${f.replace(/[+/]/g, "\\$&")}`) })).toBeVisible();
    await expect(page.getByRole("option", { name: /^Political reel/ })).toContainText("no rate");
    await page.keyboard.press("Escape");
    // No Political reel rate on this page: the line is added anyway and asks for its cost; Next waits for it.
    await addPlanFormat(page, "desi.memes", "Political reel");
    await expect(page.getByText("desi.memes has no Political reel rate. Type its cost on the line.")).toBeVisible();
    await expect(page.getByTestId("unpriced-lines-warning")).toContainText("1 line has no cost yet");
    await expect(page.getByRole("button", { name: "Next: pricing" })).toBeDisabled();
    await page.getByLabel("Political reel cost on desi.memes").fill("5000");
    await expect(page.getByTestId("unpriced-lines-warning")).toHaveCount(0);
    await page.getByRole("button", { name: "Remove Political reel on desi.memes" }).click();
    await addPlanFormat(page, "desi.memes", "Reel + Story");
    await expect(page.getByLabel("Reel + Story posts on desi.memes")).toHaveValue("1");
    // ₹30,000 split by the page's Reel ₹20,000 / Story ₹15,000 rates, in paise; the halves add up to ₹30,000.
    await expect(page.getByText("Reel ₹17,142.85 + Story ₹12,857.15")).toBeVisible();
    await expect(page.getByTestId("budget-meter")).toContainText("₹50,000 of ₹1,00,000 used");
    await expect(page.getByText("3 posts · our cost")).toBeVisible(); // reel 1 + combo 2
    await shot(page, "plan-combo-line");
    await page.getByRole("button", { name: "Next: pricing" }).click();
    await expect.poll(() => calls.updates.length).toBe(1);
    expect(calls.updates[0].body.items).toEqual([
      { assetId: "a1", format: "reel", postsPerProfile: 1 },
      { assetId: "a1", format: "reel_story", postsPerProfile: 1 },
    ]);
    await expect(page.getByText("1 pages · 3 posts")).toBeVisible();
  });

  test("plan detail: a combo line shows the server's split (14 Oct)", async ({ page }) => {
    await signIn(page, "ADMIN");
    const p = plan("p1", PRIYA, "DRAFT");
    p.items = [{ ...p.items[0], format: "reel_story", cost: "30000", clientCost: null, postsPerProfile: 1, comboSplit: { reel: 17142.85, story: 12857.15 } } as (typeof p.items)[number]];
    await plansApi(page, [p]);
    await page.goto("/plans/p1");
    const row = page.getByRole("row").filter({ hasText: "desi.memes" });
    await expect(row).toContainText("Reel + Story");
    await expect(row).toContainText("Reel ₹17,142.85 + Story ₹12,857.15");
  });

  test("editing a plan with a legacy carousel line priced differently from its post line keeps both prices (review fix, 14 Oct)", async ({ page }) => {
    await signIn(page, "ADMIN");
    const p = plan("p1", PRIYA, "DRAFT");
    const a1 = p.items[0];
    // Legacy line first: merging would keep ₹9,000 for all 3 posts and reprice the ₹12,000 post on save.
    p.items = [
      { ...a1, id: "p1-c", format: "carousel", cost: "9000", clientCost: null, postsPerProfile: 2 },
      { ...a1, id: "p1-p", format: "post", cost: "12000", clientCost: null, postsPerProfile: 1 },
    ];
    const calls = await plansApi(page, [p]);
    const withPost = { ...ASSETS[0], rateCards: [...ASSETS[0].rateCards, { id: "r-a1-p", assetId: "a1", format: "post", amount: "12000", effectiveFrom: "" }] };
    await page.route(`${API_URL}/assets`, (r) => r.fulfill({ json: [withPost, ASSETS[1], ASSETS[2]] }));
    await page.goto("/plans/p1/edit");
    await page.getByRole("button", { name: "Next: budget & pages" }).click();

    const postLines = page.getByLabel("Static / Carousel posts on desi.memes");
    await expect(postLines).toHaveCount(2);
    await expect(postLines.nth(0)).toHaveValue("2");
    await expect(postLines.nth(1)).toHaveValue("1");
    const postCosts = page.getByLabel("Static / Carousel cost on desi.memes");
    await expect(postCosts.nth(0)).toHaveValue("9000");
    await expect(postCosts.nth(1)).toHaveAttribute("placeholder", "12000");
    await expect(page.getByTestId("budget-meter")).toContainText("₹30,000"); // 2 × 9,000 + 12,000 — nothing repriced
    // The legacy line is flagged to be sorted out by hand; removing it leaves the post line at its own price.
    await expect(page.getByText("Plans no longer use this format", { exact: false })).toHaveCount(1);
    await page.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(postLines).toHaveCount(1);
    await page.getByRole("button", { name: "Next: pricing" }).click();
    await expect.poll(() => calls.updates.some((u) => Array.isArray(u.body.items))).toBe(true);
    expect(calls.updates.find((u) => Array.isArray(u.body.items))!.body.items).toEqual([{ assetId: "a1", format: "post", cost: 12000, postsPerProfile: 1 }]);
  });

  // 16 Oct: the layout is picked only in the dialog "Client sheet" opens; the form's last step and the plan page carry no format control.
  test("sheet format: asked for when creating the client sheet, nowhere else", async ({ page }) => {
    await signIn(page, "ADMIN");
    const calls = await plansApi(page, [plan("p1", PRIYA, "DRAFT")]);
    const sheets: unknown[] = [];
    await page.route(`${API_URL}/plans/p1/sheet*`, (r) => {
      sheets.push(r.request().postDataJSON());
      return r.fulfill({ json: { spreadsheetUrl: "https://docs.google.com/spreadsheets/d/s1/edit" } });
    });
    await page.goto("/plans/p1/edit");
    await page.getByRole("button", { name: "Next: budget & pages" }).click();
    await page.getByRole("button", { name: "Next: pricing" }).click();
    await page.getByRole("button", { name: "Next: review" }).click();
    await expect(page.getByRole("radiogroup", { name: "Google Sheet format" })).toHaveCount(0);
    const before = calls.updates.length;
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page).toHaveURL(/\/plans\/p1$/);
    expect(calls.updates.slice(before)).toEqual([]);

    await expect(page.getByText("Sheet format:")).toHaveCount(0);
    await page.getByTestId("client-sheet-button").click();
    const dialog = page.getByTestId("client-sheet-dialog");
    await expect(dialog.getByRole("radio", { name: /Category breakdown/ })).toHaveAttribute("aria-checked", "true");
    await dialog.getByRole("radio", { name: /Campaign summary/ }).click();
    const [tab] = await Promise.all([page.waitForEvent("popup"), dialog.getByTestId("client-sheet-generate").click()]);
    await tab.close();
    await expect.poll(() => sheets).toEqual([{ sheetFormat: "summary" }]);
  });

  test("a rejected plan can be approved again, but not rejected twice (8 Oct)", async ({ page }) => {
    await signIn(page, "ADMIN");
    const calls = await plansApi(page, [plan("p1", PRIYA, "REJECTED")]);
    await page.goto("/plans/p1");
    await expect(page.getByText("Rejected. You can still approve it", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reject", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Approve plan" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Approve plan" }).click();
    await expect.poll(() => calls.approve).toBe(1);
  });
});

// 16 Oct — "chaahe budget 3.5 lac ho jae pr add hone chahie pages": the budget is a target, not a cap.
test("over budget is a warning, not a block: pages still get added, the meter turns red, Next stays enabled", async ({ page }) => {
  await signIn(page, "ADMIN");
  const calls = await plansApi(page, []);
  await page.goto("/plans/new");
  await page.getByLabel("Plan name").fill("Diwali Food Stories");
  await page.getByLabel("Client", { exact: true }).fill("Saffron Street");
  await page.getByLabel("Brief").fill("Festive food reels");
  await page.getByRole("button", { name: "Next: budget & pages" }).click();
  await page.getByLabel("Internal budget (₹)").fill("20000");
  await page.getByRole("checkbox", { name: "Add desi.memes" }).click(); // reel ₹32,000
  await expect(page.getByTestId("budget-meter")).toContainText("Over budget by");
  await expect(page.getByTestId("over-budget-warning")).toContainText("Over budget by ₹12,000");
  await expect(page.getByRole("checkbox", { name: "Add desi.memes" })).toBeChecked();
  const next = page.getByRole("button", { name: "Next: pricing" });
  await expect(next).toBeEnabled();
  await next.click();
  await expect.poll(() => calls.updates.length).toBe(1);
  expect(calls.updates[0].body).toMatchObject({ budget: 20000 });
});
