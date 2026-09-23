import { test, expect } from "@playwright/test";

import { signIn, mockApi, API_URL } from "./fixtures";

/**
 * Creator's New invoice popup vs. "Not eligible for invoicing: <url>
 * (already on invoice INV-…)" (user report, 22 Sep). Two halves:
 *  - the "ready to invoice" list asks the server for unbilled links only
 *    (?unbilled=true — links/service.js listLinks), so a link whose status
 *    drifted away from its invoice row is never offered;
 *  - if the server still refuses (a race), the popup names the links, drops
 *    them from the list and lets the creator generate again with the rest,
 *    instead of a dead-end red line.
 */
const link = (i: number) => ({
  id: `link-${i}`,
  status: "SCREENSHOT_APPROVED",
  format: "reel",
  cost: "1000",
  postedAt: "2026-01-01T00:00:00.000Z",
  url: `https://instagram.com/p/post${i}`,
  campaignId: "camp-1",
  asset: { id: "asset-1", handle: "demo.page" },
  campaign: { id: "camp-1", title: "Derby Series", brandName: "Northfield Running Co." },
});

test("the ready list is fetched with unbilled=true; an INELIGIBLE_LINKS refusal names the links, drops them and a retry posts only the rest", async ({ page }) => {
  await signIn(page, "CREATOR");
  await mockApi(page);
  const listUrls: string[] = [];
  let listCalls = 0;
  await page.route(`${API_URL}/links?*`, (route) => {
    listUrls.push(route.request().url());
    listCalls += 1;
    // First load offers 3 links; after the refusal the refetch no longer includes link-1.
    const items = listCalls === 1 ? [link(0), link(1), link(2)] : [link(0), link(2)];
    return route.fulfill({ json: { items, total: items.length, page: 1, pageSize: 100 } });
  });
  await page.route(`${API_URL}/campaigns`, (route) => route.fulfill({ json: [] }));
  const posted: string[][] = [];
  await page.route(`${API_URL}/invoices/bulk`, (route) => {
    const ids = route.request().postDataJSON().linkIds as string[];
    posted.push(ids);
    if (posted.length === 1) {
      return route.fulfill({
        status: 400,
        json: { error: { code: "INELIGIBLE_LINKS", message: "Not eligible for invoicing: https://instagram.com/p/post1 (already on invoice INV-1787605367393-H2OKIE)" } },
      });
    }
    return route.fulfill({ json: { id: "inv-1", invoiceNumber: "INV-NEW", amount: "2000", isGstInvoice: false } });
  });

  await page.goto("/invoices");
  await page.getByRole("button", { name: "New invoice" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  expect(listUrls[0]).toContain("unbilled=true");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: /Raise invoice/ }).click();

  const notice = page.getByTestId("ineligible-links-notice");
  await expect(notice).toContainText("One link can't go on this invoice");
  await expect(notice).toContainText("https://instagram.com/p/post1");
  await expect(notice).toContainText("already on invoice INV-1787605367393-H2OKIE");
  expect(posted[0]).toEqual(["link-0", "link-1", "link-2"]);

  // The refetched list no longer has link-1, so the total and the retry exclude it.
  await expect(page.getByRole("button", { name: /Raise invoice/ })).toHaveText("Raise invoice · ₹2,000");
  await page.getByRole("button", { name: /Raise invoice/ }).click();
  await expect(page.getByRole("heading", { name: "Invoice raised" })).toBeVisible();
  expect(posted[1]).toEqual(["link-0", "link-2"]);
});

test("when every selected link is refused, Raise is disabled rather than posting an empty invoice", async ({ page }) => {
  await signIn(page, "CREATOR");
  await mockApi(page);
  let listCalls = 0;
  await page.route(`${API_URL}/links?*`, (route) => {
    listCalls += 1;
    const items = listCalls === 1 ? [link(1)] : [];
    return route.fulfill({ json: { items, total: items.length, page: 1, pageSize: 100 } });
  });
  await page.route(`${API_URL}/campaigns`, (route) => route.fulfill({ json: [] }));
  let posts = 0;
  await page.route(`${API_URL}/invoices/bulk`, (route) => {
    posts += 1;
    return route.fulfill({ status: 400, json: { error: { code: "INELIGIBLE_LINKS", message: "Not eligible for invoicing: https://instagram.com/p/post1 (already on invoice INV-9)" } } });
  });

  await page.goto("/invoices");
  await page.getByRole("button", { name: "New invoice" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: /Raise invoice/ }).click();

  await expect(page.getByTestId("ineligible-links-notice")).toContainText("INV-9");
  await expect(page.getByRole("button", { name: /Raise invoice/ })).toBeDisabled();
  expect(posts).toBe(1);
});
