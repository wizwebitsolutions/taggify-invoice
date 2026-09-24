import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../middleware/errorHandler.js";
import { notify } from "../notifications/service.js";
import { INVOICEABLE_STATUSES } from "../invoices/service.js";
import { buildPayoutReceiptKey, getUploadParams, objectExists, publicUrlFor } from "../../lib/cloudinaryClient.js";

/**
 * Admin/Finance-initiated payouts (tasks.md #5, 23 Sep) — the "Payments" tab's
 * internal-costing side. Distinct from Invoice (creator self-raises their own
 * bill, locked CREATOR-only since 13 Sep): here Finance picks the links and
 * pays, so eligibility only needs the same INVOICEABLE_STATUSES gate plus
 * "not already spoken for" by either mechanism — a link can be billed via a
 * creator Invoice OR an admin Payout, never both (see assertLinksPayable).
 */

const GST_RATE = 0.18;

/** subtotal/gst/tds/net for a set of links, rounded to paise at each step so float drift can't leave netAmount off by a fraction once stored as Decimal(12,2). */
export function computePayoutTotals(links, isGstInvoice, tdsPercent) {
  const paise = (n) => Math.round(n * 100) / 100;
  const subtotal = paise(links.reduce((sum, l) => sum + Number(l.cost), 0));
  const gstAmount = isGstInvoice ? paise(subtotal * GST_RATE) : 0;
  const tdsAmount = tdsPercent ? paise(subtotal * (tdsPercent / 100)) : 0;
  const netAmount = paise(subtotal + gstAmount - tdsAmount);
  return { subtotal, gstAmount, tdsAmount, netAmount };
}

const LINK_INCLUDE_FOR_PAYOUT = { asset: true, invoiceItem: { select: { invoiceId: true } }, payoutItem: { select: { payoutId: true } } };

/** Same shape of error as invoices/service.js's assertLinksInvoiceable — names the URL, not the id, so it's findable on screen. */
function assertLinksPayable(links) {
  const ineligible = links.filter((l) => !INVOICEABLE_STATUSES.has(l.status) || l.invoiceItem || l.payoutItem);
  if (ineligible.length === 0) return;
  const describe = (l) => {
    if (l.invoiceItem) return `${l.url} (already on an invoice)`;
    if (l.payoutItem) return `${l.url} (already on a payout)`;
    return `${l.url} (${l.status.toLowerCase().replace(/_/g, " ")})`;
  };
  throw new ApiError(400, "INELIGIBLE_LINKS", `Not eligible for payout: ${ineligible.map(describe).join("; ")}`);
}

export async function createPayout(actor, { creatorId, linkIds, isGstInvoice, tdsPercent }) {
  const links = await prisma.link.findMany({ where: { id: { in: linkIds } }, include: LINK_INCLUDE_FOR_PAYOUT });
  if (links.length !== linkIds.length) throw new ApiError(404, "LINK_NOT_FOUND", "One or more links do not exist");

  const ownerIds = new Set(links.map((l) => l.asset.ownerId));
  if (ownerIds.size !== 1 || [...ownerIds][0] !== creatorId) {
    throw new ApiError(400, "MIXED_CREATORS", "All links in one payout must belong to the chosen vendor");
  }
  assertLinksPayable(links);

  const totals = computePayoutTotals(links, isGstInvoice, tdsPercent ?? null);

  const payout = await prisma.payout.create({
    data: {
      creatorId,
      createdById: actor.id,
      isGstInvoice,
      tdsPercent: tdsPercent ?? null,
      ...totals,
      status: "DRAFT",
      items: { create: links.map((l) => ({ linkId: l.id, amount: l.cost })) },
    },
    include: { items: true },
  });

  return payout;
}

/** Only while DRAFT — releases the locked links back to the pool for an admin who backs out before attaching a receipt. */
export async function cancelPayout(payoutId, actor) {
  const payout = await prisma.payout.findUnique({ where: { id: payoutId } });
  if (!payout) throw new ApiError(404, "PAYOUT_NOT_FOUND", "Payout not found");
  if (payout.status !== "DRAFT") throw new ApiError(409, "INVALID_STATUS", "Only a draft payout (before a receipt is attached) can be cancelled");
  await prisma.payout.delete({ where: { id: payoutId } });
  return null;
}

