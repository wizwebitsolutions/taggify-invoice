import type { Page } from "@playwright/test";

/** Must match client/.env.local's NEXT_PUBLIC_API_URL. Exported so a test
 * that needs to override one endpoint beyond what mockApi() sends can scope
 * its own page.route() to this origin — a bare "**\/campaigns"-style glob
 * has no scheme/host and also matches the *page* navigation to
 * localhost:3000/campaigns, replacing the whole document with the mocked
 * JSON instead of just answering the API call. */
export const API_URL = "http://localhost:4000/api";

/** Must match client/lib/api-client.ts's AUTH_STORAGE_KEY. */
const AUTH_STORAGE_KEY = "taggify_auth";

export type MockRole = "CREATOR" | "ADMIN" | "FINANCE" | "TEAM_MEMBER" | "PLAN_MAKER";

const PERMISSION_SECTIONS = {
  users: ["view", "edit"],
  campaigns: ["view", "edit"],
  inventory: ["view", "edit", "approve"],
  links: ["view", "edit", "approve"],
  finance: ["view", "edit", "approve", "pay"],
  plans: ["view", "edit", "approve"],
} as const;
const PERMISSION_KEYS = Object.entries(PERMISSION_SECTIONS).flatMap(([s, actions]) => actions.map((a) => `${s}.${a}`));
const allTrue = () => Object.fromEntries(PERMISSION_KEYS.map((k) => [k, true]));
const allFalse = () => Object.fromEntries(PERMISSION_KEYS.map((k) => [k, false]));

/**
 * The effective permissions map a real login actually returns for each
 * role (mirrors server/src/lib/permissions.js's ROLE_DEFAULTS exactly —
 * keep the two in sync). A mocked session with no `permissions` at all
 * makes client/lib/api-client.ts's hasAccess() treat every non-ADMIN role
 * as having nothing, which the real app never does, so tests asserting a
 * FINANCE/PLAN_MAKER-only action (approve/pay an invoice, see Receivables,
 * …) need this to behave like the real API a test with a plain `signIn`
 * call is standing in for.
 */
const ROLE_DEFAULT_PERMISSIONS: Record<MockRole, Record<string, boolean>> = {
  ADMIN: allTrue(),
  FINANCE: { ...allFalse(), "finance.view": true, "finance.edit": true, "finance.approve": true, "finance.pay": true, "campaigns.view": true, "inventory.view": true, "links.view": true },
  PLAN_MAKER: { ...allFalse(), "inventory.view": true },
  CREATOR: allFalse(),
  TEAM_MEMBER: allFalse(),
};

export function userFor(role: MockRole = "CREATOR") {
  return {
    id: "test-user-1",
    phoneNumber: "+919876543210",
    name: "Test User",
    role,
    whatsappVerified: true,
    // Verified by default so AppShell's EmailVerifyBanner (email 2FA, 21 Sep)
    // stays out of every unrelated test — login.spec.ts overrides this.
    emailVerified: true,
    permissions: ROLE_DEFAULT_PERMISSIONS[role],
  };
}

/**
 * Seeds localStorage with a logged-in session *before* any app code runs,
 * so RequireAuth (client/components/auth/require-auth.tsx) sees a signed-in
 * user on first paint instead of redirecting to /login.
 */
export async function signIn(page: Page, role: MockRole = "CREATOR") {
  const user = userFor(role);
  await page.addInitScript(
    ({ key, session }) => window.localStorage.setItem(key, JSON.stringify(session)),
    {
      key: AUTH_STORAGE_KEY,
      session: { user, accessToken: "test-access-token", refreshToken: "test-refresh-token" },
    }
  );
  return user;
}

/**
 * Intercepts every server/ API call so these tests don't need a real
 * backend/DB — just empty-but-valid shapes, enough for pages to render
 * without throwing on an unexpected data shape. This makes these tests
 * connectivity/rendering smoke tests, not data-correctness tests: they
 * catch "this link 404s / crashes the page", not "this page shows the
 * right numbers" — that's what server/ vitest tests + assertions on
 * specific mocked data are for.
 *
 * Call *after* signIn(); call any test-specific page.route() for the same
 * pattern *after* this one — Playwright uses the most-recently-registered
 * matching handler.
 */
export async function mockApi(page: Page) {
  await page.route(`${API_URL}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();

    if (method !== "GET") return route.fulfill({ status: 204, body: "" });

    if (path === "/api/users/me") return route.fulfill({ json: userFor() });
    // Exactly "/api/links" or "/api/invoices" (the list endpoints) only — a
    // sub-path like "/api/links/:id/timeline" or "/api/links/:id/cost-revisions"
    // also starts with "/api/links" but returns a bare array, not this
    // paginated shape. Matching on startsWith() here used to hand
    // LinkDetailPanel's timeline query this {items, total, ...} object
    // instead, which its `.map()` then threw on — no test happened to open
    // a link's detail panel under plain mockApi() until campaign-detail.spec.ts did.
    const PAGINATED = ["/api/links", "/api/invoices", "/api/payments/payouts", "/api/payments/pending", "/api/payments/me/pending", "/api/payments/me/payouts"];
    if (PAGINATED.includes(path)) {
      return route.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 100 } });
    }
    // Everything else the app reads on nav destinations (/api/campaigns,
    // /api/assets, /api/billing-profiles, /api/admin/users, /api/admin/job-runs,
    // /api/users/me/team, /api/notifications, /api/links/:id/timeline,
    // /api/links/:id/cost-revisions) is a plain array.
    return route.fulfill({ json: [] });
  });
}
