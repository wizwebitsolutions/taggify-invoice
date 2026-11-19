import { expect, test } from "@playwright/test";

import { mockApi, signIn, userFor } from "./fixtures";

/**
 * 19 Nov — "hide the nav tabs that the user doesn't have access to, it should not
 * even be visible in UI". Each sidebar item now follows its page's own access
 * check, so nothing shows that would only open a "you don't have access" screen.
 */
test.describe("Sidebar shows only what you can open", () => {
  test.use({ viewport: { width: 1440, height: 1000 } });
  const nav = (page: import("@playwright/test").Page) => page.getByRole("navigation", { name: "Main" });

  test("Finance with campaigns, payouts and posts switched off sees no Campaigns, Reports or Payouts", async ({ page }) => {
    await signIn(page, "FINANCE", { permissions: { ...userFor("FINANCE").permissions, "campaigns.view": false, "finance.pay": false, "links.view": false } });
    await mockApi(page);
    await page.goto("/settings");
    await expect(nav(page).getByRole("link", { name: "Settings" })).toBeVisible();
    for (const name of ["Campaigns", "Reports", "Payouts", "Approvals", "Content"]) {
      await expect(nav(page).getByRole("link", { name })).toHaveCount(0);
    }
  });

  test("an admin with every approval right removed sees no Approvals", async ({ page }) => {
    await signIn(page, "ADMIN", {
      permissions: { ...userFor("ADMIN").permissions, "links.approve": false, "inventory.approve": false, "plans.approve": false, "finance.pay": false, "campaigns.edit": false },
    });
    await mockApi(page);
    await page.goto("/settings");
    await expect(nav(page).getByRole("link", { name: "Settings" })).toBeVisible();
    await expect(nav(page).getByRole("link", { name: "Approvals" })).toHaveCount(0);
  });

  test("a creator without My pages access gets no Submit post", async ({ page }) => {
    await signIn(page, "CREATOR", { ownAccess: { "inventory.view": false } });
    await mockApi(page);
    await page.goto("/settings");
    await expect(nav(page).getByRole("link", { name: "Settings" })).toBeVisible();
    await expect(nav(page).getByRole("link", { name: "Submit post" })).toHaveCount(0);
  });
});
