import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApiError } from "../../middleware/errorHandler.js";

const mockPrisma = {
  user: { findUnique: vi.fn(), update: vi.fn() },
  refreshToken: { updateMany: vi.fn() },
  $transaction: vi.fn(async (ops) => Promise.all(ops)),
};
vi.mock("../../lib/prisma.js", () => ({ prisma: mockPrisma }));

const { resetUserPassword } = await import("./service.js");

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
