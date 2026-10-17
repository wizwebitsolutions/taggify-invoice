/**
 * Splits a combo price (Reel + Story, Repost + Story — lib/formats.js COMBOS)
 * between its two posts. Each part becomes its own campaign slot, so the two
 * posts are invoiced and paid on their own.
 *
 * Works in integer paise so nothing is lost to float rounding:
 *   - the first part's share is proportional to the page's rates for the two
 *     parts (floor of total × first / (first + second)), or 50/50 (floor of
 *     half) when either rate is missing or zero;
 *   - the second part gets the remainder, so the two always add up exactly
 *     to the combo price.
 *
 * Inputs may be numbers, numeric strings or Prisma Decimals; returns rupees
 * as numbers with at most 2 decimals, keyed by the combo's part formats
 * (`parts`, default ["reel", "story"]): e.g. { reel, story } or
 * { repost, story }.
 */
function toPaise(value) {
  if (value == null || value === "") return 0;
  const n = Number(typeof value === "object" && typeof value.toString === "function" ? value.toString() : value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 100);
}

export function splitComboCost(total, firstRate, secondRate, parts = ["reel", "story"]) {
  const totalP = toPaise(total);
  const firstRateP = toPaise(firstRate);
  const secondRateP = toPaise(secondRate);

  let firstP;
  if (firstRateP > 0 && secondRateP > 0) {
    firstP = Number((BigInt(totalP) * BigInt(firstRateP)) / BigInt(firstRateP + secondRateP));
  } else {
    firstP = Math.floor(totalP / 2);
  }
  const secondP = totalP - firstP;
  const [first, second] = parts;
  return { [first]: firstP / 100, [second]: secondP / 100 };
}
