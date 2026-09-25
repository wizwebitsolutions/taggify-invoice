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
  it("a bare own-scope role (the route's self-service user) passes while its own-content switch is on — the default (24 Sep)", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ role: "CREATOR", permissions: null });
    const req = { user: { id: "creator-1", role: "CREATOR" } };
    const res = mockRes();
    const next = vi.fn();

    await requireAccess("inventory.edit", "CREATOR")(req, res, next);

    expect(next).toHaveBeenCalledWith();
  });

  it("...and gets 403 ACCESS_REMOVED once the admin switches it off for them", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ role: "CREATOR", permissions: { "inventory.edit": false } });
    const req = { user: { id: "creator-1", role: "CREATOR" } };
    const res = mockRes();
    const next = vi.fn();

    await requireAccess("inventory.edit", "CREATOR")(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.objectContaining({ code: "ACCESS_REMOVED" }) }));
  });

  it("a bare staff role still passes without a lookup", async () => {
    const req = { user: { id: "admin-1", role: "ADMIN" } };
    const res = mockRes();
    const next = vi.fn();

    await requireAccess("finance.pay", "ADMIN")(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("passes a plain ADMIN account through (no overlay)", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ role: "ADMIN", permissions: null });
    const req = { user: { id: "admin-1", role: "ADMIN" } };
    const res = mockRes();
    const next = vi.fn();

    await requireAccess("campaigns.edit")(req, res, next);

    expect(next).toHaveBeenCalledWith();
  });

  it("403s a sub-admin whose overlay turns the key off", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ role: "ADMIN", permissions: { "campaigns.edit": false } });
    const req = { user: { id: "sub-1", role: "ADMIN" } };
    const res = mockRes();
    const next = vi.fn();

    await requireAccess("campaigns.edit")(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("403s a non-bare role with no grant — a plain TEAM_MEMBER can't reach an inventory.edit-gated route", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ role: "TEAM_MEMBER", permissions: null });
    const req = { user: { id: "tm-1", role: "TEAM_MEMBER" } };
    const res = mockRes();
    const next = vi.fn();

    await requireAccess("inventory.edit", "CREATOR")(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("regression (24 Sep): a stored global grant on an own-scope role (TEAM_MEMBER inventory.edit) no longer opens a staff route", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ role: "TEAM_MEMBER", permissions: { "inventory.edit": true } });
    const req = { user: { id: "tm-1", role: "TEAM_MEMBER" } };
    const res = mockRes();
    const next = vi.fn();

    await requireAccess("inventory.edit", "CREATOR")(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("a granted FINANCE account (staff) still passes a key outside its baseline", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ role: "FINANCE", permissions: { "inventory.edit": true } });
    const req = { user: { id: "fin-1", role: "FINANCE" } };
    const res = mockRes();
    const next = vi.fn();

    await requireAccess("inventory.edit", "CREATOR")(req, res, next);

    expect(next).toHaveBeenCalledWith();
  });

  it("reads permissions fresh from the DB rather than trusting req.user — an edit takes effect immediately", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ role: "FINANCE", permissions: { "finance.pay": true } });
    const req = { user: { id: "fin-1", role: "FINANCE" } };
    const res = mockRes();
    const next = vi.fn();

    await requireAccess("finance.pay", "ADMIN")(req, res, next);

    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({ where: { id: "fin-1" }, select: { role: true, permissions: true } });
    expect(next).toHaveBeenCalledWith();
  });

  it("401s if the account no longer exists", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    const req = { user: { id: "gone", role: "TEAM_MEMBER" } };
    const res = mockRes();
    const next = vi.fn();

    await requireAccess("users.edit")(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
