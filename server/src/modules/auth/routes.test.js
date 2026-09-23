import { describe, it, expect, vi, afterAll } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";

// Route-level test for the trusted-device cookie ("skip OTP for 7 days",
// user decision, 23 Sep): does /login read it, does /login/verify-otp set
// it with the right flags, and — critically — does the raw token ever leak
// into the JSON body. service.js itself is mocked; requireAuth/requireAccess
// aren't exercised on these two public routes, so no auth mock is needed.
const login = vi.fn();
const verifyLoginOtp = vi.fn();
vi.mock("./service.js", () => ({
  login: (...args) => login(...args),
  verifyLoginOtp: (...args) => verifyLoginOtp(...args),
  resendLoginOtp: vi.fn(),
  startEmailVerification: vi.fn(),
  confirmEmailVerification: vi.fn(),
  signup: vi.fn(),
  refresh: vi.fn(),
  changePassword: vi.fn(),
  logout: vi.fn(),
}));

const { default: router } = await import("./routes.js");

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use("/auth", router);
const server = await new Promise((resolve) => {
  const s = app.listen(0, () => resolve(s));
});
const base = `http://127.0.0.1:${server.address().port}`;
afterAll(() => server.close());

function setCookieFor(name, res) {
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get("set-cookie")].filter(Boolean);
  return raw.find((c) => c.startsWith(`${name}=`));
}

describe("POST /auth/login — reads the trusted-device cookie", () => {
  it("passes req.cookies' trusted-device value through to the service", async () => {
    login.mockResolvedValue({ step: "OTP_REQUIRED", challengeToken: "t", emailHint: "a***@gmail.com" });

    await fetch(`${base}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: "taggify_trusted_device=abc123; other=1" },
      body: JSON.stringify({ email: "a@gmail.com", password: "pw" }),
    });

    expect(login).toHaveBeenCalledWith({ email: "a@gmail.com", password: "pw", trustedDeviceToken: "abc123" });
  });

  it("passes undefined when no cookie is sent, not an error", async () => {
    login.mockResolvedValue({ step: "OTP_REQUIRED", challengeToken: "t", emailHint: "a***@gmail.com" });

    await fetch(`${base}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "a@gmail.com", password: "pw" }),
    });

    expect(login).toHaveBeenCalledWith({ email: "a@gmail.com", password: "pw", trustedDeviceToken: undefined });
  });
});

describe("POST /auth/login/verify-otp — sets the trusted-device cookie", () => {
  it("sets an httpOnly, ~7-day, /api/auth-scoped cookie, and the raw token never appears in the JSON body", async () => {
    verifyLoginOtp.mockResolvedValue({
      step: "AUTHENTICATED",
      user: { id: "u1" },
      accessToken: "acc",
      refreshToken: "ref",
      trustedDeviceToken: "brand-new-secret-token",
    });

    const res = await fetch(`${base}/auth/login/verify-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ challengeToken: "ct", code: "123456" }),
    });
    const body = await res.json();
    const cookie = setCookieFor("taggify_trusted_device", res);

    expect(cookie).toBeTruthy();
    expect(cookie).toContain("brand-new-secret-token");
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\/api\/auth/i);
    const maxAgeMatch = cookie.match(/Max-Age=(\d+)/i);
    expect(Number(maxAgeMatch[1])).toBe(7 * 24 * 60 * 60);
    // Not in helmet/dev secure mode by default (NODE_ENV != production here).
    expect(cookie).not.toMatch(/Secure/i);

    expect(body.trustedDeviceToken).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("brand-new-secret-token");
    expect(body).toMatchObject({ step: "AUTHENTICATED", accessToken: "acc", refreshToken: "ref" });
  });

  it("sets no cookie at all when the service mints no trusted-device token (the 'Remember this device' checkbox was unchecked)", async () => {
    verifyLoginOtp.mockResolvedValue({ step: "AUTHENTICATED", accessToken: "acc", trustedDeviceToken: undefined });

    const res = await fetch(`${base}/auth/login/verify-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ challengeToken: "ct", code: "123456", remember: false }),
    });
    const body = await res.json();

    expect(setCookieFor("taggify_trusted_device", res)).toBeUndefined();
    expect(body).toMatchObject({ step: "AUTHENTICATED", accessToken: "acc" });
    expect(body.trustedDeviceToken).toBeUndefined();
  });

  it("sets Secure in production", async () => {
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      verifyLoginOtp.mockResolvedValue({ step: "AUTHENTICATED", accessToken: "acc", trustedDeviceToken: "tok" });
      const res = await fetch(`${base}/auth/login/verify-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeToken: "ct", code: "123456" }),
      });
      expect(setCookieFor("taggify_trusted_device", res)).toMatch(/Secure/i);
    } finally {
      process.env.NODE_ENV = prevEnv;
    }
  });
});
