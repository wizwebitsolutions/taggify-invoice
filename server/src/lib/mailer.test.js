import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ApiError } from "../middleware/errorHandler.js";
import { sendOtpEmail, DEFAULT_EMAIL_FROM } from "./mailer.js";

// tasks.md (23 Sep #2): login / email-verification OTPs must go out from
// noreply@taggify.in through Resend. These pin the sender and the two
// failure modes (no key → console in dev, Resend error → 502).
describe("sendOtpEmail — Resend sender (tasks.md 23 Sep #2)", () => {
  const env = { ...process.env };
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    process.env.RESEND_API_KEY = "re_test_key";
    delete process.env.EMAIL_FROM;
    process.env.NODE_ENV = "test";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...env };
  });

  it("sends from Taggify <noreply@taggify.in> by default", async () => {
    await sendOtpEmail({ to: "user@example.com", code: "123456", purpose: "LOGIN", expiresInMinutes: 10 });

    expect(DEFAULT_EMAIL_FROM).toBe("Taggify <noreply@taggify.in>");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers.Authorization).toBe("Bearer re_test_key");
    const body = JSON.parse(init.body);
    expect(body.from).toBe("Taggify <noreply@taggify.in>");
    expect(body.to).toEqual(["user@example.com"]);
    expect(body.subject).toBe("123456 is your Taggify sign-in code");
    expect(body.text).toContain("123456");
  });

  it("lets EMAIL_FROM override the sender per environment", async () => {
    process.env.EMAIL_FROM = "Taggify Staging <otp@staging.taggify.in>";

    await sendOtpEmail({ to: "user@example.com", code: "654321", purpose: "VERIFY_EMAIL", expiresInMinutes: 10 });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.from).toBe("Taggify Staging <otp@staging.taggify.in>");
    expect(body.subject).toBe("654321 is your Taggify email verification code");
  });

  it("surfaces a Resend error as a 502 EMAIL_SEND_FAILED (the caller then discards the unsent code)", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 403, text: async () => '{"message":"domain not verified"}' });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const err = await sendOtpEmail({ to: "user@example.com", code: "111111", purpose: "LOGIN", expiresInMinutes: 10 }).catch((e) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect(err.statusCode).toBe(502);
    expect(err.code).toBe("EMAIL_SEND_FAILED");
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Resend 403"));
    errorSpy.mockRestore();
  });

  it("without a key: prints the code outside production, 503s in production", async () => {
    delete process.env.RESEND_API_KEY;
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await sendOtpEmail({ to: "user@example.com", code: "222222", purpose: "LOGIN", expiresInMinutes: 10 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("222222"));

    process.env.NODE_ENV = "production";
    const err = await sendOtpEmail({ to: "user@example.com", code: "333333", purpose: "LOGIN", expiresInMinutes: 10 }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("EMAIL_NOT_CONFIGURED");
    logSpy.mockRestore();
  });
});
