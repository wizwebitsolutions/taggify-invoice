import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../middleware/errorHandler.js";

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

  // A rejected screenshot means the submission never counted as valid
  // work, so it shouldn't count against the budget either.
  const spent = campaignLinks
    .filter((l) => l.status !== "SCREENSHOT_REJECTED")
    .reduce((sum, l) => sum + Number(l.cost), 0);

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

export async function listCampaigns({ search } = {}) {
  const campaigns = await prisma.campaign.findMany({
    where: search
      ? { OR: [{ title: { contains: search, mode: "insensitive" } }, { brandName: { contains: search, mode: "insensitive" } }] }
      : undefined,
    orderBy: { createdAt: "desc" },
  });
  if (campaigns.length === 0) return campaigns;

  const campaignIds = campaigns.map((c) => c.id);

  const [links, assignments] = await Promise.all([
    prisma.link.findMany({ where: { campaignId: { in: campaignIds } }, select: LINK_SELECT_FOR_CAMPAIGN }),
    prisma.campaignAssignment.findMany({
      where: { campaignId: { in: campaignIds }, status: "pending" },
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

  return campaigns.map((campaign) =>
    annotateCampaign(campaign, linksByCampaign.get(campaign.id) ?? [], pendingByCampaign.get(campaign.id) ?? 0)
  );
}

/** Single-campaign version of listCampaigns' per-card annotation, for the
 * campaign detail page (bugs.md #7). */
export async function getCampaignById(id) {
  const campaign = await prisma.campaign.findUnique({ where: { id } });
  if (!campaign) throw new ApiError(404, "CAMPAIGN_NOT_FOUND", "Campaign not found");

  const [links, pendingAssignmentCount] = await Promise.all([
    prisma.link.findMany({ where: { campaignId: id }, select: LINK_SELECT_FOR_CAMPAIGN }),
    prisma.campaignAssignment.count({ where: { campaignId: id, status: "pending" } }),
  ]);

  return annotateCampaign(campaign, links, pendingAssignmentCount);
}

/**
 * Creates a campaign and, if a page/creator sheet was attached (newTask.md
 * #8), one CampaignAssignment row per entry — matched immediately to an
 * existing Asset by handle where one exists, left "pending" otherwise for
 * an admin to resolve (see resolveAssignment).
 */
export async function createCampaign({ brandName, title, deadline, costCap, sheetLink, assignments }) {
  const campaign = await prisma.campaign.create({ data: { brandName, title, deadline, costCap, sheetLink } });
  if (!assignments || assignments.length === 0) return { campaign, matchedCount: 0, pendingCount: 0 };

  // One query for every handle in the sheet, rather than one lookup per row.
  const handles = [...new Set(assignments.map((a) => a.handle.trim().replace(/^@+/, "").toLowerCase()))];
  const existingAssets = await prisma.asset.findMany({
    where: { handle: { in: handles, mode: "insensitive" } },
    select: { id: true, handle: true },
  });
  const assetByHandle = new Map(existingAssets.map((a) => [a.handle.toLowerCase(), a.id]));

  const rows = assignments.map((a) => {
    const cleanHandle = a.handle.trim().replace(/^@+/, "");
    const assetId = assetByHandle.get(cleanHandle.toLowerCase()) ?? null;
    return {
      campaignId: campaign.id,
      pageHandle: cleanHandle,
      creatorPhone: a.phone,
      assetId,
      status: assetId ? "matched" : "pending",
    };
  });
  await prisma.campaignAssignment.createMany({ data: rows });

  const matchedCount = rows.filter((r) => r.status === "matched").length;
  return { campaign, matchedCount, pendingCount: rows.length - matchedCount };
}

export async function updateCampaign(id, data) {
  return prisma.campaign.update({ where: { id }, data });
}

export async function listAssignments(campaignId) {
  return prisma.campaignAssignment.findMany({
    where: { campaignId },
    include: { asset: { select: { id: true, handle: true, category: true, approvalStatus: true } } },
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
  });
}

/**
 * Resolves a pending assignment once an admin has created (or identified)
 * the page it should point to — newTask.md #11's approval gate is whatever
 * that page's own Asset.approvalStatus already is (a page created for this
 * still starts "pending" there, same as any other new page).
 */
export async function resolveAssignment(campaignId, assignmentId, assetId) {
  const assignment = await prisma.campaignAssignment.findUnique({ where: { id: assignmentId } });
  if (!assignment || assignment.campaignId !== campaignId) {
    throw new ApiError(404, "ASSIGNMENT_NOT_FOUND", "Assignment not found on this campaign");
  }
  const asset = await prisma.asset.findUnique({ where: { id: assetId } });
  if (!asset) throw new ApiError(404, "ASSET_NOT_FOUND", "Asset not found");

  return prisma.campaignAssignment.update({
    where: { id: assignmentId },
    data: { assetId, status: "matched" },
  });
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
