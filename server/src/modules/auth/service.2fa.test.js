import { describe, it, expect, vi, beforeEach } from "vitest";

// jwt.js reads its secrets at import time — real tokens here, so the
// challenge-token purpose checks are exercised for real, not mocked away.
process.env.JWT_ACCESS_SECRET = "test-access-secret";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret";

const mockPrisma = {
  user: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  refreshToken: { create: vi.fn(), updateMany: vi.fn() },
  $transaction: vi.fn(async (fn) => fn(mockPrisma)),
};
vi.mock("../../lib/prisma.js", () => ({ prisma: mockPrisma }));
vi.mock("bcryptjs", () => ({ default: { compare: vi.fn(async (pw) => pw === "right-password"), hash: vi.fn() } }));

const issueOtp = vi.fn();
const consumeOtp = vi.fn();
vi.mock("../../lib/auth/emailOtp.js", () => ({ issueOtp, consumeOtp }));

// "Skip OTP for 7 days" (23 Sep) — mocked like issueOtp/consumeOtp above,
// so these tests check service.js's own orchestration (when is a device
// trusted, when is a fresh one minted, when is trust revoked) rather than
// trustedDevice.js's own hashing/expiry logic (covered by its own unit
// tests, lib/auth/trustedDevice.test.js).
const issueTrustedDevice = vi.fn();
const verifyTrustedDevice = vi.fn();
const revokeTrustedDevices = vi.fn();
vi.mock("../../lib/auth/trustedDevice.js", () => ({ issueTrustedDevice, verifyTrustedDevice, revokeTrustedDevices }));

const { login, verifyLoginOtp, resendLoginOtp, startEmailVerification, confirmEmailVerification, changePassword, MAX_UNVERIFIED_LOGINS } = await import("./service.js");
const { signChallengeToken, verifyAccessToken, signAccessToken } = await import("../../lib/auth/jwt.js");

const PHONE = "+919876543210";
const unverified = (over = {}) => ({ id: "u1", phoneNumber: PHONE, role: "CREATOR", name: "C", passwordHash: "h", email: null, emailVerifiedAt: null, unverifiedLoginCount: 0, ...over });
const verified = (over = {}) => unverified({ email: "creator@gmail.com", emailVerifiedAt: new Date(), ...over });

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.$transaction.mockImplementation(async (fn) => fn(mockPrisma));
  // Untrusted by default — every pre-existing test below exercises the
  // "no trusted device" path unless it opts in with mockResolvedValueOnce.
  verifyTrustedDevice.mockResolvedValue(false);
  issueTrustedDevice.mockResolvedValue("new-trusted-device-token");
});

