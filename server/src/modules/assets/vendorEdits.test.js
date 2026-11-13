import { describe, it, expect, vi, beforeEach } from "vitest";

// Vendor contact edits from Inventory (13 Nov): admin edits directly, a plan
// maker's change waits as pendingVendorEdit until it's approved or discarded.
let vendor;
const mockPrisma = {
  user: {
    findUnique: vi.fn(async ({ where }) => {
      if (where.id) return where.id === vendor?.id ? { ...vendor } : null;
      if (where.phoneNumber) return where.phoneNumber === "+919999999999" ? { id: "someone-else" } : null;
      return null;
    }),
    update: vi.fn(async ({ data }) => ({ ...vendor, ...data })),
  },
  permissionAuditLog: { create: vi.fn(async ({ data }) => data) },
  asset: { count: vi.fn(async () => 2) },
  $transaction: vi.fn(async (arr) => Promise.all(arr)),
};
vi.mock("../../lib/prisma.js", () => ({ prisma: mockPrisma }));

const { editVendor, proposeVendorEdit, decideVendorEdit } = await import("./vendorEdits.js");

const admin = { id: "admin-1", role: "ADMIN" };
const planner = { id: "pm-1", role: "PLAN_MAKER" };

beforeEach(() => {
  vi.clearAllMocks();
  vendor = { id: "v-1", role: "CREATOR", name: "Riya", phoneNumber: "+911111111111", secondaryPhone: null, pendingVendorEdit: null, pendingVendorEditById: null, pendingVendorEditAt: null };
});

describe("editVendor (admin, direct)", () => {
  it("writes only the changed fields and audit-logs them", async () => {
    const out = await editVendor(admin, "v-1", { name: "Riya Kapoor", phoneNumber: "+911111111111", secondaryPhone: "+912222222222" });
    expect(mockPrisma.user.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "v-1" }, data: { name: "Riya Kapoor", secondaryPhone: "+912222222222" } }));
    expect(mockPrisma.permissionAuditLog.create).toHaveBeenCalledWith({
      data: { targetId: "v-1", actorId: "admin-1", action: "vendor_details_change", before: { name: "Riya", secondaryPhone: null }, after: { name: "Riya Kapoor", secondaryPhone: "+912222222222" } },
    });
    expect(out.name).toBe("Riya Kapoor");
  });

  it("nothing changed → no write", async () => {
    await editVendor(admin, "v-1", { name: "Riya" });
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it("refuses a phone another account already has", async () => {
    await expect(editVendor(admin, "v-1", { phoneNumber: "+919999999999" })).rejects.toMatchObject({ statusCode: 409, code: "PHONE_ALREADY_REGISTERED" });
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it("only edits vendor (creator) accounts, never staff", async () => {
    vendor = { ...vendor, role: "ADMIN" };
    await expect(editVendor(admin, "v-1", { name: "x" })).rejects.toMatchObject({ statusCode: 404, code: "VENDOR_NOT_FOUND" });
  });
});

describe("proposeVendorEdit (plan maker)", () => {
  it("parks the change without touching the live fields", async () => {
    await proposeVendorEdit(planner, "v-1", { phoneNumber: "+913333333333", name: "Riya" });
    const { data } = mockPrisma.user.update.mock.calls[0][0];
    expect(data.pendingVendorEdit).toEqual({ phoneNumber: "+913333333333" });
    expect(data.pendingVendorEditById).toBe("pm-1");
    expect(data).not.toHaveProperty("phoneNumber");
    expect(mockPrisma.permissionAuditLog.create).not.toHaveBeenCalled();
  });

  it("an admin is told to edit directly; other roles are refused", async () => {
    await expect(proposeVendorEdit(admin, "v-1", { name: "x" })).rejects.toMatchObject({ statusCode: 400, code: "USE_DIRECT_EDIT" });
    await expect(proposeVendorEdit({ id: "fin-1", role: "FINANCE" }, "v-1", { name: "x" })).rejects.toMatchObject({ statusCode: 403 });
  });

  it("a vendor with no pages can't be suggested for (Approvals would never show it)", async () => {
    mockPrisma.asset.count.mockResolvedValueOnce(0);
    await expect(proposeVendorEdit(planner, "v-1", { name: "x" })).rejects.toMatchObject({ statusCode: 404 });
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it("a suggestion that changes nothing is refused", async () => {
    await expect(proposeVendorEdit(planner, "v-1", { name: "Riya" })).rejects.toMatchObject({ statusCode: 400, code: "NOTHING_TO_CHANGE" });
  });
});

describe("decideVendorEdit", () => {
  beforeEach(() => {
    vendor = { ...vendor, pendingVendorEdit: { name: "Riya K", phoneNumber: "+913333333333" }, pendingVendorEditById: "pm-1", pendingVendorEditAt: new Date() };
  });

  it("approve applies the change, clears it and logs the approver", async () => {
    await decideVendorEdit(admin, "v-1", "approve");
    const { data } = mockPrisma.user.update.mock.calls[0][0];
    expect(data).toMatchObject({ name: "Riya K", phoneNumber: "+913333333333", pendingVendorEdit: null, pendingVendorEditById: null, pendingVendorEditAt: null });
    expect(mockPrisma.permissionAuditLog.create.mock.calls[0][0].data).toMatchObject({ actorId: "admin-1", action: "vendor_details_change", after: { name: "Riya K", suggestedById: "pm-1" } });
  });

  it("reject only clears the suggestion", async () => {
    await decideVendorEdit(admin, "v-1", "reject");
    expect(mockPrisma.user.update.mock.calls[0][0].data).toEqual({ pendingVendorEdit: null, pendingVendorEditById: null, pendingVendorEditAt: null });
    expect(mockPrisma.permissionAuditLog.create).not.toHaveBeenCalled();
  });

  it("nothing waiting → 400", async () => {
    vendor = { ...vendor, pendingVendorEdit: null };
    await expect(decideVendorEdit(admin, "v-1", "approve")).rejects.toMatchObject({ statusCode: 400, code: "NO_PENDING_EDIT" });
  });
});
