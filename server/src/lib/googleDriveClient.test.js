import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const { makeFilePublicViewable } = await import("./googleDriveClient.js");

beforeEach(() => vi.clearAllMocks());

function jsonResponse(body, ok = true, status = 200) {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) };
}

/**
 * makeFilePublicViewable — "Anyone with the link → Viewer" (user request,
 * 10 Sep — "public view access of sheet to anyone").
 */
describe("makeFilePublicViewable", () => {
  it("POSTs an 'anyone: reader' permission to the file's permissions endpoint", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ id: "perm-1", type: "anyone", role: "reader" }));

    await makeFilePublicViewable({ accessToken: "tok", fileId: "sheet-1" });

    expect(mockFetch).toHaveBeenCalledWith(
      "https://www.googleapis.com/drive/v3/files/sheet-1/permissions",
      expect.objectContaining({ method: "POST", headers: expect.objectContaining({ Authorization: "Bearer tok" }) })
    );
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({ type: "anyone", role: "reader" });
  });

  it("throws a readable error when Google refuses to share it", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: "boom" }, false, 403));

    await expect(makeFilePublicViewable({ accessToken: "tok", fileId: "sheet-1" })).rejects.toThrow(/sharing file/);
  });
});
