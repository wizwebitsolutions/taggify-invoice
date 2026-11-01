/**
 * Post Tracker Proxy Pool & Rotation.
 *
 * Keeps a pool of proxies configured via POST_TRACKER_PROXIES or PROXIES.
 * Supports:
 * - Parsing multiple formats: http(s)://, socks5://, host:port, with or without user:pass.
 * - Delimiters: comma, semicolon, newline.
 * - Round-robin rotation across captures.
 * - Per-proxy cooldown on blocks / login walls / rate-limits.
 * - Automatic failover: if blocked or network error, mark proxy on cooldown and try next proxy.
 * - Graceful fallback to direct connection when no proxies are configured.
 */

const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

export function parseProxy(entry) {
  if (!entry) return null;

  if (typeof entry === "object") {
    if (!entry.server) return null;
    const username = entry.username || undefined;
    const password = entry.password || undefined;
    const id = `${entry.server}#${username || ""}`;
    return {
      id,
      server: entry.server,
      username,
      password,
      raw: entry.server,
    };
  }

  let raw = String(entry).trim();
  if (!raw) return null;

  // If no scheme is provided, default to http://
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw)) {
    raw = `http://${raw}`;
  }

  try {
    const u = new URL(raw);
    const server = `${u.protocol}//${u.host}`;
    const username = u.username ? decodeURIComponent(u.username) : undefined;
    const password = u.password ? decodeURIComponent(u.password) : undefined;
    const id = `${server}#${username || ""}`;
    return {
      id,
      server,
      username,
      password,
      raw: entry,
    };
  } catch {
    return null;
  }
}

export function parseProxyList(input) {
  if (!input) return [];
  const entries = Array.isArray(input)
    ? input
    : String(input)
        .split(/[\r\n;,]+/)
        .map((s) => s.trim())
        .filter(Boolean);

  const seen = new Set();
  const list = [];
  for (const item of entries) {
    const parsed = parseProxy(item);
    if (parsed && !seen.has(parsed.id)) {
      seen.add(parsed.id);
      list.push(parsed);
    }
  }
  return list;
}

export class ProxyPool {
  constructor(options = {}) {
    this.cooldownMs = options.cooldownMs ?? Number(process.env.POST_TRACKER_PROXY_COOLDOWN_MS || DEFAULT_COOLDOWN_MS);
    this.proxies = [];
    this.currentIndex = 0;
    this.envLoaded = false;

    if (options.proxies) {
      this.setProxies(options.proxies);
      this.envLoaded = true;
    }
  }

  get size() {
    this.lazyLoadFromEnv();
    return this.proxies.length;
  }

  lazyLoadFromEnv() {
    if (this.envLoaded) return;
    this.reloadFromEnv();
  }

  reloadFromEnv() {
    const envStr = process.env.POST_TRACKER_PROXIES || process.env.PROXIES || "";
    this.setProxies(parseProxyList(envStr));
    this.envLoaded = true;
  }

  setProxies(list) {
    const parsed = Array.isArray(list) ? list.map((p) => (p && p.id ? p : parseProxy(p))).filter(Boolean) : parseProxyList(list);
    this.proxies = parsed.map((p) => ({
      id: p.id,
      server: p.server,
      username: p.username,
      password: p.password,
      raw: p.raw || p.server,
      blockedUntil: 0,
      failureCount: 0,
      successCount: 0,
      lastUsedAt: null,
      lastError: null,
    }));
    this.currentIndex = 0;
  }

  clear() {
    this.proxies = [];
    this.currentIndex = 0;
  }

  hasAvailableProxy(excludeIds = new Set()) {
    this.lazyLoadFromEnv();
    return this.proxies.some((p) => !excludeIds.has(p.id));
  }

  getNextProxy({ excludeIds = new Set(), allowCooldownFallback = true } = {}) {
    this.lazyLoadFromEnv();
    if (this.proxies.length === 0) return null;

    const total = this.proxies.length;
    const now = Date.now();

    // 1. First pass: look for a non-excluded proxy that is NOT on cooldown
    for (let offset = 0; offset < total; offset++) {
      const idx = (this.currentIndex + offset) % total;
      const candidate = this.proxies[idx];

      if (!excludeIds.has(candidate.id) && candidate.blockedUntil <= now) {
        this.currentIndex = (idx + 1) % total;
        candidate.lastUsedAt = new Date();
        return {
          id: candidate.id,
          server: candidate.server,
          username: candidate.username,
          password: candidate.password,
        };
      }
    }

    // 2. Second pass: if all non-excluded proxies are on cooldown, fallback to the one expiring soonest
    if (allowCooldownFallback) {
      let earliest = null;
      let earliestIdx = -1;

      for (let offset = 0; offset < total; offset++) {
        const idx = (this.currentIndex + offset) % total;
        const candidate = this.proxies[idx];

        if (!excludeIds.has(candidate.id)) {
          if (!earliest || candidate.blockedUntil < earliest.blockedUntil) {
            earliest = candidate;
            earliestIdx = idx;
          }
        }
      }

      if (earliest) {
        this.currentIndex = (earliestIdx + 1) % total;
        earliest.lastUsedAt = new Date();
        return {
          id: earliest.id,
          server: earliest.server,
          username: earliest.username,
          password: earliest.password,
        };
      }
    }

    // All available proxies were already tried for this capture
    return null;
  }

  markBlocked(proxy, reason = "", customCooldownMs) {
    if (!proxy) return;
    const match = this.proxies.find((p) => p.id === proxy.id || p.server === proxy.server);
    if (!match) return;

    const cooldown = customCooldownMs ?? this.cooldownMs;
    match.blockedUntil = Date.now() + cooldown;
    match.failureCount += 1;
    match.lastError = String(reason || "Blocked");
  }

  markSuccess(proxy) {
    if (!proxy) return;
    const match = this.proxies.find((p) => p.id === proxy.id || p.server === proxy.server);
    if (!match) return;

    match.blockedUntil = 0;
    match.successCount += 1;
    match.lastError = null;
  }

  getStats() {
    this.lazyLoadFromEnv();
    const now = Date.now();
    return {
      total: this.proxies.length,
      active: this.proxies.filter((p) => p.blockedUntil <= now).length,
      blocked: this.proxies.filter((p) => p.blockedUntil > now).length,
      proxies: this.proxies.map((p) => ({
        id: p.id,
        server: p.server,
        hasAuth: Boolean(p.username),
        blockedUntil: p.blockedUntil > now ? new Date(p.blockedUntil).toISOString() : null,
        failureCount: p.failureCount,
        successCount: p.successCount,
        lastError: p.lastError,
      })),
    };
  }
}

export const defaultProxyPool = new ProxyPool();
