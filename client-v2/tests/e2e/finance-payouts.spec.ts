import { expect, test, type Page } from "@playwright/test";

import { API_URL, mockApi, shot, signIn } from "./fixtures";

/**
 * Finance → Creator Payouts → vendor → 4-step payout (ux/design-ref/Taggify
 * Vendor Payout - FINAL.png). API is fully mocked and stateful: a payout that
 * gets its receipt removes its posts from Pending, like the real server.
 */

const RIYA = { id: "v-riya", name: "Riya Mehta", phoneNumber: null, email: "riya@example.com" };
const ASSETS = [
  { id: "a-eats", ownerId: RIYA.id, platform: "instagram", handle: "riya.eats", followers: 482000, category: "Food", approvalStatus: "approved", rateCards: [], engagement: { avgLikes: null, avgComments: null, avgViews: null, sampleSize: 0 }, owner: RIYA },
  { id: "a-trav", ownerId: RIYA.id, platform: "instagram", handle: "riyatravels", followers: 310000, category: "Travel", approvalStatus: "approved", rateCards: [], engagement: { avgLikes: null, avgComments: null, avgViews: null, sampleSize: 0 }, owner: RIYA },
];
const link = (id: string, assetId: string, handle: string, caption: string, cost: number, status = "INSIGHTS_APPROVED") => ({
  id,
  campaignId: `c-${id}`,
  assetId,
  submittedById: RIYA.id,
  url: `https://instagram.com/p/${id}`,
  format: "reel",
  cost: String(cost),
  status,
  postedAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  overQuota: false,
  campaign: { id: `c-${id}`, title: `${caption} campaign`, brandName: "Saffron Street" },
  asset: { id: assetId, handle, ownerId: RIYA.id, owner: RIYA },
  postSnapshots: [{ likeCount: 1, commentsCount: 1, videoViews: 1, capturedAt: new Date().toISOString(), caption, thumbnailUrl: null }],
});

type Recorded = { created: Record<string, unknown>[]; receipts: Record<string, unknown>[]; cancelled: string[]; paymentsCalls: number };

const INVOICE = {
  id: "inv-1",
  invoiceNumber: "INV-2026-0140",
  creatorId: RIYA.id,
  amount: "11800",
  subtotal: "10000",
  isGstInvoice: true,
  gstAmount: "1800",
  status: "APPROVED",
  dueDate: null,
  paidAt: null,
  createdAt: new Date().toISOString(),
  creator: RIYA,
  links: [{ id: "il-1", url: "https://instagram.com/p/il-1", format: "reel", assetId: "a-eats", asset: { id: "a-eats", handle: "riya.eats" }, campaign: { id: "c-inv", title: "Foodie Fridays", brandName: "Ladoo Lane" } }],
  selectable: true,
};