export async function requestPayoutReceiptUpload(payoutId, actor) {
  const payout = await prisma.payout.findUnique({ where: { id: payoutId } });
  if (!payout) throw new ApiError(404, "PAYOUT_NOT_FOUND", "Payout not found");
  if (payout.status !== "DRAFT") throw new ApiError(409, "INVALID_STATUS", "This payout already has a receipt attached");
  return getUploadParams(buildPayoutReceiptKey(payoutId));
}

export async function confirmPayoutReceipt(payoutId, actor, { publicId, fileName, paidOn, utr }) {
  const payout = await prisma.payout.findUnique({ where: { id: payoutId } });
  if (!payout) throw new ApiError(404, "PAYOUT_NOT_FOUND", "Payout not found");
  if (payout.status !== "DRAFT") throw new ApiError(409, "INVALID_STATUS", "This payout already has a receipt attached");
  if (!publicId.startsWith(`payout-receipts/${payoutId}/`)) {
    throw new ApiError(400, "KEY_MISMATCH", "Object key does not belong to this payout");
  }
  if (!(await objectExists(publicId))) {
    throw new ApiError(422, "UPLOAD_NOT_FOUND", "No file found at that key — upload may not have completed");
  }
  // "Paid on" (24 Sep redesign) is the date the money actually left, which
  // can be earlier than the moment Finance gets round to attaching the
  // receipt — but never in the future (a day of slack for timezones).
  if (paidOn && paidOn.getTime() > Date.now() + 24 * 60 * 60 * 1000) {
    throw new ApiError(400, "PAID_ON_IN_FUTURE", "Paid-on date can't be in the future");
  }
  // Guarded transition (updateMany on status DRAFT), not check-then-update:
  // two overlapping confirms, or a cancel landing mid-confirm, can't both
  // win — the loser gets a 409 instead of a double PAID / a 500.
  const { count } = await prisma.payout.updateMany({
    where: { id: payoutId, status: "DRAFT" },
    data: {
      status: "PAID",
      paidAt: paidOn ?? new Date(),
      utr: utr?.trim() || null,
      markedPaidById: actor.id,
      receiptPublicId: publicId,
      receiptName: fileName,
      receiptUploadedAt: new Date(),
    },
  });
  if (count === 0) throw new ApiError(409, "INVALID_STATUS", "This payout was already completed or cancelled");
  const updated = await prisma.payout.findUnique({ where: { id: payoutId }, include: PAYOUT_INCLUDE });

  await notifyQuietly(payout.creatorId, "payout_paid", { payoutId, markedById: actor.id, amount: updated.netAmount });
  return withResolvedReceipt(updated);
}

const PAYOUT_INCLUDE = {
  creator: { select: { id: true, name: true, phoneNumber: true } },
  createdBy: { select: { id: true, name: true } },
  markedPaidBy: { select: { id: true, name: true } },
  // Enough per link for the Paid tab's expanded row (24 Sep): campaign, page, format, posted date, views, cost.
  items: {
    include: {
      link: {
        select: {
          id: true,
          url: true,
          format: true,
          cost: true,
          status: true,
          postedAt: true,
          createdAt: true,
          assetId: true,
          campaignId: true,
          asset: { select: { id: true, handle: true } },
          campaign: { select: { id: true, title: true, brandName: true } },
          postSnapshots: { orderBy: { capturedAt: "desc" }, take: 1 },
        },
      },
    },
  },
};

/** Public shape — never the raw public_id, always a usable URL plus the original file name (mirrors invoices/service.js's attachmentFor). */
function receiptFor(payout) {
  if (!payout.receiptPublicId) return null;
  return { name: payout.receiptName ?? "Payment receipt", url: publicUrlFor(payout.receiptPublicId), uploadedAt: payout.receiptUploadedAt };
}

function withResolvedReceipt(payout) {
  return { ...payout, receipt: receiptFor(payout) };
}

/** Page-handle search as typed ("@memes", "memes.daily") → a case-insensitive contains on Asset.handle. */
function handleContains(q) {
  const term = q?.trim().replace(/^@/, "");
  return term ? { contains: term, mode: "insensitive" } : undefined;
}