describe("login — unverified account (phone number)", () => {
  it("gives a normal session for the first logins, counting each one", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(unverified());
    mockPrisma.user.updateMany.mockResolvedValue({ count: 1 });

    const result = await login({ phoneNumber: PHONE, password: "right-password" });

    expect(result.step).toBe("AUTHENTICATED");
    expect(result.accessToken).toBeTruthy();
    expect(result.user.emailVerified).toBe(false);
    expect(result.unverifiedLoginsLeft).toBe(MAX_UNVERIFIED_LOGINS - 1);
    // Conditional on the allowance still being open — see the race test below.
    expect(mockPrisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: "u1", emailVerifiedAt: null, unverifiedLoginCount: { lt: MAX_UNVERIFIED_LOGINS } },
      data: { unverifiedLoginCount: { increment: 1 } },
    });
    expect(issueOtp).not.toHaveBeenCalled();
  });

  it("parallel logins can't both take the last allowed login — the loser of the race is locked out", async () => {
    // This request read "1 used", but by the time it writes, another request has taken the last slot.
    mockPrisma.user.findUnique.mockResolvedValue(unverified({ unverifiedLoginCount: MAX_UNVERIFIED_LOGINS - 1 }));
    mockPrisma.user.updateMany.mockResolvedValue({ count: 0 });

    const result = await login({ phoneNumber: PHONE, password: "right-password" });

    expect(result.step).toBe("EMAIL_VERIFICATION_REQUIRED");
    expect(result.accessToken).toBeUndefined();
    expect(mockPrisma.refreshToken.create).not.toHaveBeenCalled();
  });

  it("stops issuing sessions once the allowance is used — email verification is the only way in", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(unverified({ unverifiedLoginCount: MAX_UNVERIFIED_LOGINS }));
    mockPrisma.user.updateMany.mockResolvedValue({ count: 0 });

    const result = await login({ phoneNumber: PHONE, password: "right-password" });

    expect(result.step).toBe("EMAIL_VERIFICATION_REQUIRED");
    expect(result.challengeToken).toBeTruthy();
    expect(result.accessToken).toBeUndefined();
    expect(result.refreshToken).toBeUndefined();
    expect(mockPrisma.refreshToken.create).not.toHaveBeenCalled();
  });

  it("doesn't spend a login or reveal lock-out state on a wrong password", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(unverified({ unverifiedLoginCount: MAX_UNVERIFIED_LOGINS }));
    await expect(login({ phoneNumber: PHONE, password: "nope" })).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    expect(mockPrisma.user.updateMany).not.toHaveBeenCalled();
  });

  it("won't accept an unverified profile email as a login identifier", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(unverified({ email: "typed-in-profile@gmail.com" }));
    await expect(login({ email: "typed-in-profile@gmail.com", password: "right-password" })).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
  });
});

describe("login — verified account (email + OTP)", () => {
  it("emails a code and returns a challenge, never a session, after the password step", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(verified());

    const result = await login({ email: "  Creator@Gmail.com ", password: "right-password" });

    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({ where: { email: "creator@gmail.com" } });
    expect(issueOtp).toHaveBeenCalledWith({ userId: "u1", purpose: "LOGIN", email: "creator@gmail.com" });
    expect(result).toMatchObject({ step: "OTP_REQUIRED", emailHint: "cr***@gmail.com" });
    expect(result.accessToken).toBeUndefined();
    expect(mockPrisma.refreshToken.create).not.toHaveBeenCalled();
  });

  it("signing in again inside the resend cooldown still reaches the OTP step (the earlier code is still live) instead of a 429", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(verified());
    issueOtp.mockRejectedValueOnce(Object.assign(new Error("wait"), { code: "OTP_RESEND_TOO_SOON" }));

    const result = await login({ email: "creator@gmail.com", password: "right-password" });

    expect(result.step).toBe("OTP_REQUIRED");
    expect(result.challengeToken).toBeTruthy();
  });

  it("…but a failed send is a failed login step, not a challenge for a code that was never delivered", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(verified());
    issueOtp.mockRejectedValueOnce(Object.assign(new Error("resend down"), { code: "EMAIL_SEND_FAILED" }));

    await expect(login({ email: "creator@gmail.com", password: "right-password" })).rejects.toMatchObject({ code: "EMAIL_SEND_FAILED" });
  });

  it("no longer accepts the phone number once an email is verified", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(verified());
    await expect(login({ phoneNumber: PHONE, password: "right-password" })).rejects.toMatchObject({ code: "USE_EMAIL_LOGIN" });
    expect(issueOtp).not.toHaveBeenCalled();
  });

  it("sends no code on a wrong password", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(verified());
    await expect(login({ email: "creator@gmail.com", password: "nope" })).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    expect(issueOtp).not.toHaveBeenCalled();
  });

  it("verifyLoginOtp turns challenge + correct code into a session", async () => {
    const user = verified();
    mockPrisma.user.findUnique.mockResolvedValue(user);
    consumeOtp.mockResolvedValue({ email: user.email });

    const result = await verifyLoginOtp({ challengeToken: signChallengeToken(user, "login-otp"), code: "123456" });

    expect(consumeOtp).toHaveBeenCalledWith({ userId: "u1", purpose: "LOGIN", code: "123456" });
    expect(result.step).toBe("AUTHENTICATED");
    expect(result.user.emailVerified).toBe(true);
    expect(mockPrisma.refreshToken.create).toHaveBeenCalledTimes(1);
  });

  it("verifyLoginOtp issues nothing when the code is wrong", async () => {
    const user = verified();
    mockPrisma.user.findUnique.mockResolvedValue(user);
    consumeOtp.mockRejectedValue(Object.assign(new Error("bad"), { code: "OTP_INVALID" }));

    await expect(verifyLoginOtp({ challengeToken: signChallengeToken(user, "login-otp"), code: "000000" })).rejects.toMatchObject({ code: "OTP_INVALID" });
    expect(mockPrisma.refreshToken.create).not.toHaveBeenCalled();
    expect(issueTrustedDevice).not.toHaveBeenCalled();
  });
});

