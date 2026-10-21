import { expect, test, type Page } from "@playwright/test";

import { API_URL, mockApi, shot, signIn, userFor, type MockRole } from "./fixtures";

/**
 * Plans sheet tools: "New plan from sheet", the plan's "From a sheet" card (Sync from
 * sheet, Complete details → add a waiting page) and the execution sheet format dialog.
 * API fully mocked.
 */

const now = new Date().toISOString();
const SHEET = "https://docs.google.com/spreadsheets/d/abc123/edit";

const DETAILS_TAB = ["Field,Value", "Plan name,Holi Colours", "Client name,Saffron Street", "Budget,\"1,50,000\"", "GST %,18"].join("\n");
const PAGES_TAB = ["Handle,Page link,Category,Followers,Format,Posts per profile,Cost,Client cost", "@desi.memes,https://www.instagram.com/desi.memes/,Meme page,1.2M,Reel,2,28000,32000", "chai.diaries,,Food,85K,Story,1,9000,"].join("\n");

const PENDING = [
  { kind: "page", handle: "chai.diaries", pageUrl: null, category: "Food", followers: 85000, format: "story", cost: 9000, clientCost: null, postsPerProfile: 1, reason: "Not in Creators yet" },
  { kind: "page", handle: "nocost.page", pageUrl: null, category: null, followers: null, format: "reel", cost: null, clientCost: null, postsPerProfile: 1, reason: "No cost" },
];

function plan(id: string, status: "DRAFT" | "APPROVED", overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: "Holi Colours",
    clientName: "Saffron Street",
    clientContact: null,
    clientCompany: null,
    clientGstNumber: null,
    clientAddress: null,
    clientPhone: null,
    clientInvoiceNumber: null,
    clientInvoiceAt: null,
    invoiceDescription: null,
    hsnSac: null,
    notes: null,
    budget: "150000",
    isGstPlan: true,
    gstPercent: 18,
    status,
    approvedAt: status === "APPROVED" ? now : null,
    createdAt: now,
    updatedAt: now,
    items: [{ id: `${id}-i1`, planId: id, assetId: "a1", format: "reel", cost: "28000", clientCost: "32000", postsPerProfile: 2, asset: { id: "a1", handle: "desi.memes", category: "Meme page", followers: 1200000, platform: "instagram" } }],
    totalCost: 56000,
    budgetVariance: 86000,
    expectedEngagement: { likes: 0, views: 0 },
    overview: { totalFollowers: 1200000, totalPosts: 2, expectedImpressions: 0, subtotal: 64000, gstAmount: 11520, total: 75520 },
    internal: { computedFollowers: 1200000, computedPosts: 2, computedImpressions: 0, computedSubtotal: 64000, computedGstAmount: 11520, computedTotal: 75520 },
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
    createdBy: { id: "test-admin", name: "Test ADMIN" },
    sourceSheetUrl: SHEET,
    sourceSheetFetchedAt: now,
    sourceSheetPending: PENDING,
    ...overrides,
  };
}

