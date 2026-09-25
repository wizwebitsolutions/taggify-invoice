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

    const result = await signup({ email: "user7890@example.com", name: "New Creator", role: "CREATOR" }, actor);

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
      permissions: { "campaigns.edit": false },
    });

    const result = await signup(
      { email: "user9999@example.com", name: "Sub Admin", role: "ADMIN", permissions: { "campaigns.edit": false } },
      actor
    );

    expect(mockPrisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ permissions: { "campaigns.edit": false }, createdByAdminId: "actor-1" }) })
    );
    expect(mockPrisma.permissionAuditLog.create).toHaveBeenCalledWith({
      data: { targetId: "sub-1", actorId: "actor-1", action: "permissions", before: null, after: { "campaigns.edit": false } },
    });
    // Effective permissions come back fully resolved — every other key
    // defaults true, only the overlaid one is false.
    expect(result.user.permissions["campaigns.edit"]).toBe(false);
    expect(result.user.permissions["inventory.edit"]).toBe(true);
  });

  it("403s a restricted sub-admin or granted non-admin creating an ADMIN-role account at all (23 Sep)", async () => {
    // The privilege-escalation path this guards: an ADMIN account carries
    // bare, non-permission-keyed privileges (every plans/service.js
    // `role === ADMIN` branch, job-runs, invoice numbering, …), so even a
    // clamped overlay isn't enough — a users.edit holder could mint an
    // admin, read its one-time password off this response and sign in as it.
    const restrictedActor = { id: "actor-1", role: "ADMIN", permissions: { "campaigns.edit": false } };
    const grantedPlanner = { id: "actor-2", role: "PLAN_MAKER", permissions: { "users.edit": true } };
    for (const who of [restrictedActor, grantedPlanner]) {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(who);
      const err = await signup({ email: "user9997@example.com", name: "New Admin", role: "ADMIN" }, who).catch((e) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect(err.statusCode).toBe(403);
      expect(err.code).toBe("ADMIN_ACCOUNT_RESTRICTED");
    }
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });

  it("still lets a restricted sub-admin create non-admin accounts, clamped to their own keys", async () => {
    const restrictedActor = { id: "actor-1", role: "ADMIN", permissions: { "campaigns.edit": false } };
    mockPrisma.user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(restrictedActor);
    mockPrisma.user.create.mockResolvedValue({ id: "pm-3", phoneNumber: "+919999999997", name: "Planner", role: "FINANCE", whatsappVerified: false });

    await signup({ email: "user9997@example.com", name: "Planner", role: "FINANCE", permissions: { "campaigns.edit": true, "inventory.edit": true } }, restrictedActor);

    expect(mockPrisma.user.create).toHaveBeenCalledWith(
      // campaigns.edit is clamped away (the actor lacks it); inventory.edit passes.
      expect.objectContaining({ data: expect.objectContaining({ role: "FINANCE", permissions: { "inventory.edit": true } }) })
    );
  });

  it("401s if the acting admin's own account no longer exists", async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null);

    await expect(signup({ email: "user9996@example.com", role: "ADMIN" }, actor)).rejects.toBeInstanceOf(ApiError);
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });

  it("stores nothing for a non-ADMIN role when the payload only restates that role's own false baseline", async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(actor);
    mockPrisma.user.create.mockResolvedValue({ id: "pm-1", phoneNumber: "+918888888888", name: "Planner", role: "FINANCE", whatsappVerified: false });

    await signup({ email: "user8888@example.com", name: "Planner", role: "FINANCE", permissions: { "plans.edit": false } }, actor);

    expect(mockPrisma.user.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ permissions: undefined }) }));
    expect(mockPrisma.permissionAuditLog.create).not.toHaveBeenCalled();
  });

  it("grants a staff (FINANCE) account a section outside its baseline (15 Sep — admin can give any user access permissions)", async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(actor);
    mockPrisma.user.create.mockResolvedValue({
      id: "tm-1",
      phoneNumber: "+918888888887",
      name: "Teammate",
      role: "FINANCE",
      whatsappVerified: false,
      permissions: { "inventory.edit": true },
    });

    const result = await signup(
      { email: "user8887@example.com", name: "Teammate", role: "FINANCE", permissions: { "inventory.edit": true } },
      actor
    );

    expect(mockPrisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ permissions: { "inventory.edit": true } }) })
    );
    expect(mockPrisma.permissionAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ after: { "inventory.edit": true } }) })
    );
    expect(result.user.permissions["inventory.edit"]).toBe(true);
    expect(result.user.permissions["campaigns.edit"]).toBe(false);
  });

  it("a restricted actor can't grant a non-ADMIN role a section they don't hold themselves", async () => {
    const restrictedActor = { id: "actor-1", role: "ADMIN", permissions: { "inventory.edit": false } };
    mockPrisma.user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(restrictedActor);
    mockPrisma.user.create.mockResolvedValue({ id: "tm-1", phoneNumber: "+918888888886", name: "Teammate", role: "FINANCE", whatsappVerified: false });

    await signup(
      { email: "user8886@example.com", name: "Teammate", role: "FINANCE", permissions: { "inventory.edit": true } },
      restrictedActor
    );

    expect(mockPrisma.user.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ permissions: undefined }) }));
    expect(mockPrisma.permissionAuditLog.create).not.toHaveBeenCalled();
  });

  it("own-scope roles at signup (24 Sep): only their own-content switches can be set — anything else is 400 OWN_SCOPE_ONLY", async () => {
    for (const [role, key] of [["CREATOR", "links.approve"], ["TEAM_MEMBER", "finance.edit"], ["PLAN_MAKER", "finance.pay"]]) {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);
      const err = await signup({ email: "user8885@example.com", role, permissions: { [key]: true } }, actor).catch((e) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect(err.code).toBe("OWN_SCOPE_ONLY");
    }
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });

  it("own-scope roles at signup: a switched-off section is stored (e.g. a creator created without invoicing)", async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce(null);
    mockPrisma.user.create.mockImplementation(async ({ data }) => ({ id: "c-8", phoneNumber: null, whatsappVerified: false, ...data }));

    const result = await signup({ email: "c8@example.com", role: "CREATOR", permissions: { "finance.edit": false } }, actor);

    expect(mockPrisma.user.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ permissions: { "finance.edit": false } }) }));
    expect(result.user.ownAccess["finance.edit"]).toBe(false);
    expect(result.user.ownAccess["links.edit"]).toBe(true);
    expect(Object.values(result.user.permissions).every((v) => v === false)).toBe(true);
  });

  it("still creates a plain CREATOR when permissions is omitted or all-false", async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(actor);
    mockPrisma.user.create.mockResolvedValue({ id: "c-9", phoneNumber: "+918888888884", name: null, role: "CREATOR", whatsappVerified: false });

    await signup({ email: "user8884@example.com", role: "CREATOR", permissions: { "links.approve": false } }, actor);

    expect(mockPrisma.user.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ role: "CREATOR", permissions: undefined }) }));
  });

  it("409s when the email already belongs to an account (24 Sep — email is the login)", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: "existing" });

    await expect(signup({ email: "Taken@Example.com", role: "CREATOR" }, actor)).rejects.toMatchObject({ code: "EMAIL_ALREADY_REGISTERED" });
    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({ where: { email: "taken@example.com" } });
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });

  it("409s when an optional phone number is already registered", async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "existing" });

    await expect(signup({ email: "new@example.com", phoneNumber: "+911234567890", role: "CREATOR" }, actor)).rejects.toMatchObject({ code: "PHONE_ALREADY_REGISTERED" });
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });

  it("stores the email lower-cased and unverified, and no phone when none is given (24 Sep)", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.user.create.mockResolvedValue({ id: "u2", phoneNumber: null, email: "amit@gmail.com", emailVerifiedAt: null, name: "Amit", role: "CREATOR", whatsappVerified: false });

    const result = await signup({ email: "  Amit@Gmail.com ", name: "Amit", role: "CREATOR" }, actor);

    expect(mockPrisma.user.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ email: "amit@gmail.com", phoneNumber: null }) }));
    expect(mockPrisma.user.create.mock.calls[0][0].data.emailVerifiedAt).toBeUndefined();
    expect(result.generatedPassword).toBe("Gen3rated!Pw");
    expect(result.user).toMatchObject({ email: "amit@gmail.com", emailVerified: false, phoneNumber: null });
  });

  it("regression (24 Sep review): two admins creating the same email at once — the losing insert is a 409, not a 500", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.user.create.mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002", meta: { target: ["email"] } }));

    await expect(signup({ email: "race@gmail.com", role: "CREATOR" }, actor)).rejects.toMatchObject({ code: "EMAIL_ALREADY_REGISTERED", statusCode: 409 });
  });
});