export function payoutsWhere(filters = {}) {
  const where = {};
  if (filters.creatorId) where.creatorId = filters.creatorId;
  if (filters.status) where.status = filters.status;
  const handle = handleContains(filters.q);
  if (filters.assetId || handle) {
    const link = {};
    if (filters.assetId) link.assetId = filters.assetId;
    if (handle) link.asset = { handle };
    where.items = { some: { link } };
  }
  // The Paid tab's month filter means "paid in" (24 Sep redesign), not
  // "created in" — a payout drafted on the 30th and paid on the 2nd belongs
  // to the later month. Drafts have no paidAt, so they keep createdAt.
  if (filters.from || filters.to) {
    const range = {};
    if (filters.from) range.gte = filters.from;
    if (filters.to) range.lte = filters.to;
    where[filters.status === "PAID" ? "paidAt" : "createdAt"] = range;
  }
  return where;
}

export async function listPayouts(actor, filters = {}) {
  const where = payoutsWhere(filters);

  const [items, total] = await prisma.$transaction([
    prisma.payout.findMany({
      where,
      include: PAYOUT_INCLUDE,
      // Paid list reads by paid date (the column it shows and filters on).
      orderBy: filters.status === "PAID" ? [{ paidAt: "desc" }, { createdAt: "desc" }] : { createdAt: "desc" },
      skip: ((filters.page ?? 1) - 1) * (filters.pageSize ?? 25),
      take: filters.pageSize ?? 25,
    }),
    prisma.payout.count({ where }),
  ]);
  return { items: items.map(withResolvedReceipt), total };
}

/**
 * The Payments tab's "Pending" list (24 Sep redesign): every link that could
 * still go on a payout, across all vendors — same eligibility as
 * assertLinksPayable (an INVOICEABLE status, not on an invoice, not on a
 * payout — a DRAFT payout counts, so its links stay off until it's finished
 * or cancelled). Filters: vendor (ownerId), one page (assetId), page-handle
 * search (q), and a date range on when it was posted (falling back to when
 * it was submitted, since postedAt is only known once insights come in).
 */
export function pendingLinksWhere(filters = {}) {
  const where = { status: { in: [...INVOICEABLE_STATUSES] }, invoiceItem: null, payoutItem: null };
  const asset = {};
  if (filters.ownerId) asset.ownerId = filters.ownerId;
  const handle = handleContains(filters.q);
  if (handle) asset.handle = handle;
  if (Object.keys(asset).length > 0) where.asset = asset;
  if (filters.assetId) where.assetId = filters.assetId;
  if (filters.from || filters.to) {
    const range = {};
    if (filters.from) range.gte = filters.from;
    if (filters.to) range.lte = filters.to;
    where.OR = [{ postedAt: range }, { postedAt: null, createdAt: range }];
  }
  return where;
}

export async function listPendingLinks(actor, filters = {}) {
  const where = pendingLinksWhere(filters);
  const [items, total] = await prisma.$transaction([
    prisma.link.findMany({
      where,
      include: {
        campaign: { select: { id: true, title: true, brandName: true } },
        asset: { select: { id: true, handle: true, ownerId: true, owner: { select: { id: true, name: true, phoneNumber: true } } } },
        screenshot: true,
        postSnapshots: { orderBy: { capturedAt: "desc" }, take: 1 },
      },
      orderBy: [{ postedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      take: filters.pageSize ?? 200,
    }),
    prisma.link.count({ where }),
  ]);
  return {
    items: items.map((l) => ({ ...l, screenshot: l.screenshot ? { ...l.screenshot, url: publicUrlFor(l.screenshot.publicId) } : null })),
    total,
  };
}

/** Creator side (24 Sep): only links on pages the caller owns — ownerId is forced, never taken from the query. */
export function listMyPendingLinks(actor, filters = {}) {
  return listPendingLinks(actor, { ...filters, ownerId: actor.id });
}

/** Creator side: only their own PAID payouts — no drafts (nothing's been paid yet) and never anyone else's. */
export function listMyPayouts(actor, filters = {}) {
  return listPayouts(actor, { ...filters, creatorId: actor.id, status: "PAID" });
}

async function notifyQuietly(userId, type, payload) {
  try {
    await notify(userId, type, payload);
  } catch (err) {
    console.error(`[payments] notify(${type}) failed for ${userId}:`, err?.message ?? err);
  }
}
