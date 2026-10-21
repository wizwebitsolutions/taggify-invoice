import { expect, test, type Page } from "@playwright/test";

import { API_URL, mockApi, shot, signIn, userFor, type MockRole } from "./fixtures";

/** Finance → Invoices: creator invoices by status, approve / reject with reason, over-booking block. API fully mocked. */

const RIYA = { id: "v-riya", name: "Riya Mehta", phoneNumber: null, email: "riya@example.com" };
const link = (id: string, overQuota = false) => ({ id, url: `https://www.instagram.com/reel/${id}/`, format: "reel", overQuota });
const invoice = (id: string, number: string, status: string, extra: Record<string, unknown> = {}) => ({
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
  createdAt: "2026-10-03T10:00:00.000Z",
  overdueDays: 0,
  campaign: { id: "c1", title: "Diwali Food Stories", brandName: "Saffron Street" },
  items: [{ id: `${id}-1`, amount: "32000", link: link(`${id}l`) }],
  overQuotaCount: 0,
  attachment: null,
  ...extra,
});
const TOTALS: Record<string, number> = { RAISED: 2, APPROVED: 1, PAID: 8, REJECTED: 1 };

async function invoicesApi(page: Page) {
  const calls = { approved: [] as string[], rejected: [] as unknown[], lists: [] as URLSearchParams[] };
  await mockApi(page);
  await page.route(`${API_URL}/invoices**`, (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace(/^\/api\/invoices/, "");
    const m = path.match(/^\/([^/]+)\/(approve|reject)$/);
    if (req.method() === "POST" && m) {
      if (m[2] === "approve") calls.approved.push(m[1]);
      else calls.rejected.push({ id: m[1], ...req.postDataJSON() });
      return route.fulfill({ json: {} });
    }
    const p = url.searchParams;
    const status = p.get("status") ?? "";
    if (p.get("pageSize") === "1") return route.fulfill({ json: { items: [], total: TOTALS[status] ?? 0, page: 1, pageSize: 1 } });
    calls.lists.push(p);
    const items =
      status === "RAISED"
        ? [invoice("i1", "INV-2026-0140", "RAISED"), invoice("i2", "INV-2026-0137", "RAISED", { overQuotaCount: 1, items: [{ id: "x1", amount: "32000", link: link("ok") }, { id: "x2", amount: "13000", link: link("extra", true) }] })]
        : status === "APPROVED"
          ? [invoice("i3", "INV-2026-0139", "APPROVED")]
          : [];
    return route.fulfill({ json: { items, total: items.length, page: 1, pageSize: 10 } });
  });
  return calls;
}

