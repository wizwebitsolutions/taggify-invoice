import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  invoice: { findMany: vi.fn() },
  user: { findMany: vi.fn() },
};
vi.mock("../../lib/prisma.js", () => ({ prisma: mockPrisma }));

const notify = vi.fn();
vi.mock("../notifications/service.js", () => ({ notify: (...args) => notify(...args) }));

const { invoiceAgingSweepJob } = await import("./invoiceAgingSweep.js");

beforeEach(() => vi.clearAllMocks());

const overdueInvoice = { id: "inv-1", creatorId: "creator-1", dueDate: new Date("2020-01-01") };

describe("invoiceAgingSweepJob — who gets notified (23 Sep, Step 3: finance.view, not bare role)", () => {
  it("notifies the creator plus every user whose effective finance.view is true", async () => {
    mockPrisma.invoice.findMany.mockResolvedValue([overdueInvoice]);
    mockPrisma.user.findMany.mockResolvedValue([
      { id: "admin-1", role: "ADMIN", permissions: null }, // baseline true
      { id: "fin-1", role: "FINANCE", permissions: null }, // baseline true
      { id: "creator-2", role: "CREATOR", permissions: null }, // never
    ]);

    await invoiceAgingSweepJob();

    const notifiedIds = notify.mock.calls.map((c) => c[0]);
    expect(notifiedIds).toContain("creator-1"); // the billed creator, always
    expect(notifiedIds).toContain("admin-1");
    expect(notifiedIds).toContain("fin-1");
    expect(notifiedIds).not.toContain("creator-2");
  });

  it("a Finance account restricted below finance.view no longer gets notified — it used to be a no-op", async () => {
    mockPrisma.invoice.findMany.mockResolvedValue([overdueInvoice]);
    mockPrisma.user.findMany.mockResolvedValue([{ id: "fin-restricted", role: "FINANCE", permissions: { "finance.view": false, "finance.edit": false, "finance.approve": false, "finance.pay": false } }]);

    await invoiceAgingSweepJob();

    expect(notify.mock.calls.map((c) => c[0])).not.toContain("fin-restricted");
  });

  it("a role granted finance.view outside its baseline (e.g. a Plan Maker) now does get notified", async () => {
    mockPrisma.invoice.findMany.mockResolvedValue([overdueInvoice]);
    mockPrisma.user.findMany.mockResolvedValue([{ id: "pm-granted", role: "PLAN_MAKER", permissions: { "finance.view": true } }]);

    await invoiceAgingSweepJob();

    expect(notify.mock.calls.map((c) => c[0])).toContain("pm-granted");
  });

  it("does nothing when there are no overdue invoices — no user query, no notifications", async () => {
    mockPrisma.invoice.findMany.mockResolvedValue([]);

    await invoiceAgingSweepJob();

    expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });
});
