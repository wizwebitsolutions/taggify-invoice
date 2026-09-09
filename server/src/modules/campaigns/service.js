import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../middleware/errorHandler.js";
import { autoAttachLink } from "../links/service.js";

const MAX_SHEET_BYTES = 5 * 1024 * 1024; // 5MB — plenty for a pages/work list, small enough to hold in memory

/**
 * Campaigns list, each annotated with:
 *  - a card preview: one representative post's thumbnail + caption, and the
 *    total likes across every post submitted for that campaign
 *  - budget: `spent` (sum of every non-rejected link's cost) and
 *    `remainingBudget` (costCap - spent, null if no cap was set) — newTask.md #9
 *  - `pendingAssignmentCount`: how many rows from an attached sheet still
 *    need a page/creator created for them — newTask.md #8/#11
 * None of this is stored — computed here from Link/CampaignAssignment so
 * there's nothing to keep in sync.
 */
const LINK_SELECT_FOR_CAMPAIGN = {
  campaignId: true,
  cost: true,
  status: true,
  postedAt: true,
  createdAt: true,
  postSnapshots: {
    orderBy: { capturedAt: "desc" },
    take: 1,
    select: { thumbnailUrl: true, caption: true, likeCount: true },
  },
};

// A rejected screenshot means the submission never counted as valid work,
// so it shouldn't count against the budget either — same for a link an
// admin has since confirmed dead/broken (newTask.md, 8 Sep). Shared by
// annotateCampaign and the phase-group rollups below so "spent" is never
// computed two different ways.
function computeSpent(links) {
  return links.filter((l) => l.status !== "SCREENSHOT_REJECTED" && l.status !== "INVALID").reduce((sum, l) => sum + Number(l.cost), 0);
}

/** Shared by listCampaigns (batched, many campaigns at once) and
 * getCampaignById (one campaign) so the two never compute this differently. */
function annotateCampaign(campaign, campaignLinks, pendingAssignmentCount) {
  // One post represents the whole campaign on its card — prefer the most
  // recently posted link that actually has a scraped thumbnail yet (a
  // just-submitted link hasn't been scraped by the cron/on-approval scrape
  // yet), falling back to just the most recent link so a brand-new
  // campaign still shows *something* instead of an empty card.
  const withThumbnail = campaignLinks
    .filter((l) => l.postSnapshots[0]?.thumbnailUrl)
    .sort((a, b) => (b.postedAt ?? b.createdAt) - (a.postedAt ?? a.createdAt));
  const representative = withThumbnail[0] ?? campaignLinks[0] ?? null;
  const representativeSnapshot = representative?.postSnapshots[0] ?? null;

  // -1 is Apify's "unknown/hidden count" sentinel (see scraping/service.js)
  // — never counted as a real like, and never a link with no snapshot yet.
  const totalLikes = campaignLinks.reduce((sum, l) => {
    const likes = l.postSnapshots[0]?.likeCount;
    return likes && likes > 0 ? sum + likes : sum;
  }, 0);

  const spent = computeSpent(campaignLinks);

  return {
    ...campaign,
    postCount: campaignLinks.length,
    representativePost: representativeSnapshot
      ? { thumbnailUrl: representativeSnapshot.thumbnailUrl, caption: representativeSnapshot.caption }
      : null,
    totalLikes,
    spent,
    remainingBudget: campaign.costCap != null ? Number(campaign.costCap) - spent : null,
    pendingAssignmentCount,
  };
}

/**
 * Roots only (newTask.md, 8 Sep) — a phase (2+) isn't its own entry on the
 * list, it's reached from its root's detail page. `spent`/`remainingBudget`
 * roll up across every phase under a root (same rule as getCampaignById),
 * so the number on this card and the number you see after clicking into it
 * never disagree; `postCount`/the card preview stay specific to the root's
 * own posts. `phaseCount` tells the card whether to show a "3 phases" hint.
 */
