import { expect, test, type Page } from "@playwright/test";

import { API_URL, mockApi, shot, signIn, userFor, type MockRole } from "./fixtures";

/** Creators → Import pages: file / Google Sheet → every row with its status (Instagram lookup) → pick a creator → import → skipped list. API fully mocked. */

const RIYA = { id: "o1", name: "Riya Mehta", email: "riya@example.com", phoneNumber: null };
const AMAN = { id: "o2", name: "Aman Gupta", email: "aman@example.com", phoneNumber: null };
const row = (rowNumber: number, rawHandle: string, extra: Record<string, unknown>) => ({ rowNumber, rawHandle, handle: rawHandle, pageName: null, category: null, followers: null, rateCards: [], ownerRef: null, owner: null, ownerId: null, status: "ready", reason: null, ...extra });
const PREVIEW = {
  rows: [
    row(2, "riya.eats", { pageName: "Riya Eats", category: "Food", followers: 480000, rateCards: [{ format: "reel", amount: 18000 }], ownerRef: "riya@example.com", owner: RIYA, ownerId: "o1" }),
    row(3, "newpage.official", { status: "owner-missing", reason: "No creator in this row" }),
    row(4, "broken.link", { status: "owner-missing", reason: "No creator in this row" }),
    row(5, "desi.memes", { status: "exists", owner: RIYA, ownerId: "o1", reason: "Already in Inventory" }),
    row(6, "not a link", { handle: null, status: "invalid", reason: "Not an Instagram page link" }),
  ],
  summary: { ready: 1, "owner-missing": 2, exists: 1, invalid: 1 },
  totalRows: 5,
  hasOwnerColumn: true,
  owners: [RIYA, AMAN],
};
const PROFILE = (followers: number) => ({ followers, avgViews: 90000, avgLikes: null, avgComments: null, fullName: null });

/** Rows 3–4 are one new vendor (with an email), row 5 another (phone only); row 2 matched an existing creator. */
const CHAI = { name: "Chai Co", phone: "+91 98000 00011", email: "chai@vendor.in" };
const MEME = { name: "Meme House", phone: "9800000022", email: null };
const VENDOR_PREVIEW = {
  rows: [
    row(2, "riya.eats", { owner: RIYA, ownerId: "o1", ownerRef: "Riya Mehta", vendor: { name: "Riya Mehta", phone: null, email: "riya@example.com" } }),
    row(3, "chai.diaries", { status: "owner-unknown", reason: "New vendor: Chai Co", ownerRef: "Chai Co", vendor: CHAI }),
    row(4, "chai.tales", { status: "owner-unknown", reason: "New vendor: Chai Co", ownerRef: "Chai Co", vendor: CHAI }),
    row(5, "meme.house", { status: "owner-unknown", reason: "New vendor: Meme House", ownerRef: "Meme House", vendor: MEME }),
  ],
  summary: { ready: 1, "owner-unknown": 3 },
  totalRows: 4,
  hasOwnerColumn: true,
  owners: [RIYA, AMAN],
  newVendors: [
    { key: "chai@vendor.in", ...CHAI, rowNumbers: [3, 4] },
    { key: "meme house", ...MEME, rowNumbers: [5] },
  ],
};

