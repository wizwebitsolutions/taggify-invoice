import { expect, test, type Page } from "@playwright/test";

import { API_URL, mockApi, signIn } from "./fixtures";

/** Top bar → Notifications: picking an unread one marks just that one read; "Mark all as read" still works. API fully mocked. */

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

async function notificationsApi(page: Page) {
  await signIn(page, "ADMIN");
  const rows = [
    { id: "n1", userId: "test-admin", type: "invoice_raised", payload: { invoiceNumber: "INV-0042" }, readAt: null as string | null, createdAt: ago(5) },
    { id: "n2", userId: "test-admin", type: "invoice_paid", payload: { invoiceNumber: "INV-0041" }, readAt: null as string | null, createdAt: ago(60) },
    { id: "n3", userId: "test-admin", type: "screenshot_reminder", payload: {}, readAt: ago(120), createdAt: ago(180) },
  ];
  const calls = { read: [] as string[], readAll: 0 };
  await mockApi(page);
  await page.route(`${API_URL}/notifications**`, (r) => {
    const path = new URL(r.request().url()).pathname.replace(/^\/api/, "");
    const one = path.match(/^\/notifications\/([^/]+)\/read$/);
    if (r.request().method() === "POST" && one) {
      calls.read.push(one[1]);
      rows.find((n) => n.id === one[1])!.readAt = new Date().toISOString();
      return r.fulfill({ status: 204, body: "" });
    }
    if (r.request().method() === "POST" && path === "/notifications/read-all") {
      calls.readAll++;
      rows.forEach((n) => (n.readAt ??= new Date().toISOString()));
      return r.fulfill({ status: 204, body: "" });
    }
    return r.fulfill({ json: rows });
  });
  await page.goto("/settings");
  return calls;
}

// While the menu is open Radix hides the rest of the page from assistive tech, so the bell is found with includeHidden.
const bell = (page: Page, name: string) => page.getByRole("button", { name, exact: true, includeHidden: true });

test.describe("Notifications", () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test("picking an unread notification marks only that one read and keeps the menu open", async ({ page }) => {
    const calls = await notificationsApi(page);
    await page.getByRole("button", { name: "Notifications, 2 unread" }).click();
    const menu = page.getByRole("menu");
    const first = menu.getByRole("menuitem", { name: /Invoice INV-0042 was raised/ });
    await expect(first).toContainText("unread");
    await first.click();

    await expect(bell(page, "Notifications, 1 unread")).toBeVisible();
    await expect(menu).toBeVisible();
    await expect(first).not.toContainText("unread");
    expect(calls.read).toEqual(["n1"]);

    // A read one does nothing when picked.
    await menu.getByRole("menuitem", { name: /waiting for its screenshot/ }).click();
    await expect(menu).toBeVisible();
    expect(calls.read).toEqual(["n1"]);
  });

  test("the keyboard can read several in a row", async ({ page }) => {
    const calls = await notificationsApi(page);
    await page.getByRole("button", { name: "Notifications, 2 unread" }).click();
    const menu = page.getByRole("menu");
    await menu.getByRole("menuitem", { name: /INV-0042/ }).focus();
    await page.keyboard.press("Enter");
    await expect(bell(page, "Notifications, 1 unread")).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(bell(page, "Notifications")).toBeVisible();
    expect(calls.read).toEqual(["n1", "n2"]);
    await expect(menu).toBeVisible();
  });

  test("Mark all as read clears every unread dot with one request", async ({ page }) => {
    const calls = await notificationsApi(page);
    await page.getByRole("button", { name: "Notifications, 2 unread" }).click();
    await page.getByRole("button", { name: "Mark all as read" }).click();
    await expect(bell(page, "Notifications")).toBeVisible();
    expect(calls.readAll).toBe(1);
    expect(calls.read).toEqual([]);
    await expect(page.getByRole("button", { name: "Mark all as read" })).toHaveCount(0);
  });
});