describe("login — trusted device (user decision, 23 Sep: 'skip OTP for 7 days')", () => {
  it("a browser with a live trusted-device token goes straight to AUTHENTICATED — no OTP emailed", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(verified());
    verifyTrustedDevice.mockResolvedValue(true);

    const result = await login({ email: "creator@gmail.com", password: "right-password", trustedDeviceToken: "cookie-value" });

    expect(verifyTrustedDevice).toHaveBeenCalledWith("u1", "cookie-value");
    expect(result.step).toBe("AUTHENTICATED");
    expect(result.accessToken).toBeTruthy();
    expect(mockPrisma.refreshToken.create).toHaveBeenCalledTimes(1);
    expect(issueOtp).not.toHaveBeenCalled();
  });

  it("still checks the password first — a valid trusted-device token doesn't save a wrong password", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(verified());
    verifyTrustedDevice.mockResolvedValue(true);

    await expect(login({ email: "creator@gmail.com", password: "nope", trustedDeviceToken: "cookie-value" })).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    expect(verifyTrustedDevice).not.toHaveBeenCalled();
    expect(mockPrisma.refreshToken.create).not.toHaveBeenCalled();
  });

  it("a missing, unknown, expired, or revoked trusted-device token falls back to the normal OTP step, not an error", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(verified());
    verifyTrustedDevice.mockResolvedValue(false);

    const result = await login({ email: "creator@gmail.com", password: "right-password" });

    expect(result.step).toBe("OTP_REQUIRED");
    expect(issueOtp).toHaveBeenCalledWith({ userId: "u1", purpose: "LOGIN", email: "creator@gmail.com" });
  });

  it("an unverified (phone-login) account never consults device trust at all", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(unverified());
    mockPrisma.user.updateMany.mockResolvedValue({ count: 1 });

    await login({ phoneNumber: PHONE, password: "right-password", trustedDeviceToken: "cookie-value" });

    expect(verifyTrustedDevice).not.toHaveBeenCalled();
  });

  it("verifyLoginOtp mints a new trusted-device token for this browser alongside the session (remember defaults true)", async () => {
    const user = verified();
    mockPrisma.user.findUnique.mockResolvedValue(user);
    consumeOtp.mockResolvedValue({ email: user.email });
    issueTrustedDevice.mockResolvedValue("freshly-issued-token");

    const result = await verifyLoginOtp({ challengeToken: signChallengeToken(user, "login-otp"), code: "123456" });

    expect(issueTrustedDevice).toHaveBeenCalledWith("u1");
    expect(result.trustedDeviceToken).toBe("freshly-issued-token");
  });

  it("'Remember this device' unchecked (remember: false) still signs in, but mints no trust token", async () => {
    const user = verified();
    mockPrisma.user.findUnique.mockResolvedValue(user);
    consumeOtp.mockResolvedValue({ email: user.email });

    const result = await verifyLoginOtp({ challengeToken: signChallengeToken(user, "login-otp"), code: "123456", remember: false });

    expect(result.step).toBe("AUTHENTICATED");
    expect(result.accessToken).toBeTruthy();
    expect(result.trustedDeviceToken).toBeUndefined();
    expect(issueTrustedDevice).not.toHaveBeenCalled();
  });
});

