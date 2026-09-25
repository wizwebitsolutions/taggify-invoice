import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../middleware/errorHandler.js";
import { transitionLinkStatus, ALREADY_INVOICED } from "./statusTimeline.js";
import { refreshLinkMetrics } from "../scraping/service.js";
import { publicUrlFor } from "../../lib/cloudinaryClient.js";
import { planMakerCampaignWhere } from "../../lib/campaignAccess.js";
import { creatorPhaseLabels, phaseRowIds } from "../../lib/campaignPhases.js";
import { loadEffectivePermissions } from "../../lib/effectivePermissions.js";
import { assertCanActOnPage, assertPageBooked } from "../../lib/pageOwnership.js";

export async function createLink(user, { campaignId, assetId, url, format, customAmount }) {
  const asset = await prisma.asset.findUnique({ where: { id: assetId }, include: { rateCards: true } });
  if (!asset) throw new ApiError(404, "ASSET_NOT_FOUND", "Asset not found");
  await assertCanActOnPage(user, asset);
  await assertPageBooked(campaignId, assetId);

  return createOneLink(user, asset, { campaignId, assetId, url, format, customAmount });
}

/** Shared by createLink and bulkCreateLink — asset is passed in so the bulk path fetches it once, not per URL. */
async function createOneLink(user, asset, { campaignId, assetId, url, format, customAmount }) {
  // Non-admin callers get the asset's rate-card price; only an admin caller
  // may pass customAmount to override it for a negotiated deal.
  let cost;
  let customRate = false;
  if (customAmount != null && user.role === "ADMIN") {
    cost = customAmount;
    customRate = true;
  } else {
    const rateCard = asset.rateCards.find((rc) => rc.format === format);
    if (!rateCard) {
      throw new ApiError(400, "NO_RATE_CARD", `No rate card set for format "${format}" on this asset`);
    }
    cost = rateCard.amount;
  }

  const link = await prisma.link.create({
    data: { campaignId, assetId, submittedById: user.id, url, format, cost, customRate, status: "SUBMITTED" },
  });

  await prisma.linkStatusEvent.create({ data: { linkId: link.id, status: "SUBMITTED", actedById: user.id } });
  return link;
}

/**
 * Bulk link upload (creator.wldd.in's "Upload Links" modal): one
 * campaign/asset/format, many URLs submitted together. Each URL is
 * created independently — one bad/duplicate URL doesn't fail the batch,
 * it's just reported back alongside the ones that succeeded.
 */
export async function bulkCreateLink(user, { campaignId, assetId, format, urls }) {
  const asset = await prisma.asset.findUnique({ where: { id: assetId }, include: { rateCards: true } });
  if (!asset) throw new ApiError(404, "ASSET_NOT_FOUND", "Asset not found");
  await assertCanActOnPage(user, asset);
  await assertPageBooked(campaignId, assetId);

  // De-dupe the pasted list itself (creators commonly paste the same link twice).
  const uniqueUrls = [...new Set(urls.map((u) => u.trim()).filter(Boolean))];

  const created = [];
  const skipped = [];
  for (const url of uniqueUrls) {
    try {
      const existing = await prisma.link.findFirst({ where: { url, assetId } });
      if (existing) {
        skipped.push({ url, reason: "Already submitted for this page" });
        continue;
      }
      const link = await createOneLink(user, asset, { campaignId, assetId, url, format });
      created.push(link);
    } catch (err) {
      skipped.push({ url, reason: err instanceof ApiError ? err.message : "Couldn't submit this link" });
    }
  }

  return { created, skipped, totalSubmitted: uniqueUrls.length };
}

/**
 * Creates a Link on behalf of the *asset's owner*, not the caller — used
 * when a campaign assignment sheet already names a posted link (newTask.md,
 * 8 Sep: "if a post link is already mentioned in the attached sheet, it
 * should get added directly to that creator's posts"). Cost resolution
 * mirrors a normal submission (rate card, or an explicit `cost` from the
 * sheet) — the caller is always an admin already gated by
 * campaigns.manage, the same trust level bulkImportLinks' sheet-supplied
 * cost already runs at, so no extra role check is needed here. Returns
 * null (not an error) for a duplicate URL on this asset — a sheet
 * re-uploaded or re-resolved shouldn't create a second Link for the same
 * post, same skip behavior bulkCreateLink/bulkImportLinks already use.
 */
