/**
 * Post formats (14 Oct "multiple page costs"; ten since 16 Oct). Mirrors
 * server/src/lib/formats.js and server/src/lib/comboSplit.js — keep in step.
 *
 *   reel             Reel                    bookable, rate
 *   entertainment    Entertainment / Brand   bookable, rate
 *   pr               PR                      bookable, rate
 *   political_reel   Political reel          bookable, rate
 *   post             Static / Carousel       bookable, rate (legacy "carousel")
 *   repost           Repost                  bookable, rate
 *   story            Story                   bookable, rate
 *   political_story  Political story         bookable, rate
 *   reel_story       Reel + Story            combo: one booking is a reel AND a story,
 *                                            its price split between them (splitCombo)
 *   repost_story     Repost + Story          combo: a repost AND a story
 *
 * No rate is mandatory (16 Oct — "remove the need part, need reel story rate").
 */
export const FORMATS = ["reel", "entertainment", "pr", "political_reel", "post", "repost", "story", "political_story", "reel_story", "repost_story"] as const;
export const BOOKABLE_FORMATS = ["reel", "entertainment", "pr", "political_reel", "post", "repost", "story", "political_story"] as const;
/** Nothing is required any more; kept so the few callers stay in one place. */
export const REQUIRED_RATE_FORMATS: readonly Format[] = [];
export const OPTIONAL_RATE_FORMATS = FORMATS;

export type Format = (typeof FORMATS)[number];
export type BookableFormat = (typeof BOOKABLE_FORMATS)[number];
export type ComboFormat = "reel_story" | "repost_story";

/** Each combo and the two posts it produces (first part, second part). */
export const COMBOS: Record<ComboFormat, readonly [BookableFormat, BookableFormat]> = {
  reel_story: ["reel", "story"],
  repost_story: ["repost", "story"],
};
/** The original combo (14 Oct); callers that only knew one combo still compile. */
export const COMBO = "reel_story";
export const COMBO_PARTS = COMBOS.reel_story;

export const FORMAT_LABELS: Record<Format, string> = {
  reel: "Reel",
  entertainment: "Entertainment / Brand",
  pr: "PR",
  political_reel: "Political reel",
  post: "Static / Carousel",
  repost: "Repost",
  story: "Story",
  political_story: "Political story",
  reel_story: "Reel + Story",
  repost_story: "Repost + Story",
};

/** Message the server sends for a combo row in a campaign / posts sheet. */
export const COMBO_ROW_MESSAGE = "A combo (Reel + Story, Repost + Story) is two posts: use one row per post";

export const isFormat = (f: unknown): f is Format => typeof f === "string" && (FORMATS as readonly string[]).includes(f);
export const isBookableFormat = (f: unknown): f is BookableFormat => typeof f === "string" && (BOOKABLE_FORMATS as readonly string[]).includes(f);
export const isCombo = (f: unknown): f is ComboFormat => typeof f === "string" && Object.prototype.hasOwnProperty.call(COMBOS, f);

/** The two formats a combo stands for, or null for a single format. */
export function comboParts(format: string | null | undefined): readonly [BookableFormat, BookableFormat] | null {
  return isCombo(format) ? COMBOS[format] : null;
}

/** Human label for a stored format; legacy/unknown keys stay readable. */
export function formatLabel(format: string | null | undefined): string {
  if (format == null || format === "") return "";
  const key = String(format);
  if (isFormat(key)) return FORMAT_LABELS[key];
  if (key.toLowerCase() === "carousel") return FORMAT_LABELS.post;
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/** "Reel, Story and Static / Carousel" (or "… or …"). */
export function joinLabels(formats: readonly string[], conjunction: "and" | "or" = "and"): string {
  const labels = formats.map(formatLabel);
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} ${conjunction} ${labels[labels.length - 1]}`;
}

/** Formats shown/handled as a reel (icon, Instagram views). Same set as the server. */
export const isReelLike = (format: string | null | undefined) => format === "reel" || format === "political_reel";

/** How many posts one unit of this format produces. */
export const postsPerUnit = (format: string | null | undefined) => (isCombo(format) ? 2 : 1);

const ALIASES = new Map<string, Format>([
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
  ["public relation", "pr"],
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

/** Free text from a sheet ("Static", "Reels", "Reel + Story rate", "brand") → a format key, or null. */
export function formatFromText(text: unknown): Format | null {
  if (text == null) return null;
  let s = String(text).toLowerCase().trim().replace(/\s+/g, " ");
  s = s.replace(/\s*(rate|cost|price|amount)$/, "").trim();
  if (!s) return null;
  const hit = ALIASES.get(s);
  if (hit) return hit;
  const singular = s.endsWith("ies") ? `${s.slice(0, -3)}y` : s.endsWith("s") ? s.slice(0, -1) : null;
  return (singular && ALIASES.get(singular)) || null;
}

function toPaise(value: unknown): number {
  if (value == null || value === "") return 0;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 100);
}

/**
 * Splits one combo price between its two posts (rupees), keyed by the combo's
 * part formats ({reel, story} or {repost, story}). Paise maths, same rule as
 * the server's comboSplit.js: first = floor(total × firstRate / (firstRate +
 * secondRate)), or floor(total / 2) when either rate is missing; the second
 * part gets the remainder so the two always add up exactly.
 */
export function splitComboFor(combo: ComboFormat, total: unknown, firstRate: unknown, secondRate: unknown): Record<string, number> {
  const [first, second] = COMBOS[combo];
  const totalP = toPaise(total);
  const a = toPaise(firstRate);
  const b = toPaise(secondRate);
  const firstP = a > 0 && b > 0 ? Number((BigInt(totalP) * BigInt(a)) / BigInt(a + b)) : Math.floor(totalP / 2);
  return { [first]: firstP / 100, [second]: (totalP - firstP) / 100 };
}

/** Reel + Story split (the 14 Oct shape), for callers that only knew that combo. */
export function splitCombo(total: unknown, reelRate: unknown, storyRate: unknown): { reel: number; story: number } {
  const s = splitComboFor("reel_story", total, reelRate, storyRate);
  return { reel: s.reel, story: s.story };
}
