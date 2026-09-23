import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApiError } from "../../middleware/errorHandler.js";

const mockPrisma = {
  user: { findUnique: vi.fn(), update: vi.fn() },
  refreshToken: { updateMany: vi.fn() },
  permissionAuditLog: { create: vi.fn() },
  $transaction: vi.fn(async (ops) => Promise.all(ops)),
};
vi.mock("../../lib/prisma.js", () => ({ prisma: mockPrisma }));

const { resetUserPassword, updateUserPermissions, updateUserRole } = await import("./service.js");

beforeEach(() => vi.clearAllMocks());

const fullAdmin = { id: "actor-1", role: "ADMIN", permissions: null };
// A sub-admin who still holds users.edit — the actor every escalation
// guard below is about: they can reach these routes, but must not be able
// to turn that one section into full admin.
const subAdminWithUsers = { id: "actor-2", role: "ADMIN", permissions: { "finance.pay": false } };
const grantedPlanner = { id: "actor-3", role: "PLAN_MAKER", permissions: { "users.edit": true } };

const expectApiError = async (promise, code, statusCode) => {
  const err = await promise.catch((e) => e);
  expect(err).toBeInstanceOf(ApiError);
  expect(err.code).toBe(code);
  if (statusCode) expect(err.statusCode).toBe(statusCode);
};

