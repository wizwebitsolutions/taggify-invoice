import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = { user: { findUnique: vi.fn() } };
vi.mock("../lib/prisma.js", () => ({ prisma: mockPrisma }));

const { requireOwnAccess } = await import("./requireOwnAccess.js");

function run(key, user, stored) {
  mockPrisma.user.findUnique.mockResolvedValue(stored);
  const req = { user };
  const res = { status: vi.fn(() => res), json: vi.fn(() => res) };
  const next = vi.fn();
  return requireOwnAccess(key)(req, res, next).then(() => ({ res, next }));
}

beforeEach(() => vi.clearAllMocks());

describe("requireOwnAccess — own-content switches for creators, team members and planners (24 Sep)", () => {
  it("staff roles pass straight through without a lookup (their scoping is the route's own)", async () => {
    for (const role of ["ADMIN", "FINANCE"]) {
      const { next } = await run("finance.view", { id: "s-1", role }, null);
      expect(next).toHaveBeenCalledWith();
    }
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("an own-scope role passes while the switch is on — the default", async () => {
    const { next } = await run("finance.view", { id: "c-1", role: "CREATOR" }, { role: "CREATOR", permissions: null });
    expect(next).toHaveBeenCalledWith();
  });

  it("403 ACCESS_REMOVED once the admin switches it off — read fresh, so it applies at once", async () => {
    const { res, next } = await run("finance.edit", { id: "c-1", role: "CREATOR" }, { role: "CREATOR", permissions: { "finance.edit": false } });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.objectContaining({ code: "ACCESS_REMOVED" }) }));
    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({ where: { id: "c-1" }, select: { role: true, permissions: true } });
  });

  it("a key outside the role's own list is always refused (a team member can't raise invoices)", async () => {
    const { res } = await run("finance.edit", { id: "tm-1", role: "TEAM_MEMBER" }, { role: "TEAM_MEMBER", permissions: { "finance.edit": true } });
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("401 when the account no longer exists", async () => {
    const { res } = await run("links.view", { id: "gone", role: "CREATOR" }, null);
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
