import { describe, it, expect, vi, beforeEach } from "vitest";

// One User-row read per request (22 Oct): auth, access middleware and the
// service's permission reads share a single findUnique inside a request
// scope, and read afresh on the next request.
const mockPrisma = { user: { findUnique: vi.fn(async ({ where }) => ({ role: "CREATOR", permissions: null, deactivatedAt: null, id: where.id })) } };
vi.mock("./prisma.js", () => ({ prisma: mockPrisma }));

const { loadUserAccess, withRequestUserCache } = await import("./requestUser.js");

beforeEach(() => vi.clearAllMocks());

describe("loadUserAccess", () => {
  it("reads the row once for the whole request, however many layers ask", async () => {
    const rows = await withRequestUserCache(async () => {
      const first = await loadUserAccess("u1");
      const [second, third] = await Promise.all([loadUserAccess("u1"), loadUserAccess("u1")]);
      return [first, second, third];
    });
    expect(mockPrisma.user.findUnique).toHaveBeenCalledTimes(1);
    expect(rows[0]).toBe(rows[1]);
    expect(rows[1]).toBe(rows[2]);
  });

  it("a different request reads again, so a permission edit applies on the next call", async () => {
    await withRequestUserCache(() => loadUserAccess("u1"));
    await withRequestUserCache(() => loadUserAccess("u1"));
    expect(mockPrisma.user.findUnique).toHaveBeenCalledTimes(2);
  });

  it("keeps users apart within one request", async () => {
    await withRequestUserCache(() => Promise.all([loadUserAccess("u1"), loadUserAccess("u2")]));
    expect(mockPrisma.user.findUnique).toHaveBeenCalledTimes(2);
  });

  it("outside a request scope (cron, direct service calls) it just queries", async () => {
    await loadUserAccess("u1");
    await loadUserAccess("u1");
    expect(mockPrisma.user.findUnique).toHaveBeenCalledTimes(2);
    expect(await loadUserAccess(null)).toBeNull();
  });
});
