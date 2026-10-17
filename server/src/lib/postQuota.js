import { prisma } from "./prisma.js";
import { phaseRowIds } from "./campaignPhases.js";
import { comboPagesFor } from "./comboSlots.js";
import { BOOKABLE_FORMATS } from "./formats.js";

/**
 * Posts beyond what a campaign phase booked for a page (user decision, 29 Sep
 * — "if limit is of 2 post for that page, creator can submit 3 but everywhere
 * it'll show 2 of 2, in maths money calculation as well cause it's creator
 * fault not admin/finance").
 *
 * The booking is the page's CampaignAssignment rows across the phase's rows —
 * plans/service.js's createCampaignFromPlan spreads a plan's postsPerProfile
 * into one row per post, and that count is never stored anywhere else. The
 * first `booked` posts by posted date count; the rest get Link.overQuota, and
 * every money path skips them.
 *
 * A page with no booking at all in the phase is left uncapped: that means no
 * limit was ever set, not a limit of zero — capping it would silently make
 * legacy or admin-added posts unpayable.
 */

/** Posted date, else when it was submitted (postedAt only lands once insights are scraped); then createdAt and id, so the order never ties. */
function byPostedDate(a, b) {
  const when = (l) => new Date(l.postedAt ?? l.createdAt).getTime();
  return when(a) - when(b) || new Date(a.createdAt) - new Date(b.createdAt) || String(a.id).localeCompare(String(b.id));
}

/**
 * The decision itself, with no I/O: which of one page's posts in a phase are
 * beyond its `booked` slots.
 *
 * A post that has already been paid (`paid: true`) holds its slot for good and
 * is never flagged. Ranking purely by posted date let a post scraped *later*
 * jump ahead of one already paid, flag it, and free its slot, so a second post
 * got paid against a booking of one. Paid posts take their slots first, and only
 * the unpaid ones compete, by posted date, for whatever is left.
 */
export function overQuotaIds(links, booked) {
  if (booked === 0) return new Set();
  const paidCount = links.filter((l) => l.paid).length;
  const openSlots = Math.max(0, booked - paidCount);
  return new Set(
    links
      .filter((l) => !l.paid)
      .sort(byPostedDate)
      .slice(openSlots)
      .map((l) => l.id)
  );
}

/**
 * A combo page (Reel + Story 14 Oct, Repost + Story 16 Oct) is booked per
 * format — a slot per part per post (reel + story, repost + story) — so its quota is counted per format: a second reel
 * against one reel slot is over quota even while the story slot is still
 * open, and a format with no slot at all (a post on a reel/story combo) has
 * every unpaid post over quota. `bookedByFormat` is { format: slots }.
 * Used for combo pages, and for a page whose slots in the phase span more
 * than one format (a plan page booked Reel x1 + Static & Carousel x1: a
 * second reel is over quota, it doesn't take the static's place). A page
 * booked in one format only keeps the count rule above.
 */
export function overQuotaIdsByFormat(links, bookedByFormat) {
  const byFormat = new Map();
  for (const l of links) {
    const key = l.format ?? "";
    if (!byFormat.has(key)) byFormat.set(key, []);
    byFormat.get(key).push(l);
  }
  const over = new Set();
  for (const [format, group] of byFormat) {
    const booked = bookedByFormat[format] ?? 0;
    const ids = booked === 0 ? group.filter((l) => !l.paid).map((l) => l.id) : overQuotaIds(group, booked);
    for (const id of ids) over.add(id);
  }
  return over;
}

/**
 * A non-combo page's slots, when they're booked in more than one format and
 * every slot names a current bookable format (review fix, 16 Oct: a plan can
 * book a page for several formats, one slot per line). Otherwise null: one
 * format only, or a legacy/sheet slot with no or an old format, keeps the
 * count rule exactly as before.
 */
function multiFormatBooking(slots) {
  if (!Array.isArray(slots) || slots.length < 2) return null;
  if (!slots.every((s) => BOOKABLE_FORMATS.includes(s?.format))) return null;
  return new Set(slots.map((s) => s.format)).size > 1 ? slots : null;
}

/** Money has actually left for this post — it's on a PAID invoice or a PAID payout. A raised/approved invoice or a draft payout doesn't count yet. */
const PAID_SELECT = { invoiceItem: { select: { invoice: { select: { status: true } } } }, payoutItem: { select: { payout: { select: { status: true } } } } };
export const isPaidLink = (l) => l.invoiceItem?.invoice?.status === "PAID" || l.payoutItem?.payout?.status === "PAID";

/**
 * Recomputes overQuota for every post on one page within one campaign phase.
 * `campaignId` may be any row of the phase. Writes only the links whose flag
 * actually changes. Returns the ids now over quota.
 */
export async function recomputePostQuota(campaignId, assetId, db = prisma) {
  if (!campaignId || !assetId) return [];
  const rowIds = await phaseRowIds(campaignId, db);
  const combo = (await comboPagesFor(campaignId, [assetId], db)).has(assetId);
  const [booking, slotFormats, rows] = await Promise.all([
    combo
      ? db.campaignAssignment.findMany({ where: { campaignId: { in: rowIds }, assetId }, select: { format: true } })
      : db.campaignAssignment.count({ where: { campaignId: { in: rowIds }, assetId } }),
    combo ? null : db.campaignAssignment.findMany({ where: { campaignId: { in: rowIds }, assetId }, select: { format: true } }),
    db.link.findMany({ where: { campaignId: { in: rowIds }, assetId }, select: { id: true, format: true, postedAt: true, createdAt: true, overQuota: true, ...PAID_SELECT } }),
  ]);
  const links = rows.map((l) => ({ ...l, paid: isPaidLink(l) }));

  let over;
  const perFormat = combo ? booking : multiFormatBooking(slotFormats);
  if (perFormat) {
    const bookedByFormat = {};
    for (const { format } of perFormat) bookedByFormat[format ?? ""] = (bookedByFormat[format ?? ""] ?? 0) + 1;
    over = overQuotaIdsByFormat(links, bookedByFormat);
  } else {
    over = overQuotaIds(links, booking);
  }
  const toFlag = links.filter((l) => over.has(l.id) && !l.overQuota).map((l) => l.id);
  const toClear = links.filter((l) => !over.has(l.id) && l.overQuota).map((l) => l.id);
  if (toFlag.length > 0) await db.link.updateMany({ where: { id: { in: toFlag } }, data: { overQuota: true } });
  if (toClear.length > 0) await db.link.updateMany({ where: { id: { in: toClear } }, data: { overQuota: false } });
  return [...over];
}

/**
 * The belt-and-braces check at the points where money is actually committed
 * (raising an invoice, creating a payout): recompute the pages these links
 * sit on first, so a trigger missed elsewhere can at worst leave a stale
 * number on screen — never pay for a post beyond the booking.
 */
export async function refreshPostQuotaForLinks(links, db = prisma) {
  const seen = new Set();
  for (const { campaignId, assetId } of links) {
    const key = `${campaignId}|${assetId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    await recomputePostQuota(campaignId, assetId, db);
  }
}