async function financeApi(page: Page, opts: { uploadStatus?: number; receiptStatus?: number; cancelStatus?: number; invoices?: (typeof INVOICE)[]; drafts?: Record<string, unknown>[]; pending?: ReturnType<typeof link>[] } = {}) {
  const pending = opts.pending ?? [link("l1", "a-eats", "riya.eats", "Monsoon Cravings", 18000), link("l2", "a-trav", "riyatravels", "Goa Budget Tips", 24000), link("l3", "a-eats", "riya.eats", "What I Eat in a Day", 15000, "INSIGHTS_PENDING")];
  const rec: Recorded = { created: [], receipts: [], cancelled: [], paymentsCalls: 0 };
  let draft: { id: string; linkIds: string[]; body: Record<string, unknown> } | null = null;
  const drafts = [...(opts.drafts ?? [])];

  await mockApi(page);
  await page.route(`${API_URL}/assets`, (r) => r.fulfill({ json: ASSETS }));
  await page.route(`${API_URL}/billing-profiles`, (r) => r.fulfill({ json: [{ id: "b1", userId: RIYA.id, pan: "ABCPM1234R", name: "RIYA MEHTA", gstin: null, msme: null, bankAccountNumber: "50100012344321", ifscCode: "HDFC0001234", approvalStatus: "approved", createdAt: "" }] }));
  await page.route(`${API_URL}/fake-cloudinary`, (r) => r.fulfill({ status: opts.uploadStatus ?? 200, json: { ok: true } }));
  await page.route(`${API_URL}/payments/**`, async (route) => {
    rec.paymentsCalls++;
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace(/^\/api\/payments/, "");
    const method = req.method();
    if (method === "GET" && path === "/pending") return route.fulfill({ json: { items: pending, total: pending.length, invoices: opts.invoices ?? [] } });
    if (method === "GET" && path === "/summary") {
      const amount = pending.reduce((s, l) => s + Number(l.cost), 0);
      return route.fulfill({ json: { pending: { amount, links: pending.length, invoices: 0 }, paid: { amount: 0, links: 0, payments: 0 } } });
    }
    if (method === "GET" && path === "/paid") return route.fulfill({ json: { items: [], total: 0 } });
    if (method === "GET" && path === "/payouts") return route.fulfill({ json: { items: drafts, total: drafts.length, page: 1, pageSize: 100 } });
    if (method === "GET" && path === "/payouts/d-old/receipt-upload") return route.fulfill({ json: { uploadUrl: `${API_URL}/fake-cloudinary`, apiKey: "k", timestamp: 1, signature: "s", publicId: "payout-receipts/d-old/uuid" } });
    if (method === "POST" && path === "/payouts/d-old/receipt") {
      rec.receipts.push({ draft: "d-old", ...req.postDataJSON() });
      drafts.splice(0);
      return route.fulfill({ status: 201, json: { id: "d-old", status: "PAID", creatorId: RIYA.id, subtotal: "9000", gstAmount: "0", tdsAmount: "0", netAmount: "9000", isGstInvoice: false, tdsPercent: null, paidAt: new Date().toISOString(), items: [{ id: "x", amount: "9000", link: { id: "lx" } }], createdAt: "" } });
    }
    if (method === "DELETE" && path === "/payouts/d-old") {
      rec.cancelled.push("d-old");
      drafts.splice(0);
      return route.fulfill({ status: 204, body: "" });
    }
    if (method === "POST" && path === "/payouts") {
      const body = req.postDataJSON();
      rec.created.push(body);
      draft = { id: "p-new", linkIds: body.linkIds, body };
      return route.fulfill({ status: 201, json: { id: "p-new", status: "DRAFT", creatorId: RIYA.id, subtotal: "0", gstAmount: "0", tdsAmount: "0", netAmount: "0", isGstInvoice: body.isGstInvoice, tdsPercent: body.tdsPercent, paidAt: null, createdAt: "" } });
    }
    if (method === "GET" && path === "/payouts/p-new/receipt-upload") return route.fulfill({ json: { uploadUrl: `${API_URL}/fake-cloudinary`, apiKey: "k", timestamp: 1, signature: "s", publicId: "payout-receipts/p-new/uuid" } });
    if (method === "POST" && path === "/payouts/p-new/receipt") {
      const body = req.postDataJSON();
      if (opts.receiptStatus) return route.fulfill({ status: opts.receiptStatus, json: { error: { code: "X", message: "Receipt couldn't be confirmed." } } });
      rec.receipts.push(body);
      const paidIds = draft?.linkIds ?? [];
      for (const id of paidIds) pending.splice(pending.findIndex((l) => l.id === id), 1);
      return route.fulfill({ status: 201, json: { id: "p-new", status: "PAID", creatorId: RIYA.id, subtotal: "42000", gstAmount: "0", tdsAmount: "420", netAmount: "41580", isGstInvoice: false, tdsPercent: "1", paidAt: new Date().toISOString(), utr: body.utr ?? null, items: paidIds.map((id) => ({ id, amount: "0", link: { id } })), createdAt: "" } });
    }
    if (method === "DELETE" && path === "/payouts/p-new") {
      if (opts.cancelStatus) return route.fulfill({ status: opts.cancelStatus, json: { error: { code: "INVALID_STATUS", message: "Not a draft" } } });
      rec.cancelled.push("p-new");
      draft = null;
      return route.fulfill({ status: 204, body: "" });
    }
    return route.fulfill({ status: 404, json: { error: { code: "NOT_MOCKED", message: path } } });
  });
  return rec;
}