export async function autoAttachLink(asset, { campaignId, url, format, cost }) {
  const existing = await prisma.link.findFirst({ where: { url, assetId: asset.id } });
  if (existing) return null;

  let resolvedCost = cost;
  let customRate = cost != null;
  if (resolvedCost == null) {
    const rateCard = asset.rateCards?.find((rc) => rc.format === format);
    if (!rateCard) throw new ApiError(400, "NO_RATE_CARD", `No rate card set for format "${format}" on @${asset.handle}`);
    resolvedCost = rateCard.amount;
  }

  // The findFirst above is a plain read, not a lock — two overlapping calls
  // (a double-clicked "Refresh links", or the execution-sheet auto-sync
  // inside plans/service.js's updatePlan racing a manual sync right after)
  // can both pass it before either write lands. Link.@@unique([url,
  // assetId]) (23 Sep) is the actual guard: a second insert for the same
  // post/page 404s here on P2002, and is treated exactly like the
  // existing-row case above — this caller, and campaigns/service.js's
  // autoAttachLinkIfPossible, both already handle a null return as
  // "nothing to attach", so no invoice can ever double-bill one post.
  let link;
  try {
    link = await prisma.link.create({
      data: { campaignId, assetId: asset.id, submittedById: asset.ownerId, url, format, cost: resolvedCost, customRate, status: "SUBMITTED" },
    });
  } catch (err) {
    if (err?.code === "P2002") return null;
    throw err;
  }
  await prisma.linkStatusEvent.create({ data: { linkId: link.id, status: "SUBMITTED", actedById: asset.ownerId } });
  return link;
}

/**
 * Admin bulk-import of already-completed work from a sheet (newTask.md #8:
 * "which page posted it, their finance part"). Unlike bulkCreateLink (one
 * campaign/page for many URLs), each row here can name a different
 * campaign/page — resolved by title/handle since that's what a sheet
 * actually has, not IDs. The importing admin is recorded as submittedBy;
 * there's no "submitted by the creator" concept for work an admin is
 * retroactively recording on their behalf.
 */
export async function bulkImportLinks(admin, { rows }) {
  const campaignTitles = [...new Set(rows.map((r) => r.campaignTitle.trim()))];
  const pageHandles = [...new Set(rows.map((r) => r.pageHandle.trim().replace(/^@+/, "")))];

  const [campaigns, assets] = await Promise.all([
    prisma.campaign.findMany({ where: { title: { in: campaignTitles, mode: "insensitive" } } }),
    prisma.asset.findMany({ where: { handle: { in: pageHandles, mode: "insensitive" } }, include: { rateCards: true } }),
  ]);
  const campaignByTitle = new Map(campaigns.map((c) => [c.title.toLowerCase(), c]));
  const assetByHandle = new Map(assets.map((a) => [a.handle.toLowerCase(), a]));

  const created = [];
  const skipped = [];
  for (const row of rows) {
    const campaign = campaignByTitle.get(row.campaignTitle.trim().toLowerCase());
    const asset = assetByHandle.get(row.pageHandle.trim().replace(/^@+/, "").toLowerCase());
    if (!campaign) {
      skipped.push({ row, reason: `No campaign titled "${row.campaignTitle}"` });
      continue;
    }
    if (!asset) {
      skipped.push({ row, reason: `No page @${row.pageHandle}` });
      continue;
    }
    const existing = await prisma.link.findFirst({ where: { url: row.url, assetId: asset.id } });
    if (existing) {
      skipped.push({ row, reason: "Already submitted for this page" });
      continue;
    }
    try {
      const link = await createOneLink(admin, asset, {
        campaignId: campaign.id,
        assetId: asset.id,
        url: row.url,
        format: row.format,
        customAmount: row.cost,
      });
      created.push(link);
    } catch (err) {
      skipped.push({ row, reason: err instanceof ApiError ? err.message : "Couldn't create this link" });
    }
  }

  return { created, skipped, totalSubmitted: rows.length };
}

