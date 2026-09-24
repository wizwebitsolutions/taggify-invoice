import { test, expect, type Page } from "@playwright/test";

import { signIn, mockApi, API_URL } from "./fixtures";

/**
 * Payments → Internal · creator payouts, list-first redesign (24 Sep).
 * Pending lists every payable link across vendors (filter by vendor, page
 * search, month); one vendor's links are selected and paid from a single
 * sheet (GST, TDS, paid-on, UTR, receipt); once paid they leave Pending and
 * show under Paid. A creator gets their own Pending/Paid view. Server-side
 * eligibility/scoping is covered by vitest in server/src/modules/payments/.
 */

/** "2026-09" for this month — the Posted-in select's option value. */
function currentMonthKey(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

const ROHAN = { id: "creator-1", name: "Rohan Mehta", phoneNumber: "9820100204" };
const KABIR = { id: "creator-2", name: "Kabir Studios", phoneNumber: "9004000318" };

function pendingLink(id: string, owner: typeof ROHAN, handle: string, campaignTitle: string, cost: string) {
  return {
    id,
    campaignId: `camp-${id}`,
    assetId: `asset-${handle}`,
    submittedById: owner.id,
    url: `https://instagram.com/reel/${id}`,
    format: "reel",
    cost,
    customRate: false,
    status: "SCREENSHOT_APPROVED",
    postedAt: "2026-09-12T10:00:00.000Z",
    createdAt: "2026-09-10T10:00:00.000Z",
    campaign: { id: `camp-${id}`, title: campaignTitle, brandName: "Brand", deadline: null, createdAt: "2026-09-01T00:00:00.000Z" },
    asset: { id: `asset-${handle}`, handle, ownerId: owner.id, owner },
    screenshot: null,
    postSnapshots: [{ likeCount: 100, commentsCount: 5, videoViews: 240000, capturedAt: "2026-09-14T00:00:00.000Z" }],
  };
}

const L1 = pendingLink("l1", ROHAN, "memes.daily", "Swiggy Instamart · Sep", "8000");
const L2 = pendingLink("l2", ROHAN, "desi.humour", "boAt Airdopes launch", "12000");
const L3 = pendingLink("l3", KABIR, "cricket.buzz", "Zomato Gold relaunch", "22000");

type Recorded = {
  pendingQueries: URLSearchParams[];
  created: Record<string, unknown>[];
  receipts: { id: string; body: Record<string, unknown> }[];
  cancelled: string[];
};

/** A small stateful fake of the payments API: paying links removes them from Pending and adds a PAID payout. */
async function mockPayments(page: Page, opts: { drafts?: Record<string, unknown>[]; uploadStatus?: number } = {}) {
  const rec: Recorded = { pendingQueries: [], created: [], receipts: [], cancelled: [] };
  const paidIds = new Set<string>();
  const payouts: Record<string, unknown>[] = [];
  let drafts = [...(opts.drafts ?? [])];
  let lastCreated: Record<string, unknown> | null = null;

  await page.route(`${API_URL}/assets/owners`, (route) => route.fulfill({ json: [ROHAN, KABIR] }));
  await page.route(`${API_URL}/fake-cloudinary`, (route) => route.fulfill({ status: opts.uploadStatus ?? 200, json: { ok: true } }));
  await page.route(`${API_URL}/payments/**`, async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace("/api/payments", "");
    const method = route.request().method();

    if (method === "GET" && path === "/pending") {
      rec.pendingQueries.push(url.searchParams);
      const items = [L1, L2, L3].filter((l) => !paidIds.has(l.id));
      return route.fulfill({ json: { items, total: items.length } });
    }
    if (method === "GET" && path === "/payouts") {
      const items = url.searchParams.get("status") === "DRAFT" ? drafts : payouts;
      return route.fulfill({ json: { items, total: items.length, page: 1, pageSize: 100 } });
    }
    if (method === "POST" && path === "/payouts") {
      const body = route.request().postDataJSON();
      rec.created.push(body);
      const links = [L1, L2, L3].filter((l) => body.linkIds.includes(l.id));
      const subtotal = links.reduce((s, l) => s + Number(l.cost), 0);
      const gst = body.isGstInvoice ? subtotal * 0.18 : 0;
      const tds = body.tdsPercent ? subtotal * (body.tdsPercent / 100) : 0;
      lastCreated = {
        id: "p-new",
        creatorId: body.creatorId,
        subtotal: String(subtotal),
        isGstInvoice: body.isGstInvoice,
        gstAmount: String(gst),
        tdsPercent: body.tdsPercent ? String(body.tdsPercent) : null,
        tdsAmount: String(tds),
        netAmount: String(subtotal + gst - tds),
        status: "DRAFT",
        paidAt: null,
        createdAt: "2026-09-24T00:00:00.000Z",
        creator: ROHAN,
        items: links.map((l) => ({ id: `item-${l.id}`, amount: l.cost, link: l })),
      };
      return route.fulfill({ status: 201, json: lastCreated });
    }
    const receiptUpload = path.match(/^\/payouts\/([^/]+)\/receipt-upload$/);
    if (method === "GET" && receiptUpload) {
      return route.fulfill({ json: { uploadUrl: `${API_URL}/fake-cloudinary`, apiKey: "k", timestamp: 1, signature: "s", publicId: `payout-receipts/${receiptUpload[1]}/uuid` } });
    }
    const receipt = path.match(/^\/payouts\/([^/]+)\/receipt$/);
    if (method === "POST" && receipt) {
      const id = receipt[1];
      const body = route.request().postDataJSON();
      rec.receipts.push({ id, body });
      const base = id === "p-new" ? lastCreated! : drafts.find((d) => d.id === id)!;
      const paid = {
        ...base,
        status: "PAID",
        paidAt: body.paidOn,
        utr: body.utr ?? null,
        markedPaidBy: { id: "test-user-1", name: "Test User" },
        receipt: { name: body.fileName, url: "https://cdn/receipt.pdf", uploadedAt: "2026-09-24T00:00:00.000Z" },
      };
      for (const item of (base.items as { link: { id: string } }[]) ?? []) paidIds.add(item.link.id);
      drafts = drafts.filter((d) => d.id !== id);
      payouts.unshift(paid);
      return route.fulfill({ status: 201, json: paid });
    }
    const del = path.match(/^\/payouts\/([^/]+)$/);
    if (method === "DELETE" && del) {
      rec.cancelled.push(del[1]);
      drafts = drafts.filter((d) => d.id !== del[1]);
      return route.fulfill({ status: 204, body: "" });
    }
    return route.fallback();
  });
  return rec;
}

