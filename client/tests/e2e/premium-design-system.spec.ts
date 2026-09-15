import { test, expect } from "@playwright/test";

import { signIn, mockApi } from "./fixtures";

/**
 * Guards the premium design system (Sep 2026): Geist + Instrument Serif
 * are wired through the token layer, light is the default theme, the
 * primary action is ink-black (not the status green), and the dashboard
 * headline carries the one serif italic accent. A regression in
 * lib/fonts.ts, styles/tokens.css, tailwind.config.ts or button.tsx
 * would silently ship the old look while every other test still passes.
 */
test.describe("premium design system", () => {
  test("defaults to the light theme and loads Geist + Instrument Serif", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    const fonts = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      return {
        ui: root.getPropertyValue("--font-ui"),
        display: root.getPropertyValue("--font-display"),
        bodyFamily: getComputedStyle(document.body).fontFamily,
        ground: root.getPropertyValue("--bg").trim(),
      };
    });
    // Computed custom properties come back with var() already substituted
    // (the next/font family names), so match on the family, not the token.
    expect(fonts.ui.toLowerCase()).toContain("geist");
    expect(fonts.display.toLowerCase()).toContain("instrument");
    expect(fonts.bodyFamily.toLowerCase()).toContain("geist");
    expect(fonts.ground).toBe("#fafafa");
  });

  test("primary button is ink-black with an 8px+ radius, not a green pill", async ({ page }) => {
    await page.goto("/login");
    const button = page.getByRole("button", { name: "Sign in" });
    const style = await button.evaluate((el) => {
      const s = getComputedStyle(el);
      return { bg: s.backgroundColor, radius: s.borderRadius, color: s.color };
    });
    expect(style.bg).toBe("rgb(9, 9, 11)");
    expect(style.color).toBe("rgb(255, 255, 255)");
    expect(parseFloat(style.radius)).toBeGreaterThanOrEqual(8);
    expect(parseFloat(style.radius)).toBeLessThan(20); // not a pill
  });

  test("dashboard headline carries the serif italic accent and the sidebar uses ink for the active item", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.goto("/dashboard");

    const accent = page.locator("h1 .serif").first();
    await expect(accent).toBeVisible();
    const accentStyle = await accent.evaluate((el) => {
      const s = getComputedStyle(el);
      return { style: s.fontStyle, family: s.fontFamily.toLowerCase() };
    });
    expect(accentStyle.style).toBe("italic");
    expect(accentStyle.family).toContain("instrument");

    // Active nav item is a neutral zinc block (no green tint) in the premium system.
    const active = page.getByRole("complementary").getByRole("link", { name: "Home", exact: true }).locator("span").first();
    const activeBg = await active.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(activeBg).toBe("rgb(244, 244, 245)");
  });
});
