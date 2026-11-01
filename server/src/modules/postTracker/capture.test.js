import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { decodeEntities, parseCount, parseMetaDescription, captureSnapshot, LoginWallError, PostUnavailableError } from "./capture.js";
import { ProxyPool } from "./proxyPool.js";

// The meta description is what the snapshot's numbers come from (24 Oct).
// The first case is the exact text Instagram served for a real public reel.
describe("parseMetaDescription", () => {
  it("reads likes, comments, handle, date and caption from Instagram's real meta text", () => {
    const real = "186 likes, 67 comments - huz_aifadevloper on October 23, 2026: &quot;This AI agent runs a YouTube channel for you &#x1f916;&#x1f3a5;&quot;. ";
    expect(parseMetaDescription(real)).toEqual({
      likeCount: 186,
      commentCount: 67,
      ownerHandle: "huz_aifadevloper",
      postedOn: "October 23, 2026",
      caption: "This AI agent runs a YouTube channel for you 🤖🎥",
    });
  });

  it("reads thousands with commas and K/M shorthand", () => {
    expect(parseMetaDescription("6,313 likes, 65 comments - _pahadi_frames on August 2, 2026: \"Somewhere\"")).toMatchObject({ likeCount: 6313, commentCount: 65, ownerHandle: "_pahadi_frames" });
    expect(parseMetaDescription("12.5K likes, 1M comments - a.b on May 1, 2026")).toMatchObject({ likeCount: 12500, commentCount: 1000000, caption: null });
  });

  it("singular counts, and a hidden like count", () => {
    expect(parseMetaDescription("1 like, 1 comment - someone on May 1, 2026: \"hi\"")).toMatchObject({ likeCount: 1, commentCount: 1 });
    expect(parseMetaDescription("40 comments - someone on May 1, 2026: \"hi\"")).toMatchObject({ likeCount: null, commentCount: 40 });
  });

  it("returns null for anything that isn't a post description (e.g. a login page)", () => {
    expect(parseMetaDescription(null)).toBeNull();
    expect(parseMetaDescription("Create an account or log in to Instagram - Share what you're into with the people who get you.")).toBeNull();
  });
});

describe("parseCount / decodeEntities", () => {
  it.each([
    ["186", 186],
    ["6,313", 6313],
    ["1.2K", 1200],
    ["3M", 3000000],
    ["", null],
    ["abc", null],
  ])("%j → %j", (raw, n) => expect(parseCount(raw)).toBe(n));

  it("decodes named, decimal and hex entities", () => {
    expect(decodeEntities("&quot;a&amp;b&#39;&#x1f916;&lt;")).toBe("\"a&b'🤖<");
  });
});

