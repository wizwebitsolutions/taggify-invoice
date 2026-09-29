import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../middleware/errorHandler.js";
import { notify } from "../notifications/service.js";
import { INVOICEABLE_STATUSES, invoiceTotals, newInvoiceNumber, markLinksInvoiced, invoiceReceiptFor } from "../invoices/service.js";
import { buildPayoutReceiptKey, getUploadParams, objectExists, publicUrlFor } from "../../lib/cloudinaryClient.js";
import { refreshPostQuotaForLinks } from "../../lib/postQuota.js";

/**
 * Admin/Finance-initiated payouts (tasks.md #5, 23 Sep) — the "Payments" tab.
 * Finance pays a creator for two kinds of work, in one payout:
 *  - unbilled links (INVOICEABLE status, on no invoice, on no payout). When the
 *    payout is paid the system raises the creator's invoice for them (25 Sep),
 *    already PAID/COMPLETED, so it shows in their Invoices section;
 *  - creator-raised invoices still owed (RAISED/APPROVED). Paying marks that
 *    invoice PAID — no second invoice is made for the same links.
 * Partial payment is by subset: pay some links/invoices now, the rest later; an
 * invoice is never split. A link is on an Invoice OR a Payout (see
 * assertLinksPayable), and a paid payout always ends in an invoice.
 */

const GST_RATE = 0.18;
const DAY_MS = 24 * 60 * 60 * 1000;
const DUE_AFTER_DAYS = 30; // an unbilled link falls due this long after it was posted (or submitted)
const OWED_INVOICE_STATUSES = ["RAISED", "APPROVED"];
const paise = (n) => Math.round(n * 100) / 100;

/** subtotal/gst/tds/net for a set of links (+ raised invoices being paid off), rounded to paise at each step so float drift can't leave netAmount off by a fraction once stored as Decimal(12,2). */
export function computePayoutTotals(links, isGstInvoice, tdsPercent, invoices = []) {
  const linksSubtotal = paise(links.reduce((sum, l) => sum + Number(l.cost), 0));
  const subtotal = paise(linksSubtotal + invoices.reduce((sum, inv) => sum + Number(inv.subtotal), 0));
  // GST is added only to unbilled links; a raised invoice already carries its own.
  const gstAmount = paise((isGstInvoice ? linksSubtotal * GST_RATE : 0) + invoices.reduce((sum, inv) => sum + Number(inv.gstAmount), 0));
  const tdsAmount = tdsPercent ? paise(subtotal * (tdsPercent / 100)) : 0;
  const netAmount = paise(subtotal + gstAmount - tdsAmount);
  return { subtotal, gstAmount, tdsAmount, netAmount };
}

const LINK_INCLUDE_FOR_PAYOUT = {
  asset: true,
  invoiceItem: { include: { invoice: { select: { invoiceNumber: true } } } },
  payoutItem: { select: { payoutId: true } },
};

/** Same shape of error as invoices/service.js's assertLinksInvoiceable — names the URL, not the id, so it's findable on screen. */
function assertLinksPayable(links) {
  // overQuota (29 Sep): beyond what the campaign booked for the page — the creator's own extra, never paid (lib/postQuota.js).
  const ineligible = links.filter((l) => !INVOICEABLE_STATUSES.has(l.status) || l.invoiceItem || l.payoutItem || l.overQuota);
  if (ineligible.length === 0) return;
  const describe = (l) => {
    if (l.invoiceItem) return `${l.url} (on invoice ${l.invoiceItem.invoice?.invoiceNumber ?? ""}, pay that invoice instead)`;
    if (l.payoutItem) return `${l.url} (already on a payout)`;
    if (l.overQuota) return `${l.url} (beyond the posts booked for this page on that campaign)`;
    return `${l.url} (${l.status.toLowerCase().replace(/_/g, " ")})`;
  };
  throw new ApiError(400, "INELIGIBLE_LINKS", `Not eligible for payout: ${ineligible.map(describe).join("; ")}`);
}