/** 12 dues, newest first: "Post 1" … "Post 12" — more than one page of the table. */
const twelve = () =>
  Array.from({ length: 12 }, (_, i) => ({ ...link(`m${i + 1}`, "a-eats", "riya.eats", `Post ${i + 1}`, 1000 * (i + 1)), postedAt: new Date(Date.now() - i * 86_400_000).toISOString() }));

const receipt = { name: "neft-receipt.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%mock\n") };

async function walkToReceipt(page: Page) {
  await page.goto(`/finance/payouts/${RIYA.id}`);
  const rail = page.getByRole("complementary", { name: "Process payout" });
  await page.getByRole("checkbox", { name: "Select Monsoon Cravings" }).click();
  await page.getByRole("checkbox", { name: "Select Goa Budget Tips" }).click();
  await expect(rail).toContainText("2 posts");
  await rail.getByRole("button", { name: "Continue to Tax Details" }).click();
  await rail.getByRole("radio", { name: "1%" }).click();
  await expect(rail).toContainText("Total payable");
  await expect(rail).toContainText("₹41,580");
  await rail.getByRole("button", { name: "Continue to Payment Details" }).click();
  await rail.getByLabel(/UTR/).fill("UTR82374923");
  await rail.getByRole("button", { name: "Continue to Receipt" }).click();
  return rail;
}