const receiptFile = { name: "neft-receipt.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%mock\n") };

test.describe("Payments — admin payouts (list-first, 24 Sep)", () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  /** Opens a vendor's row (Pending lists page owners only until opened or filtered). */
  const openVendor = (page: Page, name: string) => page.getByRole("button", { name: `Show ${name}'s links` }).click();

  test("finance sees the Internal / Client receivables toggle; unfiltered Pending lists page owners only, each opening to its links", async ({ page }) => {
    await signIn(page, "FINANCE");
    await mockApi(page);
    await mockPayments(page);
    await page.goto("/payments");

    await expect(page.getByRole("tab", { name: "Internal · creator payouts" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tab", { name: "Client receivables" })).toBeVisible();
    await expect(page.getByRole("tab", { name: /Pending/ })).toHaveAttribute("aria-selected", "true");

    // Default (24 Sep): just the page owners, no link rows yet.
    const groups = page.getByTestId("pending-vendor-group");
    await expect(groups).toHaveCount(2);
    await expect(groups.first()).toContainText("Rohan Mehta");
    await expect(groups.first()).toContainText("2 links");
    await expect(groups.first()).toContainText("₹20,000");
    await expect(page.getByTestId("pending-row")).toHaveCount(0);

    await openVendor(page, "Rohan Mehta");
    await expect(page.getByTestId("pending-row")).toHaveCount(2);
    await expect(page.getByRole("button", { name: "Hide Rohan Mehta's links" })).toHaveAttribute("aria-expanded", "true");
    // No Views column (24 Sep).
    await expect(page.getByTestId("pending-list")).not.toContainText("Views");
    await page.getByRole("button", { name: "Hide Rohan Mehta's links" }).click();
    await expect(page.getByTestId("pending-row")).toHaveCount(0);

    await page.getByRole("tab", { name: "Client receivables" }).click();
    await expect(page.getByRole("tab", { name: /Pending/ })).toHaveCount(0);
  });

  test("select one vendor's links → Pay on that vendor's row → GST + TDS + receipt → they leave Pending and show under Paid", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    const rec = await mockPayments(page);
    await page.goto("/payments");

    const rohan = page.getByTestId("pending-vendor-group").filter({ hasText: "Rohan Mehta" });
    const kabir = page.getByTestId("pending-vendor-group").filter({ hasText: "Kabir Studios" });
    await expect(page.getByTestId("pay-vendor")).toHaveCount(0);

    await openVendor(page, "Rohan Mehta");
    await openVendor(page, "Kabir Studios");
    await page.getByRole("checkbox", { name: "Select Swiggy Instamart · Sep on @memes.daily" }).check();
    await expect(rohan.getByTestId("pay-vendor")).toContainText("Pay Rohan · 1");
    await expect(rohan.getByTestId("vendor-amount")).toContainText("₹8,000 of ₹20,000");

    // Another vendor's link starts a new selection — one vendor per payout; the Pay button moves to that vendor's row.
    await page.getByRole("checkbox", { name: "Select Zomato Gold relaunch on @cricket.buzz" }).check();
    await expect(kabir.getByTestId("pay-vendor")).toContainText("Pay Kabir · 1");
    await expect(rohan.getByTestId("pay-vendor")).toHaveCount(0);
    await expect(page.getByRole("checkbox", { name: "Select Swiggy Instamart · Sep on @memes.daily" })).not.toBeChecked();

    await page.getByRole("checkbox", { name: "Select all of Rohan Mehta's links" }).check();
    await expect(rohan.getByTestId("pay-vendor")).toContainText("Pay Rohan · 2");
    await expect(rohan.getByRole("spinbutton", { name: "Number of Rohan Mehta's links to select" })).toHaveValue("2");

    await rohan.getByTestId("pay-vendor").click();
    const sheet = page.getByTestId("pay-sheet");
    await expect(sheet.getByRole("heading", { name: "Pay Rohan Mehta" })).toBeVisible();
    await expect(sheet.getByTestId("pay-sheet-links")).toContainText("@memes.daily");
    await expect(sheet.getByTestId("pay-sheet-links")).toContainText("@desi.humour");

    await sheet.getByRole("checkbox", { name: /Add 18% GST/ }).check();
    await sheet.getByRole("radio", { name: "2%" }).click();
    await expect(sheet.getByRole("radio", { name: "2%" })).toHaveAttribute("aria-checked", "true");
    await expect(sheet.getByRole("radio", { name: "None" })).toHaveAttribute("aria-checked", "false");
    // 20,000 + 18% GST (3,600) − 2% TDS (400)
    await expect(sheet.getByTestId("payout-preview")).toContainText("₹23,200");

    const markPaid = sheet.getByRole("button", { name: /Mark paid/ });
    await expect(markPaid).toBeDisabled();
    await sheet.getByPlaceholder("Optional").fill("UTR123");
    await sheet.locator('input[type="file"]').setInputFiles(receiptFile);
    await expect(sheet).toContainText("neft-receipt.pdf");
    await markPaid.click();

    await expect(page.getByTestId("payout-paid")).toContainText("₹23,200 to Rohan Mehta");
    expect(rec.created).toEqual([{ creatorId: "creator-1", linkIds: ["l1", "l2"], isGstInvoice: true, tdsPercent: 2 }]);
    expect(rec.receipts).toHaveLength(1);
    expect(rec.receipts[0].id).toBe("p-new");
    expect(rec.receipts[0].body).toMatchObject({ fileName: "neft-receipt.pdf", utr: "UTR123" });
    // Paid-on defaults to today, sent as local noon so it stays on that calendar day in any timezone.
    const paidOn = new Date(rec.receipts[0].body.paidOn as string);
    expect(paidOn.toDateString()).toBe(new Date().toDateString());
    expect(paidOn.getHours()).toBe(12);

    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByTestId("pending-vendor-group")).toHaveCount(1);
    await expect(page.getByTestId("pending-list")).not.toContainText("Rohan Mehta");

    await page.getByRole("tab", { name: /Paid/ }).click();
    const row = page.getByTestId("paid-row");
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("Rohan Mehta");
    await expect(row).toContainText("₹23,200");
    await row.getByRole("button", { name: /Rohan Mehta/ }).click();
    await expect(page.getByTestId("paid-row-links")).toContainText("Swiggy Instamart · Sep");
    await expect(page.getByTestId("paid-row-links")).toContainText("UTR UTR123");
  });

  test("'Select N of M' picks exactly that many of the vendor's links, top of the list first, and clamps to M", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    const rec = await mockPayments(page);
    await page.goto("/payments");

    const rohan = page.getByTestId("pending-vendor-group").filter({ hasText: "Rohan Mehta" });
    const count = rohan.getByRole("spinbutton", { name: "Number of Rohan Mehta's links to select" });
    await expect(rohan).toContainText("of 2");

    await count.fill("1");
    await expect(rohan.getByTestId("pay-vendor")).toContainText("Pay Rohan · 1");
    await openVendor(page, "Rohan Mehta");
    await expect(page.getByRole("checkbox", { name: "Select Swiggy Instamart · Sep on @memes.daily" })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: "Select boAt Airdopes launch on @desi.humour" })).not.toBeChecked();

    await count.fill("9");
    await expect(count).toHaveValue("2");
    await expect(rohan.getByTestId("pay-vendor")).toContainText("Pay Rohan · 2");

    await count.fill("0");
    await expect(rohan.getByTestId("pay-vendor")).toHaveCount(0);

    // Regression (24 Sep review): a stray "-" (badInput → "") must not wipe the selection.
    await count.fill("2");
    await count.press("End");
    await count.pressSequentially("-");
    await expect(rohan.getByTestId("pay-vendor")).toContainText("Pay Rohan · 2");
    await count.fill("0");

    // −/+ stepper around the number.
    await rohan.getByRole("button", { name: "One more of Rohan Mehta's links" }).click();
    await expect(count).toHaveValue("1");
    await rohan.getByRole("button", { name: "One more of Rohan Mehta's links" }).click();
    await expect(count).toHaveValue("2");
    await expect(rohan.getByRole("button", { name: "One more of Rohan Mehta's links" })).toBeDisabled();
    await rohan.getByRole("button", { name: "One fewer of Rohan Mehta's links" }).click();
    await expect(count).toHaveValue("1");

    await rohan.getByTestId("pay-vendor").click();
    await expect(page.getByTestId("pay-sheet-links")).toContainText("Swiggy Instamart · Sep");
    await expect(page.getByTestId("pay-sheet-links")).not.toContainText("boAt Airdopes launch");
    expect(rec.created).toHaveLength(0);
  });

  test("if the receipt upload fails, the just-created payout is cancelled so its links go back to Pending", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    const rec = await mockPayments(page, { uploadStatus: 500 });
    await page.goto("/payments");

    await page.getByRole("checkbox", { name: "Select all of Kabir Studios's links" }).check();
    await page.getByTestId("pay-vendor").click();
    const sheet = page.getByTestId("pay-sheet");
    await sheet.locator('input[type="file"]').setInputFiles(receiptFile);
    await sheet.getByRole("button", { name: /Mark paid/ }).click();

    await expect(sheet).toContainText("receipt upload was rejected");
    await expect.poll(() => rec.cancelled).toEqual(["p-new"]);
    expect(rec.receipts).toHaveLength(0);
  });

  test("regression (24 Sep review): removing every link in the pay sheet leaves it open and empty, and closing it doesn't wedge the page", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    const rec = await mockPayments(page);
    await page.goto("/payments");

    await page.getByRole("checkbox", { name: "Select all of Kabir Studios's links" }).check();
    await page.getByTestId("pay-vendor").click();
    const sheet = page.getByTestId("pay-sheet");
    await sheet.getByRole("button", { name: /Remove Zomato Gold relaunch/ }).click();

    await expect(sheet).toContainText("No links left on this payout");
    await expect(sheet.getByRole("button", { name: /Mark paid/ })).toBeDisabled();
    await sheet.getByRole("button", { name: "Cancel" }).click();
    await expect(sheet).toHaveCount(0);

    await page.getByRole("checkbox", { name: "Select all of Rohan Mehta's links" }).check();
    await expect(page.getByTestId("pay-vendor")).toContainText("Pay Rohan · 2");
    await expect(page.getByTestId("pay-sheet")).toHaveCount(0);
    expect(rec.created).toHaveLength(0);
  });

  test("filters: searchable page-owner dropdown, page search (no @) and month all reach the Pending request; narrowing opens the links", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    const rec = await mockPayments(page);
    await page.goto("/payments");
    await expect(page.getByTestId("pending-vendor-group")).toHaveCount(2);

    // Page owner is a searchable dropdown (24 Sep), not a plain select.
    const owner = page.getByRole("combobox", { name: "Page owner" });
    await expect(owner).toHaveAttribute("placeholder", "All page owners");
    await owner.click();
    await owner.fill("rohan");
    await expect(page.getByRole("listbox").getByRole("option")).toHaveCount(1);
    await page.getByRole("option", { name: /Rohan Mehta/ }).click();
    await expect.poll(() => rec.pendingQueries.at(-1)?.get("ownerId")).toBe("creator-1");
    // A vendor filter shows that vendor's links straight away.
    await expect(page.getByTestId("pending-row")).toHaveCount(3);

    const search = page.getByRole("textbox", { name: "Search page" });
    await expect(search).toHaveAttribute("placeholder", "Search page, e.g. memes.daily");
    await search.fill("@memes");
    await expect(search).toHaveValue("memes");
    await expect.poll(() => rec.pendingQueries.at(-1)?.get("q")).toBe("memes");

    await page.getByRole("combobox", { name: "Posted in" }).selectOption(currentMonthKey());
    await expect.poll(() => rec.pendingQueries.at(-1)?.get("from")).toBeTruthy();
    const last = rec.pendingQueries.at(-1)!;
    const from = new Date(last.get("from")!);
    const to = new Date(last.get("to")!);
    expect(from.getDate()).toBe(1);
    expect(to.getMonth()).toBe(from.getMonth());
    expect(new Date(to.getTime() + 1).getDate()).toBe(1);

    await page.getByRole("combobox", { name: "Posted in" }).selectOption("custom");
    await expect(page.getByLabel("From date")).toBeVisible();
    await expect(page.getByLabel("To date")).toBeVisible();

    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect.poll(() => rec.pendingQueries.at(-1)?.get("ownerId") ?? null).toBeNull();
    // Back to page owners only.
    await expect(page.getByTestId("pending-row")).toHaveCount(0);
  });

  test("summary tiles: pending total across every vendor, and 'Paid this month' jumps to Paid filtered to this month", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await mockPayments(page);
    await page.goto("/payments");

    const kpis = page.getByTestId("payments-kpis");
    await expect(kpis).toContainText("Pending payout");
    await expect(kpis).toContainText("₹42,000"); // 8,000 + 12,000 + 22,000
    await expect(kpis).toContainText("3 links · 2 page owners");

    await kpis.getByRole("button", { name: /Paid in/ }).click();
    await expect(page.getByRole("tab", { name: /Paid/ })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("combobox", { name: "Paid in" })).toHaveValue(currentMonthKey());
  });

  test("the receipt can be dropped onto the pay sheet as well as picked", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await mockPayments(page);
    await page.goto("/payments");

    await page.getByRole("checkbox", { name: "Select all of Kabir Studios's links" }).check();
    await page.getByTestId("pay-vendor").click();
    const sheet = page.getByTestId("pay-sheet");
    await expect(sheet.getByRole("button", { name: /Mark paid/ })).toBeDisabled();

    const dataTransfer = await page.evaluateHandle(() => {
      const dt = new DataTransfer();
      dt.items.add(new File(["%PDF-1.4"], "dropped-receipt.pdf", { type: "application/pdf" }));
      return dt;
    });
    await sheet.getByTestId("receipt-dropzone").dispatchEvent("drop", { dataTransfer });
    await expect(sheet).toContainText("dropped-receipt.pdf");
    await expect(sheet.getByRole("button", { name: /Mark paid/ })).toBeEnabled();

    // Regression (24 Sep review): dropping a wrong file type keeps the good receipt instead of clearing it.
    const badDrop = await page.evaluateHandle(() => {
      const dt = new DataTransfer();
      dt.items.add(new File(["x"], "notes.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }));
      return dt;
    });
    await sheet.getByTestId("receipt-dropzone").dispatchEvent("drop", { dataTransfer: badDrop });
    await expect(sheet).toContainText("notes.docx isn't a PDF or an image — kept the previous receipt");
    await expect(sheet).toContainText("dropped-receipt.pdf");
    await expect(sheet.getByRole("button", { name: /Mark paid/ })).toBeEnabled();

    // The picker is keyboard-reachable (not display:none).
    await expect(sheet.getByLabel("Payment receipt")).toBeAttached();
    await sheet.getByLabel("Payment receipt").focus();
    await expect(sheet.getByLabel("Payment receipt")).toBeFocused();
  });

  test("clicking a pending link opens its details", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await mockPayments(page);
    await page.goto("/payments");

    await openVendor(page, "Rohan Mehta");
    await page.getByTestId("pending-row").filter({ hasText: "@memes.daily" }).getByRole("button", { name: /Swiggy Instamart/ }).click();
    const detail = page.getByTestId("payments-link-detail");
    await expect(detail).toBeVisible();
    await expect(detail).toContainText("@memes.daily");
    await expect(detail).toContainText("Not paid yet");
  });

  test("a payout waiting for a receipt shows a banner and can be finished without re-creating it", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    const draft = {
      id: "p-draft",
      creatorId: "creator-2",
      subtotal: "22000",
      isGstInvoice: false,
      gstAmount: "0",
      tdsPercent: null,
      tdsAmount: "0",
      netAmount: "22000",
      status: "DRAFT",
      paidAt: null,
      createdAt: "2026-09-23T00:00:00.000Z",
      creator: KABIR,
      items: [{ id: "item-x", amount: "22000", link: { ...L3, id: "lx" } }],
    };
    const rec = await mockPayments(page, { drafts: [draft] });
    await page.goto("/payments");

    const banner = page.getByTestId("draft-payout-banner");
    await expect(banner).toContainText("Kabir Studios");
    await banner.getByRole("button", { name: "Attach receipt" }).click();

    const sheet = page.getByTestId("pay-sheet");
    await expect(sheet.getByRole("heading", { name: "Finish payout to Kabir Studios" })).toBeVisible();
    await sheet.locator('input[type="file"]').setInputFiles(receiptFile);
    await sheet.getByRole("button", { name: /Mark paid · ₹22,000/ }).click();

    await expect(page.getByTestId("payout-paid")).toBeVisible();
    expect(rec.created).toHaveLength(0);
    expect(rec.receipts.map((r) => r.id)).toEqual(["p-draft"]);
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByTestId("draft-payout-banner")).toHaveCount(0);
  });
});