/** A raised/approved invoice, none of whose links is already on a payout. Paid and rejected invoices can't be selected. */
function assertInvoicesPayable(invoices) {
  // An invoice carrying over-quota posts (29 Sep) is flagged, not paid — it has
  // to be rejected and re-raised with only the booked posts (invoices/service.js
  // assertNoOverQuotaPosts), never paid for more than the campaign booked.
  const overQuota = (inv) => inv.items.some((i) => i.link.overQuota);
  const bad = invoices.filter((inv) => !OWED_INVOICE_STATUSES.includes(inv.status) || inv.items.some((i) => i.link.payoutItem) || overQuota(inv));
  if (bad.length === 0) return;
  const describe = (inv) => {
    if (inv.status === "PAID") return `${inv.invoiceNumber} (already paid)`;
    if (inv.status === "REJECTED") return `${inv.invoiceNumber} (rejected)`;
    if (!OWED_INVOICE_STATUSES.includes(inv.status)) return `${inv.invoiceNumber} (${inv.status.toLowerCase()})`;
    if (overQuota(inv)) return `${inv.invoiceNumber} (includes posts beyond the booking — reject it so it's raised again)`;
    return `${inv.invoiceNumber} (already on a payout)`;
  };
  throw new ApiError(400, "INELIGIBLE_INVOICES", `Not eligible for payout: ${bad.map(describe).join("; ")}`);
}

export async function createPayout(actor, { creatorId, linkIds = [], invoiceIds = [], isGstInvoice, tdsPercent }) {
  // Money is about to be committed: re-derive the over-quota flags for every
  // post this payout would touch — its own links and the invoices' links — so
  // a trigger missed elsewhere can never pay for a post beyond the booking.
  const touched = await prisma.link.findMany({
    where: { OR: [{ id: { in: linkIds } }, { invoiceItem: { invoiceId: { in: invoiceIds } } }] },
    select: { campaignId: true, assetId: true },
  });
  await refreshPostQuotaForLinks(touched);

  const links = linkIds.length ? await prisma.link.findMany({ where: { id: { in: linkIds } }, include: LINK_INCLUDE_FOR_PAYOUT }) : [];
  if (links.length !== linkIds.length) throw new ApiError(404, "LINK_NOT_FOUND", "One or more links do not exist");
  const invoices = invoiceIds.length
    ? await prisma.invoice.findMany({ where: { id: { in: invoiceIds } }, include: { items: { include: { link: { include: { payoutItem: { select: { payoutId: true } } } } } } } })
    : [];
  if (invoices.length !== invoiceIds.length) throw new ApiError(404, "INVOICE_NOT_FOUND", "One or more invoices do not exist");

  const ownerIds = new Set([...links.map((l) => l.asset.ownerId), ...invoices.map((inv) => inv.creatorId)]);
  if (ownerIds.size !== 1 || [...ownerIds][0] !== creatorId) {
    throw new ApiError(400, "MIXED_CREATORS", "All links and invoices in one payout must belong to the chosen vendor");
  }
  assertLinksPayable(links);
  assertInvoicesPayable(invoices);

  const invoiceLinks = invoices.flatMap((inv) => inv.items.map((i) => i.link));
  const totals = computePayoutTotals(links, isGstInvoice, tdsPercent ?? null, invoices);

  const payout = await prisma.payout.create({
    data: {
      creatorId,
      createdById: actor.id,
      isGstInvoice,
      tdsPercent: tdsPercent ?? null,
      ...totals,
      status: "DRAFT",
      items: { create: [...links, ...invoiceLinks].map((l) => ({ linkId: l.id, amount: l.cost })) },
    },
    include: { items: true },
  });

  return payout;
}