async function sheetApi(page: Page, role: MockRole, list: ReturnType<typeof plan>[], permissions?: Record<string, boolean>, opts: { details?: string; pages?: string; createError?: { status: number; code: string; message: string } } = {}) {
  await signIn(page, role, permissions ? { permissions: { ...userFor(role).permissions, ...permissions } } : {});
  const calls = { tabs: [] as string[], created: [] as Record<string, unknown>[], synced: [] as { id: string; body: Record<string, unknown> }[], added: [] as { id: string; body: Record<string, unknown> }[], updates: [] as Record<string, unknown>[], templateCopies: 0, execSyncs: 0 };
  await mockApi(page);
  await page.route(`${API_URL}/plans**`, (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(/^\/api\/plans/, "");
    if (req.method() === "GET" && path === "") return route.fulfill({ json: list });
    if (req.method() === "GET" && path === "/clients") return route.fulfill({ json: [] });
    if (req.method() === "POST" && path === "/import-sheet-tabs") {
      calls.tabs.push(req.postDataJSON().url);
      return route.fulfill({ json: { tabs: [{ gid: "0", title: "Details", csv: opts.details ?? DETAILS_TAB }, { gid: "1", title: "Pages", csv: opts.pages ?? PAGES_TAB }] } });
    }
    if (req.method() === "POST" && path === "/from-sheet") {
      const body = req.postDataJSON();
      calls.created.push(body);
      if (opts.createError) return route.fulfill({ status: opts.createError.status, json: { error: { code: opts.createError.code, message: opts.createError.message } } });
      const created = plan("p-sheet", "DRAFT", { name: body.fields.name, clientName: body.fields.clientName });
      list.push(created);
      return route.fulfill({ status: 201, json: created });
    }
    if (req.method() === "GET" && path === "/execution-sheet-template/preview")
      return route.fulfill({ json: { title: "Execution sheet", headers: ["Page", "Post link", "Views"], rows: [["desi.memes", "https://www.instagram.com/reel/AAA/", 120000]], totalsRow: ["TOTAL", "", 120000], linkColumns: [1] } });
    if (req.method() === "POST" && path === "/execution-sheet-template") {
      calls.templateCopies++;
      return route.fulfill({ json: { spreadsheetUrl: "https://docs.google.com/spreadsheets/d/template/edit" } });
    }
    const execSync = path.match(/^\/([^/]+)\/execution-sheet\/sync$/);
    if (req.method() === "POST" && execSync) {
      calls.execSyncs++;
      const p = list.find((x) => x.id === execSync[1])!;
      Object.assign(p, { executionSheetFetchedAt: new Date().toISOString(), executionSheetPending: [{ rowNumber: 4, pageHandle: "ghost.page", pageName: null, postUrl: "https://www.instagram.com/reel/ZZZ/", reason: "Page isn't on this plan" }] });
      return route.fulfill({ json: { plan: p, summary: { attached: 2, alreadyLinked: 1, pending: 1, rows: 4 } } });
    }
    const sync = path.match(/^\/([^/]+)\/sheet-sync$/);
    if (req.method() === "POST" && sync) {
      calls.synced.push({ id: sync[1], body: req.postDataJSON() });
      const p = list.find((x) => x.id === sync[1])!;
      p.sourceSheetFetchedAt = new Date().toISOString();
      return route.fulfill({ json: p });
    }
    const add = path.match(/^\/([^/]+)\/sheet-pending\/add$/);
    if (req.method() === "POST" && add) {
      const body = req.postDataJSON();
      calls.added.push({ id: add[1], body });
      const p = list.find((x) => x.id === add[1])!;
      p.sourceSheetPending = p.sourceSheetPending.filter((x) => x.handle !== body.handle);
      p.items = [...p.items, { id: `${p.id}-i2`, planId: p.id, assetId: "a9", format: "story", cost: "9000", clientCost: null as unknown as string, postsPerProfile: 1, asset: { id: "a9", handle: body.handle, category: "Food", followers: 85000, platform: "instagram" } }];
      return route.fulfill({ json: p });
    }
    const one = path.match(/^\/([^/]+)$/);
    if (req.method() === "PUT" && one) {
      const body = req.postDataJSON();
      calls.updates.push(body);
      const p = list.find((x) => x.id === one[1])!;
      Object.assign(p, body);
      return route.fulfill({ json: p });
    }
    if (req.method() === "GET" && one) return route.fulfill({ json: list.find((x) => x.id === one[1]) });
    return route.fulfill({ status: 404, json: { error: { code: "NOT_MOCKED", message: path } } });
  });
  await page.route(`${API_URL}/assets/owners`, (r) => r.fulfill({ json: [{ id: "o1", name: "Riya Mehta", email: "riya@example.com", phoneNumber: null }] }));
  return calls;
}

