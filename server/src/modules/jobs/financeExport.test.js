import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockPrisma = {
  invoice: { findMany: vi.fn() },
  link: { findMany: vi.fn() },
  clientInvoice: { findMany: vi.fn() },
};
vi.mock("../../lib/prisma.js", () => ({ prisma: mockPrisma }));

const mockBuildWorkbook = vi.fn();
vi.mock("../../lib/financeWorkbook.js", () => ({ buildFinanceWorkbook: (...args) => mockBuildWorkbook(...args) }));

const mockEnsureBranch = vi.fn();
const mockUpsertFile = vi.fn();
vi.mock("../../lib/githubClient.js", () => ({
  ensureBranchExists: (...args) => mockEnsureBranch(...args),
  upsertGitHubFile: (...args) => mockUpsertFile(...args),
}));

const { financeExportJob } = await import("./financeExport.js");

const ENV_KEYS = ["GITHUB_TOKEN", "GITHUB_REPO_OWNER", "GITHUB_REPO_NAME", "GITHUB_FINANCE_BRANCH", "GITHUB_FINANCE_PATH"];
let savedEnv;

beforeEach(() => {
  vi.clearAllMocks();
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  process.env.GITHUB_TOKEN = "test-token";
  process.env.GITHUB_REPO_OWNER = "deepak007-star";
  process.env.GITHUB_REPO_NAME = "taggify-invoice";
  delete process.env.GITHUB_FINANCE_BRANCH;
  delete process.env.GITHUB_FINANCE_PATH;

  mockPrisma.invoice.findMany.mockResolvedValue([]);
  mockPrisma.link.findMany.mockResolvedValue([]);
  mockPrisma.clientInvoice.findMany.mockResolvedValue([]);
  mockBuildWorkbook.mockResolvedValue(Buffer.from("fake-xlsx"));
  mockEnsureBranch.mockResolvedValue(undefined);
  mockUpsertFile.mockResolvedValue({ commitSha: "abc", htmlUrl: "https://github.com/x" });
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe("financeExportJob — newTask.md #2", () => {
  it("throws a clear, specific error when GitHub isn't configured, before touching anything", async () => {
    delete process.env.GITHUB_TOKEN;

    await expect(financeExportJob()).rejects.toThrow(/GITHUB_TOKEN/);
    expect(mockPrisma.invoice.findMany).not.toHaveBeenCalled();
  });

  it("pulls every invoice and link, builds the workbook, and pushes it to the configured branch/path", async () => {
    await financeExportJob();

    expect(mockPrisma.invoice.findMany).toHaveBeenCalled();
    expect(mockPrisma.link.findMany).toHaveBeenCalled();
    expect(mockBuildWorkbook).toHaveBeenCalled();
    expect(mockEnsureBranch).toHaveBeenCalledWith(expect.objectContaining({ branch: "finance-data" }));
    expect(mockUpsertFile).toHaveBeenCalledWith(
      expect.objectContaining({ branch: "finance-data", path: "finance-exports/finance-data.xlsx" })
    );
  });

  it("uses GITHUB_FINANCE_BRANCH / GITHUB_FINANCE_PATH overrides when set", async () => {
    process.env.GITHUB_FINANCE_BRANCH = "custom-branch";
    process.env.GITHUB_FINANCE_PATH = "custom/path.xlsx";

    await financeExportJob();

    expect(mockUpsertFile).toHaveBeenCalledWith(expect.objectContaining({ branch: "custom-branch", path: "custom/path.xlsx" }));
  });

  it("never pushes to main — the default branch is something else", async () => {
    await financeExportJob();

    const call = mockUpsertFile.mock.calls[0][0];
    expect(call.branch).not.toBe("main");
  });
});
