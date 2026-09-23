import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  trustedDevice: { create: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
};
vi.mock("../prisma.js", () => ({ prisma: mockPrisma }));

const { issueTrustedDevice, verifyTrustedDevice, revokeTrustedDevices, TRUSTED_DEVICE_DAYS } = await import("./trustedDevice.js");
const { hashToken } = await import("./jwt.js");

beforeEach(() => vi.clearAllMocks());

describe("issueTrustedDevice — 'skip OTP for 7 days' (23 Sep)", () => {
  it("stores only the hash of a fresh random token, with a ~7-day expiry, and returns the raw token", async () => {
    mockPrisma.trustedDevice.create.mockResolvedValue({});

    const token = await issueTrustedDevice("u1");

    expect(token).toMatch(/^[0-9a-f]{64}$/);
    const { data } = mockPrisma.trustedDevice.create.mock.calls[0][0];
    expect(data.userId).toBe("u1");
    expect(data.tokenHash).toBe(hashToken(token));
    expect(data.tokenHash).not.toBe(token);
    const daysOut = (data.expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(daysOut).toBeGreaterThan(TRUSTED_DEVICE_DAYS - 0.01);
    expect(daysOut).toBeLessThanOrEqual(TRUSTED_DEVICE_DAYS);
  });

  it("two calls mint two different tokens (no reuse across devices/logins)", async () => {
    mockPrisma.trustedDevice.create.mockResolvedValue({});
    const a = await issueTrustedDevice("u1");
    const b = await issueTrustedDevice("u1");
    expect(a).not.toBe(b);
  });
});

describe("verifyTrustedDevice", () => {
  const row = (over = {}) => ({ id: "td-1", userId: "u1", expiresAt: new Date(Date.now() + 60_000), revokedAt: null, ...over });

  it("is true for a live token issued to this exact user", async () => {
    mockPrisma.trustedDevice.findUnique.mockResolvedValue(row());
    await expect(verifyTrustedDevice("u1", "raw-token")).resolves.toBe(true);
    expect(mockPrisma.trustedDevice.findUnique).toHaveBeenCalledWith({ where: { tokenHash: hashToken("raw-token") } });
  });

  it("is false with no token at all — never even queries the DB", async () => {
    await expect(verifyTrustedDevice("u1", undefined)).resolves.toBe(false);
    await expect(verifyTrustedDevice("u1", "")).resolves.toBe(false);
    expect(mockPrisma.trustedDevice.findUnique).not.toHaveBeenCalled();
  });

  it("is false for an unknown token, a different user's token, an expired one, or a revoked one", async () => {
    mockPrisma.trustedDevice.findUnique.mockResolvedValue(null);
    await expect(verifyTrustedDevice("u1", "raw")).resolves.toBe(false);

    mockPrisma.trustedDevice.findUnique.mockResolvedValue(row({ userId: "someone-else" }));
    await expect(verifyTrustedDevice("u1", "raw")).resolves.toBe(false);

    mockPrisma.trustedDevice.findUnique.mockResolvedValue(row({ expiresAt: new Date(Date.now() - 1000) }));
    await expect(verifyTrustedDevice("u1", "raw")).resolves.toBe(false);

    mockPrisma.trustedDevice.findUnique.mockResolvedValue(row({ revokedAt: new Date() }));
    await expect(verifyTrustedDevice("u1", "raw")).resolves.toBe(false);
  });

  it("never throws on a garbled/unknown token — just reports untrusted", async () => {
    mockPrisma.trustedDevice.findUnique.mockResolvedValue(null);
    await expect(verifyTrustedDevice("u1", "not-a-real-token")).resolves.toBe(false);
  });
});

describe("revokeTrustedDevices — password change ends every device's OTP-skip (23 Sep)", () => {
  it("marks every live row for this user revoked, and only this user's", async () => {
    mockPrisma.trustedDevice.updateMany.mockResolvedValue({ count: 2 });
    await revokeTrustedDevices("u1");
    expect(mockPrisma.trustedDevice.updateMany).toHaveBeenCalledWith({
      where: { userId: "u1", revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });
});
