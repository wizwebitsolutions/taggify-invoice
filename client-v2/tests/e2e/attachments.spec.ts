import { expect, test, type Page } from "@playwright/test";

import { API_URL, mockApi, shot, signIn } from "./fixtures";

/** Invoice files: the creator's own invoice (Finance → Invoices drawer, Money → Invoices) and a plan's client invoice file. API + Cloudinary mocked. */

const now = new Date().toISOString();
const UPLOAD = { uploadUrl: "https://upload.test/image/upload", apiKey: "k", timestamp: 1, signature: "s" };
const RIYA = { id: "v-riya", name: "Riya Mehta", phoneNumber: null, email: "riya@example.com" };
const invoice = (id: string, number: string, status: string, attachment: { name: string; url: string } | null = null) => ({
  id,
  creatorId: RIYA.id,
  creator: RIYA,
  invoiceNumber: number,
  amount: "37760",
  subtotal: "32000",
  isGstInvoice: true,
  gstAmount: "5760",
  status,
  paymentStatus: "PENDING",
  gstStatus: "PENDING",
  remarks: null,
  dueDate: null,
  paidAt: null,
  createdAt: now,
  overdueDays: 0,
  campaign: { id: "c1", title: "Diwali Food Stories", brandName: "Saffron Street" },
  items: [{ id: `${id}-1`, amount: "32000", link: { id: `${id}l`, url: `https://www.instagram.com/reel/${id}/`, format: "reel", overQuota: false } }],
  overQuotaCount: 0,
  attachment: attachment && { ...attachment, uploadedAt: now, uploadedById: "x" },
});
const pdf = (name = "riya-gst-invoice.pdf") => ({ name, mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 test") });

/** Invoices whose attachment changes as the app attaches / removes. */
async function invoiceApi(page: Page, start: ReturnType<typeof invoice>[]) {
  const rows = start.map((r) => ({ ...r }));
  const calls = { signed: [] as string[], uploaded: 0, confirmed: [] as unknown[], removed: [] as string[] };
  await mockApi(page);
  await page.route("https://upload.test/**", (route) => {
    calls.uploaded++;
    return route.fulfill({ json: {} });
  });
  await page.route(`${API_URL}/invoices**`, (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace(/^\/api\/invoices/, "");
    const m = path.match(/^\/([^/]+)\/attachment(\/upload-url)?$/);
    if (m) {
      const row = rows.find((r) => r.id === m[1])!;
      if (m[2]) {
        calls.signed.push(m[1]);
        return route.fulfill({ json: { ...UPLOAD, publicId: `invoice-attachments/${m[1]}/file` } });
      }
      if (req.method() === "POST") {
        const body = req.postDataJSON();
        calls.confirmed.push({ id: m[1], ...body });
        row.attachment = { name: body.fileName, url: "https://files.test/inv.pdf", uploadedAt: now, uploadedById: "x" };
        return route.fulfill({ status: 201, json: row.attachment });
      }
      calls.removed.push(m[1]);
      row.attachment = null;
      return route.fulfill({ status: 204, body: "" });
    }
    const status = url.searchParams.get("status");
    const items = status ? rows.filter((r) => r.status === status) : rows;
    if (url.searchParams.get("pageSize") === "1") return route.fulfill({ json: { items: [], total: items.length, page: 1, pageSize: 1 } });
    return route.fulfill({ json: { items, total: items.length, page: 1, pageSize: 100 } });
  });
  return calls;
}

test.describe("Invoice files", () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test("finance: attaches the creator's invoice in the drawer, then removes it", async ({ page }) => {
    await signIn(page, "FINANCE");
    const calls = await invoiceApi(page, [invoice("i1", "INV-2026-0140", "RAISED")]);
    await page.goto("/finance/invoices");
    await page.getByRole("button", { name: /^INV-2026-0140/ }).click();
    const drawer = page.getByRole("dialog");
    await expect(drawer.getByRole("heading", { name: "Creator's invoice file" })).toBeVisible();
    await expect(drawer.getByText("PDF or image, up to 10 MB.")).toBeVisible();
    await drawer.locator('input[type="file"]').setInputFiles(pdf());
    await expect(page.getByText("riya-gst-invoice.pdf attached.")).toBeVisible();
    await expect(drawer.getByRole("link", { name: "riya-gst-invoice.pdf" })).toHaveAttribute("href", "https://files.test/inv.pdf");
    expect(calls.signed).toEqual(["i1"]);
    expect(calls.uploaded).toBe(1);
    expect(calls.confirmed).toEqual([{ id: "i1", publicId: "invoice-attachments/i1/file", fileName: "riya-gst-invoice.pdf" }]);
    await shot(page, "invoice-file-drawer");

    await drawer.getByRole("button", { name: "Remove riya-gst-invoice.pdf" }).click();
    await expect(page.getByText("The invoice file was removed.")).toBeVisible();
    await expect(drawer.getByRole("button", { name: "Attach the creator's invoice" })).toBeVisible();
    expect(calls.removed).toEqual(["i1"]);
  });

  test("a file that isn't a PDF or image is refused before anything uploads", async ({ page }) => {
    await signIn(page, "FINANCE");
    const calls = await invoiceApi(page, [invoice("i1", "INV-2026-0140", "RAISED")]);
    await page.goto("/finance/invoices");
    await page.getByRole("button", { name: /^INV-2026-0140/ }).click();
    await page.getByRole("dialog").locator('input[type="file"]').setInputFiles({ name: "notes.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: Buffer.from("x") });
    await expect(page.getByRole("dialog").getByRole("alert")).toHaveText("notes.docx isn't a PDF or image. Attach the invoice as a PDF, JPG, PNG or WebP.");
    expect(calls.signed).toEqual([]);
  });

  test("a paid invoice shows its file read-only", async ({ page }) => {
    await signIn(page, "FINANCE");
    await invoiceApi(page, [invoice("i3", "INV-2026-0101", "PAID", { name: "old.pdf", url: "https://files.test/old.pdf" })]);
    await page.goto("/finance/invoices?tab=PAID");
    await page.getByRole("tab", { name: /Paid/ }).click();
    await page.getByRole("button", { name: /^INV-2026-0101/ }).click();
    const drawer = page.getByRole("dialog");
    await expect(drawer.getByRole("link", { name: "old.pdf" })).toBeVisible();
    await expect(drawer.getByText("Paid invoices can't change.")).toBeVisible();
    await expect(drawer.getByRole("button", { name: /Remove|Replace/ })).toHaveCount(0);
  });

  test("creator: attaches their own invoice from Money → Invoices", async ({ page }) => {
    await signIn(page, "CREATOR", { ownAccess: { "finance.view": true, "finance.edit": true } });
    const calls = await invoiceApi(page, [invoice("i1", "INV-2026-0140", "RAISED"), invoice("i2", "INV-2026-0099", "PAID")]);
    await page.route(`${API_URL}/payments/me/**`, (route) => route.fulfill({ json: { items: [], total: 0, invoices: [], pending: { amount: 0, links: 0, invoices: 0 }, paid: { amount: 0, links: 0, payments: 0 } } }));
    await page.goto("/money");
    await page.getByRole("tab", { name: /Invoices/ }).click();
    // The paid invoice has nothing attached and can't take a file now; only the open one offers it.
    await expect(page.getByRole("button", { name: "Attach your invoice" })).toHaveCount(1);
    await page.locator('input[type="file"]').first().setInputFiles(pdf("my-invoice.pdf"));
    await expect(page.getByRole("link", { name: "my-invoice.pdf" })).toBeVisible();
    expect(calls.confirmed).toEqual([{ id: "i1", publicId: "invoice-attachments/i1/file", fileName: "my-invoice.pdf" }]);
    await shot(page, "invoice-file-money");
  });

  test("creator whose invoice editing is switched off sees files read-only", async ({ page }) => {
    await signIn(page, "CREATOR", { ownAccess: { "finance.view": true, "finance.edit": false } });
    await invoiceApi(page, [invoice("i1", "INV-2026-0140", "RAISED", { name: "mine.pdf", url: "https://files.test/m.pdf" })]);
    await page.route(`${API_URL}/payments/me/**`, (route) => route.fulfill({ json: { items: [], total: 0, invoices: [], pending: { amount: 0, links: 0, invoices: 0 }, paid: { amount: 0, links: 0, payments: 0 } } }));
    await page.goto("/money");
    await page.getByRole("tab", { name: /Invoices/ }).click();
    await expect(page.getByRole("link", { name: "mine.pdf" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Remove|Replace|Attach/ })).toHaveCount(0);
  });
});

test.describe("Client invoice file on a plan", () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  const PLAN = {
    id: "p1",
    name: "Diwali Food Stories",
    clientName: "Saffron Street",
    clientCompany: "Saffron Street Foods",
    clientContact: null,
    clientInvoiceNumber: "TGF/26-27/014",
    notes: null,
    budget: "120000",
    isGstPlan: true,
    gstPercent: 18,
    status: "APPROVED",
    approvedAt: now,
    createdAt: now,
    updatedAt: now,
    items: [],
    totalCost: 0,
    budgetVariance: 0,
    expectedEngagement: { likes: 0, views: 0 },
    overview: { totalFollowers: 0, totalPosts: 0, expectedImpressions: 0, subtotal: 0, gstAmount: 0, total: 0 },
    internal: { computedFollowers: 0, computedPosts: 0, computedImpressions: 0, computedSubtotal: 0, computedGstAmount: 0, computedTotal: 0 },
    pitchGroupId: null,
    variantLabel: "Plan A",
    campaignId: "c1",
    createdBy: { id: "u-priya", name: "Priya" },
    invoiceAttachment: null as null | { name: string; url: string; uploadedAt: string; uploadedById: string },
  };

  async function planApi(page: Page, overrides: Record<string, unknown> = {}) {
    const plan = { ...PLAN, ...overrides } as typeof PLAN;
    const calls = { confirmed: [] as unknown[] };
    await mockApi(page);
    await page.route("https://upload.test/**", (route) => route.fulfill({ json: {} }));
    await page.route(`${API_URL}/plans**`, (route) => {
      const req = route.request();
      const path = new URL(req.url()).pathname.replace(/^\/api\/plans/, "");
      if (path === "/p1/invoice-attachment/upload-url") return route.fulfill({ json: { ...UPLOAD, publicId: "plan-invoice-attachments/p1/file" } });
      if (path === "/p1/invoice-attachment" && req.method() === "POST") {
        const body = req.postDataJSON();
        calls.confirmed.push(body);
        plan.invoiceAttachment = { name: body.fileName, url: "https://files.test/client.pdf", uploadedAt: now, uploadedById: "x" };
        return route.fulfill({ status: 201, json: plan.invoiceAttachment });
      }
      if (path === "/p1") return route.fulfill({ json: plan });
      if (path === "") return route.fulfill({ json: [plan] });
      return route.fulfill({ json: [] });
    });
    return calls;
  }

  test("admin attaches the client invoice file on an approved plan", async ({ page }) => {
    await signIn(page, "ADMIN");
    const calls = await planApi(page);
    await page.goto("/plans/p1");
    await expect(page.getByText("TGF/26-27/014")).toBeVisible();
    await page.locator('input[type="file"]').setInputFiles(pdf("saffron-invoice.pdf"));
    await expect(page.getByRole("link", { name: "saffron-invoice.pdf" })).toBeVisible();
    expect(calls.confirmed).toEqual([{ publicId: "plan-invoice-attachments/p1/file", fileName: "saffron-invoice.pdf" }]);
    await shot(page, "plan-invoice-file");
  });

  test("a plan's client invoice must be a PDF; a draft plan can take one too", async ({ page }) => {
    await signIn(page, "ADMIN");
    const calls = await planApi(page, { status: "DRAFT", approvedAt: null, clientInvoiceNumber: null, campaignId: null });
    await page.goto("/plans/p1");
    await expect(page.getByText("PDF, up to 10 MB.")).toBeVisible();
    await page.locator('input[type="file"]').setInputFiles({ name: "saffron-invoice.jpg", mimeType: "image/jpeg", buffer: Buffer.from("x") });
    await expect(page.getByText("saffron-invoice.jpg isn't a PDF. Attach the client invoice as a PDF.")).toBeVisible();
    expect(calls.confirmed).toEqual([]);
    await page.locator('input[type="file"]').setInputFiles(pdf("saffron-invoice.pdf"));
    await expect(page.getByRole("link", { name: "saffron-invoice.pdf" })).toBeVisible();
  });

  test("finance (no plans.edit) gets no attach control", async ({ page }) => {
    await signIn(page, "FINANCE", { permissions: { ...(await import("./fixtures")).userFor("FINANCE").permissions, "plans.view": true } });
    await planApi(page);
    await page.goto("/plans/p1");
    await expect(page.getByText("TGF/26-27/014")).toBeVisible();
    await expect(page.getByRole("button", { name: "Attach client invoice PDF" })).toHaveCount(0);
  });
});

test.describe("Client invoice file from Receivables", () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  const receivable = (createdBy = { id: "u-priya", name: "Priya" }) => ({
    id: "ci1",
    planId: "p1",
    campaignId: "c1",
    invoiceNumber: "TGF/26-27/014",
    subtotal: "100000",
    gstPercent: "18",
    gstAmount: "18000",
    total: "118000",
    status: "ISSUED",
    issuedAt: now,
    paidAt: null,
    paidAmount: null,
    remarks: null,
    plan: {
      id: "p1",
      name: "Diwali Food Stories",
      clientName: "Saffron Street",
      clientCompany: "Saffron Street Foods",
      clientGstNumber: null,
      createdById: createdBy.id,
      createdBy,
      campaign: null,
      invoiceAttachment: null as null | { name: string; url: string; uploadedAt: string; uploadedById: string },
    },
  });

  async function receivablesApi(page: Page, row = receivable()) {
    const calls = { confirmed: [] as unknown[], removed: 0 };
    await mockApi(page);
    await page.route("https://upload.test/**", (route) => route.fulfill({ json: {} }));
    await page.route(`${API_URL}/invoices/client**`, (route) => route.fulfill({ json: { items: [row], total: 1 } }));
    await page.route(`${API_URL}/plans/p1/invoice-attachment**`, (route) => {
      const req = route.request();
      if (req.url().endsWith("/upload-url")) return route.fulfill({ json: { ...UPLOAD, publicId: "plan-invoice-attachments/p1/file" } });
      if (req.method() === "POST") {
        const body = req.postDataJSON();
        calls.confirmed.push(body);
        row.plan.invoiceAttachment = { name: body.fileName, url: "https://files.test/client.pdf", uploadedAt: now, uploadedById: "x" };
        return route.fulfill({ status: 201, json: row.plan.invoiceAttachment });
      }
      calls.removed++;
      row.plan.invoiceAttachment = null;
      return route.fulfill({ status: 204, body: "" });
    });
    return calls;
  }

  test("admin attaches the plan's final invoice PDF on the row, then removes it", async ({ page }) => {
    await signIn(page, "ADMIN");
    const calls = await receivablesApi(page);
    await page.goto("/finance/receivables");
    const row = page.getByRole("row").filter({ hasText: "TGF/26-27/014" });
    await expect(row.getByRole("button", { name: "Attach client invoice PDF" })).toBeVisible();
    await row.locator('input[type="file"]').setInputFiles(pdf("saffron-final.pdf"));
    await expect(row.getByRole("link", { name: "saffron-final.pdf" })).toHaveAttribute("href", "https://files.test/client.pdf");
    expect(calls.confirmed).toEqual([{ publicId: "plan-invoice-attachments/p1/file", fileName: "saffron-final.pdf" }]);
    await shot(page, "receivables-attach");
    await row.getByRole("button", { name: "Remove saffron-final.pdf" }).click();
    await expect(row.getByRole("button", { name: "Attach client invoice PDF" })).toBeVisible();
    expect(calls.removed).toBe(1);
  });

  test("finance (no plans.edit) sees no attach control on the row", async ({ page }) => {
    await signIn(page, "FINANCE");
    await receivablesApi(page);
    await page.goto("/finance/receivables");
    await expect(page.getByRole("row").filter({ hasText: "TGF/26-27/014" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Attach client invoice PDF" })).toHaveCount(0);
  });

  test("a planner gets the control only on their own plan's invoice", async ({ page }) => {
    // Own-scope switches default on; the plan's maker is this planner.
    const planner = await signIn(page, "PLAN_MAKER");
    await receivablesApi(page, receivable({ id: planner.id, name: "Test PLAN_MAKER" }));
    await page.goto("/finance/receivables");
    await expect(page.getByRole("button", { name: "Attach client invoice PDF" })).toBeVisible();
  });

  test("a planner gets no control on someone else's plan", async ({ page }) => {
    await signIn(page, "PLAN_MAKER");
    await receivablesApi(page);
    await page.goto("/finance/receivables");
    await expect(page.getByRole("row").filter({ hasText: "TGF/26-27/014" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Attach client invoice PDF" })).toHaveCount(0);
  });
});
