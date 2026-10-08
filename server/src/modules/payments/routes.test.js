import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import express from "express";

// Route-level gate test for the Payments module — the whole thing is
// finance.pay-gated (tasks.md #5, 23 Sep: "shown only to admin or finance").
// Auth, the DB, and the service are all mocked; what's under test is which
// roles the router lets through.
const mockPrisma = { user: { findUnique: vi.fn() } };
vi.mock("../../lib/prisma.js", () => ({ prisma: mockPrisma }));

let currentUser;
vi.mock("../../middleware/requireAuth.js", () => ({
  requireAuth: (req, _res, next) => {
    req.user = currentUser;
    next();
  },
}));

const listPayouts = vi.fn(async () => ({ items: [], total: 0 }));
const createPayout = vi.fn(async () => ({ id: "payout-1", status: "DRAFT" }));
const cancelPayout = vi.fn(async () => null);
const requestPayoutReceiptUpload = vi.fn(async () => ({ uploadUrl: "https://upload" }));
const confirmPayoutReceipt = vi.fn(async () => ({ id: "payout-1", status: "PAID" }));
const listPendingLinks = vi.fn(async () => ({ items: [], total: 0 }));
const listMyPendingLinks = vi.fn(async () => ({ items: [], total: 0 }));
const listMyPayouts = vi.fn(async () => ({ items: [], total: 0 }));
const getPaymentSummary = vi.fn(async () => ({}));
const getMyPaymentSummary = vi.fn(async () => ({}));
vi.mock("./service.js", () => ({
  listPayouts: (...args) => listPayouts(...args),
  createPayout: (...args) => createPayout(...args),
  cancelPayout: (...args) => cancelPayout(...args),
  requestPayoutReceiptUpload: (...args) => requestPayoutReceiptUpload(...args),
  confirmPayoutReceipt: (...args) => confirmPayoutReceipt(...args),
  listPendingLinks: (...args) => listPendingLinks(...args),
  listMyPendingLinks: (...args) => listMyPendingLinks(...args),
  listMyPayouts: (...args) => listMyPayouts(...args),
  getPaymentSummary: (...args) => getPaymentSummary(...args),
  getMyPaymentSummary: (...args) => getMyPaymentSummary(...args),
}));

const { default: router } = await import("./routes.js");

const app = express();
app.use(express.json());
app.use("/payments", router);
const server = await new Promise((resolve) => {
  const s = app.listen(0, () => resolve(s));
});
const base = `http://127.0.0.1:${server.address().port}`;
afterAll(() => server.close());

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.user.findUnique.mockImplementation(async () => ({ role: currentUser.role, permissions: currentUser.permissions ?? null }));
});

