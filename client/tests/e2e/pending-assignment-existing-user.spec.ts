import { test, expect, type Page } from "@playwright/test";

import { signIn, mockApi, API_URL } from "./fixtures";

/**
 * User request, 12 Sep — "option of creating account under user": a page
 * from the sheet that isn't in the system yet can be attached to a creator
 * who already has an account, instead of always minting a new one. If the
 * sheet's phone already belongs to someone, the row starts on that user.
 * Component: components/campaigns/resolve-pending-assignments-modal.tsx.
 */
const users = [
  { id: "u-priya", phoneNumber: "+919000000001", name: "Priya Creator", role: "CREATOR", whatsappVerified: true },
  { id: "u-rahul", phoneNumber: "+919000000002", name: "Rahul Creator", role: "CREATOR", whatsappVerified: true },
  { id: "u-admin", phoneNumber: "+919000000009", name: "Ops Admin", role: "ADMIN", whatsappVerified: true },
];

async function mockPending(page: Page, creatorPhone: string | null) {
  await page.route(`${API_URL}/campaigns`, (route) =>
    route.fulfill({
      json: [{ id: "camp-1", brandName: "Solmate Coffee", title: "Launch Week", deadline: null, createdAt: new Date().toISOString(), pendingAssignmentCount: 1 }],
    })
  );
  await page.route(`${API_URL}/campaigns/camp-1/assignments`, (route) =>
    route.fulfill({
      json: [{ id: "assign-1", campaignId: "camp-1", assetId: null, pageHandle: "newpage", creatorPhone, status: "pending", createdAt: new Date().toISOString() }],
    })
  );
  await page.route(`${API_URL}/admin/users`, (route) => route.fulfill({ json: users }));
}

test.describe("Resolve pending pages — attach to an existing user", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("Existing user tab lists creators (not admins), search narrows them, and Attach creates the page under the picked owner", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await mockPending(page, null);
    let assetBody: { handle: string; ownerId: string } | undefined;
    let signupCalled = false;
    await page.route(`${API_URL}/auth/signup`, (route) => {
      signupCalled = true;
      return route.fulfill({ status: 500, json: { error: { code: "SHOULD_NOT_BE_CALLED", message: "no" } } });
    });
    await page.route(`${API_URL}/assets`, (route) => {
      if (route.request().method() !== "POST") return route.fulfill({ json: [] });
      assetBody = route.request().postDataJSON();
      return route.fulfill({ status: 201, json: { id: "asset-new", handle: "newpage", ownerId: assetBody!.ownerId, rateCards: [] } });
    });
    let resolved = false;
    await page.route(`${API_URL}/campaigns/camp-1/assignments/assign-1`, (route) => {
      resolved = true;
      return route.fulfill({ json: { id: "assign-1", status: "matched", assetId: "asset-new" } });
    });

    await page.goto("/campaigns");
    await page.getByRole("button", { name: /still need.*creating/ }).click();
    await page.getByRole("button", { name: "Create" }).click();

    // No sheet phone → starts on "New creator account".
    await expect(page.getByRole("tab", { name: "New creator account" })).toHaveAttribute("aria-selected", "true");
    await page.getByRole("tab", { name: "Existing user" }).click();

    const picker = page.getByRole("radiogroup", { name: "Existing user" });
    await expect(picker.getByRole("radio", { name: /Priya Creator/ })).toBeVisible();
    await expect(picker.getByRole("radio", { name: /Rahul Creator/ })).toBeVisible();
    await expect(picker.getByRole("radio", { name: /Ops Admin/ })).toHaveCount(0);

    const attach = page.getByRole("button", { name: "Attach page" });
    await expect(attach).toBeDisabled(); // nobody picked yet

    await page.getByLabel("Search existing users").fill("rahul");
    await expect(picker.getByRole("radio", { name: /Priya Creator/ })).toHaveCount(0);
    await picker.getByRole("radio", { name: /Rahul Creator/ }).click();
    await expect(attach).toBeEnabled();
    await attach.click();

    await expect(page.getByText("@newpage attached to Rahul Creator.")).toBeVisible();
    expect(assetBody).toMatchObject({ handle: "newpage", ownerId: "u-rahul" });
    expect(signupCalled).toBe(false);
    await expect.poll(() => resolved).toBe(true);
  });

  test("a sheet phone that already belongs to a creator pre-selects them on the Existing user tab", async ({ page }) => {
    await signIn(page, "ADMIN");
    await mockApi(page);
    await mockPending(page, "+919000000001");

    await page.goto("/campaigns");
    await page.getByRole("button", { name: /still need.*creating/ }).click();
    await page.getByRole("button", { name: "Create" }).click();

    await expect(page.getByRole("tab", { name: "Existing user" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText(/already belongs to Priya Creator/)).toBeVisible();
    await expect(page.getByRole("radiogroup", { name: "Existing user" }).getByRole("radio", { name: /Priya Creator/ })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("button", { name: "Attach page" })).toBeEnabled();
  });
});
