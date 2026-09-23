import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = { user: { findUnique: vi.fn(), update: vi.fn() } };
vi.mock("../../lib/prisma.js", () => ({ prisma: mockPrisma }));

const { updateProfile } = await import("./service.js");

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
