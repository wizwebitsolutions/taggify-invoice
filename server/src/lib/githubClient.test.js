import { describe, it, expect, vi, beforeEach } from "vitest";
import { ensureBranchExists, upsertGitHubFile } from "./githubClient.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function jsonResponse(status, body) {
  return { status, ok: status >= 200 && status < 300, json: async () => body, text: async () => JSON.stringify(body) };
}

beforeEach(() => vi.clearAllMocks());

describe("ensureBranchExists — auto-creates the export branch (newTask.md #2)", () => {
  it("does nothing when the branch already exists", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, { ref: "refs/heads/finance-data" }));

    await ensureBranchExists({ token: "t", owner: "o", repo: "r", branch: "finance-data" });

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("creates the branch off the default branch when it doesn't exist yet", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse(404, {})) // branch doesn't exist
      .mockResolvedValueOnce(jsonResponse(200, { default_branch: "main" }))
      .mockResolvedValueOnce(jsonResponse(200, { object: { sha: "abc123" } }))
      .mockResolvedValueOnce(jsonResponse(201, { ref: "refs/heads/finance-data" }));

    await ensureBranchExists({ token: "t", owner: "o", repo: "r", branch: "finance-data" });

    expect(mockFetch).toHaveBeenCalledTimes(4);
    const createCall = mockFetch.mock.calls[3];
    expect(createCall[0]).toContain("/git/refs");
    const body = JSON.parse(createCall[1].body);
    expect(body).toEqual({ ref: "refs/heads/finance-data", sha: "abc123" });
  });

  it("throws on an unexpected error checking the branch", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(500, { message: "server error" }));

    await expect(ensureBranchExists({ token: "t", owner: "o", repo: "r", branch: "finance-data" })).rejects.toThrow(/500/);
  });
});

describe("upsertGitHubFile", () => {
  it("creates the file (no sha) when it doesn't exist yet", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse(404, {})) // GET existing file
      .mockResolvedValueOnce(jsonResponse(201, { commit: { sha: "commit1" }, content: { html_url: "https://github.com/x" } }));

    const result = await upsertGitHubFile({
      token: "t",
      owner: "o",
      repo: "r",
      branch: "finance-data",
      path: "finance-exports/finance-data.xlsx",
      content: Buffer.from("hello"),
      message: "Daily finance export",
    });

    const putCall = mockFetch.mock.calls[1];
    const body = JSON.parse(putCall[1].body);
    expect(body.sha).toBeUndefined();
    expect(body.content).toBe(Buffer.from("hello").toString("base64"));
    expect(result.commitSha).toBe("commit1");
  });

  it("updates the file (includes sha) when it already exists", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse(200, { sha: "existing-sha" }))
      .mockResolvedValueOnce(jsonResponse(200, { commit: { sha: "commit2" }, content: { html_url: "https://github.com/x" } }));

    await upsertGitHubFile({
      token: "t",
      owner: "o",
      repo: "r",
      branch: "finance-data",
      path: "finance-exports/finance-data.xlsx",
      content: Buffer.from("hello"),
      message: "Daily finance export",
    });

    const putCall = mockFetch.mock.calls[1];
    const body = JSON.parse(putCall[1].body);
    expect(body.sha).toBe("existing-sha");
  });

  it("throws a clear error when GitHub rejects the write", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse(404, {}))
      .mockResolvedValueOnce({ status: 401, ok: false, text: async () => "Bad credentials" });

    await expect(
      upsertGitHubFile({ token: "bad", owner: "o", repo: "r", branch: "b", path: "p", content: Buffer.from("x"), message: "m" })
    ).rejects.toThrow(/401/);
  });

  it("throws immediately when no token is given", async () => {
    await expect(
      upsertGitHubFile({ token: "", owner: "o", repo: "r", branch: "b", path: "p", content: Buffer.from("x"), message: "m" })
    ).rejects.toThrow(/GITHUB_TOKEN/);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