describe("resetUserPassword — reset-and-reveal (newTask.md #8, not recoverable passwords)", () => {
  beforeEach(() => {
    mockPrisma.user.update.mockResolvedValue({});
    mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.permissionAuditLog.create.mockResolvedValue({});
  });

  it("returns a freshly generated password and never the old one", async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce({ id: "u1", role: "CREATOR", passwordHash: "old-hash" }).mockResolvedValueOnce(fullAdmin);

    const result = await resetUserPassword("actor-1", "u1");

    expect(result.generatedPassword).toEqual(expect.any(String));
    expect(result.generatedPassword.length).toBeGreaterThan(0);
    expect(result).not.toHaveProperty("passwordHash");
  });

  it("revokes every active refresh token so old sessions can't keep working", async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce({ id: "u1", role: "CREATOR", passwordHash: "old-hash" }).mockResolvedValueOnce(fullAdmin);

    await resetUserPassword("actor-1", "u1");

    expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: "u1", revoked: false },
      data: { revoked: true },
    });
  });

  it("audit-logs the reset as action=password_reset (23 Sep — it's a takeover primitive)", async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce({ id: "u1", role: "CREATOR" }).mockResolvedValueOnce(fullAdmin);

    await resetUserPassword("actor-1", "u1");

    expect(mockPrisma.permissionAuditLog.create).toHaveBeenCalledWith({
      data: { targetId: "u1", actorId: "actor-1", action: "password_reset", before: null, after: {} },
    });
  });

  it("404s on a user that doesn't exist", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    await expect(resetUserPassword("actor-1", "missing")).rejects.toBeInstanceOf(ApiError);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it("403s when a sub-admin or granted non-admin tries to reset an ADMIN's password (23 Sep escalation)", async () => {
    // The takeover: reset a real admin's password, read it off the response, sign in as them.
    for (const actor of [subAdminWithUsers, grantedPlanner]) {
      mockPrisma.user.findUnique.mockResolvedValueOnce({ id: "admin-9", role: "ADMIN" }).mockResolvedValueOnce(actor);
      await expectApiError(resetUserPassword(actor.id, "admin-9"), "ADMIN_ACCOUNT_RESTRICTED", 403);
    }
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it("403s a non-full-admin resetting any grantable role's password — FINANCE, or a granted PLAN_MAKER (review finding, 23 Sep)", async () => {
    // Same takeover one role down: sign in as Finance (bare FINANCE routes)
    // or as a planner holding keys the actor lacks.
    const targets = [
      { id: "fin-1", role: "FINANCE", permissions: null },
      { id: "pm-9", role: "PLAN_MAKER", permissions: { "finance.pay": true } },
    ];
    for (const actor of [subAdminWithUsers, grantedPlanner]) {
      for (const target of targets) {
        mockPrisma.user.findUnique.mockResolvedValueOnce(target).mockResolvedValueOnce(actor);
        await expectApiError(resetUserPassword(actor.id, target.id), "ADMIN_ACCOUNT_RESTRICTED", 403);
      }
    }
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it("still lets a sub-admin reset a non-admin's password", async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce({ id: "c1", role: "CREATOR" }).mockResolvedValueOnce(subAdminWithUsers);

    const result = await resetUserPassword("actor-2", "c1");

    expect(result.generatedPassword).toEqual(expect.any(String));
  });
});

describe("updateUserRole — role changes drop the overlay and can't escalate (23 Sep)", () => {
  beforeEach(() => {
    mockPrisma.user.update.mockImplementation(async ({ data }) => ({ id: "t", ...data }));
    mockPrisma.permissionAuditLog.create.mockResolvedValue({});
  });

  it("changes the role, nulls the overlay, and audit-logs before/after as action=role", async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce({ id: "pm-1", role: "PLAN_MAKER", permissions: { "plans.edit": true } }).mockResolvedValueOnce(fullAdmin);

    const updated = await updateUserRole("actor-1", "pm-1", "FINANCE");

    expect(mockPrisma.user.update).toHaveBeenCalledWith({ where: { id: "pm-1" }, data: { role: "FINANCE", permissions: null } });
    expect(mockPrisma.permissionAuditLog.create).toHaveBeenCalledWith({
      data: {
        targetId: "pm-1",
        actorId: "actor-1",
        action: "role",
        before: { role: "PLAN_MAKER", permissions: { "plans.edit": true } },
        after: { role: "FINANCE", permissions: null },
      },
    });
    expect(updated.role).toBe("FINANCE");
    expect(updated.permissions).toEqual(expect.objectContaining({ "plans.edit": false }));
  });

  it("revokes the target's sessions — the access token carries the old role until it expires", async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce({ id: "a-2", role: "ADMIN", permissions: null }).mockResolvedValueOnce(fullAdmin);
    mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });

    await updateUserRole("actor-1", "a-2", "FINANCE");

    expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith({ where: { userId: "a-2", revoked: false }, data: { revoked: true } });
  });

  it("never echoes the password hash back", async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce({ id: "c1", role: "CREATOR", permissions: null }).mockResolvedValueOnce(fullAdmin);
    mockPrisma.user.update.mockResolvedValueOnce({ id: "c1", role: "FINANCE", permissions: null, passwordHash: "$2a$12$secret" });

    const updated = await updateUserRole("actor-1", "c1", "FINANCE");

    expect(updated).not.toHaveProperty("passwordHash");
  });

  it("400s on an unknown role", async () => {
    await expectApiError(updateUserRole("actor-1", "u1", "SUPERUSER"), "VALIDATION_ERROR", 400);
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("403s a self role change — the UI disabled it, the server never checked", async () => {
    await expectApiError(updateUserRole("actor-3", "actor-3", "ADMIN"), "CANNOT_EDIT_SELF", 403);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it("403s a sub-admin or granted non-admin promoting anyone to ADMIN (that would mint a full, overlay-less admin)", async () => {
    for (const actor of [subAdminWithUsers, grantedPlanner]) {
      mockPrisma.user.findUnique.mockResolvedValueOnce({ id: "c1", role: "CREATOR", permissions: null }).mockResolvedValueOnce(actor);
      await expectApiError(updateUserRole(actor.id, "c1", "ADMIN"), "ADMIN_ACCOUNT_RESTRICTED", 403);
    }
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it("403s a sub-admin demoting or re-roling an existing ADMIN", async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce({ id: "admin-9", role: "ADMIN", permissions: null }).mockResolvedValueOnce(subAdminWithUsers);

    await expectApiError(updateUserRole("actor-2", "admin-9", "CREATOR"), "ADMIN_ACCOUNT_RESTRICTED", 403);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it("lets a full admin promote to ADMIN and lets a sub-admin move between non-admin roles", async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce({ id: "c1", role: "CREATOR", permissions: null }).mockResolvedValueOnce(fullAdmin);
    await expect(updateUserRole("actor-1", "c1", "ADMIN")).resolves.toMatchObject({ role: "ADMIN" });

    mockPrisma.user.findUnique.mockResolvedValueOnce({ id: "c2", role: "CREATOR", permissions: null }).mockResolvedValueOnce(subAdminWithUsers);
    await expect(updateUserRole("actor-2", "c2", "PLAN_MAKER")).resolves.toMatchObject({ role: "PLAN_MAKER" });
  });

  it("404s on a target that doesn't exist", async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce(null);
    await expectApiError(updateUserRole("actor-1", "missing", "FINANCE"), "USER_NOT_FOUND", 404);
  });
});

describe("updateUserPermissions — sub-admin overlay (newTask.md, 8 Sep)", () => {
  // Two findUnique calls per update: the target, then the acting admin's own
  // record (for clamping) — see clampPatchToActor in lib/permissions.js.
  const unrestrictedActor = fullAdmin;

  it("merges the patch onto the target's existing overlay rather than replacing it", async () => {
    mockPrisma.user.findUnique
      .mockResolvedValueOnce({ id: "sub-1", role: "ADMIN", permissions: { "campaigns.edit": false } })
      .mockResolvedValueOnce(unrestrictedActor);
    mockPrisma.user.update.mockResolvedValue({ id: "sub-1", role: "ADMIN", permissions: { "campaigns.edit": false, "inventory.edit": false } });
    mockPrisma.permissionAuditLog.create.mockResolvedValue({});

    await updateUserPermissions("actor-1", "sub-1", { "inventory.edit": false });

    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: "sub-1" },
      data: { permissions: { "campaigns.edit": false, "inventory.edit": false } },
    });
  });

  it("writes an audit log entry with before/after and who made the change", async () => {
    mockPrisma.user.findUnique
      .mockResolvedValueOnce({ id: "sub-1", role: "ADMIN", permissions: null })
      .mockResolvedValueOnce(unrestrictedActor);
    mockPrisma.user.update.mockResolvedValue({ id: "sub-1", role: "ADMIN", permissions: { "plans.edit": false } });
    mockPrisma.permissionAuditLog.create.mockResolvedValue({});

    await updateUserPermissions("actor-1", "sub-1", { "plans.edit": false });

    expect(mockPrisma.permissionAuditLog.create).toHaveBeenCalledWith({
      data: { targetId: "sub-1", actorId: "actor-1", action: "permissions", before: null, after: { "plans.edit": false } },
    });
  });

  it("grants a section to a grantable non-ADMIN account (15 Sep — admin can give any user access permissions)", async () => {
    mockPrisma.user.findUnique
      .mockResolvedValueOnce({ id: "pm-1", role: "PLAN_MAKER", permissions: null })
      .mockResolvedValueOnce(unrestrictedActor);
    mockPrisma.user.update.mockResolvedValue({ id: "pm-1", role: "PLAN_MAKER", permissions: { "inventory.edit": true } });
    mockPrisma.permissionAuditLog.create.mockResolvedValue({});

    const result = await updateUserPermissions("actor-1", "pm-1", { "inventory.edit": true });

    // `edit` implies `view` (23 Sep per-action keys) — both are stored.
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: "pm-1" },
      data: { permissions: { "inventory.edit": true, "inventory.view": true } },
    });
    expect(result.permissions["inventory.edit"]).toBe(true);
    expect(result.permissions["campaigns.edit"]).toBe(false);
  });

  it("403s a non-full-admin editing an ADMIN's overlay — otherwise every real admin could be locked out of full-admin status (review finding, 23 Sep)", async () => {
    for (const actor of [subAdminWithUsers, grantedPlanner]) {
      mockPrisma.user.findUnique.mockResolvedValueOnce({ id: "admin-9", role: "ADMIN", permissions: null }).mockResolvedValueOnce(actor);
      const allOff = Object.fromEntries(["users.edit", "campaigns.edit", "inventory.edit", "links.approve", "finance.pay", "plans.edit"].map((k) => [k, false]));
      await expectApiError(updateUserPermissions(actor.id, "admin-9", allOff), "ADMIN_ACCOUNT_RESTRICTED", 403);
    }
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it("400s a grant on a CREATOR or TEAM_MEMBER — every list they reach is their own rows, so a grant is self-approval (23 Sep)", async () => {
    for (const role of ["CREATOR", "TEAM_MEMBER"]) {
      mockPrisma.user.findUnique.mockResolvedValueOnce({ id: "c-1", role, permissions: null }).mockResolvedValueOnce(unrestrictedActor);
      await expectApiError(updateUserPermissions("actor-1", "c-1", { "links.approve": true }), "ROLE_NOT_GRANTABLE", 400);
    }
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it("a restricted actor can't grant a non-ADMIN account a section they don't hold themselves", async () => {
    const restrictedActor = { id: "actor-1", role: "ADMIN", permissions: { "inventory.edit": false } };
    mockPrisma.user.findUnique
      .mockResolvedValueOnce({ id: "pm-1", role: "PLAN_MAKER", permissions: null })
      .mockResolvedValueOnce(restrictedActor);
    mockPrisma.user.update.mockResolvedValue({ id: "pm-1", role: "PLAN_MAKER", permissions: { "inventory.edit": false } });
    mockPrisma.permissionAuditLog.create.mockResolvedValue({});

    await updateUserPermissions("actor-1", "pm-1", { "inventory.edit": true });

    // clampPatchToActor forces the patched `true` down to `false` since the
    // actor themselves doesn't hold inventory.edit — same guard as the
    // ADMIN case above, just now reachable on a non-ADMIN target too.
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: "pm-1" },
      data: { permissions: { "inventory.edit": false, "inventory.view": true } },
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

    await expect(updateUserPermissions("gone-actor", "sub-1", { "plans.edit": false })).rejects.toBeInstanceOf(ApiError);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it("clamps the result to the acting admin's own permissions — can't grant a key they don't hold", async () => {
    // The acting admin is themselves restricted (no finance.pay) and
    // tries to grant a planner finance.pay=true. (An ADMIN target is a
    // 403 for them outright — see the test above.)
    mockPrisma.user.findUnique
      .mockResolvedValueOnce({ id: "pm-1", role: "PLAN_MAKER", permissions: null })
      .mockResolvedValueOnce({ id: "actor-1", role: "ADMIN", permissions: { "finance.pay": false } });
    mockPrisma.user.update.mockResolvedValue({ id: "pm-1", role: "PLAN_MAKER", permissions: {} });
    mockPrisma.permissionAuditLog.create.mockResolvedValue({});

    await updateUserPermissions("actor-1", "pm-1", { "finance.pay": true, "inventory.edit": true });

    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: "pm-1" },
      data: { permissions: expect.objectContaining({ "finance.pay": false, "inventory.edit": true }) },
    });
  });
});
