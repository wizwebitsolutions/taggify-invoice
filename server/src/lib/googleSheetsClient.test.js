import { describe, it, expect, vi, beforeEach } from "vitest";
import jwt from "jsonwebtoken";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

vi.mock("jsonwebtoken", () => ({ default: { sign: vi.fn(() => "signed-jwt") } }));

const { getAccessToken, ensureSheetTabsExist, writeSheetTab } = await import("./googleSheetsClient.js");

beforeEach(() => vi.clearAllMocks());

function jsonResponse(body, ok = true, status = 200) {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) };
}

describe("getAccessToken — service account JWT exchange (newTask.md, 8 Sep)", () => {
  it("signs a JWT with the service account's identity and exchanges it for an access token", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ access_token: "test-token" }));

    const token = await getAccessToken({ clientEmail: "sa@project.iam.gserviceaccount.com", privateKey: "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----" });

    expect(jwt.sign).toHaveBeenCalledWith(
      expect.objectContaining({ iss: "sa@project.iam.gserviceaccount.com", scope: "https://www.googleapis.com/auth/spreadsheets" }),
      expect.any(String),
      { algorithm: "RS256" }
    );
    expect(mockFetch).toHaveBeenCalledWith(
      "https://oauth2.googleapis.com/token",
      expect.objectContaining({ method: "POST" })
    );
    expect(token).toBe("test-token");
  });

  it("throws a readable error when Google rejects the token exchange", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ error: "invalid_grant" }, false, 400));

    await expect(getAccessToken({ clientEmail: "sa@x.iam.gserviceaccount.com", privateKey: "bad-key" })).rejects.toThrow(/token exchange failed/);
  });
});

describe("ensureSheetTabsExist — creates only the tabs that don't already exist", () => {
  it("creates missing tabs via batchUpdate, leaving existing ones alone", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ sheets: [{ properties: { title: "Invoices" } }] })) // GET spreadsheet
      .mockResolvedValueOnce(jsonResponse({})); // POST batchUpdate

    await ensureSheetTabsExist({ accessToken: "tok", spreadsheetId: "sheet-1", titles: ["Invoices", "Links", "Summary"] });

    const batchUpdateCall = mockFetch.mock.calls[1];
    expect(batchUpdateCall[0]).toContain(":batchUpdate");
    const body = JSON.parse(batchUpdateCall[1].body);
    expect(body.requests.map((r) => r.addSheet.properties.title)).toEqual(["Links", "Summary"]);
  });

  it("makes no batchUpdate call at all when every tab already exists", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ sheets: [{ properties: { title: "Invoices" } }, { properties: { title: "Links" } }, { properties: { title: "Summary" } }] })
    );

    await ensureSheetTabsExist({ accessToken: "tok", spreadsheetId: "sheet-1", titles: ["Invoices", "Links", "Summary"] });

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("throws a readable error when reading the spreadsheet fails", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ error: "not found" }, false, 404));

    await expect(ensureSheetTabsExist({ accessToken: "tok", spreadsheetId: "missing", titles: ["Invoices"] })).rejects.toThrow(/reading spreadsheet/);
  });
});

describe("writeSheetTab — clears then writes, so shrinking data doesn't leave stale cells", () => {
  it("clears the tab's range before writing the new values", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({})).mockResolvedValueOnce(jsonResponse({}));

    await writeSheetTab({ accessToken: "tok", spreadsheetId: "sheet-1", title: "Invoices", rows: [["Invoice #"], ["INV-1"]] });

    expect(mockFetch.mock.calls[0][0]).toContain(":clear");
    expect(mockFetch.mock.calls[0][1].method).toBe("POST");
    expect(mockFetch.mock.calls[1][0]).toContain("valueInputOption=RAW");
    expect(mockFetch.mock.calls[1][1].method).toBe("PUT");
    expect(JSON.parse(mockFetch.mock.calls[1][1].body)).toEqual({ values: [["Invoice #"], ["INV-1"]] });
  });

  it("throws a readable error if the clear call fails, without attempting the write", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: "boom" }, false, 500));

    await expect(writeSheetTab({ accessToken: "tok", spreadsheetId: "sheet-1", title: "Invoices", rows: [] })).rejects.toThrow(/clearing tab/);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("throws a readable error if the write call fails", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({})).mockResolvedValueOnce(jsonResponse({ error: "boom" }, false, 500));

    await expect(writeSheetTab({ accessToken: "tok", spreadsheetId: "sheet-1", title: "Invoices", rows: [] })).rejects.toThrow(/writing tab/);
  });
});
