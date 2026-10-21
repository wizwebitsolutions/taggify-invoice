import { expect, test, type Page } from "@playwright/test";

import { API_URL, mockApi, shot, signIn, type MockRole } from "./fixtures";

/** Content: every post, server-side status tabs, filters and paging; mark broken. API fully mocked. */

const now = new Date().toISOString();
const RIYA = { id: "v-riya", name: "Riya Mehta", phoneNumber: null, email: "riya@example.com" };
const post = (id: string, status: string, caption: string, extra: Record<string, unknown> = {}) => ({
  id,
  campaignId: "c1",
  assetId: "a1",
  submittedById: RIYA.id,
  url: `https://www.instagram.com/reel/${id}/`,
  format: "reel",
  cost: "32000",
  status,
  postedAt: now,
  createdAt: now,
  overQuota: false,
  campaign: { id: "c1", title: "Diwali Food Stories", brandName: "Saffron Street" },
  asset: { id: "a1", handle: "riya.eats", platform: "instagram", followers: 482000, ownerId: RIYA.id, owner: RIYA },
  screenshot: { id: `s${id}`, publicId: "x", approved: null, url: "https://example.com/proof.png" },
  invoiceItem: null,
  payoutItem: null,
  postSnapshots: [{ likeCount: 1, commentsCount: 1, videoViews: 1, capturedAt: now, caption, thumbnailUrl: null }],
  ...extra,
});
const TOTALS: Record<string, number> = { all: 23, "PENDING_SCREENSHOT_REVIEW,INSIGHTS_PENDING": 3, "SUBMITTED,SCREENSHOT_REJECTED,INVALID": 2, bill: 14, INVOICED: 4 };

async function contentApi(page: Page) {
  const calls = { lists: [] as URLSearchParams[], broken: [] as unknown[], reviewed: [] as unknown[], insights: [] as string[] };
  await mockApi(page);
  await page.route(`${API_URL}/campaigns`, (route) =>
    route.fulfill({ json: [{ id: "c1", title: "Diwali Food Stories", brandName: "Saffron Street", createdAt: now }, { id: "r2", title: "Monsoon Getaways", brandName: "Northbound", createdAt: now, phaseCount: 2 }] })
  );
  await page.route(`${API_URL}/campaigns/r2`, (route) =>
    route.fulfill({ json: { id: "r2", title: "Monsoon Getaways", brandName: "Northbound", createdAt: now, phases: [{ id: "r2", phaseNumber: 1, title: "Monsoon Getaways", createdAt: now }, { id: "r2-p2", phaseNumber: 2, title: "Monsoon Getaways", createdAt: now }] } })
  );
  await page.route(`${API_URL}/assets`, (route) => route.fulfill({ json: [{ id: "a1", ownerId: RIYA.id, owner: RIYA, platform: "instagram", handle: "riya.eats", followers: 482000, approvalStatus: "approved", createdAt: now, rateCards: [], engagement: {}, campaigns: [] }] }));
  await page.route(`${API_URL}/links**`, (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace(/^\/api\/links/, "");
    if (req.method() === "POST" && path.endsWith("/mark-invalid")) {
      calls.broken.push({ id: path.split("/")[1], ...req.postDataJSON() });
      return route.fulfill({ json: {} });
    }
    if (req.method() === "POST" && path.endsWith("/review-screenshot")) {
      calls.reviewed.push({ id: path.split("/")[1], ...req.postDataJSON() });
      return route.fulfill({ json: {} });
    }
    if (req.method() === "POST" && path.endsWith("/approve-insights")) {
      calls.insights.push(path.split("/")[1]);
      return route.fulfill({ json: {} });
    }
    const p = url.searchParams;
    const size = Number(p.get("pageSize"));
    const key = p.get("unbilled") === "true" ? "bill" : (p.get("status") ?? "all");
    const total = TOTALS[key] ?? 0;
    if (size > 1) calls.lists.push(p);
    if (size === 1) return route.fulfill({ json: { items: [], total, page: 1, pageSize: 1 } });
    const pageNo = Number(p.get("page"));
    const items =
      key === "INVOICED"
        ? [post("i1", "INVOICED", "Festive thali", { invoiceItem: { invoiceId: "inv1", invoice: { invoiceNumber: "INV-2026-0140", status: "APPROVED" } } })]
        : [post(`l${pageNo}a`, "PENDING_SCREENSHOT_REVIEW", pageNo === 1 ? "Thali hacks" : "Page two post"), post(`l${pageNo}b`, "INSIGHTS_APPROVED", "Sweet run", { payoutItem: { payoutId: "po1" } }), post(`l${pageNo}c`, "INSIGHTS_PENDING", "Chai stories")];
    return route.fulfill({ json: { items, total, page: pageNo, pageSize: size } });
  });
  return calls;
}

