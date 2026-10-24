/**
 * Post Tracker link parsing (24 Oct). One pure function decides whether a
 * pasted line is a single public Instagram reel/post and, if so, which one —
 * by its shortcode. Everything downstream (the dedupe key, the canonical
 * link, the embed iframe src) is rebuilt from that shortcode, so tracking
 * junk (`?igsh=`, `?utm_*`), `m.`/no-`www.` hosts, `/reels/` vs `/reel/`,
 * the newer `/<username>/reel/<code>/` form and a link buried in share text
 * all land on the same card, and nothing the user typed reaches the iframe.
 *
 * Mirrored for the live ✓/✗ preview in client-v2/lib/post-tracker-url.ts —
 * keep the two in step (url.test.js covers this one).
 */

const IG_URL = /(?<![a-z0-9.-])(?:https?:\/\/)?(?:[a-z0-9-]+\.)*(?:instagram\.com|instagr\.am)\/[^\s<>"'`]*/i;
const SHORTCODE = /^[A-Za-z0-9_-]{5,40}$/;
const KIND_BY_SEGMENT = { p: "post", reel: "reel", reels: "reel", tv: "reel" };
// Top-level paths that are Instagram pages, not someone's profile.
const SITE_PAGES = new Set(["explore", "accounts", "direct", "about", "developer", "legal", "web", "challenge"]);

export const REASONS = {
  empty: "Empty line",
  notLink: "Not a link",
  notInstagram: "Not an Instagram link",
  story: "Story links expire after 24 hours — paste a reel or post link",
  share: "Share links can't be read — open it in Instagram and copy the reel or post link",
  profile: "This is a profile link — open the reel or post and copy its link",
  notPost: "Not a single reel or post link",
  badCode: "This link doesn't contain a valid post code",
};

const reject = (reason) => ({ ok: false, reason });

/** Builds every URL from a known-good shortcode + kind. */
export function urlsFor(shortcode, kind) {
  const segment = kind === "reel" ? "reel" : "p";
  return {
    canonicalUrl: `https://www.instagram.com/${segment}/${shortcode}/`,
    embedUrl: `https://www.instagram.com/${segment}/${shortcode}/embed/captioned/`,
  };
}

/**
 * → { ok: true, shortcode, kind: "reel" | "post", canonicalUrl, embedUrl }
 *   or { ok: false, reason } (one of REASONS, worded for the person pasting).
 */
export function parseInstagramPostUrl(input) {
  const text = typeof input === "string" ? input.trim() : "";
  if (!text) return reject(REASONS.empty);

  const match = text.match(IG_URL);
  if (!match) return reject(/https?:\/\/|www\.|\.[a-z]{2,}\//i.test(text) ? REASONS.notInstagram : REASONS.notLink);

  const path = match[0].replace(/^(?:https?:\/\/)?[^/]+/i, "").split(/[?#]/)[0];
  const segments = path.split("/").filter(Boolean).map((s) => s.toLowerCase());
  const raw = path.split("/").filter(Boolean); // shortcodes are case-sensitive

  if (segments.length === 0) return reject(REASONS.notPost);
  if (segments[0] === "stories" || segments[0] === "s") return reject(REASONS.story);
  if (segments[0] === "share") return reject(REASONS.share);

  // /p/<code>/, /reel/<code>/ … or the newer /<username>/reel/<code>/.
  // Own keys only — "constructor"/"__proto__" in a path must not read as a kind.
  const isKind = (seg) => seg !== undefined && Object.hasOwn(KIND_BY_SEGMENT, seg);
  const at = isKind(segments[0]) ? 0 : isKind(segments[1]) ? 1 : -1;
  if (at === -1) return reject(segments.length === 1 && !SITE_PAGES.has(segments[0]) ? REASONS.profile : REASONS.notPost);
  const shortcode = raw[at + 1];
  // /reels/audio/<id>/ is a sound's page, /reels/explore/ a feed — not a reel.
  if (!shortcode || shortcode.toLowerCase() === "audio" || SITE_PAGES.has(shortcode.toLowerCase())) return reject(REASONS.notPost);
  if (!SHORTCODE.test(shortcode)) return reject(REASONS.badCode);

  const kind = KIND_BY_SEGMENT[segments[at]];
  return { ok: true, shortcode, kind, ...urlsFor(shortcode, kind) };
}
