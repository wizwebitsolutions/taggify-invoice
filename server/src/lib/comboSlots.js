import { prisma } from "./prisma.js";
import { COMBOS, COMBO_PART_FORMATS, comboParts, isCombo } from "./formats.js";
import { splitComboCost } from "./comboSplit.js";
import { phaseRowIds } from "./campaignPhases.js";

/**
 * Combo pages on a campaign — "Reel + Story" (14 Oct) and "Repost + Story"
 * (16 Oct), see lib/formats.js COMBOS. A plan line booked as a combo becomes
 * two CampaignAssignment slots per post (one per part — reel + story, or
 * repost + story — each carrying its share of the split price; see
 * plans/service.js's createCampaignFromPlan). A page is a combo page on a
 * campaign when the campaign group's plan has a combo line for it.
 *
 * Nothing here runs for a page without such a line, so every older campaign
 * (no plan can contain a combo before 14 Oct) behaves exactly as before.
 */

/**
 * The ids among `assetIds` that are booked as a combo on `campaignId`'s
 * group. With `format`, only pages with a combo line whose parts include
 * that format (a repost post on a Reel + Story-only page is not a combo post).
 */
export async function comboPagesFor(campaignId, assetIds, db = prisma, format = null) {
  const ids = [...new Set((assetIds ?? []).filter(Boolean))];
  if (!campaignId || ids.length === 0) return new Set();
  const row = await db.campaign.findUnique({ where: { id: campaignId }, select: { id: true, parentCampaignId: true } });
  if (!row) return new Set();
  const rootId = row.parentCampaignId ?? row.id;
  const plan = await db.plan.findUnique({
    where: { campaignId: rootId },
    select: { items: { where: { format: { in: Object.keys(COMBOS) }, assetId: { in: ids } }, select: { assetId: true, format: true } } },
  });
  const items = (plan?.items ?? []).filter((i) => !format || (comboParts(i.format) ?? []).includes(format));
  return new Set(items.map((i) => i.assetId));
}

/** The campaign group's root id for any row of it, or null. */
async function rootIdOf(campaignId, db) {
  const row = await db.campaign.findUnique({ where: { id: campaignId }, select: { id: true, parentCampaignId: true } });
  return row ? row.parentCampaignId ?? row.id : null;
}

/**
 * The ids among `assetIds` that have any line on `campaignId`'s group's plan.
 * createPhase copies every Phase 1 slot of these (one per plan line / combo
 * part); a page not on a plan keeps one slot.
 */
export async function plannedPagesFor(campaignId, assetIds, db = prisma) {
  const ids = [...new Set((assetIds ?? []).filter(Boolean))];
  if (!campaignId || ids.length === 0) return new Set();
  const rootId = await rootIdOf(campaignId, db);
  if (!rootId) return new Set();
  const plan = await db.plan.findUnique({ where: { campaignId: rootId }, select: { items: { where: { assetId: { in: ids } }, select: { assetId: true } } } });
  return new Set((plan?.items ?? []).map((i) => i.assetId));
}

/** One page's lines on the group's plan ({ format, cost, postsPerProfile }); [] without a plan. */
async function planLinesFor(campaignId, assetId, db) {
  const rootId = await rootIdOf(campaignId, db);
  if (!rootId) return [];
  const plan = await db.plan.findUnique({
    where: { campaignId: rootId },
    select: { items: { where: { assetId }, select: { assetId: true, format: true, cost: true, postsPerProfile: true } } },
  });
  return (plan?.items ?? []).filter((i) => !i.assetId || i.assetId === assetId);
}

const toPaise = (v) => (v == null ? null : Math.round(Number(String(v)) * 100));

/**
 * Which of one page's slots of one format are a REGULAR line's slot (full
 * line price), not a combo part's — pure, no I/O. There's no column saying
 * where a slot came from, so the marker is the plan itself
 * (createCampaignFromPlan): a row with post number N holds one slot per
 * regular line of that format with postsPerProfile >= N, at that line's
 * cost. So on each row, up to that many slots whose cost equals a regular
 * line's cost are the regular ones (claimed ones first, then oldest); every
 * other slot is a combo part. When a combo share happens to equal the
 * regular price, either pick costs the same.
 *
 * `slots`: { id, campaignId, cost, linkId } of one format, oldest first.
 * `rows`: { id, postNumber } of the phase. `regularLines`: that format's
 * regular plan lines for the page.
 */
export function regularSlotIds(slots, rows, regularLines) {
  const ids = new Set();
  if (regularLines.length === 0) return ids;
  const costs = new Set(regularLines.map((l) => toPaise(l.cost)));
  const postNumberOf = new Map((rows ?? []).map((r) => [r.id, r.postNumber ?? 1]));
  const byRow = new Map();
  for (const s of slots) {
    if (!costs.has(toPaise(s.cost))) continue;
    if (!byRow.has(s.campaignId)) byRow.set(s.campaignId, []);
    byRow.get(s.campaignId).push(s);
  }
  for (const [rowId, candidates] of byRow) {
    const post = postNumberOf.get(rowId) ?? 1;
    const expected = regularLines.filter((l) => (l.postsPerProfile ?? 1) >= post).length;
    const ordered = [...candidates].sort((a, b) => (a.linkId ? 0 : 1) - (b.linkId ? 0 : 1));
    for (const s of ordered.slice(0, expected)) ids.add(s.id);
  }
  return ids;
}

