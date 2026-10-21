import { defineConfig, devices } from "@playwright/test";

/**
 * client-v2 e2e. Every API call is intercepted (tests/e2e/fixtures.ts):
 * a catch-all answers anything a test didn't mock, so no request ever reaches
 * a real API or database — only `next dev` on :3001 is needed.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  // `next dev` compiles each route on its first visit; with two workers that can pass
  // the default 5s, so the first assertion on a fresh route gets 15s. Assertions are unchanged.
  expect: { timeout: 15_000 },
  // E2E_BASE_URL points at a built app (E2E_BASE_URL=http://localhost:3101 after building with NEXT_DIST_DIR=.next-e2e); otherwise the dev server on :3001.
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3001", trace: "on-first-retry" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: "npm run dev", url: "http://localhost:3001/login", reuseExistingServer: !process.env.CI, timeout: 180_000 },
});
