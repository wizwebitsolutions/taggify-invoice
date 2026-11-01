import { describe, it, expect, beforeEach, vi } from "vitest";
import { parseProxy, parseProxyList, ProxyPool } from "./proxyPool.js";

describe("parseProxy", () => {
  it("parses http with user:pass", () => {
    const res = parseProxy("http://john:secret123@proxy.example.com:8080");
    expect(res).toEqual({
      id: "http://proxy.example.com:8080#john",
      server: "http://proxy.example.com:8080",
      username: "john",
      password: "secret123",
      raw: "http://john:secret123@proxy.example.com:8080",
    });
  });

  it("parses socks5 without credentials", () => {
    const res = parseProxy("socks5://192.168.1.100:1080");
    expect(res).toEqual({
      id: "socks5://192.168.1.100:1080#",
      server: "socks5://192.168.1.100:1080",
      username: undefined,
      password: undefined,
      raw: "socks5://192.168.1.100:1080",
    });
  });

  it("adds http:// if protocol is omitted", () => {
    const res = parseProxy("10.0.0.1:3128");
    expect(res).toEqual({
      id: "http://10.0.0.1:3128#",
      server: "http://10.0.0.1:3128",
      username: undefined,
      password: undefined,
      raw: "10.0.0.1:3128",
    });
  });

  it("accepts pre-parsed proxy object", () => {
    const res = parseProxy({ server: "http://p1.test:80", username: "u", password: "p" });
    expect(res).toEqual({
      id: "http://p1.test:80#u",
      server: "http://p1.test:80",
      username: "u",
      password: "p",
      raw: "http://p1.test:80",
    });
  });

  it("returns null for empty or invalid input", () => {
    expect(parseProxy("")).toBeNull();
    expect(parseProxy(null)).toBeNull();
    expect(parseProxy({})).toBeNull();
  });
});

describe("parseProxyList", () => {
  it("parses comma, semicolon and newline separated lists and deduplicates", () => {
    const raw = `
      http://p1.test:8080, http://p2.test:8080;
      http://user:pass@p3.test:1080
      http://p1.test:8080
    `;
    const list = parseProxyList(raw);
    expect(list).toHaveLength(3);
    expect(list[0].server).toBe("http://p1.test:8080");
    expect(list[1].server).toBe("http://p2.test:8080");
    expect(list[2].server).toBe("http://p3.test:1080");
    expect(list[2].username).toBe("user");
    expect(list[2].password).toBe("pass");
  });
});

describe("ProxyPool", () => {
  let pool;

  beforeEach(() => {
    vi.useFakeTimers();
    pool = new ProxyPool({
      proxies: [
        "http://proxy-1.test:8000",
        "http://proxy-2.test:8000",
        "http://proxy-3.test:8000",
      ],
      cooldownMs: 60_000,
    });
  });

  it("cycles through proxies in round-robin order", () => {
    expect(pool.getNextProxy().server).toBe("http://proxy-1.test:8000");
    expect(pool.getNextProxy().server).toBe("http://proxy-2.test:8000");
    expect(pool.getNextProxy().server).toBe("http://proxy-3.test:8000");
    expect(pool.getNextProxy().server).toBe("http://proxy-1.test:8000");
  });

  it("skips excluded proxies during a single capture flow", () => {
    const tried = new Set();
    const p1 = pool.getNextProxy({ excludeIds: tried });
    expect(p1.server).toBe("http://proxy-1.test:8000");
    tried.add(p1.id);

    const p2 = pool.getNextProxy({ excludeIds: tried });
    expect(p2.server).toBe("http://proxy-2.test:8000");
    tried.add(p2.id);

    const p3 = pool.getNextProxy({ excludeIds: tried });
    expect(p3.server).toBe("http://proxy-3.test:8000");
    tried.add(p3.id);

    // All 3 tried in this flow: returns null
    const p4 = pool.getNextProxy({ excludeIds: tried });
    expect(p4).toBeNull();
  });

  it("skips proxies that are currently on cooldown", () => {
    const p1 = pool.getNextProxy();
    pool.markBlocked(p1, "HTTP 429 Too Many Requests");

    // Next call should skip p1 (cooldown active) and return p2
    const p2 = pool.getNextProxy();
    expect(p2.server).toBe("http://proxy-2.test:8000");

    // Advance past cooldown (60s)
    vi.advanceTimersByTime(61_000);

    // Now p1 is eligible again
    const p3 = pool.getNextProxy();
    expect(p3.server).toBe("http://proxy-3.test:8000");
    const p4 = pool.getNextProxy();
    expect(p4.server).toBe("http://proxy-1.test:8000");
  });

  it("falls back to proxy with earliest expiring cooldown if all are blocked", () => {
    const p1 = pool.getNextProxy();
    pool.markBlocked(p1, "Rate limited", 10_000); // expires in 10s

    const p2 = pool.getNextProxy();
    pool.markBlocked(p2, "Rate limited", 50_000); // expires in 50s

    const p3 = pool.getNextProxy();
    pool.markBlocked(p3, "Rate limited", 30_000); // expires in 30s

    // All 3 are blocked! Fallback picks p1 (lowest cooldown remaining)
    const fallback = pool.getNextProxy();
    expect(fallback.server).toBe("http://proxy-1.test:8000");
  });

  it("clears cooldown and updates stats on markSuccess", () => {
    const p1 = pool.getNextProxy();
    pool.markBlocked(p1, "Temporarily blocked");
    expect(pool.getStats().blocked).toBe(1);

    pool.markSuccess(p1);
    expect(pool.getStats().blocked).toBe(0);
    expect(pool.getStats().proxies[0].successCount).toBe(1);
    expect(pool.getStats().proxies[0].lastError).toBeNull();
  });

  it("returns null when pool is empty (direct connection)", () => {
    const emptyPool = new ProxyPool({ proxies: [] });
    expect(emptyPool.size).toBe(0);
    expect(emptyPool.getNextProxy()).toBeNull();
    expect(emptyPool.hasAvailableProxy()).toBe(false);
  });
});
