import { test, expect, type Page } from "@playwright/test";

import { signIn, mockApi, type MockRole } from "./fixtures";

/**
 * Connectivity smoke tests for the app's persistent chrome: the desktop
 * sidebar + topbar (components/layout/sidebar.tsx, topbar.tsx) and the
 * mobile bottom nav + "More" sheet (components/layout/bottom-nav.tsx,
 * more-sheet.tsx).
 *
 * These catch "the link is broken/goes nowhere/crashes the page" — they do
 * NOT catch "the link goes somewhere technically valid but semantically
 * wrong" (see the dedicated regression tests further down for examples of
 * that category, which need an assertion about intent, not just about
 * arriving somewhere without crashing).
 */

async function collectPageErrors(page: Page) {
  const errors: Error[] = [];
  page.on("pageerror", (err) => errors.push(err));
  return errors;
}

test.describe("desktop sidebar navigation", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  // `role` picks who's signed in for that one link's test — since
  // sidebar.tsx now hides Team from everyone but CREATOR (and Users/Job
  // runs from everyone but ADMIN, see the dedicated per-role visibility
  // tests below), a link only shows up in the sidebar at all for a role
  // that can actually see it. Inventory (folded Assets, newTask.md 8 Sep)
  // is visible to every role, same as it always was for Assets; Plans
  // (split back out into its own tab, newTask.md 9 Sep) is Admin/Plan
  // Maker-only.
  const SIDEBAR_LINKS: { label: string; href: string; role: MockRole }[] = [
    { label: "Home", href: "/dashboard", role: "ADMIN" },
    { label: "Campaigns", href: "/campaigns", role: "ADMIN" },
    { label: "Inventory", href: "/inventory", role: "ADMIN" },
    { label: "Plans", href: "/plans", role: "ADMIN" },
    { label: "Invoices", href: "/invoices", role: "ADMIN" },
    { label: "People", href: "/users", role: "ADMIN" },
    { label: "Team", href: "/team", role: "CREATOR" },
    { label: "Job runs", href: "/job-runs", role: "ADMIN" },
  ];

  for (const { label, href, role } of SIDEBAR_LINKS) {
    test(`"${label}" nav item goes to ${href} and renders`, async ({ page }) => {
      const errors = await collectPageErrors(page);
      await signIn(page, role);
      await mockApi(page);

      await page.goto("/dashboard");
      await page.getByRole("complementary").getByRole("link", { name: label, exact: true }).click();

      await expect(page).toHaveURL(new RegExp(`${href}$`));
      expect(errors, `uncaught page error(s) after navigating to ${href}`).toEqual([]);
    });
  }

  test.describe("per-role visibility", () => {
    // Regression tests for a real bug: the sidebar rendered every item for
    // every role regardless of whether that role could do anything on the
    // destination page — a CREATOR saw a then-ADMIN-only nav item and
    // landed on a page that rendered nothing useful for them. Fixed in
    // sidebar.tsx by giving NavItem an optional `roles` allowlist
    // (canSeeNavItem). Inventory itself is ALWAYS now (newTask.md, 8 Sep —
    // Plans within it, not the nav entry, is what stays admin-gated).
    const PEOPLE_ONLY = ["People"];
    const CREATOR_ONLY = ["Team"];
    // Everyone gets Dashboard + Inventory; Campaigns/Invoices are their own
    // bucket (every role sees them since 12 Sep — Plan Maker included,
    // scoped server-side to their own plans' campaigns).
    const ALWAYS = ["Home", "Inventory"];
    const CAMPAIGNS_AND_INVOICES = ["Campaigns", "Invoices"];
    // Plans (newTask.md, 9 Sep — its own nav tab now) — Admin + Plan Maker.
    const PLANS = ["Plans"];
    // Job runs is keyed on finance.edit (23 Sep, Step 3) — a plain Finance
    // account holds it by baseline (it can already run the finance exports
    // server-side), so it's no longer bare-Admin-only.
    const JOB_RUNS = ["Job runs"];

    const CASES: { role: MockRole; visible: string[]; hidden: string[] }[] = [
      { role: "ADMIN", visible: [...ALWAYS, ...CAMPAIGNS_AND_INVOICES, ...PEOPLE_ONLY, ...PLANS, ...JOB_RUNS], hidden: CREATOR_ONLY },
      { role: "CREATOR", visible: [...ALWAYS, ...CAMPAIGNS_AND_INVOICES, ...CREATOR_ONLY], hidden: [...PEOPLE_ONLY, ...PLANS, ...JOB_RUNS] },
      { role: "FINANCE", visible: [...ALWAYS, ...CAMPAIGNS_AND_INVOICES, ...JOB_RUNS], hidden: [...PEOPLE_ONLY, ...CREATOR_ONLY, ...PLANS] },
      { role: "TEAM_MEMBER", visible: [...ALWAYS, ...CAMPAIGNS_AND_INVOICES], hidden: [...PEOPLE_ONLY, ...CREATOR_ONLY, ...PLANS, ...JOB_RUNS] },
      // 12 Sep — Plan Maker now sees Campaigns + Invoices too (their own
      // plans' campaigns only, scoped server-side) so they can generate
      // per-creator invoices from a campaign page.
      {
        role: "PLAN_MAKER",
        visible: [...ALWAYS, ...PLANS, ...CAMPAIGNS_AND_INVOICES],
        hidden: [...PEOPLE_ONLY, ...CREATOR_ONLY, ...JOB_RUNS],
      },
    ];

    for (const { role, visible, hidden } of CASES) {
      test(`${role} sees the right sidebar items`, async ({ page }) => {
        await signIn(page, role);
        await mockApi(page);
        await page.goto("/dashboard");

        const sidebar = page.getByRole("complementary");
        for (const label of visible) {
          await expect(sidebar.getByRole("link", { name: label, exact: true }), `${role} should see "${label}"`).toBeVisible();
        }
        for (const label of hidden) {
          await expect(sidebar.getByRole("link", { name: label, exact: true }), `${role} should not see "${label}"`).toHaveCount(0);
        }
      });
    }
  });

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

test.describe("desktop topbar", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("notification bell opens the dropdown", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.goto("/dashboard");

    await page.getByRole("button", { name: "Notifications" }).click();
    await expect(page.getByText("No notifications yet.")).toBeVisible();
  });

  test("notification dropdown actually paints above the page content it overlaps", async ({ page }) => {
    // Regression test for a real bug: AppShell gave the topbar and the page
    // content sibling *equal* z-10 (components/layout/app-shell.tsx). On a
    // z-index tie, siblings paint in DOM order — content came second, so it
    // painted over the ENTIRE topbar subtree, including this dropdown's own
    // z-50 (which only wins fights within topbar's own stacking context, not
    // against a sibling context further out). Visually, the dashboard
    // heading painted right through the open dropdown instead of being
    // covered by it — passing this on visibility alone wouldn't have caught
    // that, since the dropdown WAS visible, just underneath. Checking what
    // element the browser actually hit-tests at that point is what pins it
    // down: fixed by bumping topbar's wrapper to z-20.
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    await page.getByRole("button", { name: "Notifications" }).click();
    const panel = page.getByTestId("notifications-panel");
    const box = await panel.boundingBox();
    if (!box) throw new Error("notifications panel has no layout box");

    // A point inside the panel that also sits over where the heading used
    // to show through (the panel's top strip, right under the topbar).
    const hit = await page.evaluate(
      ([x, y]) => document.elementFromPoint(x, y)?.closest('[data-testid="notifications-panel"]') !== null,
      [box.x + box.width / 2, box.y + 10]
    );
    expect(hit, "topmost element at that point should be inside the notifications panel, not page content behind it").toBe(true);
  });

  test("a Sheet modal (e.g. New campaign) paints above the topbar, not behind it", async ({ page }) => {
    // Regression test for a real bug: AppShell's content pane carries its
    // own `relative z-10` (needed so the topbar, at z-20, wins the tie
    // against the notification dropdown above — see the test above this
    // one). Every Sheet-based modal (components/ui/sheet.tsx — New
    // campaign, New invoice, New asset, ...) is rendered from inside that
    // z-10 pane, and `position: fixed` doesn't escape an ancestor's
    // stacking context — so the modal's own z-50 only ever competed
    // *inside* that z-10 subtree and always lost to the z-20 topbar.
    // Visually, opening "New campaign" rendered the dialog merged into/
    // behind the search bar, theme toggle, and log-out button instead of
    // dimming them. Fixed by portaling Sheet to document.body, which
    // escapes the content pane's stacking context entirely.
    await signIn(page, "ADMIN"); // only ADMIN can create a campaign (canCreate)
    await mockApi(page);
    await page.goto("/campaigns");

    await page.getByRole("button", { name: "New campaign", exact: true }).click();
    const overlay = page.getByTestId("sheet-overlay");
    await expect(overlay).toBeVisible();

    // The topbar's log-out button sits well above the modal panel's
    // typical top edge — exactly the region that used to render as
    // "topbar showing through the dialog" instead of dimmed-over.
    const logout = page.getByRole("button", { name: "Log out" });
    const box = await logout.boundingBox();
    if (!box) throw new Error("log out button has no layout box");

    const hit = await page.evaluate(
      ([x, y]) => document.elementFromPoint(x, y)?.closest('[data-testid="sheet-overlay"]') !== null,
      [box.x + box.width / 2, box.y + box.height / 2]
    );
    expect(hit, "topmost element over the topbar should be the modal overlay, not the log out button behind it").toBe(true);
  });
});

