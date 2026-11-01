import { chromium, devices } from "playwright";
import { defaultProxyPool } from "./proxyPool.js";

/**
 * Post Tracker snapshot capture (24/25 Oct — "implement it using playwright").
 * Opens a link's public page the way a logged-out phone visitor would and
 * keeps what that visitor sees: a phone-size screenshot (snapshot 1), the
 * cover image, and the counts Instagram prints in the page's own meta
 * description ("186 likes, 67 comments - handle on October 23, 2026: …").
 * The screenshot is tidied, not altered (27 Oct): Instagram's own "Log in" /
 * "Sign up" bars are hidden and a "Captured <when> · <page>" strip is added
 * at the bottom. The post, its counts and its handle are shown as served.
 *
 * For public video reels, also visits the creator's reels tab with desktop
 * user-agent (https://instagram.com/<handle>/reels/) to scrape the real
 * public play/view count overlay for that shortcode.
 *
 * Supports proxy rotation via POST_TRACKER_PROXIES / PROXIES. If Instagram
 * blocks an IP with a login wall, 429 rate limit, 403 or network error, the
 * current proxy is marked in cooldown and capture is automatically retried
 * with the next proxy in the pool. When no proxies are configured, it falls
 * back to direct connection.
 */

export class PostUnavailableError extends Error {}
export class LoginWallError extends Error {}

const PHONE = devices["Pixel 7"];
const DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const NAV_TIMEOUT_MS = 30_000;
const SETTLE_MS = 4_000;
/** How long to wait for the post itself (its like button) after "Continue on web". */
const POST_VISIBLE_TIMEOUT_MS = 15_000;
const VIDEO_FRAME_TIMEOUT_MS = 6_000;
const SCREENSHOT_JPEG_QUALITY = 88;

/**
 * The one-line provenance strip burned into the bottom of every screenshot
 * (27 Oct): when it was taken and from which page, so a downloaded image
 * still says where it came from. IST because that's where the team reads it.
 */
export function captureStamp(url, at = new Date()) {
  const when = at.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });
  return `Captured ${when} IST · ${url.replace(/^https?:\/\/(www\.)?/, "")}`;
}

/**
 * Hides the logged-out web furniture ("Log in", "Open app", "Sign up for
 * Instagram") before the screenshot. Those are Instagram's bars for the
 * visitor, not part of the post. Each label's wrapper is found by climbing
 * to the tallest ancestor that is still a bar (under 35% of the viewport),
 * so the page root is never touched. Runs in the page; nothing else changes.
 */
export const HIDE_WEB_CHROME_SCRIPT = `(() => {
  const labels = ["Log in", "Open app", "Sign up for Instagram"];
  const maxBar = innerHeight * 0.35;
  let hidden = 0;
  for (const el of document.querySelectorAll("a, button, div[role=button]")) {
    if (!labels.includes((el.textContent || "").trim())) continue;
    let bar = el;
    for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
      if (node.getBoundingClientRect().height >= maxBar) break;
      bar = node;
    }
    if (bar.style.visibility !== "hidden") { bar.style.setProperty("visibility", "hidden", "important"); hidden++; }
  }
  return hidden;
})()`;

// The two below take an argument, so they're real functions for page.evaluate
// (a string is evaluated as a bare expression and never receives the argument).

/** Runs in the page: appends the stamp as a fixed strip at the bottom. */
export function stampScript(text) {
  const strip = document.createElement("div");
  strip.setAttribute("data-taggify-stamp", "");
  strip.textContent = text;
  Object.assign(strip.style, {
    position: "fixed", left: "0", right: "0", bottom: "0", zIndex: "2147483647",
    background: "rgba(0,0,0,.78)", color: "#fff", font: "500 11px/16px system-ui, sans-serif",
    padding: "6px 12px", textAlign: "center",
  });
  document.body.appendChild(strip);
}

/** Runs in the page: resolves once the reel's <video> has a frame to draw (or there's no video / it timed out). */
export function videoReadyScript(timeoutMs) {
  return new Promise((resolve) => {
    const video = document.querySelector("video");
    if (!video) return resolve("no-video");
    if (video.readyState >= 2) return resolve("ready");
    video.addEventListener("loadeddata", () => resolve("loaded"), { once: true });
    setTimeout(() => resolve("timeout"), timeoutMs);
  });
}

let browserPromise = null;

/** One shared headless Chromium for the process, relaunched if it died. */
export async function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium.launch({ headless: true }).catch((err) => {
      browserPromise = null;
      throw err;
    });
  }
  const browser = await browserPromise;
  if (browser.isConnected()) return browser;
  browserPromise = null;
  return getBrowser();
}