async function importApi(page: Page, role: MockRole, { preview = PREVIEW as object, patch = {} as Parameters<typeof signIn>[2] } = {}) {
  await signIn(page, role, patch);
  const calls = { previews: 0, urls: [] as string[], lookups: [] as string[][], imported: [] as Record<string, unknown>[][], signups: [] as Record<string, unknown>[] };
  await mockApi(page);
  await page.route(`${API_URL}/assets/import/preview`, (r) => {
    calls.previews++;
    return r.fulfill({ json: preview });
  });
  await page.route(`${API_URL}/auth/signup`, (r) => {
    const body = r.request().postDataJSON();
    calls.signups.push(body);
    if (body.email === "riya@example.com") return r.fulfill({ status: 409, json: { error: { code: "EMAIL_ALREADY_REGISTERED", message: "That email is already registered" } } });
    // A mobile that belongs to someone who isn't one of the page owners (e.g. a staff account).
    if (body.phoneNumber === "+919999999999") return r.fulfill({ status: 409, json: { error: { code: "PHONE_ALREADY_REGISTERED", message: "This phone number is already registered" } } });
    const n = calls.signups.length;
    return r.fulfill({ json: { user: { id: `new${n}`, name: body.name ?? null, email: body.email, phoneNumber: body.phoneNumber ?? null, role: "CREATOR" }, generatedPassword: `Pass-${n}-xyz` } });
  });
  await page.route(`${API_URL}/assets/import/preview-url`, (r) => {
    calls.urls.push(r.request().postDataJSON().url);
    return r.fulfill({ json: { ...PREVIEW, rows: PREVIEW.rows.slice(0, 1), totalRows: 1 } });
  });
  await page.route(`${API_URL}/assets/import/followers`, (r) => {
    const { handles } = r.request().postDataJSON();
    calls.lookups.push(handles);
    const known: Record<string, ReturnType<typeof PROFILE> | null> = { "riya.eats": PROFILE(500000), "newpage.official": PROFILE(91000), "broken.link": null, "chai.diaries": PROFILE(42000), "chai.tales": PROFILE(30000), "meme.house": PROFILE(120000) };
    return r.fulfill({ json: { profiles: Object.fromEntries(handles.map((h: string) => [h, known[h] ?? null])) } });
  });
  await page.route(`${API_URL}/assets/import`, (r) => {
    const { rows } = r.request().postDataJSON();
    calls.imported.push(rows);
    return r.fulfill({
      json: {
        created: [{ id: "n1", handle: "riya.eats", ownerId: "o2", approvalStatus: "approved", owner: AMAN }],
        skipped: [{ handle: "newpage.official", reason: "Instagram says this page is private" }],
      },
    });
  });
  await page.goto("/creators");
  await expect(page.getByRole("heading", { name: "Inventory", exact: true })).toBeVisible();
  return calls;
}

const upload = (page: Page) => page.locator('input[type="file"]').setInputFiles({ name: "pages.csv", mimeType: "text/csv", buffer: Buffer.from("Page Link,Page Name\nhttps://www.instagram.com/riya.eats/,Riya Eats\n") });
const rowOf = (page: Page, n: number) => page.getByRole("dialog").getByRole("row").filter({ has: page.getByRole("cell", { name: String(n), exact: true }) });

