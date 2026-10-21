import type { Asset, Plan, PlanItemInput } from "@/lib/api-client";
import { comboParts, FORMATS, formatFromText, isCombo, isFormat, postsPerUnit, splitComboFor } from "@/lib/formats";

/**
 * One picked page while the plan is being filled in (ported from v1
 * client/components/plans/plan-wizard.tsx). `cost` is the per-post cost when
 * it differs from the page's rate card; "" = use the rate card.
 */
export interface DraftItem {
  assetId: string;
  format: string;
  cost: string;
  posts: string;
}

/**
 * A plan's saved lines as draft items. A legacy spelling the app still knows
 * (e.g. "carousel" → Static / Carousel) is read as its format today; anything
 * else keeps its stored format so the Pages step can flag it (it is never
 * silently turned into a reel). Per-line client prices aren't carried: the
 * client quote is one overall number on the Pricing step (see initialOverrideCost).
 *
 * Two lines that land on the same page + format (a legacy "carousel" next to
 * a "post") merge only when they cost the same per post. At different prices
 * merging would keep one price for both and reprice the plan on its next
 * save, so the legacy line stays as its own line under its stored format and
 * the Pages step asks for it to be sorted out by hand.
 */
export function toDraft(plan: Plan): DraftItem[] {
  const out: DraftItem[] = [];
  const stored = new Map<DraftItem, string>(); // each line's format as saved
  for (const i of plan.items ?? []) {
    const format = isFormat(i.format) ? i.format : (formatFromText(i.format) ?? i.format);
    const line = { assetId: i.assetId, format, cost: i.cost, posts: String(i.postsPerProfile) };
    const same = out.find((o) => o.assetId === line.assetId && o.format === line.format);
    if (same && Number(same.cost) === Number(line.cost)) {
      same.posts = String(Number(same.posts) + Number(line.posts));
      continue;
    }
    // Different prices: whichever of the two was saved under a legacy
    // spelling goes back to it (the other keeps the format).
    if (same && stored.get(same) !== same.format) same.format = stored.get(same)!;
    else if (same) line.format = i.format;
    out.push(line);
    stored.set(line, i.format);
  }
  return out;
}

export const toInput = (items: DraftItem[]): PlanItemInput[] => items.map((i) => ({ assetId: i.assetId, format: i.format, ...(i.cost ? { cost: Number(i.cost) } : {}), postsPerProfile: itemPosts(i) }));

export const rateFor = (asset: Asset | undefined, format: string) => Number(asset?.rateCards?.find((rc) => rc.format === format)?.amount ?? 0);
export const itemCost = (i: DraftItem, asset: Asset | undefined) => (i.cost ? Number(i.cost) : rateFor(asset, i.format));
/** Whole posts from 1 to 1000, the server's limits for a plan line. */
export const itemPosts = (i: Pick<DraftItem, "posts">) => Math.min(1000, Math.max(1, Math.floor(Number(i.posts)) || 1));
export const lineCost = (i: DraftItem, asset: Asset | undefined) => itemCost(i, asset) * itemPosts(i);
/** Posts a line produces: a Reel + Story combo is two posts per unit (server annotatePlan). */
export const itemPostCount = (i: Pick<DraftItem, "format" | "posts">) => itemPosts(i) * postsPerUnit(i.format);
/** A combo line's per-combo split between its two posts, keyed by part format (same rule as the server), else null. */
export const comboSplitOf = (i: DraftItem, asset: Asset | undefined): Record<string, number> | null => {
  const parts = comboParts(i.format);
  return parts && isCombo(i.format) ? splitComboFor(i.format, itemCost(i, asset), rateFor(asset, parts[0]), rateFor(asset, parts[1])) : null;
};

/** The formats this page has a rate for, in the app's order (Reel, Entertainment / Brand, …). */
export const pricedFormats = (asset: Asset | undefined): string[] => FORMATS.filter((f) => rateFor(asset, f) > 0);

/** A freshly picked page starts on its first priced format (Reel when it has one); with no rates at all, a Reel line whose cost is typed on the line (16 Oct). */
export const newItem = (asset: Asset): DraftItem => ({ assetId: asset.id, format: pricedFormats(asset)[0] ?? FORMATS[0], cost: "", posts: "1" });
/** A line whose cost is still unknown: no rate on the page and nothing typed. */
export const lineNeedsCost = (i: DraftItem, asset: Asset | undefined) => !(itemCost(i, asset) > 0);

export const instagramUrl = (handle: string) => `https://www.instagram.com/${handle.replace(/^@/, "")}/`;

/**
 * The quoted total to start an edit with. A plan saved with per-line client
 * prices and no overall quote would otherwise change price silently on its next
 * save (lines are saved cost-only), so its old client total becomes the quote.
 */
export function initialOverrideCost(plan: Plan): string {
  if (plan.overrideCost != null) return String(Math.round(Number(plan.overrideCost)));
  if (plan.items.some((i) => i.clientCost != null)) return String(Math.round(plan.internal.computedSubtotal));
  return "";
}