test.describe("Finance → vendor payouts", () => {
  test.use({ viewport: { width: 1536, height: 1000 } });

  test("vendor list shows who is owed and opens the vendor", async ({ page }) => {
    await signIn(page, "FINANCE");
    await financeApi(page);
    await page.goto("/finance/payouts");
    await expect(page.getByRole("heading", { name: "Creator Payouts" })).toBeVisible();
    const row = page.getByRole("row", { name: /Riya Mehta/ });
    await expect(row).toContainText("₹57,000");
    await row.getByRole("link", { name: "Review Riya Mehta" }).click();
    await expect(page).toHaveURL(new RegExp(`/finance/payouts/${RIYA.id}$`));
    await expect(page.getByRole("heading", { name: /Riya Mehta/ })).toBeVisible();
    await expect(page.getByText("Billing approved")).toBeVisible();
  });

  test("pay two dues with 1% TDS, UTR and a receipt → they leave Dues", async ({ page }) => {
    await signIn(page, "FINANCE");
    const rec = await financeApi(page);
    const rail = await walkToReceipt(page);
    const submit = rail.getByRole("button", { name: "Submit payout" });
    await expect(submit).toBeDisabled();
    await rail.locator('input[type="file"]').setInputFiles(receipt);
    await expect(rail).toContainText("neft-receipt.pdf");
    await submit.click();
    await expect(rail.getByText("Payout submitted", { exact: true })).toBeVisible();
    await shot(page, "vendor-paid");

    expect(rec.created).toHaveLength(1);
    expect(rec.created[0]).toMatchObject({ creatorId: RIYA.id, linkIds: ["l1", "l2"], invoiceIds: [], isGstInvoice: false, tdsPercent: 1 });
    expect(rec.receipts[0]).toMatchObject({ fileName: "neft-receipt.pdf", utr: "UTR82374923" });
    expect(rec.cancelled).toHaveLength(0);
    // Refetched Dues no longer list the paid posts.
    await expect(page.getByRole("checkbox", { name: "Select Monsoon Cravings" })).toHaveCount(0);
    await expect(page.getByRole("checkbox", { name: "Select What I Eat in a Day" })).toBeVisible();
  });

  test("a failed receipt upload cancels the draft so nothing stays locked", async ({ page }) => {
    await signIn(page, "FINANCE");
    const rec = await financeApi(page, { uploadStatus: 500 });
    const rail = await walkToReceipt(page);
    await rail.locator('input[type="file"]').setInputFiles(receipt);
    await rail.getByRole("button", { name: "Submit payout" }).click();
    await expect(rail.getByRole("alert")).toContainText("Nothing was paid");
    expect(rec.created).toHaveLength(1);
    expect(rec.cancelled).toEqual(["p-new"]);
    expect(rec.receipts).toHaveLength(0);
    await expect(page.getByRole("checkbox", { name: "Select Monsoon Cravings" })).toBeVisible();
  });

  test("a receipt that isn't a PDF or image is refused with a fix", async ({ page }) => {
    await signIn(page, "FINANCE");
    await financeApi(page);
    const rail = await walkToReceipt(page);
    await rail.locator('input[type="file"]').setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hi") });
    await expect(rail.getByRole("alert")).toContainText("isn't a PDF, PNG or JPG");
    await expect(rail.getByRole("button", { name: "Submit payout" })).toBeDisabled();
  });

  test("GST 18% plus a raised invoice: invoice keeps its own GST, TDS is on the combined base", async ({ page }) => {
    await signIn(page, "FINANCE");
    const rec = await financeApi(page, { invoices: [INVOICE] });
    await page.goto(`/finance/payouts/${RIYA.id}`);
    const rail = page.getByRole("complementary", { name: "Process payout" });
    await page.getByRole("checkbox", { name: "Select Monsoon Cravings" }).click();
    await page.getByRole("checkbox", { name: "Select invoice INV-2026-0140" }).click();
    // Step 1 header = what the lines add up to: ₹18,000 post + ₹11,800 invoice.
    await expect(rail).toContainText("₹29,800");
    await rail.getByRole("button", { name: "Continue to Tax Details" }).click();
    await rail.getByRole("radio", { name: "Add GST 18%" }).click();
    await rail.getByRole("radio", { name: "2%" }).click();
    // base 28,000 · GST 3,240 (18% of 18,000) + 1,800 (invoice) = 5,040 · TDS 2% of 28,000 = 560 · net 32,480
    await expect(rail).toContainText("₹28,000");
    await expect(rail).toContainText("+ ₹5,040");
    await expect(rail).toContainText("− ₹560");
    await expect(rail).toContainText("₹32,480");
    await rail.getByRole("button", { name: "Continue to Payment Details" }).click();
    await rail.getByRole("button", { name: "Continue to Receipt" }).click();
    await rail.locator('input[type="file"]').setInputFiles(receipt);
    await rail.getByRole("button", { name: "Submit payout" }).click();
    await expect(rail.getByText("Payout submitted", { exact: true })).toBeVisible();
    expect(rec.created[0]).toMatchObject({ linkIds: ["l1"], invoiceIds: ["inv-1"], isGstInvoice: true, tdsPercent: 2 });
  });

  test("if the receipt confirm fails and the draft can't be cancelled, it says to check Paid instead of 'nothing was paid'", async ({ page }) => {
    await signIn(page, "FINANCE");
    await financeApi(page, { receiptStatus: 500, cancelStatus: 409 });
    const rail = await walkToReceipt(page);
    await rail.locator('input[type="file"]').setInputFiles(receipt);
    await rail.getByRole("button", { name: "Submit payout" }).click();
    await expect(rail.getByRole("alert")).toContainText("Check the Paid tab before trying again");
    await expect(rail.getByRole("alert")).not.toContainText("Nothing was paid");
  });

  test("a leftover draft can get its receipt, or be cancelled", async ({ page }) => {
    await signIn(page, "FINANCE");
    const draft = { id: "d-old", creatorId: RIYA.id, status: "DRAFT", subtotal: "9000", gstAmount: "0", tdsAmount: "0", netAmount: "9000", isGstInvoice: false, tdsPercent: null, paidAt: null, createdAt: "", items: [{ id: "x", amount: "9000", link: { id: "lx", campaign: { id: "c", title: "Road Trip Sound", brandName: "Kavach" } } }] };
    const rec = await financeApi(page, { drafts: [draft] });
    await page.goto(`/finance/payouts/${RIYA.id}`);
    const rail = page.getByRole("complementary", { name: "Process payout" });
    await expect(rail).toContainText("A payout is waiting for its receipt");
    await rail.getByRole("button", { name: "Add receipt" }).click();
    await rail.getByRole("button", { name: "Continue to Receipt" }).click();
    await rail.locator('input[type="file"]').setInputFiles(receipt);
    await rail.getByRole("button", { name: "Submit payout" }).click();
    await expect(rail.getByText("Payout submitted", { exact: true })).toBeVisible();
    expect(rec.receipts[0]).toMatchObject({ draft: "d-old", fileName: "neft-receipt.pdf" });
    expect(rec.created).toHaveLength(0);
  });

  test("cancelling a leftover draft asks first, then releases its posts", async ({ page }) => {
    await signIn(page, "FINANCE");
    const draft = { id: "d-old", creatorId: RIYA.id, status: "DRAFT", subtotal: "9000", gstAmount: "0", tdsAmount: "0", netAmount: "9000", isGstInvoice: false, tdsPercent: null, paidAt: null, createdAt: "", items: [{ id: "x", amount: "9000", link: { id: "lx" } }] };
    const rec = await financeApi(page, { drafts: [draft] });
    await page.goto(`/finance/payouts/${RIYA.id}`);
    const rail = page.getByRole("complementary", { name: "Process payout" });
    await rail.getByRole("button", { name: "Cancel draft…" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Cancel draft" }).click();
    await expect(rail).not.toContainText("waiting for its receipt");
    expect(rec.cancelled).toEqual(["d-old"]);
  });

  test("select-all ticks every due across pages, not just the 10 shown, and pays them all", async ({ page }) => {
    await signIn(page, "FINANCE");
    const rec = await financeApi(page, { pending: twelve() });
    await page.goto(`/finance/payouts/${RIYA.id}`);
    const rail = page.getByRole("complementary", { name: "Process payout" });
    await expect(page.getByText("Showing 1–10 of 12 dues")).toBeVisible();
    await page.getByRole("checkbox", { name: "Select all 12 dues" }).click();
    const bar = page.getByTestId("selection-bar");
    await expect(bar).toContainText("All 12 dues selected");
    await expect(rail).toContainText("12 posts");
    // Clear empties it; select-all again brings every due back.
    await bar.getByRole("button", { name: "Clear selection" }).click();
    await expect(bar).toHaveCount(0);
    await expect(rail).toContainText("Tick dues in the table");
    await page.getByRole("checkbox", { name: "Select all 12 dues" }).click();
    await page.getByRole("button", { name: "2", exact: true }).click();
    await expect(page.getByRole("checkbox", { name: "Select Post 12" })).toBeChecked();
    await rail.getByRole("button", { name: "Continue to Tax Details" }).click();
    await rail.getByRole("button", { name: "Continue to Payment Details" }).click();
    await rail.getByRole("button", { name: "Continue to Receipt" }).click();
    await rail.locator('input[type="file"]').setInputFiles(receipt);
    await rail.getByRole("button", { name: "Submit payout" }).click();
    await expect(rail.getByText("Payout submitted", { exact: true })).toBeVisible();
    expect(rec.created[0]).toMatchObject({ creatorId: RIYA.id, invoiceIds: [] });
    expect((rec.created[0].linkIds as string[]).sort()).toEqual(twelve().map((l) => l.id).sort());
  });

  test("“Select first N” ticks the first N dues in the order shown", async ({ page }) => {
    await signIn(page, "FINANCE");
    await financeApi(page, { pending: twelve() });
    await page.goto(`/finance/payouts/${RIYA.id}`);
    const rail = page.getByRole("complementary", { name: "Process payout" });
    await page.getByRole("textbox", { name: "Number of dues to select" }).fill("5");
    await expect(page.getByTestId("selection-bar")).toContainText("5 dues selected");
    await shot(page, "vendor-select-first");
    await expect(page.getByRole("checkbox", { name: "Select Post 5" })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: "Select Post 6" })).not.toBeChecked();
    await page.getByRole("button", { name: "Select one due more" }).click();
    await expect(page.getByRole("checkbox", { name: "Select Post 6" })).toBeChecked();
    await expect(rail).toContainText("6 posts");
    await page.getByRole("button", { name: "Select one due fewer" }).click();
    await expect(rail).toContainText("5 posts");
    // Gmail-style: from a partial pick, one click takes every due.
    await page.getByTestId("selection-bar").getByRole("button", { name: "Select all 12 dues" }).click();
    await expect(page.getByTestId("selection-bar")).toContainText("All 12 dues selected");
    await expect(page.getByRole("checkbox", { name: "Select all 12 dues" })).toBeChecked();
    await page.getByRole("checkbox", { name: "Select all 12 dues" }).click();
    await expect(page.getByTestId("selection-bar")).toHaveCount(0);
  });

  test("Pay on an approved invoice opens the vendor with that invoice ticked and the payout rail ready", async ({ page }) => {
    await signIn(page, "FINANCE");
    const old = { ...INVOICE, createdAt: new Date(Date.now() - 60 * 86_400_000).toISOString() };
    const rec = await financeApi(page, { pending: twelve(), invoices: [old] });
    await page.route(`${API_URL}/invoices**`, (route) => {
      const p = new URL(route.request().url()).searchParams;
      if (p.get("pageSize") === "1") return route.fulfill({ json: { items: [], total: p.get("status") === "APPROVED" ? 1 : 0, page: 1, pageSize: 1 } });
      const items =
        p.get("status") === "APPROVED"
          ? [{ ...old, status: "APPROVED", paymentStatus: "PENDING", gstStatus: "PENDING", remarks: null, overdueDays: 0, campaign: null, campaignId: null, items: [{ id: "it1", amount: "10000", link: { id: "il-1", url: "https://instagram.com/p/il-1", format: "reel", overQuota: false } }], overQuotaCount: 0, attachment: null }]
          : [];
      return route.fulfill({ json: { items, total: items.length, page: 1, pageSize: 10 } });
    });
    await page.goto("/finance/invoices");
    await page.getByRole("tab", { name: /Approved/ }).click();
    await page.getByRole("link", { name: "Pay INV-2026-0140" }).click();
    await expect(page).toHaveURL(new RegExp(`/finance/payouts/${RIYA.id}$`));
    const rail = page.getByRole("complementary", { name: "Process payout" });
    await expect(rail).toContainText("Invoice INV-2026-0140");
    await expect(rail).toContainText("₹11,800");
    // The invoice is the oldest due, so the table jumps to page 2 where it is ticked.
    await expect(page.getByRole("checkbox", { name: "Select invoice INV-2026-0140" })).toBeChecked();
    await expect(page.getByRole("button", { name: "2", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("selection-bar")).toContainText("1 due selected");
    await rail.getByRole("button", { name: "Continue to Tax Details" }).click();
    await rail.getByRole("button", { name: "Continue to Payment Details" }).click();
    await rail.getByRole("button", { name: "Continue to Receipt" }).click();
    await rail.locator('input[type="file"]').setInputFiles(receipt);
    await rail.getByRole("button", { name: "Submit payout" }).click();
    await expect(rail.getByText("Payout submitted", { exact: true })).toBeVisible();
    expect(rec.created[0]).toMatchObject({ creatorId: RIYA.id, linkIds: [], invoiceIds: ["inv-1"] });
  });

  test("a Pay link for an invoice that's no longer owed says so and ticks nothing", async ({ page }) => {
    await signIn(page, "FINANCE");
    await financeApi(page);
    await page.goto(`/finance/payouts/${RIYA.id}?invoice=gone`);
    await expect(page.getByText("That invoice isn't waiting to be paid any more. Check the Paid tab.")).toBeVisible();
    await expect(page.getByTestId("selection-bar")).toHaveCount(0);
  });

  test("a creator can't open vendor payouts and no payments data is requested", async ({ page }) => {
    await signIn(page, "CREATOR");
    const rec = await financeApi(page);
    await page.goto("/finance/payouts");
    await expect(page.getByRole("heading", { name: "You don't have access to vendor payouts" })).toBeVisible();
    await page.goto(`/finance/payouts/${RIYA.id}`);
    await expect(page.getByRole("heading", { name: "You don't have access to vendor payouts" })).toBeVisible();
    expect(rec.paymentsCalls).toBe(0);
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Payouts" })).toHaveCount(0);
  });
});