/**
 * Runs inside confirmPayoutReceipt's transaction, right after DRAFT → PAID.
 * Links on no invoice get the creator's invoice raised now (PAID/COMPLETED, GST
 * status COMPLETED for a GST payout); links on a creator invoice pay that
 * invoice off (only if still RAISED/APPROVED — one already marked paid in the
 * Invoices section is left alone). Derived from the items rather than stored,
 * so nothing extra is needed on the payout row.
 */
async function settleCoveredWork(tx, payout, actor, paidAt) {
  const items = await tx.payoutItem.findMany({ where: { payoutId: payout.id }, include: { link: { include: { invoiceItem: true } } } });
  const unbilled = items.map((i) => i.link).filter((l) => !l.invoiceItem);
  const invoiceIds = [...new Set(items.map((i) => i.link.invoiceItem?.invoiceId).filter(Boolean))];

  let createdInvoice = null;
  if (unbilled.length > 0) {
    const campaignIds = new Set(unbilled.map((l) => l.campaignId).filter(Boolean));
    createdInvoice = await tx.invoice.create({
      data: {
        creatorId: payout.creatorId,
        campaignId: campaignIds.size === 1 ? [...campaignIds][0] : null,
        raisedById: actor.id,
        invoiceNumber: newInvoiceNumber(),
        ...invoiceTotals(unbilled, payout.isGstInvoice),
        isGstInvoice: payout.isGstInvoice,
        status: "PAID",
        paymentStatus: "COMPLETED",
        gstStatus: payout.isGstInvoice ? "COMPLETED" : "PENDING",
        dueDate: paidAt,
        paidAt,
        items: { create: unbilled.map((l) => ({ linkId: l.id, amount: l.cost })) },
      },
    });
    await markLinksInvoiced(tx, unbilled.map((l) => l.id), actor.id);
  }
  if (invoiceIds.length > 0) {
    const { count } = await tx.invoice.updateMany({
      where: { id: { in: invoiceIds }, status: { in: OWED_INVOICE_STATUSES } },
      data: { status: "PAID", paymentStatus: "COMPLETED", paidAt },
    });
    // An invoice that was marked paid (or rejected) in the Invoices section while this
    // payout sat as a draft must not be paid a second time: roll the whole confirm back.
    if (count !== invoiceIds.length) {
      throw new ApiError(409, "INVOICE_CHANGED", "An invoice on this payout was already paid or rejected meanwhile — cancel this payout and pay again from the list");
    }
  }
  return { createdInvoice, invoiceIds };
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
  // This is where money actually leaves, and a draft can sit for days after
  // createPayout checked it — a scrape in between can move a post on it past
  // the booking. Re-derive and re-check here too (review finding, 29 Sep).
  const draftLinks = await prisma.link.findMany({ where: { payoutItem: { payoutId } }, select: { campaignId: true, assetId: true } });
  await refreshPostQuotaForLinks(draftLinks);
  const overOnDraft = await prisma.payoutItem.count({ where: { payoutId, link: { overQuota: true } } });
  if (overOnDraft > 0) {
    throw new ApiError(
      409,
      "OVER_QUOTA",
      `${overOnDraft} post${overOnDraft === 1 ? " on this payout is" : "s on this payout are"} now beyond what the campaign booked. Cancel this payout and pay again from the list.`
    );
  }
  // Guarded transition (updateMany on status DRAFT), not check-then-update:
  // two overlapping confirms, or a cancel landing mid-confirm, can't both
  // win — the loser gets a 409 instead of a double PAID / a 500. The invoice
  // work (settleCoveredWork) is in the same transaction: a payout is never PAID
  // while its invoice is missing.
  const paidAt = paidOn ?? new Date();
  const settled = await prisma.$transaction(async (tx) => {
    const { count } = await tx.payout.updateMany({
      where: { id: payoutId, status: "DRAFT" },
      data: {
        status: "PAID",
        paidAt,
        utr: utr?.trim() || null,
        markedPaidById: actor.id,
        receiptPublicId: publicId,
        receiptName: fileName,
        receiptUploadedAt: new Date(),
      },
    });
    if (count === 0) throw new ApiError(409, "INVALID_STATUS", "This payout was already completed or cancelled");
    return settleCoveredWork(tx, payout, actor, paidAt);
  });
  const updated = await prisma.payout.findUnique({ where: { id: payoutId }, include: PAYOUT_INCLUDE });

  await notifyQuietly(payout.creatorId, "payout_paid", { payoutId, markedById: actor.id, amount: updated.netAmount });
  // Every invoice this payout settles gets its own invoice_paid — not just
  // one created from unbilled links. Without this, a payout that only pays
  // off an already-raised invoice (invoiceIds, no unbilled links) never
  // notified the creator their invoice was paid.
  for (const invoiceId of settled.invoiceIds) {
    if (settled.createdInvoice?.id === invoiceId) continue;
    await notifyQuietly(payout.creatorId, "invoice_paid", { invoiceId, markedById: actor.id });
  }
  if (settled.createdInvoice) {
    await notifyQuietly(payout.creatorId, "invoice_paid", { invoiceId: settled.createdInvoice.id, markedById: actor.id });
  }
  return withResolvedReceipt(updated);
}

