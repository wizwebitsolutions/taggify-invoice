/**
 * Post formats (14 Oct — "multiple page costs", extended with Entertainment /
 * Brand, PR, Repost, Political Story and the Repost + Story combo). Mirrors
 * server/src/lib/formats.js and server/src/lib/comboSplit.js — keep the
 * three in step.
 *
 *   reel             Reel                    bookable, rate, required
 *   entertainment    Entertainment / Brand   bookable, rate
 *   pr               PR                      bookable, rate
 *   political_reel   Political               bookable, rate
 *   post             Static & Carousel       bookable, rate (legacy "carousel")
 *   repost           Repost                  bookable, rate
 *   story            Story                   bookable, rate, required
 *   political_story  Political Story         bookable, rate
 *   reel_story       Reel + Story            combo — one booking is a reel AND a
 *                                            story, its price split between them
 *   repost_story     Repost + Story          combo — a repost AND a story
 */
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
] as const;
export const BOOKABLE_FORMATS = ["reel", "entertainment", "pr", "political_reel", "post", "repost", "story", "political_story"] as const;
/** No rate is mandatory (16 Oct, later — "remove the need part, need reel story rate"). Kept so callers stay in one place. */
export const REQUIRED_RATE_FORMATS: readonly Format[] = [];
export const OPTIONAL_RATE_FORMATS = ["entertainment", "pr", "political_reel", "post", "repost", "political_story", "reel_story", "repost_story"] as const;

export type Format = (typeof FORMATS)[number];
export type BookableFormat = (typeof BOOKABLE_FORMATS)[number];
export type ComboFormat = "reel_story" | "repost_story";

/** Each combo and the two posts it produces (first part, second part). */
export const COMBOS: Record<ComboFormat, readonly [BookableFormat, BookableFormat]> = {
  reel_story: ["reel", "story"],
  repost_story: ["repost", "story"],
};

export const FORMAT_LABELS: Record<Format, string> = {
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

export const isFormat = (f: string | null | undefined): f is Format => !!f && (FORMATS as readonly string[]).includes(f);
export const isBookableFormat = (f: string | null | undefined): f is BookableFormat => !!f && (BOOKABLE_FORMATS as readonly string[]).includes(f);
export const isCombo = (f: string | null | undefined): f is ComboFormat => !!f && Object.prototype.hasOwnProperty.call(COMBOS, f);

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

/** "Reel", "Reel and Story", "Reel, Story and PR". */
export function joinLabels(formats: readonly string[]): string {
  const labels = formats.map(formatLabel);
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

/** Formats shown/handled as a reel (icon, Instagram views). Same set as the server (lib/formats.js). */
export function isReelLike(format: string | null | undefined): boolean {
  return format === "reel" || format === "political_reel";
}

/** How many posts one unit of this format produces. */
export function postsPerUnit(format: string | null | undefined): number {
  return isCombo(format) ? 2 : 1;
}

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

/** Free text ("Static", "Reels", "Reel + Story rate", "brand") → a format key, or null. */
export function formatFromText(text: unknown): Format | null {
  if (text == null) return null;
  let s = String(text).toLowerCase().trim().replace(/\s+/g, " ");
  s = s.replace(/\s*(rate|cost|price|amount)$/, "").trim();
  if (!s) return null;
  const direct = ALIASES.get(s);
  if (direct) return direct;
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
 * part formats — {reel, story} or {repost, story}. Paise maths: first =
 * floor(total × firstRate / (firstRate + secondRate)), or floor(total / 2)
 * when either rate is missing; the second part gets the remainder so the two
 * always add up exactly. Prefer the server's `comboSplit` when a saved plan
 * line carries one.
 */
export function splitCombo(combo: ComboFormat, total: unknown, firstRate: unknown, secondRate: unknown): Record<string, number> {
  const [first, second] = COMBOS[combo];
  const totalP = toPaise(total);
  const aP = toPaise(firstRate);
  const bP = toPaise(secondRate);
  // BigInt keeps total × rate exact past 2^53 (same as the server).
  const firstP = aP > 0 && bP > 0 ? Number((BigInt(totalP) * BigInt(aP)) / BigInt(aP + bP)) : Math.floor(totalP / 2);
  return { [first]: firstP / 100, [second]: (totalP - firstP) / 100 };
}

/** "Repost ₹x + Story ₹y" for a combo split, given a money formatter. */
export function comboSplitText(combo: string, split: Record<string, number | string> | null | undefined, money: (n: number) => string): string {
  const parts = comboParts(combo);
  if (!parts || !split) return "";
  return parts.map((p) => `${formatLabel(p)} ${money(Number(split[p] ?? 0))}`).join(" + ");
}
