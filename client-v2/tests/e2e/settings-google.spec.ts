import { expect, test, type Page } from "@playwright/test";

import { API_URL, mockApi, signIn, type MockRole } from "./fixtures";

/** Settings → Google Sheets (admins): connection status and the Connect / Reconnect button. API fully mocked. */

type Status = { configured: boolean; connected: boolean; healthy: boolean };

async function googleApi(page: Page, role: MockRole, status: Status) {
  await signIn(page, role);
  // Consent opens in a new tab; record it instead of opening one.
  await page.addInitScript(() => {
    (window as unknown as { opened: string[] }).opened = [];
    window.open = ((url: string) => {
      (window as unknown as { opened: string[] }).opened.push(String(url));
      return null;
    }) as typeof window.open;
  });
  const calls = { status: 0 };
  await mockApi(page);
  await page.route(`${API_URL}/integrations/google/status`, (r) => {
    calls.status++;
    return r.fulfill({ json: status });
  });
  return calls;
}

const opened = (page: Page) => page.evaluate(() => (window as unknown as { opened: string[] }).opened);

test.describe("Settings → Google Sheets", () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  const CASES: { name: string; status: Status; pill: string; button: string | null }[] = [
    { name: "not set up", status: { configured: false, connected: false, healthy: false }, pill: "Not set up", button: null },
    { name: "not connected", status: { configured: true, connected: false, healthy: false }, pill: "Not connected", button: "Connect Google" },
    { name: "needs reconnecting", status: { configured: true, connected: true, healthy: false }, pill: "Needs reconnecting", button: "Reconnect Google" },
    { name: "connected", status: { configured: true, connected: true, healthy: true }, pill: "Connected", button: "Switch account" },
  ];

  for (const c of CASES) {
    test(`admin: ${c.name}`, async ({ page }) => {
      await googleApi(page, "ADMIN", c.status);
      await page.goto("/settings?tab=google");
      const panel = page.getByRole("region", { name: "Google Sheets" });
      await expect(panel.getByText(c.pill, { exact: true })).toBeVisible();
      for (const other of ["Connect Google", "Reconnect Google", "Switch account"].filter((b) => b !== c.button)) {
        await expect(panel.getByRole("button", { name: other, exact: true })).toHaveCount(0);
      }
      if (!c.button) return;
      await panel.getByRole("button", { name: c.button }).click();
      const urls = await opened(page);
      expect(urls).toHaveLength(1);
      expect(urls[0]).toContain("/integrations/google/authorize?token=test-access-token");
    });
  }

  test("admin: Check again re-reads the status", async ({ page }) => {
    const calls = await googleApi(page, "ADMIN", { configured: true, connected: false, healthy: false });
    await page.goto("/settings?tab=google");
    const panel = page.getByRole("region", { name: "Google Sheets" });
    await expect(panel.getByText("Not connected", { exact: true })).toBeVisible();
    const before = calls.status;
    await panel.getByRole("button", { name: "Check again" }).click();
    await expect.poll(() => calls.status).toBeGreaterThan(before);
  });

  for (const role of ["FINANCE", "CREATOR"] as const) {
    test(`${role} has no Google Sheets tab`, async ({ page }) => {
      await googleApi(page, role, { configured: true, connected: true, healthy: true });
      await page.goto("/settings?tab=google");
      await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
      await expect(page.getByRole("tab", { name: "Google Sheets" })).toHaveCount(0);
      await expect(page.getByRole("region", { name: "Google Sheets" })).toHaveCount(0);
    });
  }
});
