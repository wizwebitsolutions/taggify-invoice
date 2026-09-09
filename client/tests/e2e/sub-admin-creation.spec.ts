import { test, expect } from "@playwright/test";

import { signIn, mockApi, API_URL } from "./fixtures";

/**
 * Sub-admin creation (newTask.md, 8 Sep — "Admin can create Sub-admins,
 * each with a hand-picked selection of what they can see/access"). The
 * checklist only appears for Role=Admin (app/users/page.tsx's
 * CreateUserModal); leaving every box checked must NOT send a `permissions`
 * payload at all, so a plain admin created today stays indistinguishable
 * from one created before this feature existed (see auth/service.js's
 * signup — permissions is only ever persisted when isSubAdmin is true).
 */
test.describe("Add user — Sub-admin access checklist", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("the access checklist only appears once Role=Admin is selected", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.goto("/users");
    await page.getByRole("button", { name: "Add user" }).click();

    await expect(page.getByText("Access (Sub-admin)")).toHaveCount(0);
    await page.getByRole("combobox").selectOption("ADMIN");
    await expect(page.getByText("Access (Sub-admin)")).toBeVisible();
    await expect(page.getByText(/Campaigns — create\/edit/)).toBeVisible();
  });

  test("leaving every box checked sends no permissions field — a plain admin", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    let sentBody: Record<string, unknown> | null = null;
    await page.route(`${API_URL}/auth/signup`, (route) => {
      sentBody = route.request().postDataJSON();
      return route.fulfill({ json: { user: { id: "new-admin-1", phoneNumber: "+919876543210", name: null, role: "ADMIN" }, generatedPassword: "Abcdefg1!" } });
    });

    await page.goto("/users");
    await page.getByRole("button", { name: "Add user" }).click();
    await page.getByRole("combobox").selectOption("ADMIN");
    await page.getByPlaceholder("98765 43210").fill("9876543210");
    await page.getByRole("button", { name: "Create user" }).click();

    await expect(page.getByText(/Account created for/)).toBeVisible();
    expect(sentBody).not.toBeNull();
    expect(sentBody!.permissions).toBeUndefined();
  });

  test("unchecking a section sends it as false — creates a restricted Sub-admin", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    let sentBody: Record<string, unknown> | null = null;
    await page.route(`${API_URL}/auth/signup`, (route) => {
      sentBody = route.request().postDataJSON();
      return route.fulfill({ json: { user: { id: "new-admin-2", phoneNumber: "+919876543210", name: null, role: "ADMIN" }, generatedPassword: "Abcdefg1!" } });
    });

    await page.goto("/users");
    await page.getByRole("button", { name: "Add user" }).click();
    await page.getByRole("combobox").selectOption("ADMIN");
    await page.getByText(/Campaigns — create\/edit/).click();
    await page.getByPlaceholder("98765 43210").fill("9876543210");
    await page.getByRole("button", { name: "Create user" }).click();

    await expect(page.getByText(/Account created for/)).toBeVisible();
    const permissions = sentBody!.permissions as Record<string, boolean>;
    expect(permissions["campaigns.manage"]).toBe(false);
    expect(permissions["finance.manage"]).toBe(true);
  });
});