describe("changePassword — revokes trust everywhere, same as sessions (23 Sep)", () => {
  it("revokes every trusted device alongside every refresh token", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(verified());
    mockPrisma.user.update.mockResolvedValue({});
    mockPrisma.$transaction.mockResolvedValue(undefined); // array form: [user.update(...), refreshToken.updateMany(...)]

    await changePassword("u1", { currentPassword: "right-password", newPassword: "new-password" });

    expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith({ where: { userId: "u1", revoked: false }, data: { revoked: true } });
    expect(revokeTrustedDevices).toHaveBeenCalledWith("u1");
  });

  it("a wrong current password revokes nothing", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(verified());

    await expect(changePassword("u1", { currentPassword: "nope", newPassword: "new-password" })).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });

    expect(mockPrisma.refreshToken.updateMany).not.toHaveBeenCalled();
    expect(revokeTrustedDevices).not.toHaveBeenCalled();
  });
});

describe("challenge tokens can't be used as anything else", () => {
  it("an email-setup challenge can't redeem a login OTP, nor the reverse", async () => {
    const user = verified();
    mockPrisma.user.findUnique.mockResolvedValue(user);

    await expect(verifyLoginOtp({ challengeToken: signChallengeToken(user, "email-setup"), code: "123456" })).rejects.toMatchObject({ code: "INVALID_CHALLENGE" });
    await expect(resendLoginOtp({ challengeToken: signChallengeToken(user, "email-setup") })).rejects.toMatchObject({ code: "INVALID_CHALLENGE" });
    await expect(startEmailVerification({ challengeToken: signChallengeToken(user, "login-otp"), email: "x@gmail.com" })).rejects.toMatchObject({ code: "INVALID_CHALLENGE" });
    expect(consumeOtp).not.toHaveBeenCalled();
  });

  it("a real access token isn't a challenge, and a challenge isn't an access token (requireAuth must reject it)", async () => {
    const user = verified();
    await expect(verifyLoginOtp({ challengeToken: signAccessToken(user), code: "123456" })).rejects.toMatchObject({ code: "INVALID_CHALLENGE" });
    expect(() => verifyAccessToken(signChallengeToken(user, "login-otp"))).toThrow();
    expect(verifyAccessToken(signAccessToken(user)).sub).toBe("u1");
  });
});

