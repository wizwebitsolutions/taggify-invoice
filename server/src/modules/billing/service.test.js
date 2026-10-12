import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  billingProfile: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn(), create: vi.fn() },
  user: { findUnique: vi.fn() },
  permissionAuditLog: { create: vi.fn() },
};
vi.mock("../../lib/prisma.js", () => ({ prisma: mockPrisma }));

const { update } = await import("./service.js");

const profile = { id: "bp-1", userId: "creator-1", pan: "ABCDE1234F", approvalStatus: "approved" };

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.billingProfile.findUnique.mockImplementation(async ({ where }) => (where.id === "bp-1" ? profile : null));
  mockPrisma.billingProfile.update.mockImplementation(async ({ data }) => ({ ...profile, ...data }));
});

// User request, 22 Sep — admin "can edit billing details for any profile".
describe("update — who may edit a billing profile, and what it does to approval", () => {
  it("an Admin edits anyone's profile and the approval status is left alone", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ role: "ADMIN", permissions: null });

    await update("bp-1", { id: "admin-1", role: "ADMIN" }, { name: "New Name", gstin: "" });

    const { data } = mockPrisma.billingProfile.update.mock.calls[0][0];
    expect(data).toEqual({ name: "New Name", gstin: null });
    // 12 Oct: an edit on someone else's profile is audit-logged, changed fields only.
    expect(mockPrisma.permissionAuditLog.create).toHaveBeenCalledWith({
      data: { targetId: "creator-1", actorId: "admin-1", action: "billing_profile_update", before: { billingProfileId: "bp-1", name: undefined, gstin: undefined }, after: { billingProfileId: "bp-1", name: "New Name", gstin: null } },
    });
  });

  it("the owner edits their own profile, which goes back to pending", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ role: "CREATOR", permissions: null });

    await update("bp-1", { id: "creator-1", role: "CREATOR" }, { bankAccountNumber: "123456789" });

    expect(mockPrisma.billingProfile.update.mock.calls[0][0].data).toEqual({ bankAccountNumber: "123456789", approvalStatus: "pending" });
    // The owner's own edit isn't an admin action — no audit row.
    expect(mockPrisma.permissionAuditLog.create).not.toHaveBeenCalled();
  });

  it("another creator is refused, even with a stored finance grant (regression (24 Sep — own-scope roles never get global access)); a FINANCE account is allowed", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ role: "CREATOR", permissions: null });
    await expect(update("bp-1", { id: "creator-2", role: "CREATOR" }, { name: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });

    mockPrisma.user.findUnique.mockResolvedValue({ role: "TEAM_MEMBER", permissions: { "finance.manage": true } });
    await expect(update("bp-1", { id: "tm-1", role: "TEAM_MEMBER" }, { name: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });

    mockPrisma.user.findUnique.mockResolvedValue({ role: "FINANCE", permissions: null });
    await expect(update("bp-1", { id: "fin-1", role: "FINANCE" }, { name: "x" })).resolves.toBeTruthy();
  });

  it("a PAN already on another profile is refused; keeping the same PAN is fine", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ role: "ADMIN", permissions: null });
    mockPrisma.billingProfile.findUnique.mockImplementation(async ({ where }) => (where.id === "bp-1" ? profile : where.pan === "ZZZZZ9999Z" ? { id: "bp-other" } : null));

    await expect(update("bp-1", { id: "admin-1", role: "ADMIN" }, { pan: "ZZZZZ9999Z" })).rejects.toMatchObject({ code: "PAN_ALREADY_REGISTERED" });
    await expect(update("bp-1", { id: "admin-1", role: "ADMIN" }, { pan: "ABCDE1234F" })).resolves.toBeTruthy();
  });

  it("404s for a profile that doesn't exist", async () => {
    await expect(update("nope", { id: "admin-1", role: "ADMIN" }, { name: "x" })).rejects.toMatchObject({ code: "BILLING_PROFILE_NOT_FOUND" });
  });
});
