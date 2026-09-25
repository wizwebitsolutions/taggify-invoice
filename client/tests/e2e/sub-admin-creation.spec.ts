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

  test("Role=Admin shows the full editor with every section expanded", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.goto("/users");
    await page.getByRole("button", { name: "Add user" }).click();

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
      return route.fulfill({ json: { user: { id: "new-admin-1", phoneNumber: null, email: "new.user@gmail.com", name: null, role: "ADMIN" }, generatedPassword: "Abcdefg1!" } });
    });

    await page.goto("/users");
    await page.getByRole("button", { name: "Add user" }).click();
    await page.getByRole("combobox").selectOption("ADMIN");
    await page.getByLabel("Email", { exact: true }).fill("new.user@gmail.com");
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
      return route.fulfill({ json: { user: { id: "new-admin-2", phoneNumber: null, email: "new.user@gmail.com", name: null, role: "ADMIN" }, generatedPassword: "Abcdefg1!" } });
    });

    await page.goto("/users");
    await page.getByRole("button", { name: "Add user" }).click();
    await page.getByRole("combobox").selectOption("ADMIN");
    await page.getByLabel("Campaigns access").click();
    await page.getByLabel("Email", { exact: true }).fill("new.user@gmail.com");
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
      return route.fulfill({ json: { user: { id: "new-admin-3", phoneNumber: null, email: "new.user@gmail.com", name: null, role: "ADMIN" }, generatedPassword: "Abcdefg1!" } });
    });

    await page.goto("/users");
    await page.getByRole("button", { name: "Add user" }).click();
    await page.getByRole("combobox").selectOption("ADMIN");
    await page.getByLabel("Finance: Approve").click();
    await page.getByLabel("Email", { exact: true }).fill("new.user@gmail.com");
    await page.getByRole("button", { name: "Create user" }).click();

    await expect(page.getByText(/Account created for/)).toBeVisible();
    const permissions = sentBody!.permissions as Record<string, boolean>;
    expect(permissions["finance.approve"]).toBe(false);
    expect(permissions["finance.view"]).toBe(true);
    expect(permissions["finance.pay"]).toBe(true);
  });
});

/**
 * 24 Sep — every role gets the access editor. Creator / Team member / Planner
 * see own-content switches only (server: lib/permissions.js
 * OWN_CAPABILITIES — never a global key), all ON by default; Finance keeps
 * the global editor at its baseline.
 */