test.describe("Content", () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test("admin: tab counts are the server's totals, rows link to their campaign, paging asks the server", async ({ page }) => {
    await signIn(page, "ADMIN");
    const calls = await contentApi(page);
    await page.goto("/content");
    await expect(page.getByRole("tab", { name: "All (23)" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Waiting for review (3)" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Ready to bill (14)" })).toBeVisible();
    await expect(page.getByText("Showing 1–10 of 23 posts")).toBeVisible();
    const row = page.getByRole("row", { name: /Thali hacks/ });
    await expect(row.getByRole("link", { name: /Diwali Food Stories/ })).toHaveAttribute("href", "/campaigns/c1");
    await expect(row.getByText("Proof in review")).toBeVisible();
    await shot(page, "content");
    await page.getByRole("button", { name: "2", exact: true }).click();
    await expect(page.getByRole("row", { name: /Page two post/ })).toBeVisible();
    expect(calls.lists.at(-1)?.get("page")).toBe("2");
  });

  test("tabs and filters become server queries; Ready to bill uses the billable rule", async ({ page }) => {
    await signIn(page, "ADMIN");
    const calls = await contentApi(page);
    await page.goto("/content");
    await page.getByRole("tab", { name: /Ready to bill/ }).click();
    await expect.poll(() => calls.lists.at(-1)?.get("unbilled")).toBe("true");
    expect(calls.lists.at(-1)?.get("status")).toBe("SUBMITTED,PENDING_SCREENSHOT_REVIEW,SCREENSHOT_APPROVED,INSIGHTS_PENDING,INSIGHTS_APPROVED");
    await page.getByRole("tab", { name: /Invoiced/ }).click();
    await expect(page.getByRole("row", { name: /Festive thali/ }).getByText("INV-2026-0140")).toBeVisible();

    await page.getByRole("combobox", { name: /Campaign/ }).click();
    await page.getByRole("option", { name: "Diwali Food Stories" }).click();
    await expect.poll(() => calls.lists.at(-1)?.get("campaignId")).toBe("c1");
    await page.getByRole("combobox", { name: /Page/ }).click();
    await page.getByRole("option", { name: "riya.eats" }).click();
    await expect.poll(() => calls.lists.at(-1)?.get("assetId")).toBe("a1");
    await page.getByRole("button", { name: "Clear filters" }).click();
    // Back to the unfiltered list (served from cache, so no new request is needed).
    await expect(page.getByRole("combobox", { name: /Campaign/ })).toContainText("All");
    await expect(page.getByRole("button", { name: "Clear filters" })).toHaveCount(0);
    await expect(page.getByRole("row", { name: /Festive thali/ })).toBeVisible();
  });

  test("admin marks a post broken with a reason; review items link to Approvals", async ({ page }) => {
    await signIn(page, "ADMIN");
    const calls = await contentApi(page);
    await page.goto("/content");
    await page.getByRole("button", { name: "Actions for Thali hacks" }).click();
    await expect(page.getByRole("menuitem", { name: "Review in Approvals" })).toHaveAttribute("href", "/approvals?type=proof");
    await page.keyboard.press("Escape");
    // Mark as broken lives in the row's status menu (design-fix #6).
    await page.getByRole("row", { name: /Thali hacks/ }).getByRole("button", { name: /Change status/ }).click();
    await page.getByRole("menuitem", { name: "Mark as broken…" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: "Mark as broken" })).toBeDisabled();
    await dialog.getByLabel("What's wrong").fill("Post deleted");
    await dialog.getByRole("button", { name: "Mark as broken" }).click();
    await expect(page.getByText("Marked as broken.")).toBeVisible();
    expect(calls.broken).toEqual([{ id: "l1a", note: "Post deleted" }]);
  });

  test("a phased campaign asks which phase (the server filters one phase at a time)", async ({ page }) => {
    await signIn(page, "ADMIN");
    const calls = await contentApi(page);
    await page.goto("/content");
    await expect(page.getByRole("combobox", { name: /Phase/ })).toHaveCount(0);
    await page.getByRole("combobox", { name: /Campaign/ }).click();
    await page.getByRole("option", { name: "Monsoon Getaways (2 phases)" }).click();
    await expect.poll(() => calls.lists.at(-1)?.get("campaignId")).toBe("r2");
    await page.getByRole("combobox", { name: /Phase/ }).click();
    await page.getByRole("option", { name: "Phase 2" }).click();
    await expect.poll(() => calls.lists.at(-1)?.get("campaignId")).toBe("r2-p2");
  });

  test("a post already on a payout can't be marked broken", async ({ page }) => {
    await signIn(page, "ADMIN");
    await contentApi(page);
    await page.goto("/content");
    const row = page.getByRole("row", { name: /Sweet run/ });
    await expect(row.getByText("On a payout")).toBeVisible();
    // Verified and already on a payout: no next step, so the status is a plain pill.
    await expect(row.getByText("Verified")).toBeVisible();
    await expect(row.getByRole("button", { name: /Change status/ })).toHaveCount(0);
    await page.getByRole("button", { name: "Actions for Sweet run" }).click();
    await expect(page.getByRole("menuitem", { name: "Open post" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Mark as broken…" })).toHaveCount(0);
  });

  test("finance can read Content but can't mark broken or review", async ({ page }) => {
    await signIn(page, "FINANCE");
    await contentApi(page);
    await page.goto("/content");
    await page.getByRole("button", { name: "Actions for Thali hacks" }).click();
    await expect(page.getByRole("menuitem", { name: "Open post" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /Mark as broken|Review in Approvals/ })).toHaveCount(0);
    await page.keyboard.press("Escape");
    // No links.approve / links.edit: every status is a plain pill, never a menu.
    await expect(page.getByRole("row", { name: /Thali hacks/ }).getByText("Proof in review")).toBeVisible();
    await expect(page.getByRole("button", { name: /Change status/ })).toHaveCount(0);
  });

  test("admin moves a post forward from its status: approve proof, reject proof with a reason, approve insights (design-fix #6)", async ({ page }) => {
    await signIn(page, "ADMIN");
    const calls = await contentApi(page);
    await page.goto("/content");

    const thali = page.getByRole("row", { name: /Thali hacks/ }).getByRole("button", { name: /Change status/ });
    await thali.click();
    // Only the next step for a proof in review — nothing that skips ahead.
    await expect(page.getByRole("menuitem", { name: "Approve insights" })).toHaveCount(0);
    await page.getByRole("menuitem", { name: "Approve proof" }).click();
    await expect(page.getByText("Proof approved.")).toBeVisible();
    expect(calls.reviewed).toEqual([{ id: "l1a", approved: true }]);

    await thali.click();
    await page.getByRole("menuitem", { name: "Reject proof…" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: "Reject" })).toBeDisabled();
    await dialog.getByLabel("Reason for the creator").fill("Screenshot is cut off");
    await dialog.getByRole("button", { name: "Reject" }).click();
    await expect(page.getByText(/Proof rejected/)).toBeVisible();
    expect(calls.reviewed.at(-1)).toEqual({ id: "l1a", approved: false, note: "Screenshot is cut off" });

    await page.getByRole("row", { name: /Chai stories/ }).getByRole("button", { name: /Change status/ }).click();
    await expect(page.getByRole("menuitem", { name: "Approve proof" })).toHaveCount(0);
    await page.getByRole("menuitem", { name: "Approve insights" }).click();
    await expect(page.getByText(/Insights approved/)).toBeVisible();
    expect(calls.insights).toEqual(["l1c"]);
  });

  test("planner sees Content (their own campaigns' posts, scoped by the server)", async ({ page }) => {
    await signIn(page, "PLAN_MAKER");
    await contentApi(page);
    await page.goto("/content");
    await expect(page.getByRole("tab", { name: "All (23)" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Content" })).toBeVisible();
  });

  for (const role of ["CREATOR", "TEAM_MEMBER"] as MockRole[]) {
    test(`${role} can't open Content and no posts are requested`, async ({ page }) => {
      await signIn(page, role);
      const calls = await contentApi(page);
      await page.goto("/content");
      await expect(page.getByText(/don.t have access to Content/)).toBeVisible();
      expect(calls.lists).toHaveLength(0);
    });
  }
});
