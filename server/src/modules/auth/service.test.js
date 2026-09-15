import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApiError } from "../../middleware/errorHandler.js";

const mockPrisma = {
  user: { findUnique: vi.fn(), create: vi.fn() },
  permissionAuditLog: { create: vi.fn() },
};
vi.mock("../../lib/prisma.js", () => ({ prisma: mockPrisma }));

// signup() never reaches password generation's real randomness or bcrypt's
// real cost factor in a unit test — both are mocked to keep this fast and
// deterministic, same pattern the rest of this module's untested helpers
// would use.
vi.mock("../../lib/auth/passwordGenerator.js", () => ({ generatePassword: () => "Gen3rated!Pw" }));
vi.mock("bcryptjs", () => ({ default: { hash: vi.fn(async () => "hashed") } }));

const { signup } = await import("./service.js");

const actor = { id: "actor-1", role: "ADMIN" };

beforeEach(() => vi.clearAllMocks());

describe("signup — sub-admin creation (newTask.md, 8 Sep)", () => {
  it("creates a plain account with no permissions overlay when none is given", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.user.create.mockResolvedValue({ id: "u1", phoneNumber: "+911234567890", name: "New Creator", role: "CREATOR", whatsappVerified: false });

    const result = await signup({ phoneNumber: "+911234567890", name: "New Creator", role: "CREATOR" }, actor);

    expect(mockPrisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ permissions: undefined, createdByAdminId: "actor-1" }) })
    );
    expect(mockPrisma.permissionAuditLog.create).not.toHaveBeenCalled();
    expect(result.user.role).toBe("CREATOR");
  });

  it("creates a sub-admin (ADMIN role + restricted overlay) and logs it, when the actor is a full admin", async () => {
    // Two findUnique calls for an ADMIN-role signup: the phone-exists check, then the acting admin's own record (for clamping).
    mockPrisma.user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ ...actor, permissions: null });
    mockPrisma.user.create.mockResolvedValue({
      id: "sub-1",
      phoneNumber: "+919999999999",
      name: "Sub Admin",
      role: "ADMIN",
      whatsappVerified: false,
      permissions: { "campaigns.manage": false },
    });

    const result = await signup(
      { phoneNumber: "+919999999999", name: "Sub Admin", role: "ADMIN", permissions: { "campaigns.manage": false } },
      actor
    );

    expect(mockPrisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ permissions: { "campaigns.manage": false }, createdByAdminId: "actor-1" }) })
    );
    expect(mockPrisma.permissionAuditLog.create).toHaveBeenCalledWith({
      data: { targetId: "sub-1", actorId: "actor-1", before: null, after: { "campaigns.manage": false } },
    });
    // Effective permissions come back fully resolved — every other key
    // defaults true, only the overlaid one is false.
    expect(result.user.permissions["campaigns.manage"]).toBe(false);
    expect(result.user.permissions["inventory.manage"]).toBe(true);
  });

  it("clamps a restricted sub-admin's grant to their own permissions — can't hand out what they don't have", async () => {
    // The acting admin is themselves restricted (no finance.manage) and
    // tries to create a peer with finance.manage explicitly granted.
    const restrictedActor = { id: "actor-1", role: "ADMIN", permissions: { "finance.manage": false } };
    mockPrisma.user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(restrictedActor);
    mockPrisma.user.create.mockResolvedValue({
      id: "sub-2",
      phoneNumber: "+919999999998",
      name: "Peer Admin",
      role: "ADMIN",
      whatsappVerified: false,
      permissions: { "finance.manage": false },
    });

    const result = await signup(
      { phoneNumber: "+919999999998", name: "Peer Admin", role: "ADMIN", permissions: { "finance.manage": true, "inventory.manage": true } },
      restrictedActor
    );

    // finance.manage is forced false regardless of what was requested — the
    // stored overlay only ever carries the `false` keys (minimal storage;
    // "true" is the implicit default), so check the *effective* outcome.
    expect(mockPrisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ permissions: { "finance.manage": false } }) })
    );
    expect(result.user.permissions["finance.manage"]).toBe(false);
    expect(result.user.permissions["inventory.manage"]).toBe(true);
  });

  it("a restricted sub-admin can't create a fully unrestricted admin by simply not sending permissions", async () => {
    // This is the actual privilege-escalation path this test guards
    // against: omitting `permissions` used to mean "full admin", which
    // would let a restricted sub-admin mint themselves an unrestricted
    // peer account and read its one-time password from this response.
    const restrictedActor = { id: "actor-1", role: "ADMIN", permissions: { "campaigns.manage": false } };
    mockPrisma.user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(restrictedActor);
    mockPrisma.user.create.mockResolvedValue({ id: "sub-3", phoneNumber: "+919999999997", name: "New Admin", role: "ADMIN", whatsappVerified: false });

    await signup({ phoneNumber: "+919999999997", name: "New Admin", role: "ADMIN" }, restrictedActor);

    expect(mockPrisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ permissions: expect.objectContaining({ "campaigns.manage": false }) }) })
    );
  });

  it("401s if the acting admin's own account no longer exists", async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null);

    await expect(signup({ phoneNumber: "+919999999996", role: "ADMIN" }, actor)).rejects.toBeInstanceOf(ApiError);
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });

  it("stores nothing for a non-ADMIN role when the payload only restates that role's own false baseline", async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(actor);
    mockPrisma.user.create.mockResolvedValue({ id: "pm-1", phoneNumber: "+918888888888", name: "Planner", role: "PLAN_MAKER", whatsappVerified: false });

    await signup({ phoneNumber: "+918888888888", name: "Planner", role: "PLAN_MAKER", permissions: { "plans.manage": false } }, actor);

    expect(mockPrisma.user.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ permissions: undefined }) }));
    expect(mockPrisma.permissionAuditLog.create).not.toHaveBeenCalled();
  });

  it("grants a non-ADMIN role one of the six sections (15 Sep — admin can give any user access permissions)", async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(actor);
    mockPrisma.user.create.mockResolvedValue({
      id: "tm-1",
      phoneNumber: "+918888888887",
      name: "Teammate",
      role: "TEAM_MEMBER",
      whatsappVerified: false,
      permissions: { "inventory.manage": true },
    });

    const result = await signup(
      { phoneNumber: "+918888888887", name: "Teammate", role: "TEAM_MEMBER", permissions: { "inventory.manage": true } },
      actor
    );

    expect(mockPrisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ permissions: { "inventory.manage": true } }) })
    );
    expect(mockPrisma.permissionAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ after: { "inventory.manage": true } }) })
    );
    expect(result.user.permissions["inventory.manage"]).toBe(true);
    expect(result.user.permissions["campaigns.manage"]).toBe(false);
  });

  it("a restricted actor can't grant a non-ADMIN role a section they don't hold themselves", async () => {
    const restrictedActor = { id: "actor-1", role: "ADMIN", permissions: { "inventory.manage": false } };
    mockPrisma.user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(restrictedActor);
    mockPrisma.user.create.mockResolvedValue({ id: "tm-1", phoneNumber: "+918888888886", name: "Teammate", role: "TEAM_MEMBER", whatsappVerified: false });

    await signup(
      { phoneNumber: "+918888888886", name: "Teammate", role: "TEAM_MEMBER", permissions: { "inventory.manage": true } },
      restrictedActor
    );

    expect(mockPrisma.user.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ permissions: undefined }) }));
    expect(mockPrisma.permissionAuditLog.create).not.toHaveBeenCalled();
  });

  it("409s when the phone number is already registered", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: "existing" });

    await expect(signup({ phoneNumber: "+911234567890", role: "CREATOR" }, actor)).rejects.toBeInstanceOf(ApiError);
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });
});
