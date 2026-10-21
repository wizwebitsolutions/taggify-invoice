import { expect, test } from "@playwright/test";

import { shot } from "./fixtures";

/** The page's last layer: a gradient whose light spot glides after the cursor; still for reduced motion. */

const glow = (page: import("@playwright/test").Page) =>
  page.getByTestId("canvas-glow").evaluate((el) => {
    const s = getComputedStyle(el);
    return { x: s.getPropertyValue("--glow-x").trim(), y: s.getPropertyValue("--glow-y").trim(), position: s.position };
  });

test.describe("Canvas glow", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("follows the cursor behind every page", async ({ page }) => {
    // Privacy needs no API, so the page is fully up before the cursor moves.
    await page.goto("/privacy");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect.poll(() => glow(page)).toEqual({ x: "50%", y: "40%", position: "fixed" });

    // It eases toward the cursor (bottom-right), so it ends near 90% / 89%. The move repeats
    // in case the first one lands before the page's script has attached its listener.
    await expect
      .poll(
        async () => {
          await page.mouse.move(1290, 790);
          await page.mouse.move(1300, 800);
          const g = await glow(page);
          return parseFloat(g.x) > 85 && parseFloat(g.y) > 84;
        },
        { timeout: 15_000 }
      )
      .toBe(true);
    await shot(page, "canvas-glow");
  });

  test("holds still with reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/login");
    await expect(page.getByTestId("canvas-glow")).toBeAttached();
    await page.mouse.move(1300, 800);
    await page.waitForTimeout(500);
    expect(await glow(page)).toEqual({ x: "50%", y: "40%", position: "fixed" });
  });
});