test.describe("mobile bottom nav + More sheet", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  const TABS = [
    { label: "Home", href: "/dashboard" },
    { label: "Campaigns", href: "/campaigns" },
    { label: "Invoices", href: "/invoices" },
    // Everyone's Pages registry lives here now (newTask.md, 8 Sep —
    // Assets folded into Inventory) — kept Assets' old primary-tab slot.
    { label: "Inventory", href: "/inventory" },
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

  // Inventory isn't here — it's a primary bottom tab now, not an overflow
  // item (see the TABS list above). Plans (newTask.md, 9 Sep) is a new
  // overflow row, Admin/Plan-Maker-only.
  const MORE_SHEET_ROWS: { label: string; href: string; role: MockRole }[] = [
    { label: "Plans", href: "/plans", role: "ADMIN" },
    { label: "Team", href: "/team", role: "CREATOR" },
    { label: "People", href: "/users", role: "ADMIN" },
    { label: "Job runs", href: "/job-runs", role: "ADMIN" },
  ];

  for (const { label, href, role } of MORE_SHEET_ROWS) {
    test(`More sheet "${label}" row goes to ${href} and renders`, async ({ page }) => {
      const errors = await collectPageErrors(page);
      await signIn(page, role);
      await mockApi(page);

      await page.goto("/dashboard");
      await page.getByRole("button", { name: "More" }).click();
      await page.getByRole("link", { name: label, exact: true }).click();

      await expect(page).toHaveURL(new RegExp(`${href}$`));
      expect(errors, `uncaught page error(s) after navigating to ${href}`).toEqual([]);
    });
  }

  test("More sheet hides rows the signed-in role can't use", async ({ page }) => {
    // Same regression as the desktop sidebar's "per-role visibility" tests
    // above, for the mobile overflow sheet (more-sheet.tsx).
    await signIn(page, "CREATOR");
    await mockApi(page);
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "More" }).click();

    await expect(page.getByRole("link", { name: "Team", exact: true })).toBeVisible();
    for (const label of ["People", "Job runs", "Plans"]) {
      await expect(page.getByRole("link", { name: label, exact: true }), `CREATOR should not see "${label}"`).toHaveCount(0);
    }
  });

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

  test("topbar notification bell doesn't render on mobile — only the More sheet's view does", async ({ page }) => {
    // Regression test: components/layout/topbar.tsx's notification-bell dropdown
    // used to render at every viewport width. Its floating panel (up to 360px
    // wide, anchored to a 38px button) had nowhere correct to sit in the
    // condensed mobile topbar and overlapped the search/profile controls next
    // to it — on top of duplicating the More sheet's own notifications view
    // (tested above). Fixed by hiding it below the `md` breakpoint, matching
    // the theme-toggle button right next to it, which already did this.
    await signIn(page, "ADMIN");
    await mockApi(page);
    await page.goto("/dashboard");

    await expect(page.getByRole("button", { name: "Notifications" })).toBeHidden();
  });
});
