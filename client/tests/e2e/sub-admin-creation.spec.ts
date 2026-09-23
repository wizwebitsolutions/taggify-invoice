import { test, expect } from "@playwright/test";

import { signIn, mockApi, API_URL } from "./fixtures";

/**
 * Access editor (newTask.md, 8 Sep — "Admin can create Sub-admins, each
 * with a hand-picked selection of what they can see/access"; 23 Sep — split
 * into per-action keys and a section-then-actions checkbox UI: "user
 * selects Invoices, then checkboxes for edit, approve … appear below" —
 * see components/users/access-editor.tsx). The editor only appears for a
 * grantable role (app/users/page.tsx's CreateUserModal); leaving Admin's
 * editor fully checked must NOT send a `permissions` payload at all, so a
 * plain admin created today stays indistinguishable from one created before
 * this feature existed (see auth/service.js's signup).
 */
test.describe("Add user — access editor", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("the access editor only appears once Role=Admin is selected, with every section expanded", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.goto("/users");
    await page.getByRole("button", { name: "Add user" }).click();

    await expect(page.getByTestId("access-editor")).toHaveCount(0);
    await page.getByRole("combobox").selectOption("ADMIN");
    await expect(page.getByTestId("access-editor")).toBeVisible();
    // Every section starts checked and expanded for a full admin.
    await expect(page.getByTestId("access-section-campaigns").getByRole("checkbox").first()).toBeChecked();
    await expect(page.getByTestId("access-actions-finance")).toBeVisible();
    await expect(page.getByLabel("Finance: Pay")).toBeChecked();
  });

  test("leaving every section checked sends no permissions field — a plain admin", async ({ page }) => {
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

  test("unchecking a whole section clears its actions too — creates a restricted Sub-admin", async ({ page }) => {
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
    await page.getByLabel("Campaigns access").click();
    await page.getByPlaceholder("98765 43210").fill("9876543210");
    await page.getByRole("button", { name: "Create user" }).click();

    await expect(page.getByText(/Account created for/)).toBeVisible();
    const permissions = sentBody!.permissions as Record<string, boolean>;
    expect(permissions["campaigns.view"]).toBe(false);
    expect(permissions["campaigns.edit"]).toBe(false);
    expect(permissions["finance.pay"]).toBe(true);
  });

  test("unchecking just one action under a section leaves the section (and its other actions) on", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    let sentBody: Record<string, unknown> | null = null;
    await page.route(`${API_URL}/auth/signup`, (route) => {
      sentBody = route.request().postDataJSON();
      return route.fulfill({ json: { user: { id: "new-admin-3", phoneNumber: "+919876543210", name: null, role: "ADMIN" }, generatedPassword: "Abcdefg1!" } });
    });

    await page.goto("/users");
    await page.getByRole("button", { name: "Add user" }).click();
    await page.getByRole("combobox").selectOption("ADMIN");
    await page.getByLabel("Finance: Approve").click();
    await page.getByPlaceholder("98765 43210").fill("9876543210");
    await page.getByRole("button", { name: "Create user" }).click();

    await expect(page.getByText(/Account created for/)).toBeVisible();
    const permissions = sentBody!.permissions as Record<string, boolean>;
    expect(permissions["finance.approve"]).toBe(false);
    expect(permissions["finance.view"]).toBe(true);
    expect(permissions["finance.pay"]).toBe(true);
  });
});

/**
 * 23 Sep — Creator / Team member accounts can't carry an access overlay at
 * all (server: lib/permissions.js NON_GRANTABLE_ROLES → 400
 * ROLE_NOT_GRANTABLE), so the editor must not be offered for them; Finance
 * and Planner keep it, starting at their own baseline sections.
 */
