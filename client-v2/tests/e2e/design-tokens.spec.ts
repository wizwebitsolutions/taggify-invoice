import { expect, test } from "@playwright/test";

// Regression coverage for the public promise: edit one token and existing
// components update together, without changing their JSX or rebuilding Tailwind.
for (const theme of ["light", "dark"] as const) {
  test(`${theme}: shared controls and type respond to central token changes`, async ({ page }) => {
    await page.goto("/kitchen-sink");
    await page.locator("html").evaluate((el, mode) => {
      el.setAttribute("data-theme", mode);
      el.style.setProperty("--control-height", "48px");
      el.style.setProperty("--text-small", "16px");
      el.style.setProperty("--radius-md", "14px");
      el.style.setProperty("--space-unit", "5px");
    }, theme);

    const brand = page.getByRole("button", { name: "Brand action", exact: true });
    const outline = page.getByRole("button", { name: "View profile", exact: true });
    for (const control of [brand, outline]) {
      await expect(control).toHaveCSS("height", "48px");
      await expect(control).toHaveCSS("font-size", "16px");
      await expect(control).toHaveCSS("border-radius", "14px");
      await expect(control).toHaveCSS("column-gap", "10px");
    }

    await page.locator("html").evaluate((el) => {
      for (const name of ["--control-height", "--text-small", "--radius-md", "--space-unit"]) {
        el.style.removeProperty(name);
      }
    });
    for (const control of [brand, outline]) {
      await expect(control).toHaveCSS("height", "38px");
      await expect(control).toHaveCSS("font-size", "13px");
      await expect(control).toHaveCSS("border-radius", "8px");
      await expect(control).toHaveCSS("column-gap", "8px");
    }
  });
}