export async function listLinks(user, filters) {
  // Fresh from the DB (23 Sep, Step 3) — restricting or granting links.view
  // now actually changes what this returns.
  const effective = await loadEffectivePermissions(user.id);
  const seesAll = effective["links.view"];
  const where = {};
  // Plan Maker: every link on their own plans' campaigns (what they need
  // to generate per-creator invoices from a campaign page — 12 Sep);
  // anyone else without links.view: only links on pages they own.
  if (user.role === "PLAN_MAKER") {
    where.OR = [{ campaign: planMakerCampaignWhere(user.id) }, { asset: { ownerId: user.id } }];
  } else if (!seesAll) {
    where.asset = { ownerId: user.id };
  }
  // A comma-separated status list (e.g. from the dashboard's "Links
  // approved" KPI tile, which spans several statuses) becomes an IN match;
  // a single status stays an equality match.
  if (filters.status) {
    where.status = filters.status.includes(",") ? { in: filters.status.split(",") } : filters.status;
  }
  // An admin/finance/plan maker looking at a phase also gets its extra posts
  // (22 Sep) — a page's second reel is "submitted twice" in that phase, not
  // a phase of its own. A creator's own numbered row stays exact.
  if (filters.campaignId) {
    where.campaignId = seesAll || user.role === "PLAN_MAKER" ? { in: await phaseRowIds(filters.campaignId) } : filters.campaignId;
  }
  if (filters.assetId) where.assetId = filters.assetId;
  // "Vendor" (tasks.md #5, 23 Sep — Payments tab's page/vendor filter): the
  // user who owns the page, i.e. Asset.ownerId.
  // ANDed, not merged into where.asset: for a caller without links.view,
  // where.asset already holds their own-pages scope ({ ownerId: user.id }),
  // and overwriting it let a creator read any other creator's links by
  // passing ?ownerId= (caught in review, 24 Sep).
  if (filters.ownerId) where.AND = [...(where.AND ?? []), { asset: { ownerId: filters.ownerId } }];
  // Not on any invoice (22 Sep) — the invoice popup's "ready" list used to
  // go by status alone and could offer a drifted link that then failed on
  // submit with "already on invoice INV-…". Since the Payments tab's admin
  // payout is a second way to bill a link, "unbilled" now also excludes a
  // link already on a payout — a link can be billed via a creator Invoice OR
  // an admin Payout, never both.
  if (filters.unbilled) {
    where.invoiceItem = null;
    where.payoutItem = null;
  }
  // Payout eligibility mirrors "unbilled" from the other side: not on any
  // payout, AND not already on an invoice either (tasks.md #5).
  if (filters.unpaid) {
    where.payoutItem = null;
    where.invoiceItem = null;
  }
  if (filters.from || filters.to) {
    where.createdAt = {};
    if (filters.from) where.createdAt.gte = filters.from;
    if (filters.to) where.createdAt.lte = filters.to;
  }

  const [items, total] = await prisma.$transaction([
    prisma.link.findMany({
      where,
      // asset.owner — the campaign page's per-creator invoice panel (12
      // Sep) groups links by who gets paid and needs a name to head each
      // group with, not just an ownerId.
      // invoiceItem → invoice number/status: lets that same panel say "on
      // invoice INV-…" for a link whose status and invoice row have drifted
      // apart (a re-seeded status, a manual fix-up) instead of offering it
      // as billable and failing on submit.
      include: {
        // No costCap: a creator reads their own links and must not get the deal's budget (25 Sep).
        campaign: { select: { id: true, brandName: true, title: true, deadline: true, sheetLink: true, parentCampaignId: true, phaseNumber: true, postNumber: true, createdAt: true, updatedAt: true } },
        asset: { include: { owner: { select: { id: true, name: true, phoneNumber: true, email: true } } } },
        screenshot: true,
        invoiceItem: { select: { invoiceId: true, invoice: { select: { invoiceNumber: true, status: true } } } },
        payoutItem: { select: { payoutId: true } },
        postSnapshots: { orderBy: { capturedAt: "desc" }, take: 1 },
      },
      orderBy: { createdAt: "desc" },
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
    }),
    prisma.link.count({ where }),
  ]);

  // Screenshot only carries a publicId in the DB — the admin review panel
  // needs an actual image URL to show what was submitted, so compute it
  // here rather than leaving callers to reconstruct a Cloudinary URL.
  // A creator reads each campaign under their own running phase count
  // ("X — Phase 3"); everyone else sees the stored title plus postNumber.
  const labels = seesAll || user.role === "PLAN_MAKER" ? null : await creatorPhaseLabels(items.map((l) => l.campaignId), user.id);
  const withScreenshotUrls = items.map((link) => ({
    ...link,
    campaign: link.campaign && labels?.get(link.campaignId) ? { ...link.campaign, ...labels.get(link.campaignId) } : link.campaign,
    screenshot: link.screenshot ? { ...link.screenshot, url: publicUrlFor(link.screenshot.publicId) } : null,
  }));

  return { items: withScreenshotUrls, total, page: filters.page, pageSize: filters.pageSize };
}