describe("captureSnapshot proxy rotation & failover", () => {
  it("captures directly without proxy when pool is empty", async () => {
    const pool = new ProxyPool({ proxies: [] });
    const mockExecute = vi.fn().mockResolvedValue({ screenshot: Buffer.from("png"), likeCount: 10 });

    const res = await captureSnapshot("https://www.instagram.com/reel/123/", {
      proxyPool: pool,
      executeCapture: mockExecute,
    });

    expect(mockExecute).toHaveBeenCalledTimes(1);
    expect(mockExecute).toHaveBeenCalledWith("https://www.instagram.com/reel/123/", null, expect.any(Object));
    expect(res.likeCount).toBe(10);
  });

  it("rotates to next proxy when first proxy is blocked by a login wall", async () => {
    const pool = new ProxyPool({
      proxies: [
        "http://proxy-1.test:8000",
        "http://proxy-2.test:8000",
      ],
      cooldownMs: 60_000,
    });

    const mockExecute = vi.fn()
      .mockRejectedValueOnce(new LoginWallError("Instagram asked for a login"))
      .mockResolvedValueOnce({ screenshot: Buffer.from("png"), likeCount: 42 });

    const res = await captureSnapshot("https://www.instagram.com/reel/123/", {
      proxyPool: pool,
      executeCapture: mockExecute,
    });

    expect(mockExecute).toHaveBeenCalledTimes(2);
    // First attempt used proxy 1
    expect(mockExecute.mock.calls[0][1].server).toBe("http://proxy-1.test:8000");
    // Second attempt rotated to proxy 2
    expect(mockExecute.mock.calls[1][1].server).toBe("http://proxy-2.test:8000");
    expect(res.likeCount).toBe(42);

    // Proxy 1 should now be marked blocked/cooldown
    const stats = pool.getStats();
    expect(stats.blocked).toBe(1);
    expect(stats.proxies[0].failureCount).toBe(1);
    // Proxy 2 succeeded
    expect(stats.proxies[1].successCount).toBe(1);
  });

  it("rotates to next proxy when proxy encounters a network/tunnel failure", async () => {
    const pool = new ProxyPool({
      proxies: [
        "http://bad-proxy.test:8000",
        "http://good-proxy.test:8000",
      ],
    });

    const mockExecute = vi.fn()
      .mockRejectedValueOnce(new Error("page.goto: net::ERR_TUNNEL_CONNECTION_FAILED"))
      .mockResolvedValueOnce({ screenshot: Buffer.from("png"), likeCount: 99 });

    const res = await captureSnapshot("https://www.instagram.com/reel/123/", {
      proxyPool: pool,
      executeCapture: mockExecute,
    });

    expect(mockExecute).toHaveBeenCalledTimes(2);
    expect(mockExecute.mock.calls[0][1].server).toBe("http://bad-proxy.test:8000");
    expect(mockExecute.mock.calls[1][1].server).toBe("http://good-proxy.test:8000");
    expect(res.likeCount).toBe(99);
  });

  it("does NOT rotate proxies when post is unavailable (404/deleted)", async () => {
    const pool = new ProxyPool({
      proxies: [
        "http://proxy-1.test:8000",
        "http://proxy-2.test:8000",
      ],
    });

    const mockExecute = vi.fn().mockRejectedValue(new PostUnavailableError("This post doesn't exist any more"));

    await expect(
      captureSnapshot("https://www.instagram.com/reel/123/", {
        proxyPool: pool,
        executeCapture: mockExecute,
      })
    ).rejects.toThrow(PostUnavailableError);

    // Only called once because post unavailability is post-specific, not proxy-blocked
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it("throws last error when all proxies in the pool fail", async () => {
    const pool = new ProxyPool({
      proxies: [
        "http://proxy-1.test:8000",
        "http://proxy-2.test:8000",
      ],
    });

    const mockExecute = vi.fn().mockRejectedValue(new LoginWallError("Instagram rate limited"));

    await expect(
      captureSnapshot("https://www.instagram.com/reel/123/", {
        proxyPool: pool,
        executeCapture: mockExecute,
      })
    ).rejects.toThrow(LoginWallError);

    expect(mockExecute).toHaveBeenCalledTimes(2);
  });
});

// The screenshot tidy-up (27 Oct) is DOM logic against Instagram's layout, so
// it's checked in a real Chromium page shaped like the logged-out reel view:
// a fixed top bar, a "Sign up" button in a short wrapper inside a full-height
// container, and the post's like rail. Only the bars may go.
describe("screenshot tidy-up scripts", () => {
  let browser;
  let page;
  beforeAll(async () => {
    const { chromium } = await import("playwright");
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage({ viewport: { width: 412, height: 839 } });
    await page.setContent(`
      <body style="margin:0">
        <div id="root" style="position:relative;height:839px">
          <div id="top" style="position:fixed;top:0;left:0;right:0;height:60px"><a>Log in</a><button>Open app</button></div>
          <div id="post" style="position:absolute;top:0;height:839px;width:100%">
            <span id="likes">117K</span>
            <div id="signup-wrap" style="height:64px;margin-top:700px"><a>Sign up for Instagram</a></div>
          </div>
        </div>
      </body>`);
  }, 30_000);
  afterAll(async () => {
    await browser?.close();
  });

  it("hides the visitor bars but never the post or the page root", async () => {
    const { HIDE_WEB_CHROME_SCRIPT } = await import("./capture.js");
    const hidden = await page.evaluate(HIDE_WEB_CHROME_SCRIPT);
    expect(hidden).toBe(2);
    const visibility = (sel) => page.locator(sel).evaluate((el) => getComputedStyle(el).visibility);
    expect(await visibility("#top")).toBe("hidden");
    expect(await visibility("#signup-wrap")).toBe("hidden");
    expect(await visibility("#post")).toBe("visible");
    expect(await visibility("#root")).toBe("visible");
    expect(await visibility("#likes")).toBe("visible");
    // Running it again doesn't count the same bars twice.
    expect(await page.evaluate(HIDE_WEB_CHROME_SCRIPT)).toBe(0);
  });

  it("adds the provenance strip with the stamp text", async () => {
    const { stampScript, captureStamp } = await import("./capture.js");
    const text = captureStamp("https://www.instagram.com/reel/DZKliBFPVA2/", new Date("2026-10-27T08:12:00Z"));
    await page.evaluate(stampScript, text);
    const strip = page.locator("[data-taggify-stamp]");
    expect(await strip.count()).toBe(1);
    expect(await strip.textContent()).toBe("Captured 27 Oct 2026, 1:42 pm IST · instagram.com/reel/DZKliBFPVA2/");
    expect(await strip.evaluate((el) => getComputedStyle(el).position)).toBe("fixed");
  });
});
