import { expect, test, type Page } from "@playwright/test";

import { API_URL, mockApi, shot, signIn, type MockRole } from "./fixtures";

/** Deleting a campaign phase from Campaign detail (DELETE /campaigns/:id/phase). API fully mocked. */

const now = new Date().toISOString();
const PHASES = [
  { id: "c1", phaseNumber: 1, title: "Diwali Food Stories", createdAt: now },
  { id: "c2", phaseNumber: 2, title: "Diwali Food Stories — Phase 2", createdAt: now },
  { id: "c3", phaseNumber: 3, title: "Diwali Food Stories — Phase 3", createdAt: now },
];
const campaign = (id: string, phases = PHASES) => {
  const p = phases.find((x) => x.id === id)!;
  return { id, brandName: "Saffron Street", title: p.title, deadline: null, createdAt: now, costCap: "300000", spent: 0, postCount: 0, phaseCount: phases.length, phaseNumber: p.phaseNumber, parentCampaignId: p.phaseNumber === 1 ? null : "c1", phases };
};

async function phaseApi(page: Page, role: MockRole, phases = PHASES) {
  await signIn(page, role);
  const calls = { deleted: [] as string[] };
  await mockApi(page);
  await page.route(`${API_URL}/campaigns**`, (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(/^\/api\/campaigns/, "");
    const del = path.match(/^\/([^/]+)\/phase$/);
    if (req.method() === "DELETE" && del) {
      calls.deleted.push(del[1]);
      // Phase 3 has a post on it, so the server refuses.
      if (del[1] === "c3") return route.fulfill({ status: 409, json: { error: { code: "PHASE_HAS_POSTS", message: "Phase 3 has 1 submitted post — remove it before deleting the phase." } } });
      return route.fulfill({ json: { deleted: 1, rootId: "c1" } });
    }
    const one = path.match(/^\/([^/]+)$/);
    if (req.method() === "GET" && one) return route.fulfill({ json: campaign(one[1], phases) });
    if (req.method() === "GET" && path.endsWith("/assignments")) return route.fulfill({ json: [] });
    if (req.method() === "GET" && path === "") return route.fulfill({ json: [campaign("c1", phases)] });
    return route.fulfill({ status: 404, json: {} });
  });
  await page.route(`${API_URL}/links**`, (route) => route.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 100 } }));
  return calls;
}

test.describe("Delete a phase", () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test("admin on phase 2: deletes it after confirming and lands on phase 1", async ({ page }) => {
    const calls = await phaseApi(page, "ADMIN");
    await page.goto("/campaigns/c2");
    await expect(page.getByRole("link", { name: "Phase 2" })).toHaveAttribute("aria-current", "page");
    await page.getByRole("button", { name: "More campaign actions" }).click();
    const items = page.getByRole("menuitem");
    await expect(items).toHaveText(["Delete this phase (2)…", "Delete phase 3…"]);
    await shot(page, "phase-menu");
    await page.getByRole("menuitem", { name: "Delete this phase (2)…" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Delete phase 2?" })).toBeVisible();
    await shot(page, "phase-delete-confirm");
    await dialog.getByRole("button", { name: "Delete phase 2" }).click();
    await expect(page.getByText("Phase 2 deleted.")).toBeVisible();
    await expect(page).toHaveURL(/\/campaigns\/c1$/);
    expect(calls.deleted).toEqual(["c2"]);
  });

  test("admin on phase 1: can delete a later phase; a phase with posts shows the server's reason", async ({ page }) => {
    const calls = await phaseApi(page, "ADMIN");
    await page.goto("/campaigns/c1");
    await page.getByRole("button", { name: "More campaign actions" }).click();
    await expect(page.getByRole("menuitem")).toHaveText(["Delete phase 2…", "Delete phase 3…"]);
    await page.getByRole("menuitem", { name: "Delete phase 3…" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Delete phase 3" }).click();
    await expect(dialog.getByRole("alert")).toHaveText("Phase 3 has 1 submitted post — remove it before deleting the phase.");
    await expect(dialog.getByRole("button", { name: "Delete phase 3" })).toBeDisabled();
    await shot(page, "phase-delete-refused");
    await dialog.getByRole("button", { name: "Keep phase" }).click();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/\/campaigns\/c1$/);
    expect(calls.deleted).toEqual(["c3"]);
  });

  test("a single-phase campaign offers no delete", async ({ page }) => {
    await phaseApi(page, "ADMIN", PHASES.slice(0, 1));
    await page.goto("/campaigns/c1");
    await expect(page.getByRole("button", { name: "Edit details" })).toBeVisible();
    await expect(page.getByRole("button", { name: "More campaign actions" })).toHaveCount(0);
  });

  for (const role of ["PLAN_MAKER", "FINANCE"] as const) {
    test(`${role} (no campaigns.edit) can't delete phases`, async ({ page }) => {
      await phaseApi(page, role);
      await page.goto("/campaigns/c2");
      await expect(page.getByRole("link", { name: "Phase 2" })).toBeVisible();
      await expect(page.getByRole("button", { name: "More campaign actions" })).toHaveCount(0);
    });
  }
});