test.describe("Finance invoices", () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test("finance approves a clean invoice; one with a post over booking can only be rejected", async ({ page }) => {
    await signIn(page, "FINANCE");
    const calls = await invoicesApi(page);
    await page.goto("/finance/invoices");
    await expect(page.getByRole("tab", { name: "Waiting for approval (2)" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Paid (8)" })).toBeVisible();
    const over = page.getByRole("row", { name: /INV-2026-0137/ });
    await expect(over.getByText("1 post over booking")).toBeVisible();
    await expect(over.getByRole("button", { name: "Approve" })).toHaveCount(0);
    await shot(page, "finance-invoices");

    await page.getByRole("row", { name: /INV-2026-0140/ }).getByRole("button", { name: "Approve" }).click();
    await expect(page.getByText("INV-2026-0140 approved. Pay it from Payouts.")).toBeVisible();
    expect(calls.approved).toEqual(["i1"]);

    await over.getByRole("button", { name: "Reject…" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: "Reject invoice" })).toBeDisabled();
    await dialog.getByLabel("Reason").fill("One post is over the booking. Raise it again without it.");
    await dialog.getByRole("button", { name: "Reject invoice" }).click();
    await expect(page.getByText("INV-2026-0137 rejected.")).toBeVisible();
    expect(calls.rejected).toEqual([{ id: "i2", remarks: "One post is over the booking. Raise it again without it." }]);
  });

  test("the invoice panel lists its posts and flags the one over booking", async ({ page }) => {
    await signIn(page, "FINANCE");
    await invoicesApi(page);
    await page.goto("/finance/invoices");
    await page.getByRole("button", { name: /^INV-2026-0137/ }).click();
    const panel = page.getByRole("dialog");
    await expect(panel.getByText(/beyond what the campaign booked/)).toBeVisible();
    await expect(panel.getByRole("listitem").filter({ hasText: "Over booking" })).toHaveCount(1);
  });

  test("approved invoices send you to the vendor's payout; search asks the server", async ({ page }) => {
    await signIn(page, "FINANCE");
    const calls = await invoicesApi(page);
    await page.goto("/finance/invoices");
    await page.getByRole("tab", { name: /Approved/ }).click();
    await expect(page.getByRole("row", { name: /INV-2026-0139/ }).getByRole("link", { name: "Pay INV-2026-0139" })).toHaveAttribute("href", "/finance/payouts/v-riya?invoice=i3");
    await page.getByRole("searchbox", { name: "Search invoices" }).fill("0139");
    await expect.poll(() => calls.lists.at(-1)?.get("search")).toBe("0139");
  });

  test("a refused approve (post now over booking) shows why and refreshes the row", async ({ page }) => {
    await signIn(page, "FINANCE");
    const calls = await invoicesApi(page);
    await page.route(`${API_URL}/invoices/i1/approve`, (route) => route.fulfill({ status: 409, json: { error: { code: "OVER_QUOTA", message: "This invoice includes 1 post beyond what the campaign booked for the page." } } }));
    await page.goto("/finance/invoices");
    const before = calls.lists.length;
    await page.getByRole("row", { name: /INV-2026-0140/ }).getByRole("button", { name: "Approve" }).click();
    await expect(page.getByText("This invoice includes 1 post beyond what the campaign booked")).toBeVisible();
    await expect.poll(() => calls.lists.length).toBeGreaterThan(before);
  });

  test("reject refused because the invoice is on a payout; the dialog starts clean next time", async ({ page }) => {
    await signIn(page, "FINANCE");
    await invoicesApi(page);
    await page.route(`${API_URL}/invoices/i1/reject`, (route) => route.fulfill({ status: 409, json: { error: { code: "ON_PAYOUT", message: "This invoice is on a payout awaiting its receipt — cancel that payout in Payments before rejecting it" } } }));
    await page.goto("/finance/invoices");
    await page.getByRole("row", { name: /INV-2026-0140/ }).getByRole("button", { name: "Reject…" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Reason").fill("Duplicate");
    await dialog.getByRole("button", { name: "Reject invoice" }).click();
    await expect(dialog.getByText(/on a payout awaiting its receipt/)).toBeVisible();
    await dialog.getByRole("button", { name: "Keep it" }).click();
    await page.getByRole("row", { name: /INV-2026-0137/ }).getByRole("button", { name: "Reject…" }).click();
    await expect(dialog.getByLabel("Reason")).toHaveValue("");
    await expect(dialog.getByText(/on a payout/)).toHaveCount(0);
  });

  test("finance marks a GST invoice's filing and downloads its post links", async ({ page }) => {
    await signIn(page, "FINANCE");
    const gstCalls: unknown[] = [];
    let linksAsked = false;
    await invoicesApi(page);
    await page.route(`${API_URL}/invoices/i1/gst-status`, (route) => {
      gstCalls.push(route.request().postDataJSON());
      return route.fulfill({ json: {} });
    });
    await page.route(`${API_URL}/invoices/i1/links.txt`, (route) => {
      linksAsked = true;
      return route.fulfill({ body: "https://www.instagram.com/reel/i1l/", contentType: "text/plain" });
    });
    await page.goto("/finance/invoices");
    const row = page.getByRole("row", { name: /INV-2026-0140/ });
    await expect(row.getByText("GST not filed")).toBeVisible();
    await row.getByRole("button", { name: "More for INV-2026-0140" }).click();
    await page.getByRole("menuitem", { name: "Mark GST filed" }).click();
    await expect(page.getByText("INV-2026-0140: GST filed.")).toBeVisible();
    expect(gstCalls).toEqual([{ gstStatus: "COMPLETED" }]);
    await row.getByRole("button", { name: "More for INV-2026-0140" }).click();
    await page.getByRole("menuitem", { name: "Download post links" }).click();
    await expect.poll(() => linksAsked).toBe(true);
  });

  test("view-only finance can read but not approve, reject or pay", async ({ page }) => {
    await signIn(page, "FINANCE", { permissions: { ...userFor("FINANCE").permissions, "finance.approve": false, "finance.pay": false } });
    await invoicesApi(page);
    await page.goto("/finance/invoices");
    await expect(page.getByRole("row", { name: /INV-2026-0140/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Approve$|^Reject…$/ })).toHaveCount(0);
    await page.getByRole("tab", { name: /Approved/ }).click();
    await expect(page.getByRole("row", { name: /INV-2026-0139/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "Pay" })).toHaveCount(0);
  });

  test("planner reads their plans' invoices without any decision buttons", async ({ page }) => {
    await signIn(page, "PLAN_MAKER");
    await invoicesApi(page);
    await page.goto("/finance/invoices");
    await expect(page.getByRole("row", { name: /INV-2026-0140/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Approve$|^Reject…$/ })).toHaveCount(0);
  });

  for (const role of ["CREATOR", "TEAM_MEMBER"] as MockRole[]) {
    test(`${role} can't open Finance → Invoices`, async ({ page }) => {
      await signIn(page, role);
      const calls = await invoicesApi(page);
      await page.goto("/finance/invoices");
      await expect(page.getByText(/don.t have access to invoices/)).toBeVisible();
      expect(calls.lists).toHaveLength(0);
    });
  }
});