test.describe("Add user — access editor per role", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("Creator, Team member and Planner get own-content sections, all on; Finance keeps its baseline", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.goto("/users");
    await page.getByRole("button", { name: "Add user" }).click();

    // Default role is Creator.
    await expect(page.getByTestId("access-editor")).toBeVisible();
    await expect(page.getByTestId("access-own-note")).toBeVisible();
    await expect(page.getByLabel("Invoices & payouts access")).toBeChecked();
    await expect(page.getByLabel("Invoices & payouts: Raise invoices")).toBeChecked();
    await expect(page.getByLabel("Links: Submit")).toBeChecked();
    // No approve / pay, and no Plans section, for a creator.
    await expect(page.getByTestId("access-section-plans")).toHaveCount(0);
    await expect(page.getByLabel(/: (Approve|Pay)$/)).toHaveCount(0);

    await page.getByRole("combobox").selectOption("TEAM_MEMBER");
    await expect(page.getByTestId("access-own-note")).toBeVisible();
    await expect(page.getByTestId("access-section-users")).toHaveCount(0);
    await expect(page.getByLabel("Links: Submit")).toBeChecked();

    await page.getByRole("combobox").selectOption("PLAN_MAKER");
    await expect(page.getByTestId("access-own-note")).toBeVisible();
    await expect(page.getByLabel("Plans: Approve")).toBeChecked();
    await expect(page.getByLabel("Campaigns: Add phases")).toBeChecked();
    // 25 Sep: a plan maker can also be granted "Add pages" (vendor onboarding
    // while building a plan) — view + edit, on by default like every other
    // own-content switch.
    await expect(page.getByTestId("access-section-inventory")).toContainText("Browse the full page catalogue");
    await expect(page.getByLabel("Inventory: Add pages")).toBeChecked();
    await expect(page.getByTestId("access-section-inventory").getByRole("checkbox")).toHaveCount(2);

    await page.getByRole("combobox").selectOption("FINANCE");
    await expect(page.getByTestId("access-own-note")).toHaveCount(0);
    await expect(page.getByLabel("Finance: Pay")).toBeChecked();
    await expect(page.getByLabel("Finance: Approve")).toBeChecked();
    await expect(page.getByTestId("access-section-campaigns").getByRole("checkbox").first()).toBeChecked();
  });

  test("an untouched Creator is created with no permissions field", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    let sentBody: Record<string, unknown> | null = null;
    await page.route(`${API_URL}/auth/signup`, (route) => {
      sentBody = route.request().postDataJSON();
      return route.fulfill({ json: { user: { id: "new-c-1", phoneNumber: null, email: "new.user@gmail.com", name: null, role: "CREATOR" }, generatedPassword: "Abcdefg1!" } });
    });

    await page.goto("/users");
    await page.getByRole("button", { name: "Add user" }).click();
    // Toggle something as a Planner, then switch back — the leftover must not travel with the role change.
    await page.getByRole("combobox").selectOption("PLAN_MAKER");
    await page.getByLabel("Plans: Approve").click();
    await page.getByRole("combobox").selectOption("CREATOR");
    await page.getByLabel("Email", { exact: true }).fill("new.user@gmail.com");
    await page.getByPlaceholder("Instagram handle (without @)").fill("somepage");
    await page.getByRole("button", { name: "Create user" }).click();

    await expect(page.getByText(/Account created for/)).toBeVisible();
    expect(sentBody).not.toBeNull();
    expect(sentBody!.role).toBe("CREATOR");
    expect(sentBody!.permissions).toBeUndefined();
  });

  test("switching off a Creator's Invoices sends only own-content keys", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    let sentBody: Record<string, unknown> | null = null;
    await page.route(`${API_URL}/auth/signup`, (route) => {
      sentBody = route.request().postDataJSON();
      return route.fulfill({ json: { user: { id: "new-c-2", phoneNumber: null, email: "new.user@gmail.com", name: null, role: "CREATOR" }, generatedPassword: "Abcdefg1!" } });
    });

    await page.goto("/users");
    await page.getByRole("button", { name: "Add user" }).click();
    await page.getByLabel("Invoices & payouts access").click();
    await expect(page.getByTestId("access-summary-finance")).toHaveText("Off");
    await page.getByLabel("Email", { exact: true }).fill("new.user@gmail.com");
    await page.getByPlaceholder("Instagram handle (without @)").fill("somepage");
    await page.getByRole("button", { name: "Create user" }).click();

    await expect(page.getByText(/Account created for/)).toBeVisible();
    const perms = sentBody!.permissions as Record<string, boolean>;
    expect(perms["finance.view"]).toBe(false);
    expect(perms["finance.edit"]).toBe(false);
    expect(perms["links.edit"]).toBe(true);
    // Never a global key for an own-scope role.
    for (const k of ["finance.approve", "finance.pay", "links.approve", "inventory.approve", "plans.view", "campaigns.edit"]) {
      expect(perms[k]).toBeUndefined();
    }
  });

  // 25 Sep: a plan maker's Inventory "Add pages" (vendor onboarding while
  // building a plan) is on by default like every other own-content switch,
  // and can be switched off the same way Creator's Finance access can.
  test("switching off a Plan Maker's 'Add pages' sends inventory.edit: false, never finance.pay", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    let sentBody: Record<string, unknown> | null = null;
    await page.route(`${API_URL}/auth/signup`, (route) => {
      sentBody = route.request().postDataJSON();
      return route.fulfill({ json: { user: { id: "new-pm-1", phoneNumber: null, email: "new.pm@gmail.com", name: null, role: "PLAN_MAKER" }, generatedPassword: "Abcdefg1!" } });
    });

    await page.goto("/users");
    await page.getByRole("button", { name: "Add user" }).click();
    await page.getByRole("combobox").selectOption("PLAN_MAKER");
    await expect(page.getByLabel("Inventory: Add pages")).toBeChecked();
    await page.getByLabel("Inventory: Add pages").click();
    await page.getByLabel("Email", { exact: true }).fill("new.pm@gmail.com");
    await page.getByRole("button", { name: "Create user" }).click();

    await expect(page.getByText(/Account created for/)).toBeVisible();
    const perms = sentBody!.permissions as Record<string, boolean>;
    expect(perms["inventory.edit"]).toBe(false);
    // Turning off Inventory doesn't touch the sections left alone — Plans
    // stays on, untouched, at its own default.
    expect(perms["plans.edit"]).toBe(true);
    // finance.pay is never own-scope, for any role — never even sent, since
    // it's never a checkbox in a plan maker's editor.
    expect(perms["finance.pay"]).toBeUndefined();
  });
});