test.describe("Add user — access editor is hidden for non-grantable roles", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("no editor for Creator or Team member; Planner and Finance keep it, pre-checked at their baseline", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.goto("/users");
    await page.getByRole("button", { name: "Add user" }).click();

    // Default role is Creator.
    await expect(page.getByTestId("access-editor")).toHaveCount(0);
    await page.getByRole("combobox").selectOption("TEAM_MEMBER");
    await expect(page.getByTestId("access-editor")).toHaveCount(0);

    await page.getByRole("combobox").selectOption("PLAN_MAKER");
    await expect(page.getByTestId("access-editor")).toBeVisible();
    // Planner's baseline is inventory.view only — that section starts
    // checked, every other section starts collapsed/unchecked.
    await expect(page.getByTestId("access-section-inventory").getByRole("checkbox").first()).toBeChecked();
    await expect(page.getByTestId("access-section-finance").getByRole("checkbox").first()).not.toBeChecked();

    await page.getByRole("combobox").selectOption("FINANCE");
    await expect(page.getByTestId("access-editor")).toBeVisible();
    // Finance's baseline: approves and pays by default (invoices/routes.js,
    // 23 Sep — "Finance approves and pays"), plus reading
    // campaigns/inventory/links.
    await expect(page.getByLabel("Finance: Pay")).toBeChecked();
    await expect(page.getByLabel("Finance: Approve")).toBeChecked();
    await expect(page.getByTestId("access-section-campaigns").getByRole("checkbox").first()).toBeChecked();
  });

  test("a Creator is created without any permissions field even after toggling boxes under another role", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    let sentBody: Record<string, unknown> | null = null;
    await page.route(`${API_URL}/auth/signup`, (route) => {
      sentBody = route.request().postDataJSON();
      return route.fulfill({ json: { user: { id: "new-c-1", phoneNumber: "+919876543210", name: null, role: "CREATOR" }, generatedPassword: "Abcdefg1!" } });
    });

    await page.goto("/users");
    await page.getByRole("button", { name: "Add user" }).click();
    // Check something as a Planner, then switch back to Creator — the
    // leftover check must not travel with the role change.
    await page.getByRole("combobox").selectOption("PLAN_MAKER");
    await page.getByLabel("Link review access").click();
    await page.getByRole("combobox").selectOption("CREATOR");
    await page.getByPlaceholder("98765 43210").fill("9876543210");
    await page.getByPlaceholder("Instagram handle (without @)").fill("somepage");
    await page.getByRole("button", { name: "Create user" }).click();

    await expect(page.getByText(/Account created for/)).toBeVisible();
    expect(sentBody).not.toBeNull();
    expect(sentBody!.role).toBe("CREATOR");
    expect(sentBody!.permissions).toBeUndefined();
  });
});

/**
 * The People table's role dropdown (23 Sep): a restricted sub-admin can
 * still re-role non-admins, but the server refuses promoting anyone to
 * ADMIN or touching an ADMIN row for them — the dropdown reflects that
 * instead of offering an option that 403s.
 */
test.describe("People — role dropdown guards for a restricted sub-admin", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  const rows = [
    {
      id: "admin-9",
      phoneNumber: "+919000000001",
      name: "Real Admin",
      role: "ADMIN",
      whatsappVerified: true,
      permissions: {
        "users.view": true, "users.edit": true,
        "campaigns.view": true, "campaigns.edit": true,
        "inventory.view": true, "inventory.edit": true, "inventory.approve": true,
        "links.view": true, "links.edit": true, "links.approve": true,
        "finance.view": true, "finance.edit": true, "finance.approve": true, "finance.pay": true,
        "plans.view": true, "plans.edit": true, "plans.approve": true,
      },
      createdAt: "2026-09-01T00:00:00Z",
    },
    {
      id: "c-1",
      phoneNumber: "+919000000002",
      name: "Some Creator",
      role: "CREATOR",
      whatsappVerified: true,
      permissions: Object.fromEntries(
        ["users.view", "users.edit", "campaigns.view", "campaigns.edit", "inventory.view", "inventory.edit", "inventory.approve", "links.view", "links.edit", "links.approve", "finance.view", "finance.edit", "finance.approve", "finance.pay", "plans.view", "plans.edit", "plans.approve"].map((k) => [k, false])
      ),
      createdAt: "2026-09-01T00:00:00Z",
    },
  ];

  test("ADMIN rows are locked and the Admin option is disabled on other rows", async ({ page }) => {
    await signIn(page, "ADMIN");
    // Restricted sub-admin session: users.edit on, finance.pay off.
    await page.addInitScript(() => {
      const raw = window.localStorage.getItem("taggify_auth");
      if (!raw) return;
      const s = JSON.parse(raw);
      s.user.permissions = {
        "users.view": true, "users.edit": true,
        "campaigns.view": true, "campaigns.edit": true,
        "inventory.view": true, "inventory.edit": true, "inventory.approve": true,
        "links.view": true, "links.edit": true, "links.approve": true,
        "finance.view": true, "finance.edit": true, "finance.approve": true, "finance.pay": false,
        "plans.view": true, "plans.edit": true, "plans.approve": true,
      };
      window.localStorage.setItem("taggify_auth", JSON.stringify(s));
    });
    await mockApi(page);
    await page.route(`${API_URL}/admin/users`, (route) => route.fulfill({ json: rows }));

    await page.goto("/users");
    await page.getByRole("tab", { name: /^All/ }).click();

    const adminSelect = page.getByLabel("Role for Real Admin");
    await expect(adminSelect).toBeDisabled();
    const creatorSelect = page.getByLabel("Role for Some Creator");
    await expect(creatorSelect).toBeEnabled();
    await expect(creatorSelect.locator('option[value="ADMIN"]')).toBeDisabled();
    // Neither row offers "Edit access": the Creator can't carry a grant, and
    // a restricted sub-admin may not edit an ADMIN's overlay. Password
    // reset is offered only for the Creator (the one role a non-full-admin
    // can't out-rank by signing in as).
    await expect(page.getByRole("button", { name: "Edit access" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Reset password" })).toHaveCount(1);

    // And the Add user form won't offer Admin to a restricted sub-admin.
    await page.getByRole("button", { name: "Add user" }).click();
    await expect(page.locator('form select option[value="ADMIN"]')).toBeDisabled();
  });
});
