/**
 * Post Tracker link parsing (24 Oct) — the live ✓/✗ preview next to each
 * pasted line. A mirror of server/src/modules/postTracker/url.js (which is
 * the one that decides, and is tested); keep the two in step.
 */

const IG_URL = /(?<![a-z0-9.-])(?:https?:\/\/)?(?:[a-z0-9-]+\.)*(?:instagram\.com|instagr\.am)\/[^\s<>"'`]*/i;
const IG_URL_ALL = new RegExp(IG_URL.source, "gi");
const SHORTCODE = /^[A-Za-z0-9_-]{5,40}$/;
const KIND_BY_SEGMENT: Record<string, "reel" | "post"> = { p: "post", reel: "reel", reels: "reel", tv: "reel" };
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
} as const;

export type ParsedPostUrl = { ok: true; shortcode: string; kind: "reel" | "post" } | { ok: false; reason: string };

export function parseInstagramPostUrl(input: string): ParsedPostUrl {
  const text = input.trim();
  if (!text) return { ok: false, reason: REASONS.empty };

  const match = text.match(IG_URL);
  if (!match) return { ok: false, reason: /https?:\/\/|www\.|\.[a-z]{2,}\//i.test(text) ? REASONS.notInstagram : REASONS.notLink };

  const path = match[0].replace(/^(?:https?:\/\/)?[^/]+/i, "").split(/[?#]/)[0];
  const raw = path.split("/").filter(Boolean);
  const segments = raw.map((s) => s.toLowerCase());

  if (segments.length === 0) return { ok: false, reason: REASONS.notPost };
  if (segments[0] === "stories" || segments[0] === "s") return { ok: false, reason: REASONS.story };
  if (segments[0] === "share") return { ok: false, reason: REASONS.share };

  // Own keys only — "constructor"/"__proto__" in a path must not read as a kind.
  const isKind = (seg: string | undefined) => seg !== undefined && Object.hasOwn(KIND_BY_SEGMENT, seg);
  const at = isKind(segments[0]) ? 0 : isKind(segments[1]) ? 1 : -1;
  if (at === -1) return { ok: false, reason: segments.length === 1 && !SITE_PAGES.has(segments[0]) ? REASONS.profile : REASONS.notPost };
  const shortcode = raw[at + 1];
  if (!shortcode || shortcode.toLowerCase() === "audio" || SITE_PAGES.has(shortcode.toLowerCase())) return { ok: false, reason: REASONS.notPost };
  if (!SHORTCODE.test(shortcode)) return { ok: false, reason: REASONS.badCode };

  return { ok: true, shortcode, kind: KIND_BY_SEGMENT[segments[at]] };
}

/**
 * Splits a paste into entries: each Instagram link found becomes its own
 * entry (so "Check this out https://…" and two links on one line both work);
 * a non-empty line with no Instagram link stays as-is, to be shown rejected.
 */
export function splitPastedLinks(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => line.match(IG_URL_ALL) ?? [line]);
}