const PAYOUT_INCLUDE = {
  creator: { select: { id: true, name: true, phoneNumber: true, email: true } },
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
 * A PAID invoice that never went through a Payout — the direct-mark-paid
 * bypass this file used to allow (now removed; see invoices/service.js).
 * Exactly the filter getPaymentSummary's tile math already uses, factored
 * out here so the "Paid this month" tile and the Paid list can't drift
 * apart again the way they did before this fix.
 */
export function standalonePaidInvoicesWhere(filters = {}) {
  const where = { status: "PAID", items: { none: { link: { payoutItem: { isNot: null } } } } };
  if (filters.creatorId) where.creatorId = filters.creatorId;
  if (filters.from || filters.to) {
    const range = {};
    if (filters.from) range.gte = filters.from;
    if (filters.to) range.lte = filters.to;
    where.paidAt = range;
  }
  return where;
}

/**
 * The Paid tab's actual list (fix, 28 Sep): real Payouts plus any standalone
 * PAID invoice with no Payout behind it — legacy rows from before the direct
 * mark-paid path was removed, which the tile already counted but the list
 * never showed. Two capped reads merged+sorted by paidAt in JS (same
 * "capped page per source" convention as listPendingLinks — not real
 * cross-table cursor pagination, since Payout and Invoice are different
 * tables with different columns).
 */
export async function listPaidLedger(actor, filters = {}) {
  const pageSize = filters.pageSize ?? 100;
  const standaloneWhere = standalonePaidInvoicesWhere(filters);
  const [payoutsResult, standaloneInvoices, standaloneTotal] = await Promise.all([
    listPayouts(actor, { ...filters, status: "PAID", pageSize }),
    prisma.invoice.findMany({
      where: standaloneWhere,
      include: {
        creator: { select: { id: true, name: true, phoneNumber: true, email: true } },
        items: { include: { link: { select: INVOICE_LINK_SELECT } } },
      },
      orderBy: { paidAt: "desc" },
      take: pageSize,
    }),
    // A real count, not standaloneInvoices.length — that read is capped at
    // pageSize, so using its length here would silently undercount once
    // legacy standalone-paid invoices outnumber one page (TruncationNote
    // compares against this total to decide whether to warn at all).
    prisma.invoice.count({ where: standaloneWhere }),
  ]);
  const rows = [
    ...payoutsResult.items.map((p) => ({ kind: "payout", paidAt: p.paidAt, payout: p })),
    ...standaloneInvoices.map(({ items: invItems, ...inv }) => ({
      kind: "invoice",
      paidAt: inv.paidAt,
      invoice: { ...inv, links: invItems.map((i) => i.link), receipt: invoiceReceiptFor(inv) },
    })),
  ].sort((a, b) => new Date(b.paidAt) - new Date(a.paidAt));
  return { items: rows, total: payoutsResult.total + standaloneTotal };
}

/** Creator side: only their own paid ledger. */
export function listMyPaidLedger(actor, filters = {}) {
  return listPaidLedger(actor, { ...filters, creatorId: actor.id });
}

/**
 * The Payments tab's "Pending" list (24 Sep redesign): every link that could
 * still go on a payout, across all vendors — same eligibility as
 * assertLinksPayable (an INVOICEABLE status, not on an invoice, not on a
 * payout — a DRAFT payout counts, so its links stay off until it's finished
 * or cancelled). Filters: vendor (ownerId), one page (assetId), page-handle
 * search (q), and a date range on when it was posted (falling back to when
 * it was submitted, since postedAt is only known once insights come in).
 * Links already on an invoice aren't listed on their own: they show inside
 * their invoice (see listPendingLinks).
 */
export function pendingLinksWhere(filters = {}) {
  // overQuota: false (29 Sep) — a post beyond its campaign booking is never owed.
  const where = { status: { in: [...INVOICEABLE_STATUSES] }, invoiceItem: null, payoutItem: null, overQuota: false };
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

/**
 * Invoices shown next to the unbilled links (25 Sep): always the still-owed
 * ones (raised/approved) — a paid invoice now lives in the Paid tab's merged
 * ledger (listPaidLedger) instead, not here. Rejected invoices never show —
 * their links went back to the pool.
 */
export function pendingInvoicesWhere(filters = {}) {
  const where = { status: { in: [...OWED_INVOICE_STATUSES] } };
  if (filters.ownerId) where.creatorId = filters.ownerId;
  const link = {};
  const handle = handleContains(filters.q);
  if (handle) link.asset = { handle };
  if (filters.assetId) link.assetId = filters.assetId;
  if (Object.keys(link).length > 0) where.items = { some: { link } };
  if (filters.from || filters.to) {
    const range = {};
    if (filters.from) range.gte = filters.from;
    if (filters.to) range.lte = filters.to;
    where.createdAt = range;
  }
  return where;
}

const INVOICE_LINK_SELECT = {
  id: true,
  url: true,
  format: true,
  cost: true,
  status: true,
  postedAt: true,
  createdAt: true,
  asset: { select: { id: true, handle: true } },
  campaign: { select: { id: true, title: true, brandName: true } },
  payoutItem: { select: { payoutId: true } },
  overQuota: true,
};

export async function listPendingLinks(actor, filters = {}) {
  const where = pendingLinksWhere(filters);
  const invoiceWhere = pendingInvoicesWhere(filters);
  const [items, total, invoices] = await Promise.all([
    prisma.link.findMany({
      where,
      include: {
        campaign: { select: { id: true, title: true, brandName: true } },
        asset: { select: { id: true, handle: true, ownerId: true, owner: { select: { id: true, name: true, phoneNumber: true, email: true } } } },
        screenshot: true,
        postSnapshots: { orderBy: { capturedAt: "desc" }, take: 1 },
      },
      orderBy: [{ postedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      take: filters.pageSize ?? 200,
    }),
    prisma.link.count({ where }),
    prisma.invoice.findMany({
      where: invoiceWhere,
      include: {
        creator: { select: { id: true, name: true, phoneNumber: true, email: true } },
        items: { include: { link: { select: INVOICE_LINK_SELECT } } },
      },
      orderBy: { createdAt: "desc" },
      take: filters.pageSize ?? 200,
    }),
  ]);
  return {
    items: items.map((l) => ({ ...l, screenshot: l.screenshot ? { ...l.screenshot, url: publicUrlFor(l.screenshot.publicId) } : null })),
    total,
    // `selectable` is what the UI's checkbox follows: an owed invoice none of whose links is already on a payout (pendingInvoicesWhere
    // already limits this list to owed invoices), and — since 29 Sep — none beyond its campaign booking, which has to be re-raised instead.
    invoices: invoices.map(({ items: invItems, ...inv }) => {
      const overQuotaCount = invItems.filter((i) => i.link.overQuota).length;
      return {
        ...inv,
        links: invItems.map((i) => i.link),
        overQuotaCount,
        selectable: !invItems.some((i) => i.link.payoutItem) && overQuotaCount === 0,
      };
    }),
  };
}

/**
 * Money owed, sliced for the four Payments tiles (25 Sep). Pure so the month
 * and 30-day boundaries are testable: an unbilled link falls due DUE_AFTER_DAYS
 * after it was posted (or submitted); an invoice on its own dueDate (raise date
 * + 30 days when it has none). "30+ days" = due more than 30 days ago. A link
 * on an invoice is counted once, through the invoice.
 */
export function computeDues(links, invoices, now = new Date()) {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const overdueBefore = new Date(now.getTime() - 30 * DAY_MS);
  const entries = [
    ...links.map((l) => ({ amount: Number(l.cost), due: new Date(new Date(l.postedAt ?? l.createdAt).getTime() + DUE_AFTER_DAYS * DAY_MS) })),
    ...invoices.map((inv) => ({ amount: Number(inv.amount), due: inv.dueDate ? new Date(inv.dueDate) : new Date(new Date(inv.createdAt).getTime() + DUE_AFTER_DAYS * DAY_MS) })),
  ];
  const sum = (list) => paise(list.reduce((t, e) => t + e.amount, 0));
  return {
    totalDues: sum(entries),
    dueThisMonth: sum(entries.filter((e) => e.due >= monthStart && e.due < nextMonthStart)),
    overdue30: sum(entries.filter((e) => e.due < overdueBefore)),
    dueCount: entries.length,
  };
}

/** Totals for the Payments tiles. `ownerId` scopes it to one vendor (always the caller on the creator side). */
export async function getPaymentSummary(actor, { ownerId } = {}) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const thisMonth = { gte: monthStart, lt: nextMonthStart };
  const [links, invoices, paidPayouts, paidInvoices] = await Promise.all([
    prisma.link.findMany({
      // Links on a PAID payout (paid out before payouts raised invoices) aren't owed any more; a DRAFT payout's still are.
      where: {
        status: { in: [...INVOICEABLE_STATUSES] },
        invoiceItem: null,
        // A post beyond its campaign booking isn't a due (29 Sep).
        overQuota: false,
        OR: [{ payoutItem: null }, { payoutItem: { payout: { status: "DRAFT" } } }],
        ...(ownerId ? { asset: { ownerId } } : {}),
      },
      select: { cost: true, postedAt: true, createdAt: true },
    }),
    prisma.invoice.findMany({ where: { status: { in: OWED_INVOICE_STATUSES }, ...(ownerId ? { creatorId: ownerId } : {}) }, select: { amount: true, dueDate: true, createdAt: true } }),
    prisma.payout.aggregate({ where: { status: "PAID", paidAt: thisMonth, ...(ownerId ? { creatorId: ownerId } : {}) }, _sum: { netAmount: true } }),
    // Invoices marked paid in the Invoices section. Ones a payout produced or paid are already in the payout figure.
    prisma.invoice.aggregate({
      where: { status: "PAID", paidAt: thisMonth, items: { none: { link: { payoutItem: { isNot: null } } } }, ...(ownerId ? { creatorId: ownerId } : {}) },
      _sum: { amount: true },
    }),
  ]);
  return {
    ...computeDues(links, invoices, now),
    paidThisMonth: paise(Number(paidPayouts._sum.netAmount ?? 0) + Number(paidInvoices._sum.amount ?? 0)),
  };
}

/** Creator side (24 Sep): only links on pages the caller owns — ownerId is forced, never taken from the query. */
export function listMyPendingLinks(actor, filters = {}) {
  return listPendingLinks(actor, { ...filters, ownerId: actor.id });
}

export function getMyPaymentSummary(actor) {
  return getPaymentSummary(actor, { ownerId: actor.id });
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
