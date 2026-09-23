import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  emailOtp: { findFirst: vi.fn(), deleteMany: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), delete: vi.fn() },
};
vi.mock("../prisma.js", () => ({ prisma: mockPrisma }));

const sendOtpEmail = vi.fn();
vi.mock("../mailer.js", () => ({ sendOtpEmail }));

const { issueOtp, consumeOtp, OTP_MAX_ATTEMPTS } = await import("./emailOtp.js");
const { hashToken } = await import("./jwt.js");

const hashFor = (userId, code) => hashToken(`${userId}:${code}`);
const liveOtp = (over = {}) => ({
  id: "otp-1",
  userId: "u1",
  purpose: "LOGIN",
  email: "a@gmail.com",
  codeHash: hashFor("u1", "123456"),
  expiresAt: new Date(Date.now() + 60_000),
  attempts: 0,
  consumedAt: null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.emailOtp.create.mockResolvedValue({ id: "otp-new" });
  mockPrisma.emailOtp.delete.mockResolvedValue({});
});

describe("issueOtp", () => {
  it("stores only a hash of a 6-digit code, replaces any previous code, and emails the plaintext", async () => {
    mockPrisma.emailOtp.findFirst.mockResolvedValue(null);

    await issueOtp({ userId: "u1", purpose: "LOGIN", email: "a@gmail.com" });

    const { code, to } = sendOtpEmail.mock.calls[0][0];
    expect(code).toMatch(/^\d{6}$/);
    expect(to).toBe("a@gmail.com");
    expect(mockPrisma.emailOtp.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1", purpose: "LOGIN" } });
    const stored = mockPrisma.emailOtp.create.mock.calls[0][0].data;
    expect(stored.codeHash).toBe(hashFor("u1", code));
    expect(JSON.stringify(stored)).not.toContain(code);
  });

  it("refuses a resend inside the cooldown, without sending anything", async () => {
    mockPrisma.emailOtp.findFirst.mockResolvedValue({ email: "a@gmail.com", createdAt: new Date(Date.now() - 5_000) });

    await expect(issueOtp({ userId: "u1", purpose: "LOGIN", email: "a@gmail.com" })).rejects.toMatchObject({ code: "OTP_RESEND_TOO_SOON", statusCode: 429 });
    expect(sendOtpEmail).not.toHaveBeenCalled();
    expect(mockPrisma.emailOtp.create).not.toHaveBeenCalled();
  });

  it("the cooldown is per inbox — correcting a mistyped address sends straight away", async () => {
    mockPrisma.emailOtp.findFirst.mockResolvedValue({ email: "typo@gmial.com", createdAt: new Date(Date.now() - 5_000) });

    await issueOtp({ userId: "u1", purpose: "VERIFY_EMAIL", email: "right@gmail.com" });

    expect(sendOtpEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "right@gmail.com" }));
  });

  it("a send that fails leaves no code behind, so the retry is not blocked by a cooldown for mail that never arrived", async () => {
    mockPrisma.emailOtp.findFirst.mockResolvedValue(null);
    sendOtpEmail.mockRejectedValueOnce(Object.assign(new Error("resend down"), { code: "EMAIL_SEND_FAILED" }));

    await expect(issueOtp({ userId: "u1", purpose: "LOGIN", email: "a@gmail.com" })).rejects.toMatchObject({ code: "EMAIL_SEND_FAILED" });
    expect(mockPrisma.emailOtp.delete).toHaveBeenCalledWith({ where: { id: "otp-new" } });
  });
});

describe("consumeOtp", () => {
  it("accepts the right code once and marks it consumed", async () => {
    mockPrisma.emailOtp.findFirst.mockResolvedValue(liveOtp());
    mockPrisma.emailOtp.updateMany.mockResolvedValue({ count: 1 });

    const otp = await consumeOtp({ userId: "u1", purpose: "LOGIN", code: "123456" });

    expect(otp.email).toBe("a@gmail.com");
    expect(mockPrisma.emailOtp.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "otp-1", consumedAt: null } }));
  });

  it("counts a wrong code as an attempt and says how many are left", async () => {
    mockPrisma.emailOtp.findFirst.mockResolvedValue(liveOtp());
    mockPrisma.emailOtp.update.mockResolvedValue({ attempts: 1 });

    await expect(consumeOtp({ userId: "u1", purpose: "LOGIN", code: "000000" })).rejects.toMatchObject({
      code: "OTP_INVALID",
      message: expect.stringContaining(`${OTP_MAX_ATTEMPTS - 1} attempts left`),
    });
    expect(mockPrisma.emailOtp.update).toHaveBeenCalledWith({ where: { id: "otp-1" }, data: { attempts: { increment: 1 } } });
    expect(mockPrisma.emailOtp.updateMany).not.toHaveBeenCalled();
  });

  it("burns the code on the last wrong attempt — even the right code is refused afterwards", async () => {
    mockPrisma.emailOtp.findFirst.mockResolvedValue(liveOtp({ attempts: OTP_MAX_ATTEMPTS - 1 }));
    mockPrisma.emailOtp.update.mockResolvedValue({ attempts: OTP_MAX_ATTEMPTS });
    await expect(consumeOtp({ userId: "u1", purpose: "LOGIN", code: "000000" })).rejects.toMatchObject({ code: "OTP_EXPIRED" });

    mockPrisma.emailOtp.findFirst.mockResolvedValue(liveOtp({ attempts: OTP_MAX_ATTEMPTS }));
    await expect(consumeOtp({ userId: "u1", purpose: "LOGIN", code: "123456" })).rejects.toMatchObject({ code: "OTP_EXPIRED" });
  });

  it("refuses an expired code and a missing code", async () => {
    mockPrisma.emailOtp.findFirst.mockResolvedValue(liveOtp({ expiresAt: new Date(Date.now() - 1) }));
    await expect(consumeOtp({ userId: "u1", purpose: "LOGIN", code: "123456" })).rejects.toMatchObject({ code: "OTP_EXPIRED" });

    mockPrisma.emailOtp.findFirst.mockResolvedValue(null);
    await expect(consumeOtp({ userId: "u1", purpose: "LOGIN", code: "123456" })).rejects.toMatchObject({ code: "OTP_EXPIRED" });
  });

  it("refuses when a parallel submit already consumed the code", async () => {
    mockPrisma.emailOtp.findFirst.mockResolvedValue(liveOtp());
    mockPrisma.emailOtp.updateMany.mockResolvedValue({ count: 0 });
    await expect(consumeOtp({ userId: "u1", purpose: "LOGIN", code: "123456" })).rejects.toMatchObject({ code: "OTP_EXPIRED" });
  });
});
