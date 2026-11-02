import { expect, test } from "@playwright/test";

import { mockApi, shot, signIn, type MockRole } from "./fixtures";

/** Top-bar sun/moon toggle: swaps every token on <html data-theme>, survives a reload, and follows the OS until chosen. API fully mocked. */

const DARK_CANVAS = "rgb(14, 26, 35)"; // --background in dark (#0E1A23)
const LIGHT_CANVAS = "rgb(247, 245, 241)"; // --background in light (#F7F5F1)
const bodyBg = (page: import("@playwright/test").Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

for (const role of ["ADMIN", "CREATOR"] as MockRole[]) {
  test(`${role} can switch to dark and back, and the choice sticks`, async ({ page }) => {
    await mockApi(page);
    await signIn(page, role);
    await page.goto("/dashboard");

    const html = page.locator("html");
    await expect(html).toHaveAttribute("data-theme", "light");
    await page.getByRole("button", { name: "Switch to dark theme" }).click();
    await expect(html).toHaveAttribute("data-theme", "dark");
    expect(await bodyBg(page)).toBe(DARK_CANVAS);
    // Illustrations swap to their recoloured -dark.png twins.
    await expect(page.locator('img[src="/illustrations/sidebar-illustration-dark.png"]')).toBeVisible();
    await expect(page.locator('img[src="/illustrations/sidebar-illustration.png"]')).toBeHidden();
    await shot(page, `theme-dark-${role.toLowerCase()}`);

    // Record every data-theme value from the first byte of the reload: a saved "dark" must never blink light.
    await page.addInitScript(() => {
      const seen: string[] = [];
      (window as unknown as { __themes: string[] }).__themes = seen;
      new MutationObserver(() => seen.push(document.documentElement.dataset.theme ?? "")).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    });
    await page.reload();
    await expect(html).toHaveAttribute("data-theme", "dark");
    await expect(page.getByRole("button", { name: "Switch to light theme" })).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __themes: string[] }).__themes)).not.toContain("light");
    await page.getByRole("button", { name: "Switch to light theme" }).click();
    await expect(html).toHaveAttribute("data-theme", "light");
    expect(await bodyBg(page)).toBe(LIGHT_CANVAS);
  });
}

test("follows the OS dark setting until the viewer picks one", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await mockApi(page);
  await signIn(page, "ADMIN");
  await page.goto("/dashboard");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("button", { name: "Switch to light theme" })).toBeVisible();
});
