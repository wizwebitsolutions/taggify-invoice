import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = { plan: { findMany: vi.fn() }, user: { findUnique: vi.fn() } };
vi.mock("../../lib/prisma.js", () => ({ prisma: mockPrisma }));

const { listSavedClients } = await import("./service.js");

const plan = (over) => ({ clientName: "Nykaa", clientCompany: null, clientGstNumber: null, clientAddress: null, clientPhone: null, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  // listSavedClients (23 Sep) reads the caller's effective permissions
  // fresh from the DB — derive a plausible role from this file's id
  // fixtures (admin-*/pm-*) so existing calls work without stubbing this.
  mockPrisma.user.findUnique.mockImplementation(async ({ where }) => ({
    role: where.id?.startsWith("admin") ? "ADMIN" : where.id?.startsWith("pm") ? "PLAN_MAKER" : "CREATOR",
    permissions: null,
  }));
});

// Saved clients (user request, 21 Sep) — derived from earlier plans, newest first from the query.
describe("listSavedClients", () => {
  it("scopes to the requester's own plans, except for ADMIN — same rule as listPlans", async () => {
    mockPrisma.plan.findMany.mockResolvedValue([]);

    await listSavedClients({ id: "pm-1", role: "PLAN_MAKER" });
    expect(mockPrisma.plan.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { createdById: "pm-1" }, orderBy: { updatedAt: "desc" } }));

    await listSavedClients({ id: "admin-1", role: "ADMIN" });
    expect(mockPrisma.plan.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: {} }));
  });

  it("only ever selects the client billing columns — nothing else about the plan leaves through here", async () => {
    mockPrisma.plan.findMany.mockResolvedValue([]);
    await listSavedClients({ id: "pm-1", role: "PLAN_MAKER" });
    expect(mockPrisma.plan.findMany.mock.calls[0][0].select).toEqual({ clientName: true, clientCompany: true, clientGstNumber: true, clientAddress: true, clientPhone: true });
  });

  it("folds repeat plans for one client into a single entry, the most recently updated plan's details winning", async () => {
    mockPrisma.plan.findMany.mockResolvedValue([
      plan({ clientName: "Nykaa ", clientCompany: "FSN E-Commerce Ventures Ltd", clientGstNumber: "27AABCF1234A1Z5", clientAddress: "New address, Mumbai", clientPhone: "+919876543210" }),
      plan({ clientName: "nykaa", clientCompany: "FSN E-Commerce", clientGstNumber: "27aabcf1234a1z5", clientAddress: "Old address" }),
    ]);

    expect(await listSavedClients({ id: "a", role: "ADMIN" })).toEqual([
      { clientName: "Nykaa", clientCompany: "FSN E-Commerce Ventures Ltd", clientGstNumber: "27AABCF1234A1Z5", clientAddress: "New address, Mumbai", clientPhone: "+919876543210" },
    ]);
  });

  it("keeps one brand's different GST registrations as separate choices", async () => {
    mockPrisma.plan.findMany.mockResolvedValue([
      plan({ clientCompany: "FSN Ltd", clientGstNumber: "27AABCF1234A1Z5", clientAddress: "Mumbai" }),
      plan({ clientCompany: "FSN Ltd", clientGstNumber: "29AABCF1234A1Z1", clientAddress: "Bengaluru" }),
    ]);

    const result = await listSavedClients({ id: "a", role: "ADMIN" });
    expect(result.map((c) => c.clientGstNumber)).toEqual(["27AABCF1234A1Z5", "29AABCF1234A1Z1"]);
  });

  it("still suggests a name that has never had billing details, but drops that bare entry once the name has a detailed one", async () => {
    mockPrisma.plan.findMany.mockResolvedValue([
      plan({ clientName: "Zomato" }),
      plan({ clientName: "Nykaa" }),
      plan({ clientName: "Nykaa", clientCompany: "FSN Ltd", clientGstNumber: "27AABCF1234A1Z5", clientAddress: "Mumbai" }),
      plan({ clientName: "  " }),
    ]);

    const result = await listSavedClients({ id: "a", role: "ADMIN" });
    expect(result).toEqual([
      { clientName: "Nykaa", clientCompany: "FSN Ltd", clientGstNumber: "27AABCF1234A1Z5", clientAddress: "Mumbai", clientPhone: null },
      { clientName: "Zomato", clientCompany: null, clientGstNumber: null, clientAddress: null, clientPhone: null },
    ]);
  });

  it("treats an address-only plan as having details (not as a bare name)", async () => {
    mockPrisma.plan.findMany.mockResolvedValue([plan({ clientAddress: "Andheri East, Mumbai" }), plan({})]);
    expect(await listSavedClients({ id: "a", role: "ADMIN" })).toEqual([
      { clientName: "Nykaa", clientCompany: null, clientGstNumber: null, clientAddress: "Andheri East, Mumbai", clientPhone: null },
    ]);
  });
});
