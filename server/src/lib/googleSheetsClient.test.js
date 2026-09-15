import { describe, it, expect, vi, beforeEach } from "vitest";
import jwt from "jsonwebtoken";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

vi.mock("jsonwebtoken", () => ({ default: { sign: vi.fn(() => "signed-jwt") } }));

const { getAccessToken, ensureSheetTabsExist, writeSheetTab, getSheetTabIds, batchUpdateSpreadsheet, createSpreadsheet, deleteSheetTab } = await import(
  "./googleSheetsClient.js"
);

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

/**
 * getSheetTabIds — the deep-link building block (user request, 10 Sep —
 * "plan will be of google sheet ... generate google sheet and will provide
 * link"), matching the exact `.../edit?gid=X#gid=X` shape a Google Sheets
 * tab link takes.
 */
describe("getSheetTabIds — resolves a tab title to its sheetId (gid)", () => {
  it("returns the sheetId for each requested title that exists", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ sheets: [{ properties: { title: "Overview", sheetId: 111 } }, { properties: { title: "Pages", sheetId: 222 } }] })
    );

    const gids = await getSheetTabIds({ accessToken: "tok", spreadsheetId: "sheet-1", titles: ["Overview", "Pages"] });

    expect(gids).toEqual({ Overview: 111, Pages: 222 });
  });

  it("omits a title that isn't in the spreadsheet, rather than throwing", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ sheets: [{ properties: { title: "Overview", sheetId: 111 } }] }));

    const gids = await getSheetTabIds({ accessToken: "tok", spreadsheetId: "sheet-1", titles: ["Overview", "Missing"] });

    expect(gids).toEqual({ Overview: 111 });
  });
});

/**
 * batchUpdateSpreadsheet — the styling primitive (user request, 10 Sep —
 * "google sheet format should be like this, same styling") planSheet.js's
 * format-request builder sends through.
 */
describe("batchUpdateSpreadsheet — arbitrary formatting requests", () => {
  it("posts the requests to the spreadsheet's :batchUpdate endpoint", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({}));
    const requests = [{ mergeCells: { range: { sheetId: 1 }, mergeType: "MERGE_ALL" } }];

    await batchUpdateSpreadsheet({ accessToken: "tok", spreadsheetId: "sheet-1", requests });

    expect(mockFetch.mock.calls[0][0]).toContain(":batchUpdate");
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({ requests });
  });

  it("is a no-op (no fetch call) when there are no requests", async () => {
    await batchUpdateSpreadsheet({ accessToken: "tok", spreadsheetId: "sheet-1", requests: [] });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("throws a readable error when the API rejects the request", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: "boom" }, false, 500));

    await expect(
      batchUpdateSpreadsheet({ accessToken: "tok", spreadsheetId: "sheet-1", requests: [{ mergeCells: {} }] })
    ).rejects.toThrow(/applying formatting/);
  });
});

/**
 * createSpreadsheet/deleteSheetTab — per-plan spreadsheet creation (user
 * request, 10 Sep — "1 spreadsheet generation per plan, not just write
 * access"). Only viable with a real user's OAuth token (see
 * googleOAuthClient.js) — a service account gets a 403 on this exact call
 * (verified directly against the live API), which is why every earlier
 * plan sheet lived as tabs in one shared spreadsheet instead.
 */
describe("createSpreadsheet — one real spreadsheet per plan", () => {
  it("POSTs to the spreadsheets endpoint and returns the new file's id and default tab's sheetId", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ spreadsheetId: "new-sheet-1", sheets: [{ properties: { sheetId: 0, title: "Sheet1" } }] }));

    const result = await createSpreadsheet({ accessToken: "tok", title: "Q1 Push — Plan A — Client (Taggify)" });

    expect(mockFetch).toHaveBeenCalledWith(
      "https://sheets.googleapis.com/v4/spreadsheets",
      expect.objectContaining({ method: "POST" })
    );
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({ properties: { title: "Q1 Push — Plan A — Client (Taggify)" } });
    expect(result).toEqual({ spreadsheetId: "new-sheet-1", defaultSheetId: 0 });
  });

  it("throws a readable error when Google refuses to create it (e.g. a quota-less service account's 403)", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: "PERMISSION_DENIED" }, false, 403));

    await expect(createSpreadsheet({ accessToken: "tok", title: "x" })).rejects.toThrow(/creating spreadsheet/);
  });
});

describe("deleteSheetTab — drops a freshly created spreadsheet's blank default tab", () => {
  it("sends a deleteSheet batchUpdate request for the given sheetId", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({}));

    await deleteSheetTab({ accessToken: "tok", spreadsheetId: "sheet-1", sheetId: 0 });

    expect(mockFetch.mock.calls[0][0]).toContain(":batchUpdate");
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({ requests: [{ deleteSheet: { sheetId: 0 } }] });
  });

  it("is a no-op when sheetId is null (nothing to delete)", async () => {
    await deleteSheetTab({ accessToken: "tok", spreadsheetId: "sheet-1", sheetId: null });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("swallows Google's 'can't delete the last visible sheet' error instead of throwing", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 400, text: async () => "You can't delete the last visible sheet in a document." });

    await expect(deleteSheetTab({ accessToken: "tok", spreadsheetId: "sheet-1", sheetId: 0 })).resolves.toBeUndefined();
  });

  it("throws a readable error for any other failure", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: "boom" }, false, 500));

    await expect(deleteSheetTab({ accessToken: "tok", spreadsheetId: "sheet-1", sheetId: 0 })).rejects.toThrow(/deleting tab/);
  });
});