describe("email verification", () => {
  it("start: sends a VERIFY_EMAIL code to the normalized address (locked-out path, via challenge)", async () => {
    const user = unverified({ unverifiedLoginCount: 2 });
    mockPrisma.user.findUnique.mockResolvedValueOnce(user).mockResolvedValueOnce(null);

    const result = await startEmailVerification({ challengeToken: signChallengeToken(user, "email-setup"), email: " New@Gmail.com" });

    expect(issueOtp).toHaveBeenCalledWith({ userId: "u1", purpose: "VERIFY_EMAIL", email: "new@gmail.com" });
    expect(result.emailHint).toBe("ne***@gmail.com");
  });

  it("start: refuses an email another account has already verified, but not one merely typed into a profile", async () => {
    const user = unverified();
    mockPrisma.user.findUnique.mockResolvedValueOnce(user).mockResolvedValueOnce(verified({ id: "other" }));
    await expect(startEmailVerification({ userId: "u1", email: "creator@gmail.com" })).rejects.toMatchObject({ code: "EMAIL_ALREADY_REGISTERED" });
    expect(issueOtp).not.toHaveBeenCalled();

    mockPrisma.user.findUnique.mockResolvedValueOnce(user).mockResolvedValueOnce(unverified({ id: "other", email: "creator@gmail.com" }));
    await startEmailVerification({ userId: "u1", email: "creator@gmail.com" });
    expect(issueOtp).toHaveBeenCalledTimes(1);
  });

  it("start/confirm: refused for an account that's already verified", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(verified());
    await expect(startEmailVerification({ userId: "u1", email: "other@gmail.com" })).rejects.toMatchObject({ code: "EMAIL_ALREADY_VERIFIED" });
    await expect(confirmEmailVerification({ userId: "u1", code: "123456" })).rejects.toMatchObject({ code: "EMAIL_ALREADY_VERIFIED" });
    expect(consumeOtp).not.toHaveBeenCalled();
  });

  it("start: needs a session or a challenge — neither is a 401", async () => {
    await expect(startEmailVerification({ email: "x@gmail.com" })).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("confirm: saves the email the code was *sent to*, marks it verified, and returns a session", async () => {
    const user = unverified({ unverifiedLoginCount: 2 });
    mockPrisma.user.findUnique.mockResolvedValueOnce(user).mockResolvedValueOnce(null);
    consumeOtp.mockResolvedValue({ email: "new@gmail.com" });
    mockPrisma.user.update.mockResolvedValue(verified({ email: "new@gmail.com" }));

    const result = await confirmEmailVerification({ challengeToken: signChallengeToken(user, "email-setup"), code: "123456" });

    expect(consumeOtp).toHaveBeenCalledWith({ userId: "u1", purpose: "VERIFY_EMAIL", code: "123456" });
    expect(mockPrisma.user.update).toHaveBeenCalledWith({ where: { id: "u1" }, data: { email: "new@gmail.com", emailVerifiedAt: expect.any(Date) } });
    // Sessions from before 2FA was enrolled (password-only) are ended; the one returned here is created after.
    expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith({ where: { userId: "u1", revoked: false }, data: { revoked: true } });
    expect(mockPrisma.refreshToken.updateMany.mock.invocationCallOrder[0]).toBeLessThan(mockPrisma.refreshToken.create.mock.invocationCallOrder[0]);
    expect(result.step).toBe("AUTHENTICATED");
    expect(result.user).toMatchObject({ email: "new@gmail.com", emailVerified: true });
    expect(result.accessToken).toBeTruthy();
  });

  it("confirm: clears the address off another account's unverified profile so the unique column doesn't block the real owner", async () => {
    const user = unverified();
    mockPrisma.user.findUnique.mockResolvedValueOnce(user).mockResolvedValueOnce(unverified({ id: "squatter", email: "new@gmail.com" }));
    consumeOtp.mockResolvedValue({ email: "new@gmail.com" });
    mockPrisma.user.update.mockResolvedValue(verified({ email: "new@gmail.com" }));

    await confirmEmailVerification({ userId: "u1", code: "123456" });

    expect(mockPrisma.user.update).toHaveBeenNthCalledWith(1, { where: { id: "squatter" }, data: { email: null } });
  });

  it("confirm: losing a same-address race to another account is a 409, not a 500", async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce(unverified()).mockResolvedValueOnce(null);
    consumeOtp.mockResolvedValue({ email: "new@gmail.com" });
    mockPrisma.user.update.mockRejectedValue(Object.assign(new Error("Unique constraint failed"), { code: "P2002" }));

    await expect(confirmEmailVerification({ userId: "u1", code: "123456" })).rejects.toMatchObject({ code: "EMAIL_ALREADY_REGISTERED", statusCode: 409 });
    expect(mockPrisma.refreshToken.create).not.toHaveBeenCalled();
  });

  it("confirm: a wrong code changes nothing", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(unverified());
    consumeOtp.mockRejectedValue(Object.assign(new Error("bad"), { code: "OTP_INVALID" }));
    await expect(confirmEmailVerification({ userId: "u1", code: "000000" })).rejects.toMatchObject({ code: "OTP_INVALID" });
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });
});
