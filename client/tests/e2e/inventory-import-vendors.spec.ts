import { test, expect } from "@playwright/test";

import { signIn, mockApi, userFor, API_URL } from "./fixtures";

/**
 * Inventory → Import pages → "New vendors found" (14 Oct): the sheet's
 * Vendor Name / Vendor Contact columns name vendors who aren't in Taggify;
 * the preview groups them (newVendors) and an account-creating user can
 * approve each into a creator login that then owns exactly that vendor's
 * rows. All API calls are mocked.
 */

const owners = [
  { id: "creator-1", name: "Priya Creator", phoneNumber: "+919000000001", email: "priya@test.local" },
  { id: "creator-2", name: "Rahul Creator", phoneNumber: "+919000000002", email: "rahul@test.local" },
];

const vendorA = { name: "Asha Media", phone: "+91 98765 43210", email: "asha@media.in" };
const vendorB = { name: "Rahul Again", phone: null, email: "rahul@test.local" };
const vendorC = { name: "No Email Co", phone: "+919811111111", email: null };

function row(rowNumber: number, handle: string, vendor: { name: string | null; phone: string | null; email: string | null } | null, owner: (typeof owners)[number] | null) {
  return {
    rowNumber,
    rawHandle: handle,
    handle,
    pageName: null,
    category: null,
    followers: 1000,
    rateCards: [],
    ownerRef: vendor?.name ?? null,
    owner,
    ownerId: owner?.id ?? null,
    status: owner ? "ready" : "owner-unknown",
    reason: owner ? null : `New vendor: ${vendor?.name}`,
    vendor,
  };
}

function previewResponse() {
  return {
    totalRows: 5,
    hasOwnerColumn: true,
    owners,
    summary: { ready: 1, "owner-unknown": 4 },
    rows: [row(2, "known.page", { name: "Priya Creator", phone: null, email: "priya@test.local" }, owners[0]), row(3, "asha.one", vendorA, null), row(4, "asha.two", vendorA, null), row(5, "rahul.page", vendorB, null), row(6, "noemail.page", vendorC, null)],
    newVendors: [
      { key: "v-asha", ...vendorA, rowNumbers: [3, 4] },
      { key: "v-rahul", ...vendorB, rowNumbers: [5] },
      { key: "v-noemail", ...vendorC, rowNumbers: [6] },
    ],
  };
}

const allFound = Object.fromEntries(["known.page", "asha.one", "asha.two", "rahul.page", "noemail.page"].map((h) => [h, { followers: 1000, avgViews: null, avgLikes: null, avgComments: null, fullName: null }]));
const csvFile = { name: "pages.csv", mimeType: "text/csv", buffer: Buffer.from("Page Link,Vendor Name\nknown.page,Priya\n") };

async function openPreview(page: import("@playwright/test").Page) {
  await page.route(`${API_URL}/assets/import/preview`, (route) => route.fulfill({ json: previewResponse() }));
  await page.route(`${API_URL}/assets/import/followers`, (route) => route.fulfill({ json: { profiles: allFound } }));
  await page.goto("/inventory");
  await page.getByTestId("import-pages-button").click();
  await page.getByLabel("Pages sheet (.xlsx or .csv)").setInputFiles(csvFile);
  await expect(page.getByTestId("import-new-vendors")).toBeVisible();
}

