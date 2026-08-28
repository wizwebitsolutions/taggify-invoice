import { test, expect, type Page } from "@playwright/test";

import { signIn, mockApi } from "./fixtures";

/**
 * Connectivity smoke tests for the app's persistent chrome: the desktop
 * sidebar (components/layout/sidebar.tsx) and the mobile bottom nav +
 * "More" sheet (components/layout/bottom-nav.tsx, more-sheet.tsx).
 *
 * These catch "the link is broken/goes nowhere/crashes the page" — they do
 * NOT catch "the link goes somewhere technically valid but semantically
 * wrong" (see the dedicated regression test at the bottom of this file for
 * an example of that category, which needs an assertion about intent, not
 * just about arriving somewhere without crashing).
 */

async function collectPageErrors(page: Page) {
  const errors: Error[] = [];
  page.on("pageerror", (err) => errors.push(err));
  return errors;
}

test.describe("desktop sidebar navigation", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  const SIDEBAR_LINKS = [
    { label: "Dashboard", href: "/dashboard" },
    { label: "Campaigns", href: "/campaigns" },
    { label: "Assets", href: "/assets" },
    { label: "Inventory", href: "/inventory" },
    { label: "Invoices", href: "/invoices" },
    { label: "Users", href: "/users" },
    { label: "Team", href: "/team" },
    { label: "Job runs", href: "/job-runs" },
  ];

  for (const { label, href } of SIDEBAR_LINKS) {
    test(`"${label}" nav item goes to ${href} and renders`, async ({ page }) => {
      const errors = await collectPageErrors(page);
      await signIn(page, "ADMIN"); // ADMIN so every sidebar item's page has content to render, not a permission wall
      await mockApi(page);

      await page.goto("/dashboard");
      await page.getByRole("complementary").getByRole("link", { name: label, exact: true }).click();

      await expect(page).toHaveURL(new RegExp(`${href}$`));
      expect(errors, `uncaught page error(s) after navigating to ${href}`).toEqual([]);
    });
  }

  test("profile card link goes to /profile", async ({ page }) => {
    const errors = await collectPageErrors(page);
    await signIn(page, "ADMIN");
    await mockApi(page);

    await page.goto("/dashboard");
    await page.getByRole("complementary").getByRole("link", { name: "Test User" }).click();

    await expect(page).toHaveURL(/\/profile$/);
    expect(errors).toEqual([]);
  });
});

test.describe("mobile bottom nav + More sheet", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  const TABS = [
    { label: "Home", href: "/dashboard" },
    { label: "Campaigns", href: "/campaigns" },
    { label: "Invoices", href: "/invoices" },
    { label: "Assets", href: "/assets" },
  ];

  for (const { label, href } of TABS) {
    test(`bottom tab "${label}" goes to ${href} and renders`, async ({ page }) => {
      const errors = await collectPageErrors(page);
      await signIn(page, "ADMIN");
      await mockApi(page);

      await page.goto("/dashboard");
      await page.getByRole("navigation").getByRole("link", { name: label, exact: true }).click();

      await expect(page).toHaveURL(new RegExp(`${href}$`));
      expect(errors, `uncaught page error(s) after navigating to ${href}`).toEqual([]);
    });
  }

  const MORE_SHEET_ROWS = [
    { label: "Inventory", href: "/inventory" },
    { label: "Team", href: "/team" },
    { label: "Users", href: "/users" },
    { label: "Job runs", href: "/job-runs" },
  ];

  for (const { label, href } of MORE_SHEET_ROWS) {
    test(`More sheet "${label}" row goes to ${href} and renders`, async ({ page }) => {
      const errors = await collectPageErrors(page);
      await signIn(page, "ADMIN");
      await mockApi(page);

      await page.goto("/dashboard");
      await page.getByRole("button", { name: "More" }).click();
      await page.getByRole("link", { name: label, exact: true }).click();

      await expect(page).toHaveURL(new RegExp(`${href}$`));
      expect(errors, `uncaught page error(s) after navigating to ${href}`).toEqual([]);
    });
  }

  test("More sheet 'Notifications' row shows notifications, not the profile page", async ({ page }) => {
    // Regression test for a real bug this suite caught on its first run:
    // this row used to be href="/profile" (a copy/paste leftover from the
    // row below it) — tapping "Notifications" silently opened the profile
    // page instead of showing anything notification-related, and no
    // unread badge ever cleared since nothing here called
    // markAllRead/markRead. Fixed in components/layout/more-sheet.tsx by
    // giving it its own in-sheet view instead of a Link.
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("button", { name: "Notifications" }).click();

    await expect(page.getByText("No notifications yet.")).toBeVisible();
    // Stayed on the current page — no stray navigation to /profile.
    await expect(page).toHaveURL(/\/dashboard$/);
  });
});