/**
 * A link's status history — for whoever may see the link in listLinks
 * (24 Sep: it used to answer for any link id, whoever asked).
 */
export async function getLinkTimeline(linkId, user) {
  const effective = await loadEffectivePermissions(user.id);
  if (!effective["links.view"]) {
    const scope = user.role === "PLAN_MAKER" ? { OR: [{ campaign: planMakerCampaignWhere(user.id) }, { asset: { ownerId: user.id } }] } : { asset: { ownerId: user.id } };
    const visible = await prisma.link.findFirst({ where: { id: linkId, ...scope }, select: { id: true } });
    if (!visible) throw new ApiError(404, "LINK_NOT_FOUND", "Link not found");
  }
  return prisma.linkStatusEvent.findMany({ where: { linkId }, orderBy: { createdAt: "asc" } });
}

/** Called after a screenshot is confirmed as uploaded. */
export async function markPendingScreenshotReview(linkId) {
  return transitionLinkStatus(linkId, "PENDING_SCREENSHOT_REVIEW");
}

/**
 * Admin reviews the screenshot. On approval, kicks off an Apify metrics
 * refresh immediately so insights review isn't stuck waiting on the next
 * cron pass.
 */
export async function reviewScreenshot(linkId, admin, { approved, note }) {
  const link = await prisma.link.findUnique({ where: { id: linkId }, include: { submittedBy: true } });
  if (!link) throw new ApiError(404, "LINK_NOT_FOUND", "Link not found");
  // Checked before the screenshot row is touched, so a refused review
  // leaves nothing half-done (transitionLinkStatus would refuse too).
  if (link.status === "INVOICED") throw ALREADY_INVOICED("review its screenshot");

  await prisma.screenshot.update({
    where: { linkId },
    data: { approved, reviewedById: admin.id },
  });

  if (!approved) {
    return transitionLinkStatus(linkId, "SCREENSHOT_REJECTED", {
      actedById: admin.id,
      note,
      notifyUserId: link.submittedById,
      notifyType: "screenshot_rejected",
    });
  }

  await transitionLinkStatus(linkId, "SCREENSHOT_APPROVED", { actedById: admin.id, note });

  try {
    const result = await refreshLinkMetrics(linkId);
    if (result.ok) {
      return transitionLinkStatus(linkId, "INSIGHTS_PENDING", { actedById: admin.id });
    }
    return transitionLinkStatus(linkId, "INSIGHTS_PENDING", {
      actedById: admin.id,
      note: "Auto-scrape failed; needs manual metrics refresh",
    });
  } catch {
    // Scrape failure (transient/auth/quota) shouldn't block the approval —
    // link stays SCREENSHOT_APPROVED, cron will retry the scrape later.
    return prisma.link.findUnique({ where: { id: linkId } });
  }
}

