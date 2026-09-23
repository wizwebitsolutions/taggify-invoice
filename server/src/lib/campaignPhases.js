import { prisma } from "./prisma.js";

/**
 * Phases vs extra posts (user request, 22 Sep — "there are 2 phases types").
 * Every row of a campaign group hangs off the root (parentCampaignId):
 *  - a real phase: postNumber 1 — "Phase 2" to everyone;
 *  - an extra post of phase P: phaseNumber P, postNumber 2+ — a page booked
 *    for 2 reels. Admins see it as one more post of phase P; creators see it
 *    as the next numbered phase.
 * Creator numbering is one running count, ordered by (phaseNumber,
 * postNumber), over the rows that creator is booked on: phase 1 with 2
 * posts + a real phase 2 reads Phase 1, 2, 3 to that creator and Phase 1
 * (×2 posts), Phase 2 to admins; a creator with one post there sees 1, 2.
 *
 * Own module (not campaigns/service.js) so links/ and invoices/ can use it
 * without the campaigns → links import cycle.
 */

const GROUP_SELECT = { id: true, title: true, parentCampaignId: true, phaseNumber: true, postNumber: true };

export function byPhaseThenPost(a, b) {
  return a.phaseNumber - b.phaseNumber || a.postNumber - b.postNumber;
}

/** 1-based running count of `row` within its (already fetched) group. */
export function creatorPhaseNumberIn(group, rowId) {
  const ordered = [...group].sort(byPhaseThenPost);
  return ordered.findIndex((r) => r.id === rowId) + 1;
}

export function creatorPhaseTitle(rootTitle, creatorPhaseNumber) {
  return creatorPhaseNumber > 1 ? `${rootTitle} — Phase ${creatorPhaseNumber}` : rootTitle;
}

/** Every row in the group of each root id, keyed by root id (roots included). */
export async function groupsByRoot(rootIds, db = prisma) {
  const ids = [...new Set(rootIds)];
  if (ids.length === 0) return new Map();
  const rows = await db.campaign.findMany({ where: { OR: [{ id: { in: ids } }, { parentCampaignId: { in: ids } }] }, select: GROUP_SELECT });
  const groups = new Map(ids.map((id) => [id, []]));
  for (const row of rows) groups.get(row.parentCampaignId ?? row.id)?.push(row);
  return groups;
}

/**
 * The part of a group a creator counts over: the root (their Phase 1) plus
 * every row one of their own pages is booked on. Their numbering runs over
 * only these, so another creator's extra reel never puts a gap in theirs
 * (a creator with one post per phase sees Phase 1, 2 — not 1, 3).
 */
export function creatorRowsOf(group, bookedRowIds) {
  return group.filter((r) => !r.parentCampaignId || bookedRowIds.has(r.id));
}

/** Row ids in `campaignIds`' groups that `ownerId`'s pages are booked on. */
export async function rowsBookedFor(ownerId, campaignIds, db = prisma) {
  if (campaignIds.length === 0) return new Set();
  const rows = await db.campaignAssignment.findMany({ where: { campaignId: { in: campaignIds }, asset: { ownerId } }, select: { campaignId: true } });
  return new Set(rows.map((r) => r.campaignId));
}

/**
 * Creator-facing number + title for each campaign id (any row of a group),
 * counted over that creator's own rows (see creatorRowsOf). Used wherever a
 * creator sees a campaign's name: the campaigns list, their links.
 */
export async function creatorPhaseLabels(campaignIds, ownerId, db = prisma) {
  const ids = [...new Set(campaignIds.filter(Boolean))];
  if (ids.length === 0) return new Map();
  const rows = await db.campaign.findMany({ where: { id: { in: ids } }, select: { id: true, parentCampaignId: true } });
  const rootIds = rows.map((r) => r.parentCampaignId ?? r.id);
  const groups = await groupsByRoot(rootIds, db);
  const booked = await rowsBookedFor(ownerId, [...groups.values()].flat().map((r) => r.id), db);
  const labels = new Map();
  for (const row of rows) {
    const group = groups.get(row.parentCampaignId ?? row.id) ?? [];
    const root = group.find((r) => !r.parentCampaignId);
    // The row itself always counts — a link on it means they're on it.
    const theirs = creatorRowsOf(group, new Set([...booked, row.id]));
    const n = creatorPhaseNumberIn(theirs, row.id);
    labels.set(row.id, { creatorPhaseNumber: n, title: creatorPhaseTitle(root?.title ?? "", n) });
  }
  return labels;
}

/**
 * The rows an admin's view of one real phase covers: the phase row itself
 * plus its extra posts. Given an extra-post id, returns its phase's rows.
 * Unknown id → [id] (callers' own 404 handling stays in charge).
 */
export async function phaseRowIds(campaignId, db = prisma) {
  const row = await db.campaign.findUnique({ where: { id: campaignId }, select: { id: true, parentCampaignId: true, phaseNumber: true } });
  if (!row) return [campaignId];
  const rootId = row.parentCampaignId ?? row.id;
  const rows = await db.campaign.findMany({
    where: { OR: [{ id: rootId }, { parentCampaignId: rootId }], phaseNumber: row.phaseNumber },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}
