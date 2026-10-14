import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = { user: { findUnique: vi.fn(), update: vi.fn() }, teamMembership: { findMany: vi.fn(), upsert: vi.fn() } };
vi.mock("../../lib/prisma.js", () => ({ prisma: mockPrisma }));

const { updateProfile, listTeamMembers, addTeamMember } = await import("./service.js");

beforeEach(() => vi.clearAllMocks());

// Email 2FA (21 Sep): a verified email is the login identifier and where
// OTPs go — the ordinary profile save must not be a way around verification.
describe("updateProfile — verified login email", () => {
  it("refuses to change a verified email, and writes nothing", async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce({ email: "mine@gmail.com", emailVerifiedAt: new Date() });

    await expect(updateProfile("u1", { name: "N", email: "attacker@gmail.com" })).rejects.toMatchObject({ code: "EMAIL_LOCKED", statusCode: 409 });
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it("allows a save that re-sends the same verified email (any case) alongside other fields", async () => {
    mockPrisma.user.findUnique
      .mockResolvedValueOnce({ email: "mine@gmail.com", emailVerifiedAt: new Date() })
      .mockResolvedValueOnce({ id: "u1", email: "mine@gmail.com" });
    mockPrisma.user.update.mockResolvedValue({ id: "u1" });

    await updateProfile("u1", { name: "New Name", email: "Mine@Gmail.com" });

    expect(mockPrisma.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: { name: "New Name", email: "mine@gmail.com" } }));
  });

  it("an unverified account can still edit its profile email (stored lower-cased), but not onto another account's", async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce({ email: null, emailVerifiedAt: null }).mockResolvedValueOnce(null);
    mockPrisma.user.update.mockResolvedValue({ id: "u1" });
    await updateProfile("u1", { email: "Me@Gmail.com" });
    expect(mockPrisma.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: { email: "me@gmail.com" } }));

    mockPrisma.user.findUnique.mockResolvedValueOnce({ email: null, emailVerifiedAt: null }).mockResolvedValueOnce({ id: "someone-else" });
    await expect(updateProfile("u1", { email: "taken@gmail.com" })).rejects.toMatchObject({ code: "EMAIL_ALREADY_REGISTERED" });
  });

  it("a save with no email doesn't do the extra lookups", async () => {
    mockPrisma.user.update.mockResolvedValue({ id: "u1" });
    await updateProfile("u1", { name: "Only Name" });
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
  });
});

// My team (12 Oct): rows carry the member's name and email — and nothing else about them.
describe("team members", () => {
  const INCLUDE = { user: { select: { id: true, name: true, email: true } } };

  it("lists the creator's own team with each member's name and email", async () => {
    mockPrisma.teamMembership.findMany.mockResolvedValue([]);
    await listTeamMembers("cr-1");
    expect(mockPrisma.teamMembership.findMany).toHaveBeenCalledWith({ where: { creatorId: "cr-1" }, include: INCLUDE, orderBy: { createdAt: "asc" } });
  });

  it("adding a member returns the row with who they are", async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce({ id: "tm-1", role: "TEAM_MEMBER" });
    mockPrisma.teamMembership.upsert.mockResolvedValue({ id: "m1" });
    await addTeamMember("cr-1", { userId: "tm-1", canSeeMoney: true });
    expect(mockPrisma.teamMembership.upsert).toHaveBeenCalledWith(expect.objectContaining({ include: INCLUDE }));
  });

  it("refuses an id that isn't a team member account", async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce({ id: "x", role: "CREATOR" });
    await expect(addTeamMember("cr-1", { userId: "x", canSeeMoney: false })).rejects.toMatchObject({ code: "INVALID_TEAM_MEMBER" });
    expect(mockPrisma.teamMembership.upsert).not.toHaveBeenCalled();
  });
});
