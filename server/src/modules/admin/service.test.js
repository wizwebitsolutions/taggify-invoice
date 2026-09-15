import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApiError } from "../../middleware/errorHandler.js";

const mockPrisma = {
  user: { findUnique: vi.fn(), update: vi.fn() },
  refreshToken: { updateMany: vi.fn() },
  permissionAuditLog: { create: vi.fn() },
  $transaction: vi.fn(async (ops) => Promise.all(ops)),
};
vi.mock("../../lib/prisma.js", () => ({ prisma: mockPrisma }));

const { resetUserPassword, updateUserPermissions } = await import("./service.js");

beforeEach(() => vi.clearAllMocks());

describe("resetUserPassword — reset-and-reveal (newTask.md #8, not recoverable passwords)", () => {
  it("returns a freshly generated password and never the old one", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: "u1", passwordHash: "old-hash" });
    mockPrisma.user.update.mockResolvedValue({});
    mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });

    const result = await resetUserPassword("u1");

    expect(result.generatedPassword).toEqual(expect.any(String));
    expect(result.generatedPassword.length).toBeGreaterThan(0);
    expect(result).not.toHaveProperty("passwordHash");
  });

  it("revokes every active refresh token so old sessions can't keep working", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: "u1", passwordHash: "old-hash" });
    mockPrisma.user.update.mockResolvedValue({});
    mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 2 });

    await resetUserPassword("u1");

    expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: "u1", revoked: false },
      data: { revoked: true },
    });
  });

  it("404s on a user that doesn't exist", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    await expect(resetUserPassword("missing")).rejects.toBeInstanceOf(ApiError);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });
});

describe("updateUserPermissions — sub-admin overlay (newTask.md, 8 Sep)", () => {
  // Two findUnique calls per update: the target, then the acting admin's own
  // record (for clamping) — see clampPermissionsToActor in lib/permissions.js.
  const unrestrictedActor = { id: "actor-1", role: "ADMIN", permissions: null };

  it("merges the patch onto the target's existing overlay rather than replacing it", async () => {
    mockPrisma.user.findUnique
      .mockResolvedValueOnce({ id: "sub-1", role: "ADMIN", permissions: { "campaigns.manage": false } })
      .mockResolvedValueOnce(unrestrictedActor);
    mockPrisma.user.update.mockResolvedValue({ id: "sub-1", role: "ADMIN", permissions: { "campaigns.manage": false, "inventory.manage": false } });
    mockPrisma.permissionAuditLog.create.mockResolvedValue({});

    await updateUserPermissions("actor-1", "sub-1", { "inventory.manage": false });

    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: "sub-1" },
      data: { permissions: { "campaigns.manage": false, "inventory.manage": false } },
    });
  });

  it("writes an audit log entry with before/after and who made the change", async () => {
    mockPrisma.user.findUnique
      .mockResolvedValueOnce({ id: "sub-1", role: "ADMIN", permissions: null })
      .mockResolvedValueOnce(unrestrictedActor);
    mockPrisma.user.update.mockResolvedValue({ id: "sub-1", role: "ADMIN", permissions: { "plans.manage": false } });
    mockPrisma.permissionAuditLog.create.mockResolvedValue({});

    await updateUserPermissions("actor-1", "sub-1", { "plans.manage": false });

    expect(mockPrisma.permissionAuditLog.create).toHaveBeenCalledWith({
      data: { targetId: "sub-1", actorId: "actor-1", before: null, after: { "plans.manage": false } },
    });
  });

  it("grants a section to a non-ADMIN account (15 Sep — admin can give any user access permissions)", async () => {
    mockPrisma.user.findUnique
      .mockResolvedValueOnce({ id: "tm-1", role: "TEAM_MEMBER", permissions: null })
      .mockResolvedValueOnce(unrestrictedActor);
    mockPrisma.user.update.mockResolvedValue({ id: "tm-1", role: "TEAM_MEMBER", permissions: { "inventory.manage": true } });
    mockPrisma.permissionAuditLog.create.mockResolvedValue({});

    const result = await updateUserPermissions("actor-1", "tm-1", { "inventory.manage": true });

    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: "tm-1" },
      data: { permissions: { "inventory.manage": true } },
    });
    expect(result.permissions["inventory.manage"]).toBe(true);
    expect(result.permissions["campaigns.manage"]).toBe(false);
  });

  it("a restricted actor can't grant a non-ADMIN account a section they don't hold themselves", async () => {
    const restrictedActor = { id: "actor-1", role: "ADMIN", permissions: { "inventory.manage": false } };
    mockPrisma.user.findUnique
      .mockResolvedValueOnce({ id: "tm-1", role: "TEAM_MEMBER", permissions: null })
      .mockResolvedValueOnce(restrictedActor);
    mockPrisma.user.update.mockResolvedValue({ id: "tm-1", role: "TEAM_MEMBER", permissions: { "inventory.manage": false } });
    mockPrisma.permissionAuditLog.create.mockResolvedValue({});

    await updateUserPermissions("actor-1", "tm-1", { "inventory.manage": true });

    // clampPatchToActor forces the patched `true` down to `false` since the
    // actor themselves doesn't hold inventory.manage — same guard as the
    // ADMIN case above, just now reachable on a non-ADMIN target too.
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: "tm-1" },
      data: { permissions: { "inventory.manage": false } },
    });
  });

  it("404s on a target that doesn't exist", async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce(null);

    await expect(updateUserPermissions("actor-1", "missing", {})).rejects.toBeInstanceOf(ApiError);
  });

  it("401s if the acting admin's own account no longer exists", async () => {
    mockPrisma.user.findUnique
      .mockResolvedValueOnce({ id: "sub-1", role: "ADMIN", permissions: null })
      .mockResolvedValueOnce(null);

    await expect(updateUserPermissions("gone-actor", "sub-1", { "plans.manage": false })).rejects.toBeInstanceOf(ApiError);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it("clamps the result to the acting admin's own permissions — can't grant a key they don't hold", async () => {
    // The acting admin is themselves restricted (no finance.manage) and
    // tries to grant the target finance.manage=true.
    mockPrisma.user.findUnique
      .mockResolvedValueOnce({ id: "sub-1", role: "ADMIN", permissions: null })
      .mockResolvedValueOnce({ id: "actor-1", role: "ADMIN", permissions: { "finance.manage": false } });
    mockPrisma.user.update.mockResolvedValue({ id: "sub-1", role: "ADMIN", permissions: {} });
    mockPrisma.permissionAuditLog.create.mockResolvedValue({});

    await updateUserPermissions("actor-1", "sub-1", { "finance.manage": true, "inventory.manage": true });

    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: "sub-1" },
      data: { permissions: expect.objectContaining({ "finance.manage": false, "inventory.manage": true }) },
    });
  });
});
