import { expect, test, type Page } from "@playwright/test";

import { API_URL, mockApi, shot, signIn, userFor } from "./fixtures";

/** Settings: people & access, invoice numbering, background jobs, my profile. API fully mocked. */

const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
const KEYS = ["users.view", "users.edit", "campaigns.view", "campaigns.edit", "inventory.view", "inventory.edit", "inventory.approve", "links.view", "links.edit", "links.approve", "finance.view", "finance.edit", "finance.approve", "finance.pay", "plans.view", "plans.edit", "plans.approve"];
const perms = (on: string[]) => Object.fromEntries(KEYS.map((k) => [k, on.includes(k)]));
const FINANCE = ["finance.view", "finance.edit", "finance.approve", "finance.pay", "campaigns.view", "inventory.view", "links.view"];

const PEOPLE = [
  { ...userFor("ADMIN"), emailVerifiedAt: ago(30), createdAt: ago(300), ownAccess: perms([]) },
  { id: "u-neha", name: "Neha Kapoor", email: "neha@taggify.in", phoneNumber: null, role: "FINANCE", emailVerifiedAt: ago(20), createdAt: ago(200), permissions: perms(FINANCE), ownAccess: perms([]) },
  { id: "u-priya", name: "Priya Sharma", email: "priya@taggify.in", phoneNumber: null, role: "PLAN_MAKER", emailVerifiedAt: null, createdAt: ago(100), permissions: perms([]), ownAccess: perms(["plans.view", "plans.edit", "campaigns.view", "links.view", "finance.view", "finance.edit", "inventory.view", "inventory.edit"]) },
  { id: "u-riya", name: "Riya Mehta", email: "riya@example.com", phoneNumber: "+919800000001", role: "CREATOR", emailVerifiedAt: ago(10), createdAt: ago(50), permissions: perms([]), ownAccess: perms(["campaigns.view", "inventory.view", "inventory.edit", "links.view", "links.edit", "finance.view", "finance.edit", "users.view", "users.edit"]) },
  { id: "u-ops2", name: "Second Admin", email: "ops2@taggify.in", phoneNumber: null, role: "ADMIN", emailVerifiedAt: ago(5), createdAt: ago(40), permissions: perms(KEYS), ownAccess: perms([]) },
];

async function settingsApi(page: Page) {
  const calls = { permissions: [] as { id: string; body: Record<string, unknown> }[], role: [] as unknown[], signup: [] as Record<string, unknown>[], numbering: [] as unknown[], email: [] as unknown[], reset: 0, billing: [] as unknown[], profile: [] as unknown[], password: 0, runNow: 0 };
  await mockApi(page);
  await page.route(`${API_URL}/admin/users`, (r) => r.fulfill({ json: PEOPLE }));
  await page.route(`${API_URL}/admin/users/*/permissions`, (r) => {
    const id = r.request().url().split("/users/")[1].split("/")[0];
    const body = r.request().postDataJSON().permissions;
    calls.permissions.push({ id, body });
    const person = PEOPLE.find((p) => p.id === id)!;
    return r.fulfill({ json: { ...person, permissions: { ...person.permissions, ...body } } });
  });
  await page.route(`${API_URL}/admin/users/*/role`, (r) => {
    calls.role.push(r.request().postDataJSON());
    return r.fulfill({ json: {} });
  });
  await page.route(`${API_URL}/admin/users/*/email`, (r) => {
    calls.email.push(r.request().postDataJSON());
    return r.fulfill({ json: { id: "u-riya", email: r.request().postDataJSON().email, emailVerified: false } });
  });
  await page.route(`${API_URL}/admin/users/*/reset-password`, (r) => {
    calls.reset++;
    return r.fulfill({ json: { generatedPassword: "Fresh-Pass-42!" } });
  });
  await page.route(`${API_URL}/auth/signup`, (r) => {
    const body = r.request().postDataJSON();
    calls.signup.push(body);
    return r.fulfill({ status: 201, json: { user: { id: "u-new", name: body.name ?? null, email: body.email, role: body.role }, generatedPassword: "New-Login-77!" } });
  });
  await page.route(`${API_URL}/admin/invoice-numbering`, (r) => {
    if (r.request().method() === "PUT") {
      const body = r.request().postDataJSON();
      calls.numbering.push(body);
      const prefix = body.prefix ?? "TGF/26-27/";
      const n = body.nextNumber ?? 42;
      return r.fulfill({ json: { prefix, nextNumber: n, suggestion: `${prefix}${String(n).padStart(4, "0")}` } });
    }
    return r.fulfill({ json: { prefix: "TGF/26-27/", nextNumber: 42, suggestion: "TGF/26-27/0042" } });
  });
  await page.route(`${API_URL}/admin/job-runs`, (r) =>
    r.fulfill({
      json: [
        { id: "j1", jobName: "finance_export", status: "failed", startedAt: ago(0.1), finishedAt: ago(0.09), error: "GITHUB_TOKEN is not set" },
        { id: "j2", jobName: "instagram_rescrape", status: "success", startedAt: ago(0.2), finishedAt: ago(0.19), error: null },
        { id: "j3", jobName: "finance_export", status: "success", startedAt: ago(1.1), finishedAt: ago(1.09), error: null },
      ],
    })
  );
  await page.route(`${API_URL}/admin/finance-export/run-now`, (r) => {
    calls.runNow++;
    return r.fulfill({ status: 500, json: { error: { code: "FINANCE_EXPORT_FAILED", message: "GITHUB_TOKEN is not set" } } });
  });
  return calls;
}

