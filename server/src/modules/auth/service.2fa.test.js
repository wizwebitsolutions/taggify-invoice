import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

const { login, verifyLoginOtp, resendLoginOtp, startEmailVerification, confirmEmailVerification, changePassword } = await import("./service.js");
const { loginSchema, signupSchema } = await import("./schemas.js");
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

describe("login — email only (24 Sep: 'on login only email verification will be required')", () => {
  it("the login schema takes an email + password; a phone number is no longer an identifier", () => {
    expect(loginSchema.safeParse({ email: "creator@gmail.com", password: "x" }).success).toBe(true);
    expect(loginSchema.safeParse({ phoneNumber: PHONE, password: "x" }).success).toBe(false);
  });

  it("signup requires an email; phone is optional", () => {
    expect(signupSchema.safeParse({ name: "A", role: "CREATOR" }).success).toBe(false);
    expect(signupSchema.safeParse({ email: "not-an-email", role: "CREATOR" }).success).toBe(false);
    expect(signupSchema.safeParse({ email: "a@gmail.com", role: "CREATOR" }).success).toBe(true);
    expect(signupSchema.safeParse({ email: "a@company.in", phoneNumber: PHONE, role: "CREATOR" }).success).toBe(true);
  });

  it("an admin-created account (email set, not yet verified) gets an emailed code on its first login — no session, no lock-out counting", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(unverified({ email: "new.creator@gmail.com" }));

    const result = await login({ email: "New.Creator@gmail.com", password: "right-password" });

    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({ where: { email: "new.creator@gmail.com" } });
    expect(issueOtp).toHaveBeenCalledWith({ userId: "u1", purpose: "LOGIN", email: "new.creator@gmail.com" });
    expect(result).toMatchObject({ step: "OTP_REQUIRED", emailHint: "ne***@gmail.com" });
    expect(result.accessToken).toBeUndefined();
    expect(mockPrisma.user.updateMany).not.toHaveBeenCalled();
  });

  it("...and never skips that first code via a trusted-device cookie", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(unverified({ email: "new.creator@gmail.com" }));
    verifyTrustedDevice.mockResolvedValue(true);

    const result = await login({ email: "new.creator@gmail.com", password: "right-password", trustedDeviceToken: "cookie-value" });

    expect(verifyTrustedDevice).not.toHaveBeenCalled();
    expect(result.step).toBe("OTP_REQUIRED");
  });

  it("redeeming that first code marks the email verified and signs in", async () => {
    const user = unverified({ email: "new.creator@gmail.com" });
    mockPrisma.user.findUnique.mockResolvedValue(user);
    mockPrisma.user.update.mockImplementation(async ({ data }) => ({ ...user, ...data }));
    consumeOtp.mockResolvedValue({ email: user.email });

    const result = await verifyLoginOtp({ challengeToken: signChallengeToken(user, "login-otp"), code: "123456" });

    expect(mockPrisma.user.update).toHaveBeenCalledWith({ where: { id: "u1" }, data: { emailVerifiedAt: expect.any(Date) } });
    expect(result.step).toBe("AUTHENTICATED");
    expect(result.user.emailVerified).toBe(true);
  });

  it("regression (24 Sep review): a code sent to one address doesn't verify an email changed in between", async () => {
    const user = unverified({ email: "changed-after@gmail.com" });
    mockPrisma.user.findUnique.mockResolvedValue(user);
    consumeOtp.mockResolvedValue({ email: "sent-to@gmail.com" });

    const result = await verifyLoginOtp({ challengeToken: signChallengeToken(user, "login-otp"), code: "123456" });

    expect(result.step).toBe("AUTHENTICATED");
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
    expect(result.user.emailVerified).toBe(false);
  });

  it("regression (24 Sep review): an unknown email still runs a bcrypt compare, so timing doesn't reveal which emails exist", async () => {
    const bcrypt = (await import("bcryptjs")).default;
    mockPrisma.user.findUnique.mockResolvedValue(null);
    await expect(login({ email: "nobody@gmail.com", password: "whatever" })).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    const [pw, hash] = bcrypt.compare.mock.calls.at(-1);
    expect(pw).toBe("whatever");
    expect(hash.startsWith("$2")).toBe(true);
    expect(hash).toHaveLength(60);
  });

  it("an already-verified account's code doesn't rewrite emailVerifiedAt", async () => {
    const user = verified();
    mockPrisma.user.findUnique.mockResolvedValue(user);
    consumeOtp.mockResolvedValue({ email: user.email });

    await verifyLoginOtp({ challengeToken: signChallengeToken(user, "login-otp"), code: "123456" });

    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it("an unknown email or a wrong password is the same INVALID_CREDENTIALS, and sends no code", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    await expect(login({ email: "nobody@gmail.com", password: "right-password" })).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    mockPrisma.user.findUnique.mockResolvedValue(unverified({ email: "new.creator@gmail.com" }));
    await expect(login({ email: "new.creator@gmail.com", password: "nope" })).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    expect(issueOtp).not.toHaveBeenCalled();
  });

  it("resending the code works before the email is verified too", async () => {
    const user = unverified({ email: "new.creator@gmail.com" });
    mockPrisma.user.findUnique.mockResolvedValue(user);

    await resendLoginOtp({ challengeToken: signChallengeToken(user, "login-otp") });

    expect(issueOtp).toHaveBeenCalledWith({ userId: "u1", purpose: "LOGIN", email: "new.creator@gmail.com" });
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

describe("login — OTP bypass for test accounts (OTP_BYPASS_EMAILS, 28 Sep)", () => {
  const dummy = () => verified({ email: "creator1@taggify.test" });
  afterEach(() => {
    delete process.env.OTP_BYPASS_EMAILS;
  });

  it("is off unless the env var is set — an unset allowlist still emails a code", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(dummy());

    const result = await login({ email: "creator1@taggify.test", password: "right-password" });

    expect(result.step).toBe("OTP_REQUIRED");
    expect(issueOtp).toHaveBeenCalledTimes(1);
  });

  it("an allowlisted address signs in without a code", async () => {
    process.env.OTP_BYPASS_EMAILS = "planner1@taggify.test, creator1@taggify.test";
    mockPrisma.user.findUnique.mockResolvedValue(dummy());

    const result = await login({ email: "creator1@taggify.test", password: "right-password" });

    expect(result.step).toBe("AUTHENTICATED");
    expect(result.accessToken).toBeTruthy();
    expect(issueOtp).not.toHaveBeenCalled();
  });

  it("still checks the password first — being allowlisted doesn't save a wrong password", async () => {
    process.env.OTP_BYPASS_EMAILS = "creator1@taggify.test";
    mockPrisma.user.findUnique.mockResolvedValue(dummy());

    await expect(login({ email: "creator1@taggify.test", password: "nope" })).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    expect(mockPrisma.refreshToken.create).not.toHaveBeenCalled();
  });

  it("only the listed addresses bypass — every other account still gets a code", async () => {
    process.env.OTP_BYPASS_EMAILS = "creator1@taggify.test";
    mockPrisma.user.findUnique.mockResolvedValue(verified());

    const result = await login({ email: "creator@gmail.com", password: "right-password" });

    expect(result.step).toBe("OTP_REQUIRED");
    expect(issueOtp).toHaveBeenCalledTimes(1);
  });

  it("an unverified test account bypasses too (its address can never receive a code)", async () => {
    process.env.OTP_BYPASS_EMAILS = "creator1@taggify.test";
    mockPrisma.user.findUnique.mockResolvedValue(unverified({ email: "creator1@taggify.test" }));

    expect((await login({ email: "creator1@taggify.test", password: "right-password" })).step).toBe("AUTHENTICATED");
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

  it("start: refuses an email another account holds — verified or not (24 Sep: an unverified address is an admin-created account's only login)", async () => {
    const user = unverified();
    mockPrisma.user.findUnique.mockResolvedValueOnce(user).mockResolvedValueOnce(verified({ id: "other" }));
    await expect(startEmailVerification({ userId: "u1", email: "creator@gmail.com" })).rejects.toMatchObject({ code: "EMAIL_ALREADY_REGISTERED" });

    mockPrisma.user.findUnique.mockResolvedValueOnce(user).mockResolvedValueOnce(unverified({ id: "other", email: "creator@gmail.com" }));
    await expect(startEmailVerification({ userId: "u1", email: "creator@gmail.com" })).rejects.toMatchObject({ code: "EMAIL_ALREADY_REGISTERED" });
    expect(issueOtp).not.toHaveBeenCalled();
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

  it("regression (24 Sep review): confirm never clears another account's address — that could wipe an admin-created account's only login", async () => {
    const user = unverified();
    mockPrisma.user.findUnique.mockResolvedValueOnce(user).mockResolvedValueOnce(unverified({ id: "new-account", email: "new@gmail.com" }));
    consumeOtp.mockResolvedValue({ email: "new@gmail.com" });

    await expect(confirmEmailVerification({ userId: "u1", code: "123456" })).rejects.toMatchObject({ code: "EMAIL_ALREADY_REGISTERED" });
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
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
