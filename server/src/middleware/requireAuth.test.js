import { describe, it, expect, vi, beforeEach } from "vitest";

// Real tokens — jwt.js reads its secrets at import time.
process.env.JWT_ACCESS_SECRET = "test-access-secret";

const mockPrisma = { user: { findUnique: vi.fn() } };
vi.mock("../lib/prisma.js", () => ({ prisma: mockPrisma }));

const { requireAuth } = await import("./requireAuth.js");
const { signAccessToken } = await import("../lib/auth/jwt.js");

function run(authorization) {
  const req = { headers: authorization ? { authorization } : {} };
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  const next = vi.fn();
  return requireAuth(req, res, next).then(() => ({ req, res, next }));
}

beforeEach(() => vi.clearAllMocks());

describe("requireAuth", () => {
  it("a valid token for an active account passes with { id, role }", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ deactivatedAt: null });
    const { req, next } = await run(`Bearer ${signAccessToken({ id: "u1", role: "CREATOR" })}`);
    expect(next).toHaveBeenCalledWith();
    expect(req.user).toEqual({ id: "u1", role: "CREATOR" });
  });

  it("a still-valid token for a deactivated account is refused at once (21 Oct), 401 so the client signs out", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ deactivatedAt: new Date() });
    const { res, next } = await run(`Bearer ${signAccessToken({ id: "u1", role: "CREATOR" })}`);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body.error.code).toBe("ACCOUNT_DEACTIVATED");
  });

  it("a missing or bad token is 401 without touching the database", async () => {
    expect((await run()).res.statusCode).toBe(401);
    expect((await run("Bearer nonsense")).res.statusCode).toBe(401);
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
  });
});
