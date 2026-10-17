import { z } from "zod";

/**
 * Post formats ("cost types"). Ten prices per page (16 Oct):
 *
 *   reel             Reel                    bookable, rate, required
 *   entertainment    Entertainment / Brand   bookable, rate
 *   pr               PR                      bookable, rate
 *   political_reel   Political               bookable, rate
 *   post             Static & Carousel       bookable, rate
 *   repost           Repost                  bookable, rate
 *   story            Story                   bookable, rate, required
 *   political_story  Political Story         bookable, rate
 *   reel_story       Reel + Story            combo (reel + story)
 *   repost_story     Repost + Story          combo (repost + story)
 *
 * A combo is a rate + plan line only — one booking means two posts (its
 * COMBOS parts); its price is split between them (lib/comboSplit.js) and each
 * is posted as its own link.
 *
 * Rate cards and plan lines accept all ten (`formatSchema`); links and
 * campaign-sheet rows accept the bookable eight (`bookableFormatSchema`).
 * Rows already stored with an older format (carousel, video, custom names)
 * stay readable — only new writes are limited. `political_reel` and `post`
 * keep their keys; only their labels changed on 16 Oct.
 */
// NOTE: the "required" marks in the table above are historical (16 Oct, morning) — see REQUIRED_RATE_FORMATS.
export const FORMATS = [
  "reel",
  "entertainment",
  "pr",
  "political_reel",
  "post",
  "repost",
  "story",
  "political_story",
  "reel_story",
  "repost_story",
];

/** Combo format → its two parts, in split order (first part, second part). */
export const COMBOS = {
  reel_story: ["reel", "story"],
  repost_story: ["repost", "story"],
};

export const BOOKABLE_FORMATS = FORMATS.filter((f) => !COMBOS[f]);
// 16 Oct (later the same day): no rate is mandatory any more — "remove the
// need part, need reel story rate". A page can be created, imported and
// approved with any rates or none; a plan line with no rate just needs its
// cost typed. Kept as an (empty) list so the required-rate plumbing stays in
// one place should a rule ever come back.
export const REQUIRED_RATE_FORMATS = [];

/** True for a combo format (reel_story, repost_story). */
export function isCombo(format) {
  return Object.prototype.hasOwnProperty.call(COMBOS, format ?? "");
}

/** A combo's two part formats, or null for a non-combo. */
export function comboParts(format) {
  return isCombo(format) ? COMBOS[format] : null;
}

/** Every format that is a part of some combo (reel, story, repost). */
export const COMBO_PART_FORMATS = [...new Set(Object.values(COMBOS).flat())];

export const FORMAT_LABELS = {
  reel: "Reel",
  entertainment: "Entertainment / Brand",
  pr: "PR",
  political_reel: "Political",
  post: "Static & Carousel",
  repost: "Repost",
  story: "Story",
  political_story: "Political Story",
  reel_story: "Reel + Story",
  repost_story: "Repost + Story",
};

export const formatSchema = z.enum(FORMATS);
export const bookableFormatSchema = z.enum(BOOKABLE_FORMATS);

/** Human label for a stored format; legacy/unknown keys stay readable. */
export function formatLabel(format) {
  if (format == null || format === "") return "";
  const key = String(format);
  if (FORMAT_LABELS[key]) return FORMAT_LABELS[key];
  if (key.toLowerCase() === "carousel") return FORMAT_LABELS.post;
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/** Formats shown/handled as a reel (icon, Instagram views). */
export function isReelLike(format) {
  return format === "reel" || format === "political_reel";
}

/** How many posts one unit of this format produces. */
export function postsPerUnit(format) {
  return isCombo(format) ? 2 : 1;
}

const ALIASES = new Map([
  ["reel", "reel"],
  ["entertainment", "entertainment"],
  ["brand", "entertainment"],
  ["entertainment/brand", "entertainment"],
  ["entertainment / brand", "entertainment"],
  ["entertainment & brand", "entertainment"],
  ["entertainment and brand", "entertainment"],
  ["brand reel", "entertainment"],
  ["pr", "pr"],
  ["p.r.", "pr"],
  ["p.r", "pr"],
  ["pr reel", "pr"],
  ["public relations", "pr"],
  ["political", "political_reel"],
  ["political reel", "political_reel"],
  ["political_reel", "political_reel"],
  ["static", "post"],
  ["carousel", "post"],
  ["post", "post"],
  ["static/carousel", "post"],
  ["static / carousel", "post"],
  ["static & carousel", "post"],
  ["static and carousel", "post"],
  ["static or carousel", "post"],
  ["static post", "post"],
  ["image", "post"],
  ["feed post", "post"],
  ["repost", "repost"],
  ["re-post", "repost"],
  ["story", "story"],
  ["political story", "political_story"],
  ["political_story", "political_story"],
  ["reel + story", "reel_story"],
  ["reel+story", "reel_story"],
  ["reel & story", "reel_story"],
  ["reel and story", "reel_story"],
  ["reel/story combo", "reel_story"],
  ["reel / story combo", "reel_story"],
  ["reel story combo", "reel_story"],
  ["reel_story", "reel_story"],
  ["combo", "reel_story"],
  ["repost + story", "repost_story"],
  ["repost+story", "repost_story"],
  ["repost & story", "repost_story"],
  ["repost and story", "repost_story"],
  ["repost/story combo", "repost_story"],
  ["repost / story combo", "repost_story"],
  ["repost story combo", "repost_story"],
  ["repost_story", "repost_story"],
]);

const normalise = (text) => String(text).toLowerCase().trim().replace(/\s+/g, " ");

/**
 * Exactly one of the alias spellings above ("reel", "static & carousel",
 * "political story", "repost + story", "combo"…) → its format key; no
 * plurals, no rate/cost suffix stripping. For headers that must name a
 * format outright. Whole-string lookup, so "Political Story" is never read
 * as "Political" nor "Repost + Story" as "Repost".
 */
export function exactFormatAlias(text) {
  if (text == null) return null;
  return ALIASES.get(normalise(text)) ?? null;
}

/**
 * The one alias resolver every sheet parser uses: free text ("Static",
 * "Reels", "Reel + Story rate", "combo") → a format key, or null.
 */
export function formatFromText(text) {
  if (text == null) return null;
  let s = normalise(text);
  s = s.replace(/\s*(rate|cost|price|amount)$/, "").trim();
  if (!s) return null;
  if (ALIASES.has(s)) return ALIASES.get(s);
  // Plurals: "reels", "stories", "posts", "reposts", "political stories".
  const singular = s.endsWith("ies") ? `${s.slice(0, -3)}y` : s.endsWith("s") ? s.slice(0, -1) : null;
  if (singular && ALIASES.has(singular)) return ALIASES.get(singular);
  return null;
}