test.describe("Import pages", () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test("admin: every row shows its status after the Instagram lookup", async ({ page }) => {
    const calls = await importApi(page, "ADMIN");
    await page.getByRole("button", { name: "Import pages" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Import pages" })).toBeVisible();
    await shot(page, "import-pages-source");
    await upload(page);

    await expect(dialog.getByRole("heading", { name: "Check the pages" })).toBeVisible();
    await expect(dialog.getByText("Followers are live from Instagram.")).toBeVisible();
    expect(calls.lookups).toEqual([["riya.eats", "newpage.official", "broken.link"]]);
    await expect(rowOf(page, 2)).toContainText("Ready");
    await expect(rowOf(page, 2)).toContainText("₹18,000");
    await expect(rowOf(page, 3)).toContainText("Needs a creator");
    await expect(rowOf(page, 4)).toContainText("Not on Instagram");
    await expect(rowOf(page, 5)).toContainText("Already in Inventory");
    await expect(rowOf(page, 6)).toContainText("Not a page link");
    await expect(dialog.getByText("1 page is already in Inventory and won't be imported:")).toBeVisible();
    await expect(dialog.getByText(/1 link is broken or its page isn't on Instagram/)).toBeVisible();
    await expect(dialog.getByText("1 row still needs a creator")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Import 1 page" })).toBeEnabled();
    await shot(page, "import-pages-preview");
  });

  test("admin: the five rate columns are listed, rates show by label, and a row missing a required rate says it waits for approval", async ({ page }) => {
    const preview = {
      ...PREVIEW,
      rows: [
        row(2, "riya.eats", { rateCards: [{ format: "reel", amount: 18000 }, { format: "reel_story", amount: 25000 }], missingRates: ["story", "post"], owner: RIYA, ownerId: "o1" }),
        row(3, "chai.diaries", { rateCards: [{ format: "reel", amount: 9000 }, { format: "story", amount: 4000 }, { format: "post", amount: 6000 }], missingRates: [], owner: RIYA, ownerId: "o1" }),
      ],
      summary: { ready: 2 },
      totalRows: 2,
    };
    const calls = await importApi(page, "ADMIN", { preview });
    await page.getByRole("button", { name: "Import pages" }).click();
    const dialog = page.getByRole("dialog");
    for (const col of ["Reel Rate", "Story Rate", "Static / Carousel Rate"]) await expect(dialog.getByText(col, { exact: true })).toBeVisible();
    await upload(page);
    await expect(dialog.getByRole("heading", { name: "Check the pages" })).toBeVisible();
    await expect(dialog.getByRole("columnheader", { name: "Rates" })).toBeVisible();
    // No rate is mandatory (16 Oct): a row missing some rates carries no "needs … before approval" note.
    await expect(rowOf(page, 2)).not.toContainText("before approval");
    await expect(rowOf(page, 2)).toContainText("Reel + Story ₹25,000");
    await expect(rowOf(page, 3)).toContainText("Static / Carousel ₹6,000");
    await expect(rowOf(page, 3)).not.toContainText("before approval");
    await shot(page, "import-pages-rates");
    await dialog.getByRole("button", { name: "Import 2 pages" }).click();
    await expect.poll(() => calls.imported.length).toBe(1);
    expect(calls.imported[0].map((r) => r.handle)).toEqual(["riya.eats", "chai.diaries"]);
  });

  test("admin: one creator for all rows, then only confirmed pages are sent; skipped pages say why", async ({ page }) => {
    const calls = await importApi(page, "ADMIN");
    await page.getByRole("button", { name: "Import pages" }).click();
    await upload(page);
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Followers are live from Instagram.")).toBeVisible();

    await dialog.getByRole("combobox", { name: "Import all pages under" }).click();
    await page.getByRole("option", { name: "Aman Gupta · aman@example.com" }).click();
    await expect(dialog.getByText(/still needs? a creator/)).toHaveCount(0);
    await dialog.getByRole("button", { name: "Import 2 pages" }).click();

    await expect(dialog.getByRole("heading", { name: "1 page imported" })).toBeVisible();
    expect(calls.imported).toEqual([
      [
        { handle: "riya.eats", ownerId: "o2", category: "Food", pageName: "Riya Eats", followers: 500000, rateCards: [{ format: "reel", amount: 18000 }] },
        { handle: "newpage.official", ownerId: "o2", category: null, pageName: null, followers: 91000, rateCards: [] },
      ],
    ]);
    const skipped = dialog.getByRole("list", { name: "Skipped pages" });
    await expect(skipped).toContainText("newpage.official");
    await expect(skipped).toContainText("Instagram says this page is private");
    await expect(dialog).toContainText("Aman Gupta");
    await shot(page, "import-pages-result");
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(dialog).toBeHidden();
  });

  test("admin: a row's own creator picker overrides the all-rows choice", async ({ page }) => {
    const calls = await importApi(page, "ADMIN");
    await page.getByRole("button", { name: "Import pages" }).click();
    await upload(page);
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Followers are live from Instagram.")).toBeVisible();
    await dialog.getByRole("combobox", { name: "Creator for newpage.official" }).click();
    await page.getByRole("option", { name: "Riya Mehta · riya@example.com" }).click();
    await dialog.getByRole("button", { name: "Import 2 pages" }).click();
    await expect(dialog.getByRole("heading", { name: "1 page imported" })).toBeVisible();
    expect((calls.imported[0] as { handle: string; ownerId: string }[]).map((r) => [r.handle, r.ownerId])).toEqual([
      ["riya.eats", "o1"],
      ["newpage.official", "o1"],
    ]);
  });

  test("admin: reads rows from a Google Sheet link; a non-Sheets link is refused first", async ({ page }) => {
    const calls = await importApi(page, "ADMIN");
    await page.getByRole("button", { name: "Import pages" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("radio", { name: "Google Sheet link" }).click();
    await dialog.getByLabel("Google Sheet link").fill("https://example.com/pages");
    await dialog.getByRole("button", { name: "Read rows" }).click();
    await expect(dialog.getByRole("alert").filter({ hasText: "Paste a Google Sheets link." })).toBeVisible();
    expect(calls.urls).toEqual([]);

    await dialog.getByLabel("Google Sheet link").fill("https://docs.google.com/spreadsheets/d/abc/edit");
    await dialog.getByRole("button", { name: "Read rows" }).click();
    await expect(dialog.getByText("Google Sheet: 1 row.", { exact: false })).toBeVisible();
    expect(calls.urls).toEqual(["https://docs.google.com/spreadsheets/d/abc/edit"]);
  });

  test("admin: an old .xls file is refused before it's sent", async ({ page }) => {
    const calls = await importApi(page, "ADMIN");
    await page.getByRole("button", { name: "Import pages" }).click();
    await page.locator('input[type="file"]').setInputFiles({ name: "pages.xls", mimeType: "application/vnd.ms-excel", buffer: Buffer.from("x") });
    await expect(page.getByRole("dialog").getByText("Old .xls files can't be read.", { exact: false })).toBeVisible();
    expect(calls.previews).toBe(0);
  });

  test.describe("new vendors", () => {
    async function openVendors(page: Page, opts: Parameters<typeof importApi>[2] = {}) {
      const calls = await importApi(page, "ADMIN", { preview: VENDOR_PREVIEW, ...opts });
      await page.getByRole("button", { name: "Import pages" }).click();
      await upload(page);
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByText("Followers are live from Instagram.")).toBeVisible();
      const panel = dialog.getByRole("region", { name: "New vendors" });
      return { calls, dialog, panel, chai: panel.getByRole("listitem", { name: "Chai Co" }), meme: panel.getByRole("listitem", { name: "Meme House" }) };
    }

    test("admin: the panel lists both new vendors, prefilled from the sheet", async ({ page }) => {
      const { panel, chai, meme } = await openVendors(page);
      await expect(panel.getByRole("heading", { name: "New vendors found (2)" })).toBeVisible();
      await expect(chai.getByLabel("Name (optional)")).toHaveValue("Chai Co");
      await expect(chai.getByLabel("Email (their login)")).toHaveValue("chai@vendor.in");
      await expect(chai.getByLabel("Mobile (optional)")).toHaveValue("9800000011");
      await expect(meme.getByLabel("Name (optional)")).toHaveValue("Meme House");
      await expect(meme.getByLabel("Email (their login)")).toHaveValue("");
      await expect(meme.getByLabel("Mobile (optional)")).toHaveValue("9800000022");
      await chai.getByText("2 pages").click();
      await expect(chai).toContainText("chai.diaries, chai.tales");
      await expect(meme).toContainText("1 page");
      await expect(panel.getByRole("button", { name: "Approve all" })).toBeVisible();
      await shot(page, "import-pages-new-vendors");
    });

    test("admin: email is required to create a vendor's login", async ({ page }) => {
      const { calls, meme } = await openVendors(page);
      await meme.getByRole("button", { name: "Approve & create" }).click();
      await expect(meme.getByText("Enter their email. It's their login.")).toBeVisible();
      await meme.getByLabel("Mobile (optional)").fill("12345");
      await meme.getByLabel("Email (their login)").fill("meme@vendor.in");
      await meme.getByRole("button", { name: "Approve & create" }).click();
      await expect(meme.getByText("Enter a 10-digit mobile number, or leave it empty.")).toBeVisible();
      expect(calls.signups).toEqual([]);
    });

    test("admin: Approve & create makes the login and that vendor's rows go under it", async ({ page }) => {
      const { calls, dialog, chai } = await openVendors(page);
      await chai.getByRole("button", { name: "Approve & create" }).click();
      await expect(chai.getByText("Created")).toBeVisible();
      expect(calls.signups).toEqual([{ email: "chai@vendor.in", name: "Chai Co", phoneNumber: "+919800000011", role: "CREATOR" }]);
      await expect(dialog.getByTestId("generated-password")).toHaveText("Pass-1-xyz");
      await expect(dialog.getByText("Email: chai@vendor.in")).toBeVisible();
      await expect(rowOf(page, 3)).toContainText("Ready");
      await expect(rowOf(page, 4)).toContainText("Ready");
      await expect(dialog.getByText("1 row still needs a creator")).toBeVisible();
      await dialog.getByRole("button", { name: "Import 3 pages" }).click();
      await expect(dialog.getByRole("heading", { name: "1 page imported" })).toBeVisible();
      expect((calls.imported[0] as { handle: string; ownerId: string }[]).map((r) => [r.handle, r.ownerId])).toEqual([
        ["riya.eats", "o1"],
        ["chai.diaries", "new1"],
        ["chai.tales", "new1"],
      ]);
      await expect(dialog.getByTestId("generated-password")).toHaveText("Pass-1-xyz");
    });

    test("admin: picking a creator for all rows leaves an approved vendor's rows with that vendor", async ({ page }) => {
      const { calls, dialog, chai } = await openVendors(page);
      await chai.getByRole("button", { name: "Approve & create" }).click();
      await expect(chai.getByText("Created")).toBeVisible();
      await dialog.getByRole("combobox", { name: "Import all pages under" }).click();
      await page.getByRole("option", { name: "Aman Gupta · aman@example.com" }).click();
      await dialog.getByRole("button", { name: "Import 4 pages" }).click();
      await expect(dialog.getByRole("heading", { name: "1 page imported" })).toBeVisible();
      expect((calls.imported[0] as { handle: string; ownerId: string }[]).map((r) => [r.handle, r.ownerId])).toEqual([
        ["riya.eats", "o2"],
        ["chai.diaries", "new1"],
        ["chai.tales", "new1"],
        ["meme.house", "o2"],
      ]);
    });

    test("admin: Approve all creates every vendor; both passwords stay up through the result", async ({ page }) => {
      const { calls, dialog, panel, meme } = await openVendors(page);
      await meme.getByLabel("Email (their login)").fill("meme@vendor.in");
      await panel.getByRole("button", { name: "Approve all" }).click();
      await expect(panel.getByText("Created")).toHaveCount(2);
      expect(calls.signups.map((b) => b.email)).toEqual(["chai@vendor.in", "meme@vendor.in"]);
      expect(calls.signups[1]).toEqual({ email: "meme@vendor.in", name: "Meme House", phoneNumber: "+919800000022", role: "CREATOR" });
      await expect(dialog.getByTestId("generated-password")).toHaveText(["Pass-1-xyz", "Pass-2-xyz"]);
      await expect(panel.getByRole("button", { name: "Approve all" })).toHaveCount(0);
      await dialog.getByRole("button", { name: "Import 4 pages" }).click();
      await expect(dialog.getByRole("heading", { name: "1 page imported" })).toBeVisible();
      expect((calls.imported[0] as { handle: string; ownerId: string }[]).map((r) => r.ownerId)).toEqual(["o1", "new1", "new1", "new2"]);
      await expect(dialog.getByTestId("generated-password")).toHaveText(["Pass-1-xyz", "Pass-2-xyz"]);
    });

    test("admin: an email that's already a creator maps to that account", async ({ page }) => {
      const { calls, dialog, chai } = await openVendors(page);
      await chai.getByLabel("Email (their login)").fill("riya@example.com");
      await chai.getByRole("button", { name: "Approve & create" }).click();
      await expect(chai.getByText("Matched to existing account")).toBeVisible();
      expect(calls.signups).toHaveLength(1);
      await expect(dialog.getByTestId("generated-password")).toHaveCount(0);
      await dialog.getByRole("button", { name: "Import 3 pages" }).click();
      await expect(dialog.getByRole("heading", { name: "1 page imported" })).toBeVisible();
      expect((calls.imported[0] as { handle: string; ownerId: string }[]).map((r) => [r.handle, r.ownerId])).toEqual([
        ["riya.eats", "o1"],
        ["chai.diaries", "o1"],
        ["chai.tales", "o1"],
      ]);
    });

    test("admin: a mobile that's already taken says so, not that the email is", async ({ page }) => {
      const { calls, chai } = await openVendors(page);
      await chai.getByLabel("Mobile (optional)").fill("99999 99999");
      await chai.getByRole("button", { name: "Approve & create" }).click();
      await expect(chai.getByText("That mobile number already belongs to an account that isn't a creator. Change it or leave it empty.")).toBeVisible();
      await expect(chai.getByText(/That email already has an account/)).toHaveCount(0);
      expect(calls.signups).toHaveLength(1);
      // Clearing the mobile lets it through.
      await chai.getByLabel("Mobile (optional)").fill("");
      await chai.getByRole("button", { name: "Approve & create" }).click();
      await expect(chai.getByText("Created")).toBeVisible();
    });

    test("admin: Not now leaves the rows to be placed by hand", async ({ page }) => {
      const { calls, dialog, chai } = await openVendors(page);
      await chai.getByRole("button", { name: "Not now" }).click();
      await expect(chai.getByText("Skipped. Pick a creator for these pages below.")).toBeVisible();
      await expect(dialog.getByText("3 rows still need a creator")).toBeVisible();
      expect(calls.signups).toEqual([]);
    });

    test("without login access the panel is read-only", async ({ page }) => {
      const { calls, panel } = await openVendors(page, { patch: { permissions: { ...userFor("ADMIN").permissions, "users.edit": false } } });
      await expect(panel.getByRole("heading", { name: "New vendors found (2)" })).toBeVisible();
      await expect(panel.getByText("Ask an admin to add these vendors, or pick an existing creator below.")).toBeVisible();
      await expect(panel.getByRole("button", { name: /Approve/ })).toHaveCount(0);
      await expect(panel.getByRole("listitem", { name: "Chai Co" })).toContainText("chai@vendor.in · +91 98000 00011");
      expect(calls.signups).toEqual([]);
    });
  });

  test("finance (no inventory.edit) has no Import pages", async ({ page }) => {
    await importApi(page, "FINANCE");
    await expect(page.getByRole("button", { name: "Import pages" })).toHaveCount(0);
  });
});

test.describe("Import pages · phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the preview scrolls inside the dialog, not the page", async ({ page }) => {
    await importApi(page, "ADMIN");
    await page.getByRole("button", { name: "Import pages" }).click();
    await upload(page);
    await expect(page.getByRole("dialog").getByRole("heading", { name: "Check the pages" })).toBeVisible();
    await shot(page, "import-pages-preview-390");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
