import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import express from "express";

// GET /billing (23 Sep, Step 3) used to decide "sees every profile vs. only
// your own" with a bare `["ADMIN","FINANCE"].includes(role)` check — a
// restricted Finance account's finance.view being turned off never actually
// hid anyone else's bank/PAN details from them. Auth, the DB, and the
// service are all mocked; what's under test is the effective-permission
// branch this route now takes.
const mockPrisma = { user: { findUnique: vi.fn() } };
vi.mock("../../lib/prisma.js", () => ({ prisma: mockPrisma }));

let currentUser;
vi.mock("../../middleware/requireAuth.js", () => ({
  requireAuth: (req, _res, next) => {
    req.user = currentUser;
    next();
  },
}));

const listAll = vi.fn(async () => [{ id: "bp-other", userId: "someone-else", pan: "AAAAA0000A" }]);
const listOwn = vi.fn(async (userId) => [{ id: "bp-own", userId, pan: "BBBBB1111B" }]);
vi.mock("./service.js", () => ({ listAll: (...args) => listAll(...args), listOwn: (...args) => listOwn(...args) }));

const { default: router } = await import("./routes.js");

const app = express();
app.use(express.json());
app.use("/billing", router);
const server = await new Promise((resolve) => {
  const s = app.listen(0, () => resolve(s));
});
const base = `http://127.0.0.1:${server.address().port}`;
afterAll(() => server.close());

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.user.findUnique.mockImplementation(async () => ({ role: currentUser.role, permissions: currentUser.permissions ?? null }));
});

async function listAs(user) {
  currentUser = user;
  const res = await fetch(`${base}/billing`);
  return { status: res.status, body: await res.json() };
}

describe("GET /billing — finance.view decides the scope, read fresh (23 Sep, Step 3)", () => {
  it("a plain ADMIN or FINANCE account (finance.view true by baseline) sees every profile", async () => {
    expect((await listAs({ id: "adm-1", role: "ADMIN" })).body).toEqual([{ id: "bp-other", userId: "someone-else", pan: "AAAAA0000A" }]);
    expect(listAll).toHaveBeenCalledTimes(1);

    listAll.mockClear();
    expect((await listAs({ id: "fin-1", role: "FINANCE" })).body).toEqual([{ id: "bp-other", userId: "someone-else", pan: "AAAAA0000A" }]);
    expect(listAll).toHaveBeenCalledTimes(1);
  });

  it("a CREATOR sees only their own profile", async () => {
    const { body } = await listAs({ id: "cr-1", role: "CREATOR" });
    expect(body).toEqual([{ id: "bp-own", userId: "cr-1", pan: "BBBBB1111B" }]);
    expect(listOwn).toHaveBeenCalledWith("cr-1");
    expect(listAll).not.toHaveBeenCalled();
  });

  it("restricting a FINANCE account's finance.view now actually hides every other profile — it used to be a no-op", async () => {
    const { body } = await listAs({ id: "fin-1", role: "FINANCE", permissions: { "finance.view": false, "finance.edit": false, "finance.approve": false, "finance.pay": false } });
    expect(body).toEqual([{ id: "bp-own", userId: "fin-1", pan: "BBBBB1111B" }]);
    expect(listAll).not.toHaveBeenCalled();
  });

  it("granting finance.view to a role that doesn't normally hold it opens the full list", async () => {
    const { body } = await listAs({ id: "pm-1", role: "PLAN_MAKER", permissions: { "finance.view": true } });
    expect(body).toEqual([{ id: "bp-other", userId: "someone-else", pan: "AAAAA0000A" }]);
    expect(listAll).toHaveBeenCalledTimes(1);
  });
});