test.describe("Payments — creator's own view (24 Sep)", () => {
  test("a CREATOR sees their Pending links and Paid payouts, with page/month filters but no vendor filter", async ({ page }) => {
    await signIn(page, "CREATOR");
    await mockApi(page);
    let adminEndpointHit = false;
    const myQueries: URLSearchParams[] = [];
    await page.route(`${API_URL}/payments/**`, (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/api/payments/me/pending") {
        myQueries.push(url.searchParams);
        return route.fulfill({ json: { items: [L1, L2], total: 2 } });
      }
      if (url.pathname === "/api/payments/me/payouts") {
        return route.fulfill({
          json: {
            items: [
              {
                id: "p-1",
                creatorId: "creator-1",
                subtotal: "21000",
                isGstInvoice: false,
                gstAmount: "0",
                tdsPercent: "1",
                tdsAmount: "210",
                netAmount: "20790",
                status: "PAID",
                paidAt: "2026-09-22T00:00:00.000Z",
                utr: "4521889",
                createdAt: "2026-09-22T00:00:00.000Z",
                receipt: { name: "receipt.pdf", url: "https://cdn/receipt.pdf", uploadedAt: "2026-09-22T00:00:00.000Z" },
                items: [{ id: "i1", amount: "21000", link: { ...L1, cost: "21000" } }],
              },
            ],
            total: 1,
            page: 1,
            pageSize: 100,
          },
        });
      }
      adminEndpointHit = true;
      return route.fulfill({ status: 403, json: { error: { code: "FORBIDDEN", message: "no" } } });
    });

    await page.goto("/payments");
    await expect(page.getByRole("heading", { name: "Payments" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Internal · creator payouts" })).toHaveCount(0);
    await expect(page.getByRole("combobox", { name: "Page owner" })).toHaveCount(0);

    await expect(page.getByTestId("creator-pending-summary")).toContainText("₹20,000");
    await expect(page.getByTestId("creator-pending-row")).toHaveCount(2);
    await expect(page.getByTestId("creator-pending-list")).toContainText("@memes.daily");

    await page.getByRole("textbox", { name: "Search page" }).fill("memes");
    await expect.poll(() => myQueries.at(-1)?.get("q")).toBe("memes");
    expect(myQueries.every((q) => !q.has("ownerId"))).toBe(true);

    await page.getByRole("tab", { name: /Paid/ }).click();
    const card = page.getByTestId("creator-payout-card");
    await expect(card).toContainText("₹20,790");
    await expect(card).toContainText("TDS 1% withheld");
    await expect(card).toContainText("UTR 4521889");
    await expect(card.getByRole("link", { name: "Receipt" })).toHaveAttribute("href", "https://cdn/receipt.pdf");
    expect(adminEndpointHit).toBe(false);
  });

  test("a TEAM_MEMBER visiting /payments directly sees the restricted message", async ({ page }) => {
    await signIn(page, "TEAM_MEMBER");
    await mockApi(page);
    await page.goto("/payments");
    await expect(page.getByText("Payments is restricted")).toBeVisible();
  });
});
