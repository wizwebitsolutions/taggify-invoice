import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApiError } from "../../middleware/errorHandler.js";

// listInvoices/getInvoiceDetail's "sees everything vs. own invoices only"
// branch (23 Sep, Step 3) used to be a bare `["ADMIN","FINANCE"].includes(
// role)` check — restricting or granting finance.view never actually
// changed what came back. Kept separate from service.test.js's larger
// mockPrisma (which models $transaction as a callback, not the array form
// these two functions use).
const mockPrisma = {
  invoice: { findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn() },
  user: { findUnique: vi.fn() },
  $transaction: vi.fn(async (arg) => Promise.all(arg)),
};
vi.mock("../../lib/prisma.js", () => ({ prisma: mockPrisma }));
vi.mock("../../lib/campaignAccess.js", () => ({
  canPlanMakerAccessCampaign: vi.fn(async () => false),
  planMakerCampaignWhere: (userId) => ({ Plan: { createdById: userId } }),
}));
vi.mock("../billing/service.js", () => ({ getApprovedForUser: vi.fn(async () => null) }));

const { listInvoices, getInvoiceDetail } = await import("./service.js");

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.invoice.findMany.mockResolvedValue([]);
  mockPrisma.invoice.count.mockResolvedValue(0);
});

describe("listInvoices — finance.view scoping is read fresh, not just role", () => {
  it("a plain ADMIN or FINANCE account (finance.view true by baseline) sees every invoice", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ role: "FINANCE", permissions: null });
    await listInvoices({ id: "fin-1", role: "FINANCE" }, {});
    expect(mockPrisma.invoice.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });

  it("restricting a FINANCE account's finance.view now actually scopes them to their own invoices — it used to be a no-op", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ role: "FINANCE", permissions: { "finance.view": false, "finance.edit": false, "finance.approve": false, "finance.pay": false } });
    await listInvoices({ id: "fin-1", role: "FINANCE" }, {});
    expect(mockPrisma.invoice.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { creatorId: "fin-1" } }));
  });

  it("regression (24 Sep — own-scope roles never get global access): a TEAM_MEMBER with a stored finance.view grant still sees only their own invoices", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ role: "TEAM_MEMBER", permissions: { "finance.view": true } });
    await listInvoices({ id: "tm-1", role: "TEAM_MEMBER" }, {});
    expect(mockPrisma.invoice.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { creatorId: "tm-1" } }));
  });

  it("a Plan Maker's own-plans scope is unaffected by the finance.view overlay", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ role: "PLAN_MAKER", permissions: { "finance.view": false } });
    await listInvoices({ id: "pm-1", role: "PLAN_MAKER" }, {});
    expect(mockPrisma.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { OR: [{ campaign: { Plan: { createdById: "pm-1" } } }, { creatorId: "pm-1" }] } })
    );
  });
});

describe("getInvoiceDetail — same finance.view check as the list", () => {
  const otherCreatorsInvoice = { id: "inv-9", creatorId: "someone-else", campaignId: null, status: "RAISED", items: [] };

  it("a restricted FINANCE account gets a 404 for an invoice that isn't theirs — it used to be visible", async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue(otherCreatorsInvoice);
    mockPrisma.user.findUnique.mockResolvedValue({ role: "FINANCE", permissions: { "finance.view": false, "finance.edit": false, "finance.approve": false, "finance.pay": false } });
    await expect(getInvoiceDetail("inv-9", { id: "fin-1", role: "FINANCE" })).rejects.toMatchObject({ code: "INVOICE_NOT_FOUND" });
  });

  it("a plain FINANCE account can still see it", async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue(otherCreatorsInvoice);
    mockPrisma.user.findUnique.mockResolvedValue({ role: "FINANCE", permissions: null });
    await expect(getInvoiceDetail("inv-9", { id: "fin-1", role: "FINANCE" })).resolves.toMatchObject({ id: "inv-9" });
  });
});