test.describe("Settings", () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test("admin: people list with roles and filters", async ({ page }) => {
    await signIn(page, "ADMIN");
    await settingsApi(page);
    await page.goto("/settings");
    await expect(page.getByRole("tab", { name: "People & access (5)" })).toHaveAttribute("aria-selected", "true");
    const neha = page.getByRole("row", { name: /Neha Kapoor/ });
    await expect(neha).toContainText("Finance");
    // No Access column and no "Limited" tag (user request, 13 Oct); access lives in the person sheet.
    await expect(page.getByRole("columnheader", { name: "Access" })).toHaveCount(0);
    await expect(neha).not.toContainText("Campaigns · Inventory · Content · Finance");
    await expect(page.getByText("Limited", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("row", { name: /Test ADMIN/ })).toContainText("(you)");
    await shot(page, "settings-people");

    await page.getByLabel("Search people").fill("priya");
    await expect(page.getByRole("row", { name: /Priya Sharma/ })).toBeVisible();
    await expect(page.getByRole("row", { name: /Neha Kapoor/ })).toHaveCount(0);
    await page.getByLabel("Search people").fill("");
    await page.getByRole("combobox", { name: /Role/ }).click();
    await page.getByRole("option", { name: "Admin" }).click();
    await expect(page.getByRole("row", { name: /Second Admin/ })).toBeVisible();
    await expect(page.getByRole("row", { name: /Riya Mehta/ })).toHaveCount(0);
  });

  test("editing access sends only the keys that changed", async ({ page }) => {
    await signIn(page, "ADMIN");
    const calls = await settingsApi(page);
    await page.goto("/settings");
    await page.getByRole("button", { name: "Edit access for Neha Kapoor" }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("heading", { name: "Neha Kapoor" })).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Save access" })).toBeDisabled();
    // A view-only section is plainly ticked; clicking it again would take view away, not "complete" it.
    await expect(sheet.getByRole("checkbox", { name: "Campaigns access" })).toHaveAttribute("data-state", "checked");
    await sheet.getByRole("checkbox", { name: "Plans access" }).click();
    await sheet.getByRole("checkbox", { name: "Plans: Approve" }).click();
    await sheet.getByRole("button", { name: "Save access" }).click();
    await expect(page.getByText("Access saved for Neha Kapoor.")).toBeVisible();
    expect(calls.permissions).toEqual([{ id: "u-neha", body: { "plans.view": true, "plans.approve": true } }]);
    // Diffed against what the server returned, so nothing is left to save.
    await expect(sheet.getByRole("button", { name: "Save access" })).toBeDisabled();
  });

  test("own-scope accounts only get their own switches", async ({ page }) => {
    await signIn(page, "ADMIN");
    const calls = await settingsApi(page);
    await page.goto("/settings");
    await page.getByRole("button", { name: "Edit access for Riya Mehta" }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByText("Access (their own content only)")).toBeVisible();
    await expect(sheet.getByRole("checkbox", { name: "Plans access" })).toHaveCount(0);
    await sheet.getByRole("checkbox", { name: "Money: Raise invoices" }).click();
    await sheet.getByRole("button", { name: "Save access" }).click();
    await expect.poll(() => calls.permissions.length).toBe(1);
    expect(calls.permissions[0].body).toEqual({ "finance.edit": false });
  });

  test("changing a role asks first and says what it does", async ({ page }) => {
    await signIn(page, "ADMIN");
    const calls = await settingsApi(page);
    await page.goto("/settings");
    await page.getByRole("button", { name: "Edit access for Priya Sharma" }).click();
    const sheet = page.getByRole("dialog");
    await sheet.getByRole("combobox", { name: "Role" }).click();
    await page.getByRole("option", { name: "Finance" }).click();
    await expect(sheet.getByText("Their access goes back to a plain Finance's. Their sessions end, and the new role is fully in force within 15 minutes.")).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Save access" })).toBeDisabled();
    await sheet.getByRole("button", { name: "Change role" }).click();
    expect(calls.role).toEqual([]);
    await sheet.getByRole("button", { name: "Yes, make Finance" }).click();
    await expect.poll(() => calls.role).toEqual([{ role: "FINANCE" }]);
  });

  test("you can't edit yourself; reset password shows the new one once", async ({ page }) => {
    await signIn(page, "ADMIN");
    const calls = await settingsApi(page);
    await page.goto("/settings");
    await page.getByRole("button", { name: "View Test ADMIN" }).click();
    let sheet = page.getByRole("dialog");
    await expect(sheet.getByText("This is you. Ask another admin to change your role or access.")).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Save access" })).toHaveCount(0);
    await expect(sheet.getByRole("button", { name: "Reset password" })).toHaveCount(0);
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Edit access for Riya Mehta" }).click();
    sheet = page.getByRole("dialog");
    await sheet.getByRole("button", { name: "Reset password" }).click();
    const confirm = page.getByRole("dialog", { name: "Reset password?" });
    await confirm.getByRole("button", { name: "Reset password" }).click();
    const done = page.getByRole("dialog", { name: "New password" });
    await expect(done.getByTestId("generated-password")).toHaveText("Fresh-Pass-42!");
    await page.keyboard.press("Escape");
    await expect(done).toBeVisible(); // a stray Escape mustn't lose the password
    await done.getByRole("button", { name: "Done" }).click();
    await expect(done).toHaveCount(0);
    expect(calls.reset).toBe(1);
  });

  test("a restricted admin can't touch admin accounts or take over staff", async ({ page }) => {
    await signIn(page, "ADMIN", { permissions: perms(KEYS.filter((k) => k !== "finance.pay")) });
    await settingsApi(page);
    await page.goto("/settings");
    await page.getByRole("button", { name: "View Second Admin" }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByText("Only a full admin can change an admin account.")).toBeVisible();
    await expect(sheet.getByRole("checkbox", { name: "Plans access" })).toBeDisabled();
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Edit access for Neha Kapoor" }).click();
    await expect(page.getByRole("dialog").getByText("Only a full admin can change the email or password of an admin, finance or planner account.")).toBeVisible();
    await expect(page.getByRole("dialog").getByRole("button", { name: "Reset password" })).toHaveCount(0);
    await expect(page.getByRole("dialog").getByRole("button", { name: "Change email" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    // A role change isn't clamped by the server, so roles carrying access this admin lacks (Finance has Pay) aren't offered.
    await page.getByRole("button", { name: "Edit access for Priya Sharma" }).click();
    await page.getByRole("dialog").getByRole("combobox", { name: "Role" }).click();
    await expect(page.getByRole("option")).toHaveText(["Creator", "Team member", "Planner"]);
  });

  test("an admin with only Bulk Tracker switched off is still a full admin", async ({ page }) => {
    // Opt-in keys don't make anyone a restricted admin (server isRestrictedSubAdmin, 12 Oct).
    await signIn(page, "ADMIN", { permissions: { ...perms(KEYS), "bulkTrack.view": false } });
    await settingsApi(page);
    await page.goto("/settings");
    await page.getByRole("button", { name: "Edit access for Second Admin" }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("checkbox", { name: "Plans access" })).toBeEnabled();
    await expect(sheet.getByText("Only a full admin can change an admin account.")).toHaveCount(0);
    // Unticking Bulk Tracker for another admin needs no warning any more.
    await sheet.getByRole("checkbox", { name: "Bulk Tracker access" }).uncheck();
    await expect(sheet.getByText(/makes them a restricted admin/)).toHaveCount(0);
  });

  test("a restricted admin adding Finance always sends the access, so the server can clamp it", async ({ page }) => {
    await signIn(page, "ADMIN", { permissions: perms(KEYS.filter((k) => k !== "finance.pay")) });
    const calls = await settingsApi(page);
    await page.goto("/settings");
    await page.getByRole("button", { name: "Add person" }).click();
    const dialog = page.getByRole("dialog", { name: "Add person" });
    await dialog.getByLabel("Email").fill("fin2@example.com");
    await dialog.getByRole("combobox", { name: "Role" }).click();
    await page.getByRole("option", { name: "Finance" }).click();
    await dialog.getByRole("button", { name: "Add person" }).click();
    await expect.poll(() => calls.signup.length).toBe(1);
    expect(Object.keys(calls.signup[0].permissions as object)).toHaveLength(18); // 17 section keys + the opt-in bulkTrack.view (12 Oct)
  });

  test("add person: role required, creators go via Inventory, password shown once", async ({ page }) => {
    await signIn(page, "ADMIN");
    const calls = await settingsApi(page);
    await page.goto("/settings");
    await page.getByRole("button", { name: "Add person" }).click();
    const dialog = page.getByRole("dialog", { name: "Add person" });
    await dialog.getByLabel("Email").fill("aman@example.com");
    await dialog.getByRole("button", { name: "Add person" }).click();
    await expect(dialog.getByText("Choose a role.")).toBeVisible();
    expect(calls.signup).toEqual([]);

    await dialog.getByRole("combobox", { name: "Role" }).click();
    await page.getByRole("option", { name: "Creator" }).click();
    await expect(dialog.getByRole("link", { name: "Go to Inventory → Add page" })).toHaveAttribute("href", "/creators");
    await expect(dialog.getByRole("button", { name: "Add person" })).toBeDisabled();

    await dialog.getByRole("combobox", { name: "Role" }).click();
    await page.getByRole("option", { name: "Team member" }).click();
    await dialog.getByLabel("Name (optional)").fill("Aman");
    await dialog.getByLabel("Mobile (optional)").fill("98765 43210");
    await dialog.getByRole("button", { name: "Add person" }).click();
    const done = page.getByRole("dialog", { name: "Aman can sign in" });
    await expect(done.getByTestId("generated-password")).toHaveText("New-Login-77!");
    await page.keyboard.press("Escape");
    await expect(done).toBeVisible(); // only Done closes it
    // Usual access isn't sent at all; the server applies the role's defaults.
    expect(calls.signup).toEqual([{ email: "aman@example.com", name: "Aman", phoneNumber: "+919876543210", role: "TEAM_MEMBER" }]);
  });

  test("add person with less access sends only that role's own switches", async ({ page }) => {
    await signIn(page, "ADMIN");
    const calls = await settingsApi(page);
    await page.goto("/settings");
    await page.getByRole("button", { name: "Add person" }).click();
    const dialog = page.getByRole("dialog", { name: "Add person" });
    await dialog.getByLabel("Email").fill("plan@example.com");
    await dialog.getByRole("combobox", { name: "Role" }).click();
    await page.getByRole("option", { name: "Planner" }).click();
    await dialog.getByRole("checkbox", { name: "Plans: Approve" }).click();
    await dialog.getByRole("button", { name: "Add person" }).click();
    await expect.poll(() => calls.signup.length).toBe(1);
    const sent = calls.signup[0].permissions as Record<string, boolean>;
    expect(sent["plans.approve"]).toBe(false);
    expect(Object.keys(sent).sort()).toEqual(["bulkTrack.view", "campaigns.edit", "campaigns.view", "finance.edit", "finance.view", "inventory.edit", "inventory.view", "links.view", "plans.approve", "plans.edit", "plans.view"]);
  });

  test("invoice numbering: preview, sends only what changed, warns when going back", async ({ page }) => {
    await signIn(page, "FINANCE");
    const calls = await settingsApi(page);
    await page.goto("/settings?tab=numbering");
    await expect(page.getByTestId("numbering-preview")).toHaveText("TGF/26-27/0042");
    await page.getByLabel("Next number").fill("12");
    await expect(page.getByText(/This goes back from TGF\/26-27\/0042/)).toBeVisible();
    await page.getByLabel("Next number").fill("50");
    await expect(page.getByTestId("numbering-preview")).toHaveText("TGF/26-27/0050");
    await page.getByLabel("Prefix").fill("TGF 26");
    await expect(page.getByText("Use letters, digits and / . _ - only.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save numbering" })).toBeDisabled();
    await page.getByLabel("Prefix").fill("TGF/26-27/");
    await page.getByRole("button", { name: "Save numbering" }).click();
    await expect(page.getByText("Saved. The next client invoice will be TGF/26-27/0050.")).toBeVisible();
    expect(calls.numbering).toEqual([{ nextNumber: 50 }]);
  });

  test("background jobs: latest result per job, history, run-now failure is reported", async ({ page }) => {
    await signIn(page, "FINANCE");
    const calls = await settingsApi(page);
    await page.goto("/settings?tab=jobs");
    const exp = page.getByTestId("job-finance_export");
    await expect(exp).toContainText("Failed");
    await expect(exp).toContainText("GITHUB_TOKEN is not set");
    await expect(page.getByTestId("job-instagram_rescrape")).toContainText("Worked");
    await expect(page.getByTestId("job-screenshot_reminder")).toContainText("No runs in the last 50");
    await expect(page.getByRole("table").getByRole("row")).toHaveCount(4);
    await shot(page, "settings-jobs");
    await exp.getByRole("button", { name: "Run Finance export (GitHub) now" }).click();
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: "GITHUB_TOKEN is not set" })).toBeVisible();
    expect(calls.runNow).toBe(1);
  });

  test("tabs follow access: finance has no People, a planner and a creator only get My profile", async ({ page }) => {
    await signIn(page, "FINANCE");
    await settingsApi(page);
    await page.goto("/settings");
    await expect(page.getByRole("tab")).toHaveText(["Invoice numbering", "Background jobs", "Billing profiles", "My profile"]);
    // A tab you can't use falls back to your first one.
    await page.goto("/settings?tab=people");
    await expect(page.getByRole("tab", { name: "Invoice numbering" })).toHaveAttribute("aria-selected", "true");

    for (const role of ["PLAN_MAKER", "CREATOR"] as const) {
      const p = await page.context().newPage();
      await signIn(p, role);
      await settingsApi(p);
      await p.goto("/settings");
      await expect(p.getByRole("heading", { name: "Your details" })).toBeVisible();
      await expect(p.getByRole("tab")).toHaveCount(0);
      await p.close();
    }
  });

  test("my profile: saves only changed fields; bank details are checked and go for approval", async ({ page }) => {
    await signIn(page, "CREATOR");
    const calls = await settingsApi(page);
    const me = { ...userFor("CREATOR"), emailVerifiedAt: ago(3), secondaryPhone: null, addressLine1: "12 MG Road", addressLine2: null, state: "Maharashtra", pincode: "400001" };
    await page.route(`${API_URL}/users/me`, (r) => {
      if (r.request().method() === "PUT") {
        calls.profile.push(r.request().postDataJSON());
        return r.fulfill({ json: { ...me, ...r.request().postDataJSON() } });
      }
      return r.fulfill({ json: me });
    });
    const profiles = [{ id: "bp1", userId: me.id, pan: "ABCDE1234F", name: "Test Creator", gstin: null, msme: null, bankAccountNumber: "123456789012", ifscCode: "HDFC0001234", approvalStatus: "approved", createdAt: ago(9) }];
    await page.route(`${API_URL}/billing-profiles**`, (r) => {
      if (r.request().method() === "GET") return r.fulfill({ json: profiles });
      calls.billing.push({ method: r.request().method(), url: r.request().url(), body: r.request().postDataJSON() });
      return r.fulfill({ json: { ...profiles[0], ...r.request().postDataJSON(), approvalStatus: "pending" } });
    });
    await page.goto("/settings");
    await expect(page.getByLabel("Sign-in email")).toBeDisabled();
    await page.getByLabel("State").fill("Karnataka");
    await page.getByLabel("PIN code").fill("5600");
    await expect(page.getByText("Enter a 6-digit PIN code.")).toBeVisible();
    await page.getByLabel("PIN code").fill("560001");
    await page.getByRole("button", { name: "Save details" }).click();
    await expect(page.getByText("Profile saved.")).toBeVisible();
    expect(calls.profile).toEqual([{ state: "Karnataka", pincode: "560001" }]);

    const bank = page.getByTestId("bank-bp1");
    await expect(bank).toContainText("•••• 9012 · HDFC0001234 · PAN ABCDE1234F");
    await expect(bank).toContainText("Approved");
    await shot(page, "settings-profile");
    await bank.getByRole("button", { name: /Edit bank details/ }).click();
    const dialog = page.getByRole("dialog", { name: "Edit bank details" });
    await expect(dialog.getByText("Saving a change sends these details back to Finance to approve.")).toBeVisible();
    // Saving nothing would still reset approval on the server, so it isn't possible.
    await expect(dialog.getByRole("button", { name: "Save changes" })).toBeDisabled();
    await dialog.getByLabel("IFSC").fill("HDFC123");
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog.getByText("Enter an IFSC like HDFC0001234.")).toBeVisible();
    expect(calls.billing).toEqual([]);
    await dialog.getByLabel("IFSC").fill("ICIC0004321");
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Bank details saved. Finance will check them before your next payout.")).toBeVisible();
    expect(calls.billing).toEqual([
      { method: "PUT", url: `${API_URL}/billing-profiles/bp1`, body: { ifscCode: "ICIC0004321" } },
    ]);
  });

  test("changing your password signs you out; team members get no bank details", async ({ page }) => {
    await signIn(page, "TEAM_MEMBER");
    const calls = await settingsApi(page);
    await page.route(`${API_URL}/auth/change-password`, (r) => {
      calls.password++;
      return r.fulfill({ status: 204, body: "" });
    });
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Your details" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Bank details" })).toHaveCount(0);
    await page.getByLabel("Current password").fill("old-Pass1!");
    await page.getByLabel("New password").fill("weak");
    await expect(page.getByRole("button", { name: "Change password" })).toBeDisabled();
    await page.getByLabel("New password").fill("Str0ng-Pass!");
    await page.getByRole("button", { name: "Change password" }).click();
    // Generous: nothing else in this mocked suite visits /login, so the dev server may compile it now.
    await expect(page).toHaveURL(/\/login/, { timeout: 45_000 });
    expect(calls.password).toBe(1);
  });
});
