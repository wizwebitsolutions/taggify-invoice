import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = { user: { findUnique: vi.fn() } };
vi.mock("../lib/prisma.js", () => ({ prisma: mockPrisma }));

const { requirePermission } = await import("./requirePermission.js");

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

beforeEach(() => vi.clearAllMocks());

describe("requirePermission — sub-admin overlay guard", () => {
  it("is a no-op for any non-ADMIN role — that role's requireRole() already decided access", async () => {
    const req = { user: { id: "pm-1", role: "PLAN_MAKER" } };
    const res = mockRes();
    const next = vi.fn();

    await requirePermission("plans.manage")(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("passes a plain ADMIN account through (no overlay)", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ role: "ADMIN", permissions: null });
    const req = { user: { id: "admin-1", role: "ADMIN" } };
    const res = mockRes();
    const next = vi.fn();

    await requirePermission("campaigns.manage")(req, res, next);

    expect(next).toHaveBeenCalledWith();
  });

  it("403s a sub-admin whose overlay turns the key off", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ role: "ADMIN", permissions: { "campaigns.manage": false } });
    const req = { user: { id: "sub-1", role: "ADMIN" } };
    const res = mockRes();
    const next = vi.fn();

    await requirePermission("campaigns.manage")(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("reads permissions fresh from the DB rather than trusting req.user — an edit takes effect immediately", async () => {
    // req.user (from the access token) carries none of this; the DB row is
    // what's actually checked, so a permission edit takes effect on this
    // account's very next request, not after its token expires.
    mockPrisma.user.findUnique.mockResolvedValue({ role: "ADMIN", permissions: { "finance.manage": false } });
    const req = { user: { id: "sub-1", role: "ADMIN" } };
    const res = mockRes();
    const next = vi.fn();

    await requirePermission("finance.manage")(req, res, next);

    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({ where: { id: "sub-1" }, select: { role: true, permissions: true } });
    expect(next).not.toHaveBeenCalled();
  });

  it("401s if the account no longer exists", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    const req = { user: { id: "gone", role: "ADMIN" } };
    const res = mockRes();
    const next = vi.fn();

    await requirePermission("users.manage")(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
