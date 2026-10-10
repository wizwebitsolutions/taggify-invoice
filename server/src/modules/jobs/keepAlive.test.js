import { describe, it, expect, vi, afterEach } from "vitest";
import { keepAliveUrl, pingOnce, startKeepAlive, KEEP_ALIVE_INTERVAL_MS } from "./keepAlive.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("keepAliveUrl", () => {
  it("uses RENDER_EXTERNAL_URL and appends /health", () => {
    expect(keepAliveUrl({ RENDER_EXTERNAL_URL: "https://app.onrender.com/" })).toBe("https://app.onrender.com/health");
  });

  it("prefers KEEP_ALIVE_URL over RENDER_EXTERNAL_URL", () => {
    expect(keepAliveUrl({ KEEP_ALIVE_URL: "https://taggify.in", RENDER_EXTERNAL_URL: "https://app.onrender.com" })).toBe(
      "https://taggify.in/health"
    );
  });

  it("is off locally (no URL) and when KEEP_ALIVE_DISABLED=true", () => {
    expect(keepAliveUrl({})).toBeNull();
    expect(keepAliveUrl({ RENDER_EXTERNAL_URL: "https://app.onrender.com", KEEP_ALIVE_DISABLED: "true" })).toBeNull();
  });
});

describe("startKeepAlive", () => {
  it("does nothing without a URL", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchImpl = vi.fn();
    expect(startKeepAlive({ env: {}, fetchImpl })).toBeNull();
  });

  it("pings /health every 10 minutes", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const timer = startKeepAlive({ env: { RENDER_EXTERNAL_URL: "https://app.onrender.com" }, fetchImpl });

    expect(fetchImpl).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(KEEP_ALIVE_INTERVAL_MS);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe("https://app.onrender.com/health");
    await vi.advanceTimersByTimeAsync(KEEP_ALIVE_INTERVAL_MS);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    clearInterval(timer);
  });
});

describe("pingOnce", () => {
  it("never throws when the ping fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(pingOnce("https://x/health", vi.fn().mockRejectedValue(new Error("ECONNRESET")))).resolves.toBeUndefined();
    await expect(pingOnce("https://x/health", vi.fn().mockResolvedValue({ ok: false, status: 502 }))).resolves.toBeUndefined();
  });
});