/**
 * Every COMBO slot (one made from a combo line's part, never a regular line's
 * full-price slot) of `format` for the page across the campaign's phase rows,
 * oldest first; `openOnly` keeps the unclaimed ones. Also returns the page's
 * plan lines. Empty when the format isn't a part of a combo booked for the page.
 */
async function comboSlotsOfFormat(db, { campaignId, assetId, format, openOnly }) {
  if (!COMBO_PART_FORMATS.includes(format)) return { slots: [], lines: [] };
  const combo = await comboPagesFor(campaignId, [assetId], db, format);
  if (!combo.has(assetId)) return { slots: [], lines: [] };
  const rowIds = await phaseRowIds(campaignId, db);
  const lines = await planLinesFor(campaignId, assetId, db);
  const regularLines = lines.filter((l) => !isCombo(l.format) && l.format === format);
  const orderBy = [{ createdAt: "asc" }, { id: "asc" }];
  if (regularLines.length === 0) {
    // Every slot of this format is a combo part (the page has no regular line of it).
    const slots = await db.campaignAssignment.findMany({
      where: { campaignId: { in: rowIds }, assetId, format, ...(openOnly ? { linkId: null } : {}), cost: { not: null } },
      orderBy,
    });
    return { slots: slots ?? [], lines };
  }
  // A regular line of the same format (a full-price reel next to a Reel +
  // Story combo): tell its slots apart (regularSlotIds) — claimed ones count
  // too, so the per-row tally is right.
  const [all, rows] = await Promise.all([
    db.campaignAssignment.findMany({ where: { campaignId: { in: rowIds }, assetId, format, cost: { not: null } }, orderBy }),
    db.campaign.findMany({ where: { id: { in: rowIds } }, select: { id: true, postNumber: true } }),
  ]);
  const regular = regularSlotIds(all ?? [], rows, regularLines);
  return { slots: (all ?? []).filter((s) => !regular.has(s.id) && (!openOnly || !s.linkId)), lines };
}

/**
 * The open slots a combo page's new `format` post may take, best first:
 * unclaimed COMBO slots of that format with a cost on any row of the
 * campaign's phase (phaseRowIds — the same rows postQuota counts the booking
 * over, since a plan with postsPerProfile > 1 puts each extra post on its own
 * row) — never a regular line's full-price slot. Order: the exact
 * `campaignId` row first; then a fixed combo order (a story on a page with
 * both combos takes a Reel + Story story slot before a Repost + Story one);
 * then oldest first. Empty when the format isn't a part of a combo booked
 * for the page, or no slot of that format is left (the caller then prices
 * from the rate card; postQuota flags that post as over quota).
 */
export async function openComboSlots(db = prisma, { campaignId, assetId, format }) {
  const { slots, lines } = await comboSlotsOfFormat(db, { campaignId, assetId, format, openOnly: true });
  if (slots.length === 0) return [];
  const rank = await comboRank(db, assetId, format, lines);
  // Stable sort: the exact row's slots first, then combo order; the rest keep oldest-first order.
  return [...slots].sort((a, b) => (a.campaignId === campaignId ? 0 : 1) - (b.campaignId === campaignId ? 0 : 1) || rank(a) - rank(b));
}

/**
 * Which combo a slot of `format` belongs to, as a sort rank in COMBOS order,
 * when more than one kind of combo line on the page has that part (a story on
 * a Reel + Story and a Repost + Story page). The slot's cost is matched
 * against each line's split share at the page's current rates; a slot no
 * share matches (rates changed since approval) ranks between the two.
 */
async function comboRank(db, assetId, format, lines) {
  const order = Object.keys(COMBOS);
  const comboLines = lines.filter((l) => isCombo(l.format) && comboParts(l.format).includes(format));
  if (new Set(comboLines.map((l) => l.format)).size < 2) return () => 0;
  const rates = new Map();
  const cards = await db.rateCard.findMany({ where: { assetId, format: { in: COMBO_PART_FORMATS } } });
  for (const rc of cards ?? []) rates.set(rc.format, rc.amount);
  // Later combos first, so a share both lines produce ranks as the earlier combo.
  const rankByPaise = new Map();
  for (const l of [...comboLines].sort((a, b) => order.indexOf(b.format) - order.indexOf(a.format))) {
    const [first, second] = comboParts(l.format);
    const share = splitComboCost(l.cost, rates.get(first), rates.get(second), [first, second])[format];
    rankByPaise.set(toPaise(share), order.indexOf(l.format) * 2);
  }
  return (slot) => rankByPaise.get(toPaise(slot.cost)) ?? 1;
}

/**
 * True when `slot` (one a post claimed: { id, campaignId, format, cost }) is
 * a combo part's slot on the page — the only kind createLink claims, so the
 * only kind whose postUrl a claim wrote (links/service.js deleteLink).
 */
export async function isComboSlot(db = prisma, slot, assetId) {
  if (!slot?.format || !assetId) return false;
  const { slots } = await comboSlotsOfFormat(db, { campaignId: slot.campaignId, assetId, format: slot.format, openOnly: false });
  return slots.some((s) => s.id === slot.id);
}
