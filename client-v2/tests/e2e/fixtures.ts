import type { Page, Route } from "@playwright/test";

/**
 * The API origin the dev server talks to. Tests intercept *everything* under
 * it, so whichever API the dev server was started against (even the live one)
 * is never actually called. Override with E2E_API_URL if the dev server uses
 * another NEXT_PUBLIC_API_URL.
 */
export const API_URL = process.env.E2E_API_URL ?? "http://localhost:4000/api";

const AUTH_STORAGE_KEY = "taggify_auth"; // lib/api-client.ts AUTH_STORAGE_KEY

/** The user each page signed in as, so GET /users/me answers with that same user (the app re-reads permissions from it). */
const signedIn = new WeakMap<Page, ReturnType<typeof userFor>>();

export type MockRole = "CREATOR" | "ADMIN" | "FINANCE" | "TEAM_MEMBER" | "PLAN_MAKER";

const SECTIONS = {
  users: ["view", "edit"],
  campaigns: ["view", "edit"],
  inventory: ["view", "edit", "approve"],
  links: ["view", "edit", "approve"],
  finance: ["view", "edit", "approve", "pay"],
  plans: ["view", "edit", "approve"],
} as const;
const KEYS = Object.entries(SECTIONS).flatMap(([s, a]) => a.map((x) => `${s}.${x}`));
const all = (v: boolean) => Object.fromEntries(KEYS.map((k) => [k, v]));

/** Mirrors server/src/lib/permissions.js ROLE_DEFAULTS (keep in sync). */
const ROLE_PERMISSIONS: Record<MockRole, Record<string, boolean>> = {
  ADMIN: all(true),
  FINANCE: { ...all(false), "finance.view": true, "finance.edit": true, "finance.approve": true, "finance.pay": true, "campaigns.view": true, "inventory.view": true, "links.view": true },
  PLAN_MAKER: { ...all(false), "inventory.view": true },
  CREATOR: all(false),
  TEAM_MEMBER: all(false),
};

export function userFor(role: MockRole) {
  return { id: `test-${role.toLowerCase()}`, phoneNumber: "+919876543210", name: `Test ${role}`, email: `${role.toLowerCase()}@test.local`, role, emailVerified: true, permissions: ROLE_PERMISSIONS[role] };
}

/** Seeds a session before any app code runs, so RequireAuth sees a signed-in user on first paint. */
export async function signIn(page: Page, role: MockRole, patch: Partial<ReturnType<typeof userFor>> & { ownAccess?: Record<string, boolean> } = {}) {
  const user = { ...userFor(role), ...patch };
  signedIn.set(page, user);
  await page.addInitScript(({ key, session }) => window.localStorage.setItem(key, JSON.stringify(session)), {
    key: AUTH_STORAGE_KEY,
    session: { user, accessToken: "test-access-token", refreshToken: "test-refresh-token" },
  });
  return user;
}

/**
 * Catch-all for the API origin: empty-but-valid shapes for anything a test
 * doesn't mock itself. Register this FIRST; Playwright uses the most recently
 * registered matching route, so a test's own page.route() calls win.
 */
export async function mockApi(page: Page) {
  await page.route(`${API_URL}/**`, (route: Route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    if (path.startsWith("/notifications")) return route.fulfill({ json: [] });
    if (path === "/users/me") return route.fulfill({ json: signedIn.get(page) ?? userFor("ADMIN") });
    if (path === "/users/me/team") return route.fulfill({ json: [] });
    if (path === "/links" && route.request().method() === "GET") return route.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 20 } });
    if (path === "/payments/me/pending") return route.fulfill({ json: { items: [], total: 0, invoices: [] } });
    if (path === "/payments/me/paid") return route.fulfill({ json: { items: [], total: 0 } });
    if (path === "/admin/invoice-numbering") return route.fulfill({ json: { prefix: "QM", nextNumber: 1, suggestion: "QM1" } });
    if (route.request().method() === "GET") return route.fulfill({ json: path.endsWith("s") ? [] : {} });
    return route.fulfill({ status: 204, body: "" });
  });
}

/** Review screenshots: no-op unless E2E_SHOTS=<folder> is set (e.g. ux/build-review). */
export async function shot(page: Page, name: string) {
  const dir = process.env.E2E_SHOTS;
  if (!dir) return;
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
}

/**
 * Rates are entered one format at a time (16 Oct): open the "Add a rate for…" select, pick the
 * format, type the amount, press Add. No rate is mandatory any more.
 */
export async function addRate(scope: ReturnType<Page["getByRole"]> | Page, label: string, amount: string) {
  await scope.getByRole("combobox", { name: "Add a rate for" }).click();
  // The select's options are portalled to <body>, so they're looked up on the page, not inside `scope`.
  const pg = "page" in scope && typeof scope.page === "function" ? scope.page() : (scope as Page);
  await pg.getByRole("option", { name: label, exact: true }).click();
  await scope.getByLabel("New rate amount").fill(amount);
  await scope.getByRole("button", { name: "Add rate" }).click();
}

/** The three rates older specs filled in on an Add page form. */
export async function fillRequiredRates(scope: ReturnType<Page["getByRole"]>) {
  await addRate(scope, "Reel", "20000");
  await addRate(scope, "Story", "8000");
  await addRate(scope, "Static / Carousel", "12000");
}

/** Plan form, pages step: add a format line for a picked page via its "Add a format…" select. */
export async function addPlanFormat(page: Page, handle: string, label: string) {
  await page.getByRole("combobox", { name: `Add a format for ${handle}` }).click();
  await page.getByRole("option", { name: new RegExp(`^${label.replace(/[+/]/g, "\\$&")}`) }).click();
}
