import { expect, test, type Page } from "@playwright/test";

import { API_URL, mockApi, shot, signIn, type MockRole } from "./fixtures";

/** Settings → My team (creators only, v1 /team): list, add a member, show/hide amounts. API fully mocked. */

const now = new Date().toISOString();
const member = (userId: string, canSeeMoney: boolean) => ({ id: `m-${userId}`, creatorId: "test-creator", userId, canSeeMoney, createdAt: now });

async function teamApi(page: Page, role: MockRole, opts: { ownAccess?: Record<string, boolean>; badId?: string } = {}) {
  await signIn(page, role, opts.ownAccess ? { ownAccess: opts.ownAccess } : {});
  const rows = [member("tm-alpha-001", false)];
  const calls = { posted: [] as { userId: string; canSeeMoney: boolean }[] };
  await mockApi(page);
  await page.route(`${API_URL}/users/me/team`, (r) => {
    if (r.request().method() === "POST") {
      const body = r.request().postDataJSON();
      calls.posted.push(body);
      if (body.userId === opts.badId) return r.fulfill({ status: 400, json: { error: { code: "INVALID_TEAM_MEMBER", message: "Not a team member" } } });
      const i = rows.findIndex((m) => m.userId === body.userId);
      const next = member(body.userId, body.canSeeMoney);
      if (i >= 0) rows[i] = next;
      else rows.push(next);
      return r.fulfill({ status: 201, json: next });
    }
    return r.fulfill({ json: rows });
  });
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  return calls;
}

test.describe("My team", () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test("creator: sees their team and adds a member who can see money", async ({ page }) => {
    const calls = await teamApi(page, "CREATOR");
    const team = page.getByRole("region", { name: "My team" });
    await expect(team.getByRole("row", { name: /tm-alpha-001/ })).toContainText("Hidden");
    await shot(page, "creator-team");

    await team.getByRole("button", { name: "Add member" }).click();
    const dialog = page.getByRole("dialog", { name: "Add a team member" });
    const submit = dialog.getByRole("button", { name: "Add member" });
    await expect(submit).toBeDisabled();
    await dialog.getByLabel("Their user ID").fill("  tm-beta-002 ");
    await dialog.getByRole("switch", { name: "Can see money" }).click();
    await submit.click();
    await expect(page.getByText("Team member added.")).toBeVisible();
    expect(calls.posted).toEqual([{ userId: "tm-beta-002", canSeeMoney: true }]);
    await expect(dialog).toBeHidden();
    await expect(team.getByRole("row", { name: /tm-beta-002/ })).toContainText("Can see amounts");
  });

  test("creator: Show amounts re-sends the member with money switched on", async ({ page }) => {
    const calls = await teamApi(page, "CREATOR");
    const row = page.getByRole("region", { name: "My team" }).getByRole("row", { name: /tm-alpha-001/ });
    await row.getByRole("button", { name: "Show amounts" }).click();
    await expect(page.getByText("They can now see invoices and payment amounts.")).toBeVisible();
    expect(calls.posted).toEqual([{ userId: "tm-alpha-001", canSeeMoney: true }]);
    await expect(row).toContainText("Can see amounts");
    await expect(row.getByRole("button", { name: "Hide amounts" })).toBeVisible();
  });

  test("creator: an ID that isn't a team member login gets a plain error and the dialog stays open", async ({ page }) => {
    await teamApi(page, "CREATOR", { badId: "nobody" });
    await page.getByRole("region", { name: "My team" }).getByRole("button", { name: "Add member" }).click();
    const dialog = page.getByRole("dialog", { name: "Add a team member" });
    await dialog.getByLabel("Their user ID").fill("nobody");
    await dialog.getByRole("button", { name: "Add member" }).click();
    await expect(dialog.getByText("No team member account has that user ID.", { exact: false })).toBeVisible();
    await expect(dialog).toBeVisible();
  });

  test("creator with team view but not edit: list only, no Add or Show amounts", async ({ page }) => {
    await teamApi(page, "CREATOR", { ownAccess: { "users.view": true, "users.edit": false } });
    const team = page.getByRole("region", { name: "My team" });
    await expect(team.getByRole("row", { name: /tm-alpha-001/ })).toBeVisible();
    await expect(team.getByRole("button", { name: "Add member" })).toHaveCount(0);
    await expect(team.getByRole("button", { name: "Show amounts" })).toHaveCount(0);
  });

  test("creator: members show by name and email when the server sends them, id otherwise", async ({ page }) => {
    await signIn(page, "CREATOR");
    await mockApi(page);
    await page.route(`${API_URL}/users/me/team`, (r) =>
      r.fulfill({ json: [{ ...member("tm-named", true), user: { id: "tm-named", name: "Asha Rao", email: "asha@example.com" } }, member("tm-bare", false)] })
    );
    await page.goto("/settings");
    const team = page.getByRole("region", { name: "My team" });
    const named = team.getByRole("row", { name: /Asha Rao/ });
    await expect(named).toContainText("asha@example.com");
    await expect(named).not.toContainText("tm-named");
    await expect(team.getByRole("row", { name: /tm-bare/ })).toBeVisible();
  });

  test("creator with team access switched off: no My team", async ({ page }) => {
    await teamApi(page, "CREATOR", { ownAccess: { "users.view": false, "users.edit": false } });
    await expect(page.getByRole("region", { name: "My team" })).toHaveCount(0);
  });

  for (const role of ["ADMIN", "FINANCE", "TEAM_MEMBER", "PLAN_MAKER"] as const) {
    test(`${role} has no My team`, async ({ page }) => {
      await teamApi(page, role);
      await expect(page.getByRole("region", { name: "My team" })).toHaveCount(0);
    });
  }
});
