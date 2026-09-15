import { describe, it, expect, vi, beforeEach } from "vitest";
import jwt from "jsonwebtoken";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

vi.mock("jsonwebtoken", () => ({ default: { sign: vi.fn(() => "signed-state"), verify: vi.fn() } }));

const mockAppSettingFindUnique = vi.fn();
const mockAppSettingUpsert = vi.fn();
vi.mock("./prisma.js", () => ({ prisma: { appSetting: { findUnique: (...a) => mockAppSettingFindUnique(...a), upsert: (...a) => mockAppSettingUpsert(...a) } } }));

const {
  isGoogleOAuthConfigured,
  buildAuthorizeUrl,
  verifyState,
  exchangeCodeForTokens,
  saveRefreshToken,
  isGoogleDriveConnected,
  getUserAccessToken,
} = await import("./googleOAuthClient.js");

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GOOGLE_OAUTH_CLIENT_ID = "client-id";
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = "client-secret";
  process.env.GOOGLE_OAUTH_REDIRECT_URI = "http://localhost:4000/api/integrations/google/callback";
  process.env.JWT_ACCESS_SECRET = "test-secret";
});

function jsonResponse(body, ok = true, status = 200) {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) };
}

/**
 * Per-plan spreadsheet creation needs a real Google account's own Drive
 * quota (user request, 10 Sep — "1 spreadsheet generation per plan, not
 * just write access") — the service account has none (verified: 403 on
 * spreadsheets.create). This module runs the one-time OAuth consent flow
 * that connects a real account instead.
 */
describe("isGoogleOAuthConfigured", () => {
  it("is true only once all three env vars are set", () => {
    expect(isGoogleOAuthConfigured()).toBe(true);
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    expect(isGoogleOAuthConfigured()).toBe(false);
  });
});

describe("buildAuthorizeUrl", () => {
  it("builds a Google consent URL requesting offline access, forced consent, and both sheets scopes", () => {
    const url = buildAuthorizeUrl();

    expect(url).toMatch(/^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/);
    const params = new URL(url).searchParams;
    expect(params.get("client_id")).toBe("client-id");
    expect(params.get("redirect_uri")).toBe("http://localhost:4000/api/integrations/google/callback");
    expect(params.get("access_type")).toBe("offline");
    expect(params.get("prompt")).toBe("consent");
    expect(params.get("scope")).toContain("spreadsheets");
    expect(params.get("scope")).toContain("drive.file");
    expect(params.get("state")).toBe("signed-state");
  });
});

describe("verifyState", () => {
  it("delegates to jwt.verify with the access secret", () => {
    verifyState("some-state");
    expect(jwt.verify).toHaveBeenCalledWith("some-state", "test-secret");
  });
});

describe("exchangeCodeForTokens", () => {
  it("POSTs the authorization code to Google's token endpoint", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ access_token: "at", refresh_token: "rt" }));

    const tokens = await exchangeCodeForTokens("auth-code");

    expect(mockFetch).toHaveBeenCalledWith("https://oauth2.googleapis.com/token", expect.objectContaining({ method: "POST" }));
    expect(tokens).toEqual({ access_token: "at", refresh_token: "rt" });
  });

  it("throws a readable error when the exchange fails", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: "invalid_grant" }, false, 400));

    await expect(exchangeCodeForTokens("bad-code")).rejects.toThrow(/code exchange failed/);
  });
});

describe("saveRefreshToken / isGoogleDriveConnected", () => {
  it("upserts the refresh token under a fixed AppSetting key", async () => {
    await saveRefreshToken("rt-123");

    expect(mockAppSettingUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: "googleOAuthRefreshToken" }, create: { key: "googleOAuthRefreshToken", value: "rt-123" } })
    );
  });

  it("reports connected once a row exists, disconnected otherwise", async () => {
    mockAppSettingFindUnique.mockResolvedValueOnce(null);
    expect(await isGoogleDriveConnected()).toBe(false);

    mockAppSettingFindUnique.mockResolvedValueOnce({ key: "googleOAuthRefreshToken", value: "rt-123" });
    expect(await isGoogleDriveConnected()).toBe(true);
  });
});

describe("getUserAccessToken", () => {
  it("returns null when no refresh token has been saved yet (no admin has connected an account)", async () => {
    mockAppSettingFindUnique.mockResolvedValueOnce(null);

    expect(await getUserAccessToken()).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("exchanges the stored refresh token for a fresh access token", async () => {
    mockAppSettingFindUnique.mockResolvedValueOnce({ key: "googleOAuthRefreshToken", value: "rt-123" });
    mockFetch.mockResolvedValueOnce(jsonResponse({ access_token: "fresh-token" }));

    const token = await getUserAccessToken();

    expect(mockFetch).toHaveBeenCalledWith("https://oauth2.googleapis.com/token", expect.objectContaining({ method: "POST" }));
    expect(mockFetch.mock.calls[0][1].body.get("refresh_token")).toBe("rt-123");
    expect(token).toBe("fresh-token");
  });

  it("throws a readable error when the refresh exchange fails", async () => {
    mockAppSettingFindUnique.mockResolvedValueOnce({ key: "googleOAuthRefreshToken", value: "rt-123" });
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: "invalid_grant" }, false, 400));

    await expect(getUserAccessToken()).rejects.toThrow(/token refresh failed/);
  });
});