test.describe("Plans sheet tools", () => {
  test.use({ viewport: { width: 1536, height: 1000 } });

  test("admin: New plan from sheet reads the tabs, shows what was found, needs a name and client, then opens the plan", async ({ page }) => {
    const calls = await sheetApi(page, "ADMIN", []);
    await page.goto("/plans");
    await page.getByRole("button", { name: "New plan from sheet" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "New plan from sheet" })).toBeVisible();
    await shot(page, "plan-from-sheet-source");

    await dialog.getByLabel("Google Sheet link").fill("https://example.com/sheet");
    await dialog.getByRole("button", { name: "Read sheet" }).click();
    await expect(dialog.getByText("Use a Google Sheets link", { exact: false })).toBeVisible();
    expect(calls.tabs).toEqual([]);

    await dialog.getByLabel("Google Sheet link").fill(SHEET);
    await dialog.getByRole("button", { name: "Read sheet" }).click();
    await expect(dialog.getByRole("heading", { name: "Check what was found" })).toBeVisible();
    expect(calls.tabs).toEqual([SHEET]);
    await expect(dialog.getByText(/2 pages found · budget ₹1,50,000 · GST 18%/)).toBeVisible();
    await expect(dialog.getByText(/Not in the sheet: brief, client contact, company, GST number, address\./)).toBeVisible();
    await expect(dialog.getByLabel("Plan name")).toHaveValue("Holi Colours");
    await shot(page, "plan-from-sheet-found");

    await dialog.getByLabel("Client name").fill("  ");
    await dialog.getByRole("button", { name: "Create plan" }).click();
    await expect(dialog.getByText("Enter the client's name.")).toBeVisible();
    expect(calls.created).toEqual([]);

    await dialog.getByLabel("Client name").fill("Saffron Street Foods");
    await dialog.getByRole("button", { name: "Create plan" }).click();
    await expect(page).toHaveURL(/\/plans\/p-sheet$/);
    expect(calls.created).toHaveLength(1);
    expect(calls.created[0]).toMatchObject({
      sourceSheetUrl: SHEET,
      fields: { name: "Holi Colours", clientName: "Saffron Street Foods", budget: 150000, gstPercent: 18 },
      rows: [
        { handle: "desi.memes", pageUrl: "https://www.instagram.com/desi.memes/", category: "Meme page", followers: 1200000, format: "reel", postsPerProfile: 2, cost: 28000, clientCost: 32000 },
        { handle: "chai.diaries", category: "Food", followers: 85000, format: "story", postsPerProfile: 1, cost: 9000 },
      ],
    });
  });

  test("admin: the sheet samples download as .csv files", async ({ page }) => {
    await sheetApi(page, "ADMIN", []);
    await page.goto("/plans");
    await page.getByRole("button", { name: "New plan from sheet" }).click();
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Pages tab sample" }).click()]);
    expect(download.suggestedFilename()).toBe("taggify-plan-template-pages.csv");
  });

  test("admin: a draft made from a sheet syncs from the same link", async ({ page }) => {
    const calls = await sheetApi(page, "ADMIN", [plan("p1", "DRAFT")]);
    await page.goto("/plans/p1");
    const card = page.getByText("From a sheet", { exact: true }).locator("xpath=..");
    await expect(card.getByRole("link", { name: "Open sheet" })).toHaveAttribute("href", SHEET);
    await expect(card).toContainText("Still missing");
    await expect(card).toContainText("chai.diaries isn't in Inventory yet");
    await expect(card).toContainText("nocost.page has no cost");
    await shot(page, "plan-source-sheet-card");

    await card.getByRole("button", { name: "Sync from sheet" }).click();
    await expect(page.getByText("Plan synced from the sheet.")).toBeVisible();
    expect(calls.tabs).toEqual([SHEET]);
    expect(calls.synced).toHaveLength(1);
    expect(calls.synced[0].id).toBe("p1");
    expect(calls.synced[0].body).toMatchObject({ fields: { name: "Holi Colours", budget: 150000 }, rows: [{ handle: "desi.memes" }, { handle: "chai.diaries" }] });
  });

  test("pre-flight: rows the server would refuse are listed by sheet row and left out of the new plan", async ({ page }) => {
    // Row 3 is blank (kept for numbering), row 4 has a format the app doesn't take, row 5 asks for 0 posts.
    const [header, desiMemes] = PAGES_TAB.split("\n");
    const pages = [header, desiMemes, ",,,,,,,", "video.page,,Meme page,10K,Video,1,5000,", "zero.posts,,Meme page,10K,Reel,0,5000,"].join("\n");
    const calls = await sheetApi(page, "ADMIN", [], undefined, { pages });
    await page.goto("/plans");
    await page.getByRole("button", { name: "New plan from sheet" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Google Sheet link").fill(SHEET);
    await dialog.getByRole("button", { name: "Read sheet" }).click();
    await expect(dialog.getByText(/1 page ready/)).toBeVisible();
    const problems = dialog.getByTestId("sheet-row-problems");
    await expect(problems).toContainText("2 rows can't be used.");
    await expect(problems.getByRole("listitem").nth(0)).toContainText("Row 4");
    await expect(problems.getByRole("listitem").nth(0)).toContainText(`Format "video" isn't Reel, Entertainment / Brand, PR, Political reel, Static / Carousel, Repost, Story, Political story, Reel + Story or Repost + Story`);
    await expect(problems.getByRole("listitem").nth(1)).toContainText("Row 5");
    await expect(problems.getByRole("listitem").nth(1)).toContainText("Posts per profile must be between 1 and 1,000");
    await shot(page, "plan-from-sheet-problems");

    await dialog.getByRole("button", { name: "Create plan" }).click();
    await expect(page).toHaveURL(/\/plans\/p-sheet$/);
    expect((calls.created[0] as { rows: { handle: string }[] }).rows.map((r) => r.handle)).toEqual(["desi.memes"]);
    expect(JSON.stringify(calls.created[0])).not.toContain('"line"');
  });

  test("pre-flight: a Details value over the server's limit blocks Create and says what to shorten", async ({ page }) => {
    const details = `${DETAILS_TAB}\nBrief,${"x".repeat(1001)}`;
    const calls = await sheetApi(page, "ADMIN", [], undefined, { details });
    await page.goto("/plans");
    await page.getByRole("button", { name: "New plan from sheet" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Google Sheet link").fill(SHEET);
    await dialog.getByRole("button", { name: "Read sheet" }).click();
    await expect(dialog.getByRole("alert")).toContainText("Brief in the Details tab is 1,001 characters; the limit is 1,000.");
    await expect(dialog.getByRole("button", { name: "Create plan" })).toBeDisabled();
    expect(calls.created).toEqual([]);
  });

  test("a server validation error is shown in plain words, not as raw request text", async ({ page }) => {
    await sheetApi(page, "ADMIN", [], undefined, { createError: { status: 400, code: "VALIDATION_ERROR", message: "Invalid request body" } });
    await page.goto("/plans");
    await page.getByRole("button", { name: "New plan from sheet" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Google Sheet link").fill(SHEET);
    await dialog.getByRole("button", { name: "Read sheet" }).click();
    await dialog.getByRole("button", { name: "Create plan" }).click();
    await expect(dialog.getByRole("alert")).toContainText("The server couldn't accept something in the sheet");
    await expect(dialog.getByText("Invalid request body")).toHaveCount(0);
  });

  test("sync: bad rows are left out and listed on the card; the good ones still sync", async ({ page }) => {
    const pages = [PAGES_TAB, "video.page,,Meme page,10K,Video,1,5000,"].join("\n");
    const calls = await sheetApi(page, "ADMIN", [plan("p1", "DRAFT")], undefined, { pages });
    await page.goto("/plans/p1");
    const card = page.getByText("From a sheet", { exact: true }).locator("xpath=..");
    await card.getByRole("button", { name: "Sync from sheet" }).click();
    await expect(page.getByText("Plan synced from the sheet. 1 row left out.")).toBeVisible();
    expect((calls.synced[0].body as { rows: { handle: string }[] }).rows.map((r) => r.handle)).toEqual(["desi.memes", "chai.diaries"]);
    await expect(card.getByTestId("sheet-row-problems")).toContainText("Row 4");
  });

  test("sync: a Details value over the limit stops the sync before anything is sent", async ({ page }) => {
    const details = `${DETAILS_TAB}\nAddress,${"x".repeat(301)}`;
    const calls = await sheetApi(page, "ADMIN", [plan("p1", "DRAFT")], undefined, { details });
    await page.goto("/plans/p1");
    const card = page.getByText("From a sheet", { exact: true }).locator("xpath=..");
    await card.getByRole("button", { name: "Sync from sheet" }).click();
    await expect(page.getByText("Nothing was synced. Fix the sheet first.")).toBeVisible();
    await expect(card.getByRole("alert")).toContainText("Address in the Details tab is 301 characters; the limit is 300.");
    expect(calls.synced).toEqual([]);
  });

  test("an approved plan can't be synced", async ({ page }) => {
    await sheetApi(page, "ADMIN", [plan("p1", "APPROVED")]);
    await page.goto("/plans/p1");
    await expect(page.getByText("Built from a Google Sheet. Only a draft can be synced.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sync from sheet" })).toHaveCount(0);
  });

  test("admin: Complete details walks the gaps and adds a waiting page under a chosen creator", async ({ page }) => {
    const calls = await sheetApi(page, "ADMIN", [plan("p1", "DRAFT")]);
    await page.goto("/plans/p1");
    await page.getByRole("button", { name: "Complete details" }).click();
    const dialog = page.getByRole("dialog", { name: "Complete details" });
    await expect(dialog).toContainText("step 1 of 3");

    await dialog.getByRole("button", { name: "Save and next" }).click();
    await expect(dialog.getByText("Write a short brief.")).toBeVisible();
    await dialog.getByLabel("Brief").fill("Holi reels on food pages");
    await dialog.getByRole("button", { name: "Save and next" }).click();
    await dialog.getByLabel("Client contact").fill("Rohit Sharma");
    await dialog.getByRole("button", { name: "Save and next" }).click();
    expect(calls.updates).toEqual([{ notes: "Holi reels on food pages" }, { clientContact: "Rohit Sharma" }]);

    // Pages step: pick the creator, then add the one with a cost; the one without a cost says to fix the sheet.
    await expect(dialog.getByText("nocost.page")).toBeVisible();
    await expect(dialog.getByText("No cost in the sheet. Add one there, then sync.")).toBeVisible();
    await dialog.getByRole("combobox", { name: "Register new pages under" }).click();
    await page.getByRole("option", { name: /Riya Mehta/ }).click();
    await shot(page, "plan-complete-details-pages");
    await dialog.getByRole("listitem").filter({ hasText: "chai.diaries" }).getByRole("button", { name: "Add to plan" }).click();
    await expect(page.getByText("chai.diaries added to Inventory and the plan.")).toBeVisible();
    expect(calls.added).toEqual([{ id: "p1", body: { handle: "chai.diaries", ownerId: "o1" } }]);
    await expect(dialog.getByRole("button", { name: "Add to plan" })).toHaveCount(0);
  });

  test("admin: execution sheet format shows the sample, downloads a .csv and opens a Google copy", async ({ page }) => {
    const calls = await sheetApi(page, "ADMIN", [plan("p1", "APPROVED")]);
    await page.goto("/plans/p1");
    await page.getByRole("button", { name: "See the sheet format" }).click();
    const dialog = page.getByRole("dialog", { name: "Execution sheet format" });
    await expect(dialog.getByRole("columnheader", { name: "Post link" })).toBeVisible();
    await expect(dialog.getByRole("row", { name: /TOTAL/ })).toContainText("1,20,000");
    await shot(page, "plan-execution-sheet-format");
    const [download] = await Promise.all([page.waitForEvent("download"), dialog.getByRole("button", { name: "Download template (.csv)" }).click()]);
    expect(download.suggestedFilename()).toBe("taggify-execution-sheet-template.csv");

    // The tab is opened inside the click, then pointed at the copy; record where it goes instead of opening one.
    await page.evaluate(() => {
      const w = window as unknown as { sentTo: string[] };
      w.sentTo = [];
      window.open = (() => ({ location: { assign: (u: string) => w.sentTo.push(u) }, close: () => {} })) as unknown as typeof window.open;
    });
    await dialog.getByRole("button", { name: "Open as Google Sheet" }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { sentTo: string[] }).sentTo)).toEqual(["https://docs.google.com/spreadsheets/d/template/edit"]);
    expect(calls.templateCopies).toBe(1);
  });

  test("draft: attach an execution sheet in two steps (format + template, then a checked link); read once approved", async ({ page }) => {
    const calls = await sheetApi(page, "ADMIN", [plan("p1", "DRAFT")]);
    await page.goto("/plans/p1");
    const card = page.getByTestId("execution-sheet-card");
    await card.getByRole("button", { name: "Attach execution sheet" }).click();
    const dialog = page.getByRole("dialog", { name: "Attach execution sheet" });
    await expect(dialog.getByRole("columnheader", { name: "Post link" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Download template (.csv)" })).toBeEnabled();
    await shot(page, "plan-execution-sheet-attach");

    // v1's link rules: something, a full link, a Google Sheets link.
    await dialog.getByRole("button", { name: "Attach sheet" }).click();
    await expect(dialog.getByText("Paste the sheet's link.")).toBeVisible();
    await dialog.getByLabel("Execution sheet link").fill("docs.google.com/spreadsheets/d/x");
    await expect(dialog.getByText("Enter a full link starting with https://")).toBeVisible();
    await dialog.getByLabel("Execution sheet link").fill("https://example.com/sheet");
    await expect(dialog.getByText(/Only Google Sheets links work here/)).toBeVisible();
    expect(calls.updates).toEqual([]);
    await dialog.getByLabel("Execution sheet link").fill(SHEET);
    await dialog.getByRole("button", { name: "Attach sheet" }).click();

    await expect(page.getByText("Execution sheet attached.", { exact: true })).toBeVisible();
    expect(calls.updates).toEqual([{ executionSheetUrl: SHEET }]);
    await expect(card.getByRole("link", { name: /Execution sheet attached · Open/ })).toHaveAttribute("href", SHEET);
    await expect(card.getByText("Posted links are read from this sheet once the plan is approved.")).toBeVisible();
    await expect(card.getByRole("button", { name: "Refresh links" })).toHaveCount(0);

    // Change → Remove sheet goes back to the prompt.
    await card.getByRole("button", { name: "Change" }).click();
    await page.getByRole("dialog", { name: "Change execution sheet" }).getByRole("button", { name: "Remove sheet" }).click();
    await expect(page.getByText("Execution sheet removed.")).toBeVisible();
    expect(calls.updates[1]).toEqual({ executionSheetUrl: null });
    await expect(card.getByRole("button", { name: "Attach execution sheet" })).toBeVisible();
  });

  test("approved: not read yet → Refresh links shows what it attached and the rows that need a look", async ({ page }) => {
    const calls = await sheetApi(page, "ADMIN", [plan("p1", "APPROVED", { executionSheetUrl: SHEET })]);
    await page.goto("/plans/p1");
    const card = page.getByTestId("execution-sheet-card");
    await expect(card.getByText("Not read yet.")).toBeVisible();
    await card.getByRole("button", { name: "Refresh links" }).click();
    await expect(card.getByTestId("execution-sheet-summary")).toHaveText("Attached 2 new links · 1 already linked · 1 pending");
    await expect(card.getByText(/Links read .* · 1 row pending/)).toBeVisible();
    await expect(card.getByTestId("execution-sheet-pending")).toContainText("Row 4");
    await expect(card.getByTestId("execution-sheet-pending")).toContainText("ghost.page · Page isn't on this plan");
    expect(calls.execSyncs).toBe(1);
  });

  test("without plan edit: no New plan from sheet, no Sync or Complete details, no Google copy", async ({ page }) => {
    await sheetApi(page, "ADMIN", [plan("p1", "DRAFT"), plan("p2", "APPROVED")], { "plans.edit": false });
    await page.goto("/plans");
    await expect(page.getByRole("heading", { name: "Plans", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "New plan from sheet" })).toHaveCount(0);

    await page.goto("/plans/p1");
    await expect(page.getByRole("link", { name: "Open sheet" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sync from sheet" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Complete details" })).toHaveCount(0);

    await page.goto("/plans/p2");
    await page.getByRole("button", { name: "See the sheet format" }).click();
    const dialog = page.getByRole("dialog", { name: "Execution sheet format" });
    await expect(dialog.getByRole("button", { name: "Download template (.csv)" })).toBeEnabled();
    await expect(dialog.getByRole("button", { name: "Open as Google Sheet" })).toHaveCount(0);
    await dialog.press("Escape");
    // The sheet can be seen but not attached, changed or read.
    const card = page.getByTestId("execution-sheet-card");
    await expect(card.getByText("No execution sheet attached yet.")).toBeVisible();
    await expect(card.getByRole("button", { name: "Attach execution sheet" })).toHaveCount(0);
  });
});