export async function approveInsights(linkId, admin) {
  const link = await prisma.link.findUnique({ where: { id: linkId } });
  if (!link) throw new ApiError(404, "LINK_NOT_FOUND", "Link not found");
  if (link.status !== "INSIGHTS_PENDING") {
    throw new ApiError(400, "INVALID_STATUS", `Link must be INSIGHTS_PENDING, is ${link.status}`);
  }

  return transitionLinkStatus(linkId, "INSIGHTS_APPROVED", {
    actedById: admin.id,
    notifyUserId: link.submittedById,
    notifyType: "insights_approved",
  });
}

/**
 * Manual "Refresh metrics" (admin-triggered retry — the cron does this
 * automatically every few hours, but a stuck link shouldn't have to wait).
 * Unlike the cron sweep, a successful scrape here also advances a
 * SCREENSHOT_APPROVED link to INSIGHTS_PENDING, matching what a
 * same-turn auto-scrape does in reviewScreenshot — otherwise a link could
 * pick up a snapshot but never become eligible for "Approve insights".
 */
export async function refreshMetricsNow(linkId, admin) {
  const link = await prisma.link.findUnique({ where: { id: linkId } });
  if (!link) throw new ApiError(404, "LINK_NOT_FOUND", "Link not found");

  const result = await refreshLinkMetrics(linkId);
  if (result.ok && link.status === "SCREENSHOT_APPROVED") {
    await transitionLinkStatus(linkId, "INSIGHTS_PENDING", { actedById: admin.id });
  }
  return result;
}

/**
 * Revises what a submitted post is billed at (newTask.md #10), logging the
 * change to LinkCostRevision so there's a history of what it used to be and
 * why. Blocked once a link is INVOICED — an invoice's amount is a snapshot
 * of its items' cost at the time it was raised (InvoiceItem.amount), so
 * changing Link.cost after the fact would silently desync the two; reject
 * the invoice first (which reopens the link) if the cost genuinely needs to
 * change post-invoicing.
 */
export async function reviseLinkCost(linkId, admin, { cost, note }) {
  const link = await prisma.link.findUnique({ where: { id: linkId } });
  if (!link) throw new ApiError(404, "LINK_NOT_FOUND", "Link not found");
  if (link.status === "INVOICED") {
    throw new ApiError(409, "ALREADY_INVOICED", "Reject the invoice this link is on before revising its cost");
  }

  const [updated] = await prisma.$transaction([
    prisma.link.update({ where: { id: linkId }, data: { cost, customRate: true } }),
    prisma.linkCostRevision.create({
      data: { linkId, previousCost: link.cost, newCost: cost, note, revisedById: admin.id },
    }),
  ]);
  return updated;
}

/**
 * Admin confirms a submitted post is dead/broken (newTask.md, 8 Sep —
 * "posted link not working") — wrong URL, deleted post, private account,
 * whatever's unrecoverable. A soft flag, not a delete: the row and its
 * LinkStatusEvent history stay for audit (same reasoning as reviseLinkCost
 * below), it's just excluded from campaign spend and every "needs action"/
 * "uninvoiced" count from here on (see campaigns/service.js's `spent` and
 * client/components/dashboard/creator-dashboard.tsx's `approved` KPI).
 * Blocked once INVOICED for the same reason cost revision is — reject the
 * invoice first if a billed link turns out to be broken.
 */
export async function markLinkInvalid(linkId, admin, { note }) {
  const link = await prisma.link.findUnique({ where: { id: linkId } });
  if (!link) throw new ApiError(404, "LINK_NOT_FOUND", "Link not found");
  if (link.status === "INVOICED") {
    throw new ApiError(409, "ALREADY_INVOICED", "Reject the invoice this link is on before marking it invalid");
  }
  if (link.status === "INVALID") return link;

  return transitionLinkStatus(linkId, "INVALID", {
    actedById: admin.id,
    note,
    notifyUserId: link.submittedById,
    notifyType: "link_marked_invalid",
  });
}

export async function getLinkCostRevisions(linkId) {
  return prisma.linkCostRevision.findMany({
    where: { linkId },
    include: { revisedBy: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
  });
}