async function call(user, method, path, body) {
  currentUser = user;
  const res = await fetch(`${base}/payments${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : method === "POST" ? "{}" : undefined,
  });
  return res.status;
}

describe("Payments routes — admin/finance only (tasks.md #5, 23 Sep)", () => {
  it("GET /payments/payouts: ADMIN and FINANCE can list; CREATOR, PLAN_MAKER, TEAM_MEMBER are refused", async () => {
    expect(await call({ id: "adm-1", role: "ADMIN" }, "GET", "/payouts")).toBe(200);
    expect(await call({ id: "fin-1", role: "FINANCE" }, "GET", "/payouts")).toBe(200);
    expect(await call({ id: "cr-1", role: "CREATOR" }, "GET", "/payouts")).toBe(403);
    expect(await call({ id: "pm-1", role: "PLAN_MAKER" }, "GET", "/payouts")).toBe(403);
    expect(await call({ id: "tm-1", role: "TEAM_MEMBER" }, "GET", "/payouts")).toBe(403);
    expect(listPayouts).toHaveBeenCalledTimes(2);
  });

  it("regression (24 Sep — own-scope roles never get global access): a PLAN_MAKER with a stored finance.pay grant still can't reach the module", async () => {
    expect(await call({ id: "pm-2", role: "PLAN_MAKER", permissions: { "finance.pay": true } }, "GET", "/payouts")).toBe(403);
  });

  it("POST /payments/payouts creates a payout for FINANCE, refuses CREATOR", async () => {
    expect(await call({ id: "fin-1", role: "FINANCE" }, "POST", "/payouts", { creatorId: "c-1", linkIds: ["l1"] })).toBe(201);
    expect(createPayout).toHaveBeenCalledWith(expect.objectContaining({ id: "fin-1" }), expect.objectContaining({ creatorId: "c-1", linkIds: ["l1"] }));
    expect(await call({ id: "cr-1", role: "CREATOR" }, "POST", "/payouts", { creatorId: "c-1", linkIds: ["l1"] })).toBe(403);
  });

  it("DELETE /payments/payouts/:id and the receipt endpoints are gated the same way", async () => {
    expect(await call({ id: "fin-1", role: "FINANCE" }, "DELETE", "/payouts/payout-1")).toBe(204);
    expect(await call({ id: "cr-1", role: "CREATOR" }, "DELETE", "/payouts/payout-1")).toBe(403);

    expect(await call({ id: "adm-1", role: "ADMIN" }, "GET", "/payouts/payout-1/receipt-upload")).toBe(200);
    expect(await call({ id: "cr-1", role: "CREATOR" }, "GET", "/payouts/payout-1/receipt-upload")).toBe(403);

    expect(await call({ id: "adm-1", role: "ADMIN" }, "POST", "/payouts/payout-1/receipt", { publicId: "payout-receipts/payout-1/x", fileName: "r.pdf" })).toBe(201);
    expect(await call({ id: "cr-1", role: "CREATOR" }, "POST", "/payouts/payout-1/receipt", { publicId: "payout-receipts/payout-1/x", fileName: "r.pdf" })).toBe(403);
  });
});

describe("Payments routes — 24 Sep redesign", () => {
  it("GET /payments/pending (every vendor's payable links) is finance.pay only", async () => {
    expect(await call({ id: "fin-1", role: "FINANCE" }, "GET", "/pending?q=memes&from=2026-09-01")).toBe(200);
    expect(listPendingLinks).toHaveBeenCalledWith(expect.objectContaining({ id: "fin-1" }), expect.objectContaining({ q: "memes", from: new Date("2026-09-01") }));
    expect(await call({ id: "cr-1", role: "CREATOR" }, "GET", "/pending")).toBe(403);
    expect(await call({ id: "tm-1", role: "TEAM_MEMBER" }, "GET", "/pending")).toBe(403);
  });

  it("GET /payments/me/pending and /me/payouts are open to a CREATOR (the service scopes them to the caller)", async () => {
    expect(await call({ id: "cr-1", role: "CREATOR" }, "GET", "/me/pending?assetId=a-1")).toBe(200);
    expect(listMyPendingLinks).toHaveBeenCalledWith(expect.objectContaining({ id: "cr-1" }), expect.objectContaining({ assetId: "a-1" }));
    expect(await call({ id: "cr-1", role: "CREATOR" }, "GET", "/me/payouts")).toBe(200);
    expect(listMyPayouts).toHaveBeenCalledWith(expect.objectContaining({ id: "cr-1" }), expect.anything());
  });

  it("the creator routes don't pass a vendor/creator override from the query through", async () => {
    await call({ id: "cr-1", role: "CREATOR" }, "GET", "/me/pending?ownerId=someone-else");
    expect(listMyPendingLinks.mock.calls[0][1].ownerId).toBeUndefined();
    await call({ id: "cr-1", role: "CREATOR" }, "GET", "/me/payouts?creatorId=someone-else&status=DRAFT");
    expect(listMyPayouts.mock.calls[0][1].creatorId).toBeUndefined();
    expect(listMyPayouts.mock.calls[0][1].status).toBeUndefined();
  });

  it("POST receipt accepts paidOn and utr", async () => {
    expect(
      await call({ id: "fin-1", role: "FINANCE" }, "POST", "/payouts/payout-1/receipt", {
        publicId: "payout-receipts/payout-1/x",
        fileName: "r.pdf",
        paidOn: "2026-09-20",
        utr: "UTR1",
      })
    ).toBe(201);
    expect(confirmPayoutReceipt).toHaveBeenCalledWith("payout-1", expect.anything(), expect.objectContaining({ paidOn: new Date("2026-09-20"), utr: "UTR1" }));
  });

  it("GET /payments/summary takes the list filters (month, vendor, page) and is finance.pay only (2 Oct)", async () => {
    expect(await call({ id: "fin-1", role: "FINANCE" }, "GET", "/summary?ownerId=cr-9&q=memes&from=2026-09-01&to=2026-09-30")).toBe(200);
    expect(getPaymentSummary).toHaveBeenCalledWith(
      expect.objectContaining({ id: "fin-1" }),
      expect.objectContaining({ ownerId: "cr-9", q: "memes", from: new Date("2026-09-01"), to: new Date("2026-09-30") })
    );
    expect(await call({ id: "cr-1", role: "CREATOR" }, "GET", "/summary")).toBe(403);
    expect(await call({ id: "tm-1", role: "TEAM_MEMBER" }, "GET", "/summary")).toBe(403);
    expect(await call({ id: "fin-1", role: "FINANCE" }, "GET", "/summary?from=not-a-date")).toBe(400);
  });

  it("GET /payments/me/summary passes the month through but never a vendor override (2 Oct)", async () => {
    expect(await call({ id: "cr-1", role: "CREATOR" }, "GET", "/me/summary?ownerId=someone-else&from=2026-09-01")).toBe(200);
    expect(getMyPaymentSummary.mock.calls[0][1]).toMatchObject({ from: new Date("2026-09-01") });
    expect(getMyPaymentSummary.mock.calls[0][1].ownerId).toBeUndefined();
  });
});
