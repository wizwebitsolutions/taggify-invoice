import { test, expect, type Page } from "@playwright/test";

import { signIn, mockApi } from "./fixtures";

/**
 * Guards the real Taggify wordmark (components/ui/logo.tsx): the two
 * transparent PNGs lifted from the StreamVerse creator portal must be
 * served from /public, and exactly one of them must be visible per theme
 * (black letters on light, white letters on dark). A broken path, a
 * missing `dark:` variant, or both images showing at once would all ship
 * silently otherwise — the page still renders, just with a broken or
 * doubled brand.
 */

async function visibleLogoSrc(page: Page, scope = page.locator("body")) {
  const imgs = scope.locator('img[src*="taggify-logo"]');
  await expect(imgs).toHaveCount(2);
  const visible = imgs.locator("visible=true");
  await expect(visible).toHaveCount(1);
  return visible.getAttribute("src");
}

test.describe("brand logo", () => {
  test("login shows the light wordmark and the PNG actually loads", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    const src = await visibleLogoSrc(page);
    expect(src).toContain("/taggify-logo-light.png");

    // The file must really be served, not just referenced.
    const loaded = await page.locator('img[src*="taggify-logo-light"]').evaluate((el) => {
      const img = el as HTMLImageElement;
      return img.complete && img.naturalWidth > 0;
    });
    expect(loaded).toBe(true);
  });

  test("sidebar swaps to the dark wordmark when the theme toggles", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/dashboard");

    const sidebar = page.getByRole("complementary");
    expect(await visibleLogoSrc(page, sidebar)).toContain("/taggify-logo-light.png");

    await page.getByRole("button", { name: "Toggle color theme" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(await visibleLogoSrc(page, sidebar)).toContain("/taggify-logo-dark.png");
  });
});