export async function listCampaigns({ search } = {}) {
  const roots = await prisma.campaign.findMany({
    where: {
      parentCampaignId: null,
      ...(search ? { OR: [{ title: { contains: search, mode: "insensitive" } }, { brandName: { contains: search, mode: "insensitive" } }] } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
  if (roots.length === 0) return roots;

  const rootIds = roots.map((c) => c.id);
  const phases = await prisma.campaign.findMany({ where: { parentCampaignId: { in: rootIds } }, select: { id: true, parentCampaignId: true } });
  const groupIdsByRoot = new Map(rootIds.map((id) => [id, [id]]));
  // Defensive: a phase whose parentCampaignId doesn't match anything in
  // this batch (shouldn't happen — the query above filters on rootIds —
  // but a stale/dangling reference is a data problem, not a reason to
  // crash the whole list) is silently skipped rather than blowing up.
  for (const p of phases) groupIdsByRoot.get(p.parentCampaignId)?.push(p.id);
  const allIds = [...rootIds, ...phases.map((p) => p.id)];

  const [links, assignments] = await Promise.all([
    prisma.link.findMany({ where: { campaignId: { in: allIds } }, select: LINK_SELECT_FOR_CAMPAIGN }),
    prisma.campaignAssignment.findMany({
      where: { campaignId: { in: allIds }, status: "pending" },
      select: { campaignId: true },
    }),
  ]);

  const linksByCampaign = new Map();
  for (const link of links) {
    if (!linksByCampaign.has(link.campaignId)) linksByCampaign.set(link.campaignId, []);
    linksByCampaign.get(link.campaignId).push(link);
  }
  const pendingByCampaign = new Map();
  for (const a of assignments) {
    pendingByCampaign.set(a.campaignId, (pendingByCampaign.get(a.campaignId) ?? 0) + 1);
  }

  return roots.map((root) => {
    const groupIds = groupIdsByRoot.get(root.id);
    const annotated = annotateCampaign(root, linksByCampaign.get(root.id) ?? [], pendingByCampaign.get(root.id) ?? 0);
    if (groupIds.length <= 1) return { ...annotated, phaseCount: 1 };

    const groupLinks = groupIds.flatMap((id) => linksByCampaign.get(id) ?? []);
    const groupSpent = computeSpent(groupLinks);
    return {
      ...annotated,
      spent: groupSpent,
      remainingBudget: root.costCap != null ? Number(root.costCap) - groupSpent : null,
      phaseCount: groupIds.length,
    };
  });
}

/**
 * Single-campaign version of listCampaigns' per-card annotation, for the
 * campaign detail page (bugs.md #7). Also resolves the campaign's phase
 * group (newTask.md, 8 Sep) — works whether `id` is the root or any phase:
 * `postCount`/`totalLikes`/the representative post stay specific to this
 * one phase's own posts, but `spent`/`remainingBudget` roll up across every
 * phase in the group once more than one exists, since a phase shares its
 * parent's budget rather than getting its own. `phases` lists the whole
 * group (including this one) so the client can render phase tabs/switcher.
 */
export async function getCampaignById(id) {
  const campaign = await prisma.campaign.findUnique({ where: { id } });
  if (!campaign) throw new ApiError(404, "CAMPAIGN_NOT_FOUND", "Campaign not found");

  const rootId = campaign.parentCampaignId ?? campaign.id;
  const root = campaign.parentCampaignId ? (await prisma.campaign.findUnique({ where: { id: rootId } })) ?? campaign : campaign;

  const [pendingAssignmentCount, group] = await Promise.all([
    prisma.campaignAssignment.count({ where: { campaignId: id, status: "pending" } }),
    prisma.campaign.findMany({
      where: { OR: [{ id: root.id }, { parentCampaignId: root.id }] },
      orderBy: { phaseNumber: "asc" },
      select: { id: true, phaseNumber: true, title: true, createdAt: true },
    }),
  ]);

  const groupIds = group.map((c) => c.id);
  const groupLinks = await prisma.link.findMany({ where: { campaignId: { in: groupIds } }, select: LINK_SELECT_FOR_CAMPAIGN });
  const ownLinks = groupLinks.filter((l) => l.campaignId === id);

  const annotated = annotateCampaign(campaign, ownLinks, pendingAssignmentCount);
  if (group.length <= 1) return { ...annotated, phases: group };

  const groupSpent = computeSpent(groupLinks);

  return {
    ...annotated,
    // costCap explicitly from root, not the spread-in phase's own column —
    // a phase never carries its own cap (see createPhase); reading it live
    // from root here is what makes editing the root's cap later apply to
    // every phase, instead of each phase freezing whatever it copied in at
    // creation time.
    costCap: root.costCap,
    spent: groupSpent,
    remainingBudget: root.costCap != null ? Number(root.costCap) - groupSpent : null,
    phases: group,
  };
}

/**
 * Adds a new phase to a campaign (newTask.md, 8 Sep — "campaign can have
 * multiple phase if need to add 2 post for same campaign"), rather than
 * starting a whole new campaign for more posts under the same deal. Works
 * from any phase's id, not just the root's — "add a phase" should make
 * sense from wherever you're looking at the deal. Brand/sheet link are
 * copied from the root for display; cost cap deliberately is NOT copied
 * onto the phase row — it's read live from the root at request time (see
 * getCampaignById/listCampaigns) so that editing the root's cap later
 * still applies to every phase. A frozen per-phase copy would go stale
 * the moment the root's cap changed after this phase already existed
 * (caught live: editing the cap after creating phase 2 left phase 2's
 * own copy at its original null, silently hiding the whole Budget panel
 * even though the group's remainingBudget was computed correctly).
 */
export async function createPhase(campaignId, { title } = {}) {
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) throw new ApiError(404, "CAMPAIGN_NOT_FOUND", "Campaign not found");

  const rootId = campaign.parentCampaignId ?? campaign.id;
  const root = campaign.parentCampaignId ? await prisma.campaign.findUnique({ where: { id: rootId } }) : campaign;
  if (!root) throw new ApiError(404, "CAMPAIGN_NOT_FOUND", "Campaign not found");

  const existingPhases = await prisma.campaign.findMany({
    where: { OR: [{ id: root.id }, { parentCampaignId: root.id }] },
    select: { phaseNumber: true },
  });
  const nextPhaseNumber = Math.max(...existingPhases.map((c) => c.phaseNumber)) + 1;

  return prisma.campaign.create({
    data: {
      brandName: root.brandName,
      title: title || `${root.title} — Phase ${nextPhaseNumber}`,
      sheetLink: root.sheetLink,
      parentCampaignId: root.id,
      phaseNumber: nextPhaseNumber,
    },
  });
}

/**
 * Auto-attaches a sheet-named post to its matched page (newTask.md, 8 Sep)
 * — called once a CampaignAssignment row has both an assetId and a
 * postUrl, whether that happened immediately at campaign creation or later
 * via resolveAssignment. `assignment.linkId` already being set makes this a
 * no-op — a row is only ever auto-attached once, however many times its
 * assignment gets touched afterward (re-resolving to a different page, for
 * instance, must not create a second Link for the same sheet row). Errors
 * (typically NO_RATE_CARD, when the row didn't carry its own cost and the
 * page has no rate card for that format) are swallowed rather than thrown —
 * this runs as a side effect of creating/resolving the assignment itself,
 * so a pricing problem with the post shouldn't block the assignment from
 * being created or resolved; the row just stays without a linkId for an
 * admin to sort out (add a rate card, or attach the link manually).
 */
async function autoAttachLinkIfPossible(assignment, asset) {
  if (assignment.linkId || !assignment.postUrl || !assignment.format) return assignment;
  try {
    const link = await autoAttachLink(asset, {
      campaignId: assignment.campaignId,
      url: assignment.postUrl,
      format: assignment.format,
      cost: assignment.cost != null ? Number(assignment.cost) : undefined,
    });
    if (!link) return assignment; // duplicate URL for this asset — nothing to attach
    return prisma.campaignAssignment.update({ where: { id: assignment.id }, data: { linkId: link.id } });
  } catch {
    return assignment;
  }
}

/**
 * Creates a campaign and, if a page/creator sheet was attached (newTask.md
 * #8), one CampaignAssignment row per entry — matched immediately to an
 * existing Asset by handle where one exists, left "pending" otherwise for
 * an admin to resolve (see resolveAssignment). A matched row that also
 * named a post (newTask.md, 8 Sep) gets that post auto-attached right away.
 */
export async function createCampaign({ brandName, title, deadline, costCap, sheetLink, assignments }) {
  const campaign = await prisma.campaign.create({ data: { brandName, title, deadline, costCap, sheetLink } });
  if (!assignments || assignments.length === 0) return { campaign, matchedCount: 0, pendingCount: 0, autoAttachedCount: 0 };

  // One query for every handle in the sheet, rather than one lookup per row.
  // rateCards/ownerId are only needed for auto-attaching, so only fetched
  // when at least one row actually names a post.
  const handles = [...new Set(assignments.map((a) => a.handle.trim().replace(/^@+/, "").toLowerCase()))];
  const anyPostUrls = assignments.some((a) => a.postUrl);
  const existingAssets = await prisma.asset.findMany({
    where: { handle: { in: handles, mode: "insensitive" } },
    ...(anyPostUrls ? { include: { rateCards: true } } : { select: { id: true, handle: true } }),
  });
  const assetByHandle = new Map(existingAssets.map((a) => [a.handle.toLowerCase(), a]));

  // createMany can't return the created rows' ids, and auto-attaching needs
  // them (to store linkId back onto the right row) — so this creates one at
  // a time, same partial-success shape bulkCreateLink/bulkImportLinks
  // already use elsewhere in this codebase (one bad row doesn't fail the rest).
  let matchedCount = 0;
  let autoAttachedCount = 0;
  for (const a of assignments) {
    const cleanHandle = a.handle.trim().replace(/^@+/, "");
    const asset = assetByHandle.get(cleanHandle.toLowerCase()) ?? null;
    if (asset) matchedCount += 1;

    let row = await prisma.campaignAssignment.create({
      data: {
        campaignId: campaign.id,
        pageHandle: cleanHandle,
        creatorPhone: a.phone,
        assetId: asset?.id ?? null,
        postUrl: a.postUrl,
        format: a.format,
        cost: a.cost,
        status: asset ? "matched" : "pending",
      },
    });

    if (asset && a.postUrl) {
      row = await autoAttachLinkIfPossible(row, asset);
      if (row.linkId) autoAttachedCount += 1;
    }
  }

  return { campaign, matchedCount, pendingCount: assignments.length - matchedCount, autoAttachedCount };
}

export async function updateCampaign(id, data) {
  return prisma.campaign.update({ where: { id }, data });
}

/**
 * Scoped to who's asking (newTask.md, 8 Sep — "attached sheet/links for a
 * campaign should be visible to all creators listed in that sheet, not
 * just admin/finance"): Admin/Finance see every row on the campaign;
 * anyone else sees only the row(s) matched to a page they own — not the
 * whole sheet's worth of other creators' phone numbers, which the note
 * doesn't ask to expose and this codebase otherwise treats as private
 * (same "own assets only" scoping assets/service.js and links/service.js
 * already use for a non-privileged role).
 */
export async function listAssignments(campaignId, requester) {
  const where = { campaignId };
  if (requester && !["ADMIN", "FINANCE"].includes(requester.role)) {
    where.asset = { ownerId: requester.id };
  }
  return prisma.campaignAssignment.findMany({
    where,
    include: {
      asset: { select: { id: true, handle: true, category: true, approvalStatus: true } },
      link: { select: { id: true, status: true } },
    },
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
  });
}

/**
 * Resolves a pending assignment once an admin has created (or identified)
 * the page it should point to — newTask.md #11's approval gate is whatever
 * that page's own Asset.approvalStatus already is (a page created for this
 * still starts "pending" there, same as any other new page). If the row
 * already named a post (newTask.md, 8 Sep), this is also the point where
 * that post gets attached — a row resolved later goes through the exact
 * same auto-attach path a row matched immediately at creation did.
 */
export async function resolveAssignment(campaignId, assignmentId, assetId) {
  const assignment = await prisma.campaignAssignment.findUnique({ where: { id: assignmentId } });
  if (!assignment || assignment.campaignId !== campaignId) {
    throw new ApiError(404, "ASSIGNMENT_NOT_FOUND", "Assignment not found on this campaign");
  }
  const asset = await prisma.asset.findUnique({ where: { id: assetId }, include: { rateCards: true } });
  if (!asset) throw new ApiError(404, "ASSET_NOT_FOUND", "Asset not found");

  const updated = await prisma.campaignAssignment.update({
    where: { id: assignmentId },
    data: { assetId, status: "matched" },
  });
  return autoAttachLinkIfPossible(updated, asset);
}

/**
 * bugs.md #6 — turns a Google Sheets URL (any of the normal share-link
 * shapes: .../edit, .../edit#gid=N, .../edit?usp=sharing) into that sheet's
 * CSV export URL. Only docs.google.com is accepted — this fetches an
 * admin-supplied URL server-side, so the host is pinned rather than left
 * open to fetching arbitrary internal/external addresses.
 */
export function googleSheetCsvExportUrl(sheetUrl) {
  let parsed;
  try {
    parsed = new URL(sheetUrl);
  } catch {
    throw new ApiError(400, "INVALID_SHEET_URL", "That doesn't look like a URL.");
  }
  if (parsed.hostname !== "docs.google.com") {
    throw new ApiError(400, "INVALID_SHEET_URL", "Only Google Sheets links (docs.google.com) are supported.");
  }
  const idMatch = parsed.pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!idMatch) {
    throw new ApiError(400, "INVALID_SHEET_URL", "Couldn't find a spreadsheet ID in that link.");
  }
  // gid can show up as a query param (?gid=123) or, more often for a link
  // copied straight from the browser's address bar, in the hash (#gid=123).
  const gid = parsed.searchParams.get("gid") ?? parsed.hash.match(/gid=(\d+)/)?.[1] ?? "0";
  return `https://docs.google.com/spreadsheets/d/${idMatch[1]}/export?format=csv&gid=${gid}`;
}

/**
 * Fetches a public ("Anyone with the link can view") Google Sheet as CSV
 * text. A sheet that isn't actually link-shared makes this same request
 * return Google's HTML sign-in page with a 200 status rather than an
 * error — checked for via content-type, since a non-ok status alone
 * wouldn't catch it.
 */
export async function fetchSheetCsv(sheetUrl) {
  const exportUrl = googleSheetCsvExportUrl(sheetUrl);
  let res;
  try {
    res = await fetch(exportUrl);
  } catch {
    throw new ApiError(502, "SHEET_FETCH_FAILED", "Couldn't reach that Google Sheet.");
  }
  if (!res.ok) {
    throw new ApiError(502, "SHEET_FETCH_FAILED", "Couldn't reach that Google Sheet.");
  }
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("csv") && !contentType.includes("text/plain")) {
    throw new ApiError(
      400,
      "SHEET_NOT_SHARED",
      "Couldn't read that sheet — make sure it's shared as \"Anyone with the link can view\"."
    );
  }
  const text = await res.text();
  if (Buffer.byteLength(text, "utf8") > MAX_SHEET_BYTES) {
    throw new ApiError(400, "SHEET_TOO_LARGE", "That sheet is too large to import.");
  }
  return text;
}