/**
 * 24 Sep — a creator whose admin switched a section off: the nav item goes
 * away and the page's URL shows a plain notice instead of 403ing.
 */
test.describe("Creator with a section switched off", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("Invoices off hides the nav item and blocks the page; Payouts goes too", async ({ page }) => {
    await signIn(page, "CREATOR");
    await page.addInitScript(() => {
      const raw = window.localStorage.getItem("taggify_auth");
      if (!raw) return;
      const s = JSON.parse(raw);
      s.user.ownAccess = { ...(s.user.ownAccess ?? {}), "finance.view": false, "finance.edit": false };
      window.localStorage.setItem("taggify_auth", JSON.stringify(s));
    });
    await mockApi(page);
    await page.goto("/invoices");

    await expect(page.getByTestId("access-removed")).toBeVisible();
    const nav = page.getByRole("complementary");
    await expect(nav.getByRole("link", { name: "Invoices", exact: true })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Payouts", exact: true })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Campaigns", exact: true })).toBeVisible();
  });

  test("on a phone, the bottom tab bar drops Invoices too", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page, "CREATOR");
    await page.addInitScript(() => {
      const raw = window.localStorage.getItem("taggify_auth");
      if (!raw) return;
      const s = JSON.parse(raw);
      s.user.ownAccess = { ...(s.user.ownAccess ?? {}), "finance.view": false, "finance.edit": false };
      window.localStorage.setItem("taggify_auth", JSON.stringify(s));
    });
    await mockApi(page);
    await page.goto("/dashboard");

    const tabs = page.getByRole("navigation");
    await expect(tabs.getByRole("link", { name: "Campaigns", exact: true })).toBeVisible();
    await expect(tabs.getByRole("link", { name: "Invoices", exact: true })).toHaveCount(0);
  });

  test("with everything on, the same creator gets the Invoices page", async ({ page }) => {
    await signIn(page, "CREATOR");
    await mockApi(page);
    await page.goto("/invoices");
    await expect(page.getByTestId("access-removed")).toHaveCount(0);
    await expect(page.getByRole("complementary").getByRole("link", { name: "Invoices", exact: true })).toBeVisible();
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
    // Only the Creator row offers "Edit access" (own-content switches, 24
    // Sep) — a restricted sub-admin may not edit an ADMIN's overlay. Password
    // reset is offered only for the Creator (the one role a non-full-admin
    // can't out-rank by signing in as).
    await expect(page.getByRole("button", { name: "Edit access" })).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Reset password" })).toHaveCount(1);

    // And the Add user form won't offer Admin to a restricted sub-admin.
    await page.getByRole("button", { name: "Add user" }).click();
    await expect(page.locator('form select option[value="ADMIN"]')).toBeDisabled();
  });
});
