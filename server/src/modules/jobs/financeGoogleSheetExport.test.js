import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockPrisma = {
  invoice: { findMany: vi.fn() },
  link: { findMany: vi.fn() },
  clientInvoice: { findMany: vi.fn() },
};
vi.mock("../../lib/prisma.js", () => ({ prisma: mockPrisma }));

const mockGetAccessToken = vi.fn();
const mockEnsureTabs = vi.fn();
const mockWriteTab = vi.fn();
vi.mock("../../lib/googleSheetsClient.js", () => ({
  getAccessToken: (...args) => mockGetAccessToken(...args),
  ensureSheetTabsExist: (...args) => mockEnsureTabs(...args),
  writeSheetTab: (...args) => mockWriteTab(...args),
}));

const { financeGoogleSheetExportJob } = await import("./financeGoogleSheetExport.js");

const ENV_KEYS = ["GOOGLE_SERVICE_ACCOUNT_EMAIL", "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY", "GOOGLE_FINANCE_SPREADSHEET_ID"];
let savedEnv;

beforeEach(() => {
  vi.clearAllMocks();
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = "sa@project.iam.gserviceaccount.com";
  process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----";
  process.env.GOOGLE_FINANCE_SPREADSHEET_ID = "sheet-123";

  mockPrisma.invoice.findMany.mockResolvedValue([]);
  mockPrisma.link.findMany.mockResolvedValue([]);
  mockPrisma.clientInvoice.findMany.mockResolvedValue([]);
  mockGetAccessToken.mockResolvedValue("access-token");
  mockEnsureTabs.mockResolvedValue(undefined);
  mockWriteTab.mockResolvedValue(undefined);
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe("financeGoogleSheetExportJob — newTask.md, 8 Sep", () => {
  it("throws a clear, specific error when not configured, before touching the DB", async () => {
    delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;

    await expect(financeGoogleSheetExportJob()).rejects.toThrow(/GOOGLE_SERVICE_ACCOUNT_EMAIL/);
    expect(mockPrisma.invoice.findMany).not.toHaveBeenCalled();
  });

  it("un-escapes \\n sequences in the private key before signing", async () => {
    await financeGoogleSheetExportJob();

    expect(mockGetAccessToken).toHaveBeenCalledWith({
      clientEmail: "sa@project.iam.gserviceaccount.com",
      privateKey: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
    });
  });

  it("ensures all four tabs exist, then writes each one, in Invoices/Links/Client invoices/Summary order", async () => {
    await financeGoogleSheetExportJob();

    expect(mockEnsureTabs).toHaveBeenCalledWith({ accessToken: "access-token", spreadsheetId: "sheet-123", titles: ["Invoices", "Links", "Client invoices", "Summary"] });
    expect(mockWriteTab).toHaveBeenCalledTimes(4);
    expect(mockWriteTab.mock.calls[0][0]).toMatchObject({ title: "Invoices" });
    expect(mockWriteTab.mock.calls[1][0]).toMatchObject({ title: "Links" });
    expect(mockWriteTab.mock.calls[2][0]).toMatchObject({ title: "Client invoices" });
    expect(mockWriteTab.mock.calls[3][0]).toMatchObject({ title: "Summary" });
  });

  it("writes a header row plus one row per invoice/link, in the same column order as the Excel export", async () => {
    mockPrisma.invoice.findMany.mockResolvedValue([
      { invoiceNumber: "INV-1", creator: { name: "Demo Creator", phoneNumber: "+919000000003" }, subtotal: 10000, isGstInvoice: true, gstAmount: 1800, amount: 11800, status: "PAID", paymentStatus: "COMPLETED", gstStatus: "COMPLETED", dueDate: null, paidAt: null, createdAt: new Date("2026-08-20") },
    ]);
    mockPrisma.link.findMany.mockResolvedValue([
      { campaign: { title: "Launch Week" }, asset: { handle: "demo.page" }, submittedBy: { name: "Demo Creator" }, format: "reel", cost: 5000, status: "INVOICED", invoiceItem: { id: "i1" }, postedAt: null, createdAt: new Date("2026-08-18") },
    ]);

    mockPrisma.clientInvoice.findMany.mockResolvedValue([
      { invoiceNumber: "PI-0001", plan: { name: "Q1 Push", clientName: "Rohit", clientCompany: "Acme Foods Pvt Ltd", campaign: { title: "Q1 Push" } }, subtotal: 10000, gstPercent: 18, gstAmount: 1800, total: 11800, status: "PAID", issuedAt: new Date("2026-09-20"), paidAt: new Date("2026-09-22"), paidAmount: 11800 },
    ]);

    await financeGoogleSheetExportJob();

    const invoiceRows = mockWriteTab.mock.calls[0][0].rows;
    expect(invoiceRows[0]).toEqual(["Invoice #", "Creator", "Phone", "Subtotal", "GST Invoice", "GST Amount", "Total Amount", "Status", "Payment Status", "GST Status", "Due Date", "Paid At", "Created At"]);
    expect(invoiceRows[1]).toEqual(["INV-1", "Demo Creator", "+919000000003", 10000, "Yes", 1800, 11800, "PAID", "COMPLETED", "COMPLETED", "", "", "2026-08-20"]);

    const linkRows = mockWriteTab.mock.calls[1][0].rows;
    expect(linkRows[0]).toEqual(["Campaign", "Page", "Creator", "Format", "Cost", "Status", "Invoiced", "Posted At", "Created At"]);
    expect(linkRows[1]).toEqual(["Launch Week", "@demo.page", "Demo Creator", "reel", 5000, "INVOICED", "Yes", "", "2026-08-18"]);

    const clientRows = mockWriteTab.mock.calls[2][0].rows;
    expect(clientRows[0]).toEqual(["Invoice #", "Client", "Plan", "Campaign", "Subtotal", "GST %", "GST Amount", "Total", "Status", "Issued At", "Paid At", "Paid Amount"]);
    expect(clientRows[1]).toEqual(["PI-0001", "Acme Foods Pvt Ltd", "Q1 Push", "Q1 Push", 10000, 18, 1800, 11800, "PAID", "2026-09-20", "2026-09-22", 11800]);

    const summaryRows = mockWriteTab.mock.calls[3][0].rows;
    expect(summaryRows[0]).toEqual(["Metric", "Value"]);
    expect(summaryRows.find((r) => r[0] === "Total invoiced amount")[1]).toBe(11800);
    expect(summaryRows.find((r) => r[0] === "Total collected from clients")[1]).toBe(11800);
  });

  it("returns a link back to the spreadsheet", async () => {
    const result = await financeGoogleSheetExportJob();
    expect(result.spreadsheetUrl).toBe("https://docs.google.com/spreadsheets/d/sheet-123/edit");
  });
});