test.describe("Inventory — Import pages: new vendors", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("an ADMIN approves vendors into creator logins that own their rows; every password stays listed", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    const signups: Record<string, unknown>[] = [];
    await page.route(`${API_URL}/auth/signup`, (route) => {
      const body = route.request().postDataJSON() as { email: string; name?: string; phoneNumber?: string };
      signups.push(body);
      if (body.email === "rahul@test.local") return route.fulfill({ status: 409, json: { error: { code: "EMAIL_ALREADY_REGISTERED", message: "An account with this email already exists" } } });
      const id = body.email === "asha@media.in" ? "new-asha" : "new-noemail";
      return route.fulfill({ json: { user: { id, name: body.name ?? null, phoneNumber: body.phoneNumber ?? null, email: body.email, role: "CREATOR" }, generatedPassword: `Pw-${id}` } });
    });
    let importBody: { rows: { handle: string; ownerId: string }[] } | null = null;
    await page.route(`${API_URL}/assets/import`, (route) => {
      importBody = route.request().postDataJSON();
      return route.fulfill({ status: 201, json: { created: [], skipped: [] } });
    });

    await openPreview(page);
    const section = page.getByTestId("import-new-vendors");
    await expect(section).toContainText("New vendors found (3)");
    const asha = section.locator('[data-vendor-key="v-asha"]');
    await expect(asha.getByLabel("Vendor name")).toHaveValue("Asha Media");
    await expect(asha.getByLabel("Vendor phone")).toHaveValue("+91 98765 43210");
    await expect(asha.getByLabel("Vendor email")).toHaveValue("asha@media.in");
    await expect(asha.getByTestId("import-new-vendor-pages")).toHaveText("2 pages");
    await expect(page.getByTestId("import-confirm")).toHaveText("Import 1 page");

    await asha.getByTestId("import-vendor-approve").click();
    await expect(asha).toContainText("Created ✓");
    expect(signups[0]).toMatchObject({ email: "asha@media.in", name: "Asha Media", phoneNumber: "+919876543210", role: "CREATOR" });
    // Exactly that vendor's rows follow the new account.
    await expect(page.getByLabel("Account for @asha.one")).toHaveValue("new-asha");
    await expect(page.getByLabel("Account for @asha.two")).toHaveValue("new-asha");
    await expect(page.getByLabel("Account for @rahul.page")).toHaveValue("");
    await expect(page.getByTestId("import-new-user-password")).toContainText("Pw-new-asha");

    // Approve all: the existing-email vendor resolves to that creator; the one with no email is held back.
    await section.getByTestId("import-vendors-approve-all").click();
    await expect(section.locator('[data-vendor-key="v-rahul"]')).toContainText("Matched to existing account");
    await expect(page.getByLabel("Account for @rahul.page")).toHaveValue("creator-2");
    const noEmail = section.locator('[data-vendor-key="v-noemail"]');
    await expect(noEmail).toContainText("An email is required");
    expect(signups.some((b) => b.name === "No Email Co")).toBe(false);

    await noEmail.getByLabel("Vendor email").fill("NoEmail@Co.in");
    await noEmail.getByTestId("import-vendor-approve").click();
    await expect(noEmail).toContainText("Created ✓");
    await expect(page.getByTestId("import-created-login")).toHaveCount(2);
    await expect(page.getByTestId("import-new-user-password")).toContainText("asha@media.in");
    await expect(page.getByTestId("import-new-user-password")).toContainText("noemail@co.in");
    await expect(page.getByTestId("import-new-user-password")).toContainText("Pw-new-noemail");

    await expect(page.getByTestId("import-confirm")).toHaveText("Import 5 pages");
    await page.getByTestId("import-confirm").click();
    await expect.poll(() => importBody).not.toBeNull();
    const ownerOf = Object.fromEntries(importBody!.rows.map((r) => [r.handle, r.ownerId]));
    expect(ownerOf).toEqual({ "known.page": "creator-1", "asha.one": "new-asha", "asha.two": "new-asha", "rahul.page": "creator-2", "noemail.page": "new-noemail" });
  });

  test("picking an account for all pages leaves an approved vendor's rows with that vendor", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.route(`${API_URL}/auth/signup`, (route) => {
      const body = route.request().postDataJSON() as { email: string; name?: string };
      return route.fulfill({ json: { user: { id: "new-asha", name: body.name ?? null, phoneNumber: null, email: body.email, role: "CREATOR" }, generatedPassword: "Pw-new-asha" } });
    });
    let importBody: { rows: { handle: string; ownerId: string }[] } | null = null;
    await page.route(`${API_URL}/assets/import`, (route) => {
      importBody = route.request().postDataJSON();
      return route.fulfill({ status: 201, json: { created: [], skipped: [] } });
    });
    await openPreview(page);
    const asha = page.getByTestId("import-new-vendors").locator('[data-vendor-key="v-asha"]');
    await asha.getByTestId("import-vendor-approve").click();
    await expect(asha).toContainText("Created ✓");
    await page.getByLabel("Account for all pages").selectOption("creator-2");
    await expect(page.getByTestId("import-confirm")).toHaveText("Import 5 pages");
    await page.getByTestId("import-confirm").click();
    await expect.poll(() => importBody).not.toBeNull();
    const ownerOf = Object.fromEntries(importBody!.rows.map((r) => [r.handle, r.ownerId]));
    expect(ownerOf).toEqual({ "known.page": "creator-2", "asha.one": "new-asha", "asha.two": "new-asha", "rahul.page": "creator-2", "noemail.page": "creator-2" });
  });

  test("a phone with a label or letters in it isn't sent as a login's phone", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    const signups: unknown[] = [];
    await page.route(`${API_URL}/auth/signup`, (route) => {
      signups.push(route.request().postDataJSON());
      return route.fulfill({ json: { user: { id: "new-asha", name: "Asha Media", phoneNumber: "+919876543210", email: "asha@media.in", role: "CREATOR" }, generatedPassword: "Pw" } });
    });
    await openPreview(page);
    const asha = page.getByTestId("import-new-vendors").locator('[data-vendor-key="v-asha"]');
    await asha.getByLabel("Vendor phone").fill("Ph: 98765 43210");
    await asha.getByTestId("import-vendor-approve").click();
    await expect(asha).toContainText("Enter 10–15 digits (a + in front is fine), or leave it blank.");
    expect(signups).toHaveLength(0);
    await asha.getByLabel("Vendor phone").fill("+91 98765-43210");
    await asha.getByTestId("import-vendor-approve").click();
    await expect(asha).toContainText("Created ✓");
    expect(signups).toHaveLength(1);
  });

  test("Skip leaves a vendor's rows for the account pickers", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await openPreview(page);
    const asha = page.getByTestId("import-new-vendors").locator('[data-vendor-key="v-asha"]');
    await asha.getByRole("button", { name: "Skip" }).click();
    await expect(asha).toContainText("Skipped");
    await expect(page.getByLabel("Account for @asha.one")).toHaveValue("");
    await page.getByLabel("Account for @asha.one").selectOption("creator-1");
    await expect(page.getByLabel("Account for @asha.one")).toHaveValue("creator-1");
  });

  test("a user who can't create accounts sees the vendors read-only with a hint", async ({ page }) => {
    const grantedFinance = { ...userFor("FINANCE"), permissions: { ...userFor("FINANCE").permissions, "inventory.edit": true } };
    await page.addInitScript((s) => window.localStorage.setItem("taggify_auth", JSON.stringify(s)), { user: grantedFinance, accessToken: "test-access-token", refreshToken: "test-refresh-token" });
    await mockApi(page);
    await openPreview(page);
    const section = page.getByTestId("import-new-vendors");
    await expect(section).toContainText("Ask an admin to create their accounts, or pick an existing creator");
    await expect(section).toContainText("Asha Media");
    await expect(section).toContainText("asha@media.in");
    await expect(section.getByTestId("import-vendor-approve")).toHaveCount(0);
    await expect(section.getByTestId("import-vendors-approve-all")).toHaveCount(0);
  });

  test("a CREATOR's preview never shows the section", async ({ page }) => {
    await signIn(page, "CREATOR");
    await mockApi(page);
    await page.route(`${API_URL}/assets/import/preview`, (route) => route.fulfill({ json: { ...previewResponse(), newVendors: [] } }));
    await page.route(`${API_URL}/assets/import/followers`, (route) => route.fulfill({ json: { profiles: allFound } }));
    await page.goto("/inventory");
    await page.getByTestId("import-pages-button").click();
    await page.getByLabel("Pages sheet (.xlsx or .csv)").setInputFiles(csvFile);
    await expect(page.getByTestId("import-preview-table")).toBeVisible();
    await expect(page.getByTestId("import-new-vendors")).toHaveCount(0);
  });
});