export async function closeBrowser() {
  const pending = browserPromise;
  browserPromise = null;
  if (pending) await (await pending.catch(() => null))?.close().catch(() => {});
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'" };
export function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/** "6,313" → 6313, "12.5K" → 12500, "1M" → 1000000. */
export function parseCount(raw) {
  if (!raw) return null;
  const m = String(raw).trim().match(/^([\d.,]+)\s*([KkMm])?$/);
  if (!m) return null;
  const scale = m[2] ? (m[2].toLowerCase() === "k" ? 1_000 : 1_000_000) : 1;
  const n = m[2] ? parseFloat(m[1].replace(/,/g, "")) : parseInt(m[1].replace(/[.,]/g, ""), 10);
  return Number.isFinite(n) ? Math.round(n * scale) : null;
}

/**
 * Instagram's meta description for a public post. Either count is left out
 * when the owner hid it, so each part is optional.
 */
export function parseMetaDescription(content) {
  if (!content) return null;
  const text = decodeEntities(content).trim();
  const m = text.match(/^(?:([\d.,]+\s*[KkMm]?) likes?,\s*)?(?:([\d.,]+\s*[KkMm]?) comments?\s*-\s*)?([A-Za-z0-9._]+) on ([A-Z][a-z]+ \d{1,2}, \d{4})(?::\s*([\s\S]*))?$/);
  if (!m) return null;
  const caption = m[5]?.trim().replace(/^"/, "").replace(/"\.?$/, "").trim() || null;
  return { likeCount: parseCount(m[1]), commentCount: parseCount(m[2]), ownerHandle: m[3], postedOn: m[4], caption };
}

/**
 * Navigates to the creator's reels tab using a desktop User-Agent so Instagram
 * renders the public reels grid instead of a mobile app redirect wall.
 */
export async function fetchReelViews(browser, ownerHandle, shortcode, proxy) {
  const contextOptions = {
    userAgent: DESKTOP_UA,
    viewport: { width: 1280, height: 900 },
    locale: "en-US",
  };
  if (proxy?.server) {
    contextOptions.proxy = {
      server: proxy.server,
      ...(proxy.username ? { username: proxy.username } : {}),
      ...(proxy.password ? { password: proxy.password } : {}),
    };
  }

  const context = await browser.newContext(contextOptions);
  try {
    const page = await context.newPage();
    const reelsUrl = `https://www.instagram.com/${ownerHandle}/reels/`;
    await page.goto(reelsUrl, { waitUntil: "domcontentloaded", timeout: 18_000 });
    await page.waitForTimeout(2_500);

    const reelAnchor = page.locator(`a[href*="/reel/${shortcode}/"], a[href*="/p/${shortcode}/"]`).first();
    if (await reelAnchor.count()) {
      const rawText = await reelAnchor.innerText().catch(() => "");
      const lines = rawText.split(/[\r\n]+/).map((s) => s.trim()).filter(Boolean);
      for (const line of lines) {
        const parsed = parseCount(line);
        if (parsed !== null) return parsed;
      }
    }
    return null;
  } catch (err) {
    console.warn(`[postTracker] Couldn't fetch reel views for @${ownerHandle}/${shortcode}: ${err.message}`);
    return null;
  } finally {
    await context.close().catch(() => {});
  }
}

/**
 * Single-attempt page execution with a specific proxy (or direct if proxy is null).
 */
export async function executeCapture(url, proxy, options = {}) {
  const browser = await (options.getBrowser ? options.getBrowser() : getBrowser());
  const contextOptions = { ...PHONE, locale: "en-US" };
  if (proxy?.server) {
    contextOptions.proxy = {
      server: proxy.server,
      ...(proxy.username ? { username: proxy.username } : {}),
      ...(proxy.password ? { password: proxy.password } : {}),
    };
  }

  const context = await browser.newContext(contextOptions);
  try {
    const page = await context.newPage();
    const navTimeout = options.navTimeoutMs ?? NAV_TIMEOUT_MS;
    // "load", not "domcontentloaded": the "Continue on web" link only works once
    // Instagram's scripts are in (27 Oct — an early click left the app wall up).
    const response = await page.goto(url, { waitUntil: "load", timeout: navTimeout });
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
    if (response?.status() === 404) throw new PostUnavailableError("This post doesn't exist any more");
    if (response?.status() === 429) throw new LoginWallError("Instagram rate limited this request (HTTP 429)");
    if (response?.status() === 403) throw new LoginWallError("Instagram blocked access (HTTP 403 Forbidden)");
    if (/\/accounts\/login/.test(page.url())) throw new LoginWallError("Instagram asked for a login instead of showing the post");

    const description = await page.locator('meta[name="description"]').first().getAttribute("content").catch(() => null);
    const coverImageUrl = await page.locator('meta[property="og:image"]').first().getAttribute("content").catch(() => null);
    const meta = parseMetaDescription(description);

    const settleMs = options.settleMs ?? SETTLE_MS;
    await page.waitForTimeout(settleMs / 2);
    const bodyText = await page.locator("body").innerText().catch(() => "");
    if (/page isn.t available|content isn.t available/i.test(bodyText)) throw new PostUnavailableError("Instagram says this post isn't available (deleted or private)");
    if (/please wait a few minutes before you try again/i.test(bodyText)) throw new LoginWallError("Instagram rate limit: 'Please wait a few minutes before you try again'");
    if (!meta) throw new LoginWallError("Instagram didn't show the post's details");

    // Phone visitors first get an "open in the app" screen; the web view is one tap away.
    const continueOnWeb = page.getByText("Continue on web", { exact: true });
    if (await continueOnWeb.count()) {
      await continueOnWeb.first().click({ timeout: 5_000 }).catch(() => {});
      // The post is on screen once its like button is; fall back to the old fixed wait.
      await page.locator('svg[aria-label="Like"]').first().waitFor({ state: "visible", timeout: POST_VISIBLE_TIMEOUT_MS })
        .catch(() => page.waitForTimeout(settleMs));
    }
    if (/\/accounts\/login/.test(page.url())) throw new LoginWallError("Instagram asked for a login instead of showing the post");

    // A clean, consistent shot (27 Oct): first frame drawn, no visitor bars, provenance strip.
    await page.evaluate(videoReadyScript, VIDEO_FRAME_TIMEOUT_MS).catch(() => {});
    await page.waitForTimeout(Math.min(settleMs, 1_000));
    await page.evaluate(HIDE_WEB_CHROME_SCRIPT).catch(() => {});
    await page.evaluate(stampScript, captureStamp(url)).catch(() => {});
    const screenshot = await page.screenshot({ type: "jpeg", quality: SCREENSHOT_JPEG_QUALITY });

    // Scrape public reel view/play counts from the creator's reels tab using desktop user agent
    let viewCount = null;
    const shortcodeMatch = url.match(/\/(?:reel|reels|p)\/([A-Za-z0-9_-]+)/i);
    const shortcode = shortcodeMatch ? shortcodeMatch[1] : null;

    if (options.scrapeViewCount) {
      viewCount = await options.scrapeViewCount({ ownerHandle: meta.ownerHandle, shortcode, page }).catch(() => null);
    } else if (options.fetchViews !== false && meta.ownerHandle && shortcode) {
      viewCount = await fetchReelViews(browser, meta.ownerHandle, shortcode, proxy);
    }

    return {
      screenshot,
      coverImageUrl: coverImageUrl ? decodeEntities(coverImageUrl) : null,
      viewCount,
      ...meta,
    };
  } finally {
    await context.close().catch(() => {});
  }
}

/**
 * → { screenshot: Buffer (JPEG), coverImageUrl, likeCount, commentCount, viewCount, ownerHandle, postedOn, caption }
 * Throws PostUnavailableError (deleted/private), LoginWallError, or a plain Error (try again later).
 *
 * If proxies are configured and a proxy encounters a block or failure, automatically rotates to the next
 * available proxy until an attempt succeeds or all proxies are exhausted.
 */
export async function captureSnapshot(url, options = {}) {
  const pool = options.proxyPool ?? defaultProxyPool;
  pool.lazyLoadFromEnv();

  const totalProxies = pool.size;
  const maxAttempts = totalProxies > 0
    ? Math.min(totalProxies, options.maxProxyAttempts ?? Math.max(3, totalProxies))
    : 1;

  const triedProxyIds = new Set();
  let lastError = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const proxy = totalProxies > 0 ? pool.getNextProxy({ excludeIds: triedProxyIds }) : null;
    if (proxy) {
      triedProxyIds.add(proxy.id);
    }

    try {
      const captureFn = options.executeCapture ?? executeCapture;
      const result = await captureFn(url, proxy, options);
      if (proxy) {
        pool.markSuccess(proxy);
      }
      return result;
    } catch (err) {
      lastError = err;

      // Post unavailable (404, deleted, private) is a post-level condition, not an IP block.
      // Do not waste other proxies retrying a non-existent post.
      if (err instanceof PostUnavailableError) {
        throw err;
      }

      // Mark proxy as blocked if we were using one
      if (proxy) {
        pool.markBlocked(proxy, err.message);
      }

      // If we still have more attempts and available proxies, rotate to next proxy
      const hasMoreProxies = totalProxies > 0 && pool.hasAvailableProxy(triedProxyIds);
      if (attempt < maxAttempts - 1 && hasMoreProxies) {
        console.warn(
          `[postTracker] Snapshot attempt ${attempt + 1} with proxy ${proxy?.server || "direct"} failed (${err.message}). Rotating to next proxy...`
        );
        continue;
      }

      throw err;
    }
  }

  throw lastError || new Error("Failed to capture snapshot");
}
