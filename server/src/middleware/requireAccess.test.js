import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = { user: { findUnique: vi.fn() } };
vi.mock("../lib/prisma.js", () => ({ prisma: mockPrisma }));

const { requireAccess } = await import("./requireAccess.js");

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

beforeEach(() => vi.clearAllMocks());

describe("requireAccess — section guard grantable to any role (15 Sep)", () => {
  it("is a no-op for a bare role — that route's normal self-service user, unaffected by any overlay", async () => {
    const req = { user: { id: "creator-1", role: "CREATOR" } };
    const res = mockRes();
    const next = vi.fn();

    await requireAccess("inventory.manage", "CREATOR")(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("passes a plain ADMIN account through (no overlay)", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ role: "ADMIN", permissions: null });
    const req = { user: { id: "admin-1", role: "ADMIN" } };
    const res = mockRes();
    const next = vi.fn();

    await requireAccess("campaigns.manage")(req, res, next);

    expect(next).toHaveBeenCalledWith();
  });

  it("403s a sub-admin whose overlay turns the key off", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ role: "ADMIN", permissions: { "campaigns.manage": false } });
    const req = { user: { id: "sub-1", role: "ADMIN" } };
    const res = mockRes();
    const next = vi.fn();

    await requireAccess("campaigns.manage")(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("403s a non-bare role with no grant — a plain TEAM_MEMBER can't reach an inventory.manage-gated route", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ role: "TEAM_MEMBER", permissions: null });
    const req = { user: { id: "tm-1", role: "TEAM_MEMBER" } };
    const res = mockRes();
    const next = vi.fn();

    await requireAccess("inventory.manage", "CREATOR")(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("passes a granted non-admin role through — the actual feature: admin gave this TEAM_MEMBER inventory.manage", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ role: "TEAM_MEMBER", permissions: { "inventory.manage": true } });
    const req = { user: { id: "tm-1", role: "TEAM_MEMBER" } };
    const res = mockRes();
    const next = vi.fn();

    await requireAccess("inventory.manage", "CREATOR")(req, res, next);

    expect(next).toHaveBeenCalledWith();
  });

  it("reads permissions fresh from the DB rather than trusting req.user — an edit takes effect immediately", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ role: "FINANCE", permissions: { "finance.manage": true } });
    const req = { user: { id: "fin-1", role: "FINANCE" } };
    const res = mockRes();
    const next = vi.fn();

    await requireAccess("finance.manage", "ADMIN")(req, res, next);

    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({ where: { id: "fin-1" }, select: { role: true, permissions: true } });
    expect(next).toHaveBeenCalledWith();
  });

  it("401s if the account no longer exists", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    const req = { user: { id: "gone", role: "TEAM_MEMBER" } };
    const res = mockRes();
    const next = vi.fn();

    await requireAccess("users.manage")(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
