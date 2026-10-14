import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import express from "express";

// GET /integrations/google/status (12 Oct): was open to anyone. Now a signed-in
// admin, or someone who can edit plans, only.
const mockPrisma = { user: { findUnique: vi.fn() } };
vi.mock("../../lib/prisma.js", () => ({ prisma: mockPrisma }));

let currentUser;
vi.mock("../../middleware/requireAuth.js", () => ({
  requireAuth: (req, res, next) => {
    if (!currentUser) return res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Missing bearer token" } });
    req.user = currentUser;
    next();
  },
}));
vi.mock("../../lib/googleOAuthClient.js", () => ({
  buildAuthorizeUrl: vi.fn(),
  verifyState: vi.fn(),
  exchangeCodeForTokens: vi.fn(),
  saveRefreshToken: vi.fn(),
  isGoogleDriveConnected: vi.fn(async () => true),
  isGoogleOAuthConfigured: vi.fn(() => true),
  isGoogleConnectionHealthy: vi.fn(async () => true),
}));

const { default: router } = await import("./googleAuthRoutes.js");

const app = express();
app.use("/integrations/google", router);
const server = await new Promise((resolve) => {
  const s = app.listen(0, () => resolve(s));
});
const base = `http://127.0.0.1:${server.address().port}`;
afterAll(() => server.close());

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.user.findUnique.mockImplementation(async () => (currentUser ? { role: currentUser.role, permissions: currentUser.permissions ?? null } : null));
});

async function status(user) {
  currentUser = user;
  const res = await fetch(`${base}/integrations/google/status`);
  return { status: res.status, body: await res.json() };
}

describe("GET /integrations/google/status", () => {
  it("rejects a request with no session", async () => {
    expect((await status(null)).status).toBe(401);
  });

  it("rejects a CREATOR and a FINANCE account without plan edit", async () => {
    expect((await status({ id: "cr-1", role: "CREATOR" })).status).toBe(403);
    expect((await status({ id: "fi-1", role: "FINANCE" })).status).toBe(403);
  });

  it("answers an ADMIN, a PLAN_MAKER and finance granted plans.edit", async () => {
    const admin = await status({ id: "ad-1", role: "ADMIN" });
    expect(admin.status).toBe(200);
    expect(admin.body).toEqual({ configured: true, connected: true, healthy: true });
    expect((await status({ id: "pm-1", role: "PLAN_MAKER" })).status).toBe(200);
    expect((await status({ id: "fi-2", role: "FINANCE", permissions: { "plans.edit": true } })).status).toBe(200);
  });
});
