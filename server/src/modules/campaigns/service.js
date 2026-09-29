import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../middleware/errorHandler.js";
import { autoAttachLink } from "../links/service.js";
import { campaignVisibilityWhere, canPlanMakerAccessCampaign, canCreatorAccessCampaign, ownerIdsFor, planMakerCampaignWhere } from "../../lib/campaignAccess.js";
import { byPhaseThenPost, creatorPhaseNumberIn, creatorPhaseTitle, creatorRowsOf, groupsByRoot, phaseRowIds } from "../../lib/campaignPhases.js";
import { loadEffectivePermissions } from "../../lib/effectivePermissions.js";
import { recomputePostQuota } from "../../lib/postQuota.js";

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
  // assetId: which page the post is on — the creator's booked-vs-submitted count (29 Sep).
  assetId: true,
  cost: true,
  status: true,
  overQuota: true,
  asset: { select: { ownerId: true } },
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
// A post beyond its campaign booking (overQuota, 29 Sep) is the creator's own
// extra — it counts toward neither the campaign's spend nor their earnings.
const countsTowardCampaign = (l) => l.status !== "SCREENSHOT_REJECTED" && l.status !== "INVALID" && !l.overQuota;

function computeSpent(links) {
  return links.filter(countsTowardCampaign).reduce((sum, l) => sum + Number(l.cost), 0);
}

const isCreatorSide = (user) => user?.role === "CREATOR" || user?.role === "TEAM_MEMBER";

/**
 * Creators / team members never see the deal's budget (25 Sep — "budget &
 * remaining shouldn't be shown to creator, only their part"): the cap,
 * group spend and what's left are dropped, replaced by `yourEarnings` — the
 * cost of links on their own pages only. Done here, not just in the UI, so
 * the numbers never reach a creator's browser at all.
 */
function toCreatorMoneyView(row, links, ownerIds) {
  const { costCap: _cap, remainingBudget: _rem, spent: _spent, ...rest } = row;
  return { ...rest, yourEarnings: computeSpent(links.filter((l) => ownerIds.includes(l.asset?.ownerId))) };
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
    // Posts beyond the booking don't count (29 Sep — "everywhere it'll show 2 of 2").
    postCount: campaignLinks.filter((l) => !l.overQuota).length,
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
export async function listCampaigns({ search } = {}, requester) {
  // Search and the Plan Maker scope both use OR internally, so they go
  // under AND rather than one clobbering the other on the same key.
  const clauses = [];
  if (search) clauses.push({ OR: [{ title: { contains: search, mode: "insensitive" } }, { brandName: { contains: search, mode: "insensitive" } }] });
  const scope = await campaignVisibilityWhere(requester);
  if (Object.keys(scope).length > 0) clauses.push(scope);

  const roots = await prisma.campaign.findMany({
    where: { parentCampaignId: null, ...(clauses.length > 0 ? { AND: clauses } : {}) },
    orderBy: { createdAt: "desc" },
  });
  if (roots.length === 0) return roots;

  const rootIds = roots.map((c) => c.id);
  const phases = await prisma.campaign.findMany({ where: { parentCampaignId: { in: rootIds } }, select: { id: true, parentCampaignId: true, phaseNumber: true, postNumber: true } });
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

  // Real phases only (22 Sep) — a page's extra posts don't make a campaign "2 phases".
  const realPhaseCount = new Map(rootIds.map((id) => [id, 1]));
  for (const p of phases) if (p.postNumber === 1) realPhaseCount.set(p.parentCampaignId, (realPhaseCount.get(p.parentCampaignId) ?? 1) + 1);

  // Phase 1's extra posts belong on the card's own numbers too — to an admin
  // they're just more posts of phase 1.
  const phaseOneExtras = new Map(rootIds.map((id) => [id, []]));
  for (const p of phases) if (p.phaseNumber === 1 && p.postNumber > 1) phaseOneExtras.get(p.parentCampaignId)?.push(p.id);

  const annotatedRoots = roots.map((root) => {
    const groupIds = groupIdsByRoot.get(root.id);
    const phaseOneIds = [root.id, ...(phaseOneExtras.get(root.id) ?? [])];
    const annotated = annotateCampaign(
      root,
      phaseOneIds.flatMap((id) => linksByCampaign.get(id) ?? []),
      phaseOneIds.reduce((n, id) => n + (pendingByCampaign.get(id) ?? 0), 0)
    );
    if (groupIds.length <= 1) return { ...annotated, phaseCount: 1 };

    const groupLinks = groupIds.flatMap((id) => linksByCampaign.get(id) ?? []);
    const groupSpent = computeSpent(groupLinks);
    return {
      ...annotated,
      spent: groupSpent,
      remainingBudget: root.costCap != null ? Number(root.costCap) - groupSpent : null,
      phaseCount: realPhaseCount.get(root.id) ?? 1,
    };
  });

  // Fresh from the DB (23 Sep, Step 3) — restricting or granting
  // campaigns.view now actually changes the shape of what comes back.
  const effective = requester ? await loadEffectivePermissions(requester.id) : null;
  if (!requester || effective["campaigns.view"] || requester.role === "PLAN_MAKER") {
    if (!isCreatorSide(requester)) return annotatedRoots;
    const ownerIds = await ownerIdsFor(requester);
    return annotatedRoots.map((r) => toCreatorMoneyView(r, (groupIdsByRoot.get(r.id) ?? []).flatMap((id) => linksByCampaign.get(id) ?? []), ownerIds));
  }
  return withCreatorPhaseEntries(annotatedRoots, requester, { linksByCampaign, pendingByCampaign });
}

/**
 * Creators / team members (22 Sep — "it will show phase 2 of that campaign
 * to creator"): after each campaign, one entry per later row of its group
 * that one of their own pages is booked on — extra posts and real phases
 * alike — titled with the running count ("X — Phase 3"). This list is what
 * the creator's Upload links dropdown offers, so a second reel can actually
 * be submitted against its own row.
 */
async function withCreatorPhaseEntries(annotatedRoots, requester, { linksByCampaign, pendingByCampaign }) {
  const rootIds = annotatedRoots.map((r) => r.id);
  const groups = await groupsByRoot(rootIds);
  const childIds = [...groups.values()].flat().filter((r) => r.parentCampaignId).map((r) => r.id);
  // Their pages' bookings across every row of these groups (a team member's
  // include their creator's pages) — which child rows are theirs, and which
  // pages each entry will accept a link for.
  const ownerIds = await ownerIdsFor(requester);
  const bookings = await prisma.campaignAssignment.findMany({
    where: { campaignId: { in: [...rootIds, ...childIds] }, asset: { ownerId: { in: ownerIds } } },
    select: { campaignId: true, assetId: true },
  });
  const bookedAssetIds = (campaignId) => [...new Set(bookings.filter((b) => b.campaignId === campaignId).map((b) => b.assetId))];

  // How many posts each of their pages owes, and how many they've put up
  // (user report, 29 Sep — "it's not showing any limit of how many post on
  // that page ... so creator will get to know how many post gonna go").
  // A page booked for 2 posts has one assignment row on each of that phase's
  // post rows (plans/service.js's createCampaignFromPlan spreads
  // postsPerProfile that way), so counting those rows *is* the quota — the
  // number is never stored anywhere else. Counted per phase, since that's the
  // unit a booking is made in.
  const rowsById = new Map([...groups.values()].flat().map((r) => [r.id, r]));
  const phaseKey = (campaignId) => {
    const row = rowsById.get(campaignId);
    return row ? `${row.parentCampaignId ?? row.id}|${row.phaseNumber}` : null;
  };
  const quotas = new Map(); // "rootId|phase" → Map(assetId → { booked, submitted })
  const quotaEntry = (key, assetId) => {
    if (!quotas.has(key)) quotas.set(key, new Map());
    const perAsset = quotas.get(key);
    if (!perAsset.has(assetId)) perAsset.set(assetId, { assetId, booked: 0, submitted: 0 });
    return perAsset.get(assetId);
  };
  for (const booking of bookings) {
    const key = phaseKey(booking.campaignId);
    if (key) quotaEntry(key, booking.assetId).booked += 1;
  }
  for (const [campaignId, rowLinks] of linksByCampaign) {
    const key = phaseKey(campaignId);
    if (!key) continue;
    // Only their own pages — a phase can carry other creators' posts too.
    for (const link of rowLinks) if (ownerIds.includes(link.asset?.ownerId)) quotaEntry(key, link.assetId).submitted += 1;
  }
  const pageQuota = (campaignId) => [...(quotas.get(phaseKey(campaignId)) ?? new Map()).values()];

  const childSet = new Set(childIds);
  const mine = new Set(bookings.map((b) => b.campaignId).filter((id) => childSet.has(id)));
  const children = childIds.length === 0 ? [] : await prisma.campaign.findMany({ where: { id: { in: [...mine] } } });
  const childById = new Map(children.map((c) => [c.id, c]));

  const out = [];
  for (const root of annotatedRoots) {
    const group = groups.get(root.id) ?? [];
    // To the creator, Phase 1 is just the root row — its extra posts are their own entries below.
    out.push({
      ...toCreatorMoneyView(annotateCampaign(root, linksByCampaign.get(root.id) ?? [], pendingByCampaign.get(root.id) ?? 0), linksByCampaign.get(root.id) ?? [], ownerIds),
      phaseCount: root.phaseCount,
      creatorPhaseNumber: 1,
      bookedAssetIds: bookedAssetIds(root.id),
      pageQuota: pageQuota(root.id),
    });
    // Numbered over this creator's own rows only (root + what they're booked on).
    const theirs = creatorRowsOf(group, mine);
    for (const row of [...theirs].sort(byPhaseThenPost)) {
      const child = childById.get(row.id);
      if (!child) continue;
      const n = creatorPhaseNumberIn(theirs, row.id);
      const annotated = annotateCampaign({ ...child, title: creatorPhaseTitle(root.title, n), phaseNumber: n }, linksByCampaign.get(child.id) ?? [], pendingByCampaign.get(child.id) ?? 0);
      out.push({ ...toCreatorMoneyView(annotated, linksByCampaign.get(child.id) ?? [], ownerIds), creatorPhaseNumber: n, phaseCount: 1, bookedAssetIds: bookedAssetIds(child.id), pageQuota: pageQuota(child.id) });
    }
  }
  return out;
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
export async function getCampaignById(id, requester) {
  const campaign = await prisma.campaign.findUnique({ where: { id } });
  if (!campaign) throw new ApiError(404, "CAMPAIGN_NOT_FOUND", "Campaign not found");
  // A Plan Maker gets a 404 (not a 403) for a campaign outside their
  // plans — same "don't confirm it exists" convention listInvoices/
  // getInvoiceDetail use for another creator's invoice.
  if (requester?.role === "PLAN_MAKER" && !(await canPlanMakerAccessCampaign(requester.id, id))) {
    throw new ApiError(404, "CAMPAIGN_NOT_FOUND", "Campaign not found");
  }
  // Creators / team members (24 Sep): only campaigns their pages are in.
  if ((requester?.role === "CREATOR" || requester?.role === "TEAM_MEMBER") && !(await canCreatorAccessCampaign(requester, id))) {
    throw new ApiError(404, "CAMPAIGN_NOT_FOUND", "Campaign not found");
  }

  const rootId = campaign.parentCampaignId ?? campaign.id;
  const root = campaign.parentCampaignId ? (await prisma.campaign.findUnique({ where: { id: rootId } })) ?? campaign : campaign;

  const fullGroup = await prisma.campaign.findMany({
    where: { OR: [{ id: root.id }, { parentCampaignId: root.id }] },
    select: { id: true, phaseNumber: true, postNumber: true, title: true, createdAt: true, parentCampaignId: true },
  });
  fullGroup.sort(byPhaseThenPost);
  const groupIds = fullGroup.map((c) => c.id);
  const groupLinks = await prisma.link.findMany({ where: { campaignId: { in: groupIds } }, select: LINK_SELECT_FOR_CAMPAIGN });

  // Fresh from the DB (23 Sep, Step 3) — same campaigns.view check as listCampaigns.
  const effective = requester ? await loadEffectivePermissions(requester.id) : null;
  // Creators (22 Sep): every row they're booked on is its own numbered
  // phase, one running count over just those rows (root + theirs).
  if (requester && !(effective["campaigns.view"] || requester.role === "PLAN_MAKER")) {
    const mine = new Set(
      (await prisma.campaignAssignment.findMany({ where: { campaignId: { in: groupIds }, asset: { ownerId: requester.id } }, select: { campaignId: true } })).map((a) => a.campaignId)
    );
    const visible = creatorRowsOf(fullGroup, new Set([...mine, id]));
    const phases = visible.map((r) => ({ id: r.id, phaseNumber: creatorPhaseNumberIn(visible, r.id), title: creatorPhaseTitle(root.title, creatorPhaseNumberIn(visible, r.id)), createdAt: r.createdAt }));
    const n = creatorPhaseNumberIn(visible, id);
    const pending = await prisma.campaignAssignment.count({ where: { campaignId: id, status: "pending" } });
    const annotated = annotateCampaign({ ...campaign, title: creatorPhaseTitle(root.title, n), phaseNumber: n }, groupLinks.filter((l) => l.campaignId === id), pending);
    return { ...toCreatorMoneyView(annotated, groupLinks.filter((l) => l.campaignId === id), await ownerIdsFor(requester)), creatorPhaseNumber: n, phases: phases.length > 1 ? phases : phases.slice(0, 1) };
  }

  // Admin / Finance / Plan Maker: a phase's extra posts are part of that
  // phase (a page booked for 2 reels), not phases of their own — so only
  // real phases are listed, and this phase's numbers include its extra posts.
  // An extra post isn't a page of its own to an admin (dashboards link to a
  // link's campaignId, which can be one): answer with the phase it belongs
  // to, so the page, its tabs, invoices and Edit all act on the real phase.
  if ((campaign.postNumber ?? 1) > 1) {
    const phaseRow = fullGroup.find((r) => r.phaseNumber === campaign.phaseNumber && (r.postNumber ?? 1) === 1);
    if (phaseRow && phaseRow.id !== id) return getCampaignById(phaseRow.id, requester);
  }

  const thisPhase = campaign.phaseNumber ?? 1;
  const thisPhaseIds = fullGroup.filter((r) => (r.phaseNumber ?? 1) === thisPhase).map((r) => r.id);
  const group = fullGroup.filter((r) => r.postNumber === 1).map(({ id: rid, phaseNumber, title, createdAt }) => ({ id: rid, phaseNumber, title, createdAt }));
  const pendingAssignmentCount = await prisma.campaignAssignment.count({ where: { campaignId: { in: thisPhaseIds }, status: "pending" } });
  const ownLinks = groupLinks.filter((l) => thisPhaseIds.includes(l.campaignId));

  const annotated = annotateCampaign(campaign, ownLinks, pendingAssignmentCount);
  if (isCreatorSide(requester)) return { ...toCreatorMoneyView(annotated, ownLinks, await ownerIdsFor(requester)), phases: group };
  if (fullGroup.length <= 1) return { ...annotated, phases: group };

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
export async function createPhase(campaignId, { title } = {}, requester) {
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) throw new ApiError(404, "CAMPAIGN_NOT_FOUND", "Campaign not found");
  // Plan Maker may add a phase to their own plans' campaigns (22 Sep —
  // "admin/plan maker can add phase 2"); 404 elsewhere, same as reading it.
  if (requester?.role === "PLAN_MAKER" && !(await canPlanMakerAccessCampaign(requester.id, campaignId))) {
    throw new ApiError(404, "CAMPAIGN_NOT_FOUND", "Campaign not found");
  }

  const rootId = campaign.parentCampaignId ?? campaign.id;
  const root = campaign.parentCampaignId ? await prisma.campaign.findUnique({ where: { id: rootId } }) : campaign;
  if (!root) throw new ApiError(404, "CAMPAIGN_NOT_FOUND", "Campaign not found");

  return prisma.$transaction(async (tx) => {
    await lockCampaignGroup(tx, root.id);
    const existingPhases = await tx.campaign.findMany({
      where: { OR: [{ id: root.id }, { parentCampaignId: root.id }] },
      select: { phaseNumber: true },
    });
    const nextPhaseNumber = Math.max(...existingPhases.map((c) => c.phaseNumber)) + 1;

    // A real phase starts with Phase 1's pages, one post each (22 Sep), so
    // every creator on the deal sees the new phase straight away. Only
    // placed pages are copied — an unresolved sheet row stays in Phase 1 —
    // and never a submitted post (no postUrl / linkId).
    const phaseOnePages = await tx.campaignAssignment.findMany({
      where: { campaignId: root.id, status: "matched", assetId: { not: null } },
      select: { assetId: true, pageHandle: true, creatorPhone: true, format: true, cost: true },
    });
    const seen = new Set();
    const pages = phaseOnePages.filter((a) => !seen.has(a.assetId) && seen.add(a.assetId));

    return tx.campaign.create({
      data: {
        brandName: root.brandName,
        title: title || `${root.title} — Phase ${nextPhaseNumber}`,
        sheetLink: root.sheetLink,
        parentCampaignId: root.id,
        phaseNumber: nextPhaseNumber,
        postNumber: 1,
        ...(pages.length > 0 ? { assignments: { create: pages.map((a) => ({ ...a, status: "matched" })) } } : {}),
      },
    });
  });
}

/**
 * Row lock on a campaign's root for the rest of the transaction — phase
 * numbers are computed from the group (no unique constraint), so adding and
 * deleting phases on one campaign have to take turns.
 */
async function lockCampaignGroup(tx, rootId) {
  await tx.$queryRaw`SELECT "id" FROM "Campaign" WHERE "id" = ${rootId} FOR UPDATE`;
}

/**
 * Deletes a real phase (22 Sep — "admin should have option of deleting
 * phase of campaign"), together with its extra posts. Phase 1 is the
 * campaign itself and can't be deleted this way. Refused while anything was
 * submitted or invoiced against it — money is never silently removed; the
 * admin clears those first. Later phases move up a number (and their
 * "— Phase N" titles with them), so the numbering stays gap-free.
 */
export async function deletePhase(phaseId) {
  const phase = await prisma.campaign.findUnique({ where: { id: phaseId } });
  if (!phase) throw new ApiError(404, "CAMPAIGN_NOT_FOUND", "Phase not found");
  if (!phase.parentCampaignId || phase.phaseNumber === 1) {
    throw new ApiError(400, "CANNOT_DELETE_FIRST_PHASE", "Phase 1 is the campaign itself — it can't be deleted as a phase.");
  }
  const rootId = phase.parentCampaignId;

  return prisma.$transaction(async (tx) => {
    // Serialised with every other add/delete on this campaign, and re-read
    // inside the lock: a second, concurrent delete of the same phase must
    // not go on to delete whichever phase got renumbered into its place.
    await lockCampaignGroup(tx, rootId);
    const current = await tx.campaign.findUnique({ where: { id: phaseId }, select: { id: true, phaseNumber: true } });
    if (!current) throw new ApiError(404, "CAMPAIGN_NOT_FOUND", "That phase was already deleted");
    phase.phaseNumber = current.phaseNumber;
    const rows = await tx.campaign.findMany({ where: { parentCampaignId: rootId, phaseNumber: phase.phaseNumber }, select: { id: true } });
    const ids = rows.map((r) => r.id);
    const [links, invoices] = await Promise.all([tx.link.count({ where: { campaignId: { in: ids } } }), tx.invoice.count({ where: { campaignId: { in: ids } } })]);
    if (links > 0 || invoices > 0) {
      const parts = [links > 0 ? `${links} submitted post${links === 1 ? "" : "s"}` : null, invoices > 0 ? `${invoices} invoice${invoices === 1 ? "" : "s"}` : null].filter(Boolean);
      throw new ApiError(409, "PHASE_HAS_POSTS", `Phase ${phase.phaseNumber} has ${parts.join(" and ")} — remove ${links + invoices === 1 ? "it" : "them"} before deleting the phase.`);
    }

    await tx.campaign.deleteMany({ where: { id: { in: ids } } });

    const root = await tx.campaign.findUnique({ where: { id: rootId }, select: { title: true } });
    const later = await tx.campaign.findMany({ where: { parentCampaignId: rootId, phaseNumber: { gt: phase.phaseNumber } }, select: { id: true, phaseNumber: true, postNumber: true, title: true } });
    for (const row of later) {
      const newNumber = row.phaseNumber - 1;
      // Only an auto-named phase row is renamed; an extra post carries the root title, and a custom title is left alone.
      const autoTitle = row.postNumber === 1 && row.title === `${root.title} — Phase ${row.phaseNumber}`;
      await tx.campaign.update({ where: { id: row.id }, data: { phaseNumber: newNumber, ...(autoTitle ? { title: `${root.title} — Phase ${newNumber}` } : {}) } });
    }
    return { deleted: ids.length, rootId };
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
  // Fresh from the DB (23 Sep, Step 3) — restricting or granting
  // campaigns.view now actually narrows this to the requester's own rows,
  // the real data the "not the whole sheet's worth of other creators'
  // phone numbers" comment above is about.
  const effective = requester ? await loadEffectivePermissions(requester.id) : null;
  const privileged = !requester || effective["campaigns.view"] || requester.role === "PLAN_MAKER";
  // An admin's phase covers its extra posts too (22 Sep) — a page booked for
  // 2 reels is one page with post 1 and post 2, not a second phase. A
  // creator asks for their own numbered row, so theirs isn't widened.
  const where = { campaignId: privileged ? { in: await phaseRowIds(campaignId) } : campaignId };
  // Plan Maker sees every row of their own plans' campaigns (they need
  // "which pages are still pending" to know what can't be invoiced yet);
  // any other non-privileged role sees only their own matched row(s).
  if (requester?.role === "PLAN_MAKER") {
    where.campaign = planMakerCampaignWhere(requester.id);
  } else if (!privileged) {
    where.asset = { ownerId: requester.id };
  }
  const rows = await prisma.campaignAssignment.findMany({
    where,
    include: {
      asset: { select: { id: true, handle: true, category: true, approvalStatus: true } },
      link: { select: { id: true, status: true } },
      campaign: { select: { postNumber: true } },
    },
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
  });
  return rows
    .map(({ campaign, ...row }) => ({ ...row, postNumber: campaign?.postNumber ?? 1 }))
    // Same order as before (status, then created), with a page's post 2 after its post 1.
    .sort((a, b) => a.status.localeCompare(b.status) || a.postNumber - b.postNumber || new Date(a.createdAt) - new Date(b.createdAt));
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
  // The booking just landed on this page — and, when re-resolving, left
  // another one — so both pages' post quotas can move (lib/postQuota.js).
  await recomputePostQuota(campaignId, assetId);
  if (assignment.assetId && assignment.assetId !== assetId) await recomputePostQuota(campaignId, assignment.assetId);
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

/**
 * Every tab of a link-shared sheet, in tab order, as CSV (user request, 22
 * Sep — the uploaded plan sheet has "2 tabs in sheet, 1 for detail of
 * client budget, another tab will be of pages"). The CSV export only ever
 * serves one tab (by gid), and there's no public API listing tabs, so the
 * gids come from the sheet's read-only HTML view (/htmlview), which lists
 * its tabs in an inline script as `items.push({name: "…", …, gid: "0"})`
 * (checked against Google's public sample sheet, 22 Sep). If that page
 * can't be read (or lists nothing), it's treated as a single tab at the
 * link's own gid — the one-tab layout still works. Capped at 5 tabs.
 */
export async function fetchSheetTabs(sheetUrl) {
  const exportUrl = googleSheetCsvExportUrl(sheetUrl);
  const id = exportUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)[1];
  const linkGid = exportUrl.match(/gid=(\d+)/)[1];
  let tabs = [];
  try {
    const res = await fetch(`https://docs.google.com/spreadsheets/d/${id}/htmlview`);
    const html = res.ok ? await res.text() : "";
    tabs = [...html.matchAll(/items\.push\(\{name:\s*"((?:[^"\\]|\\.)*)"[^}]*?gid:\s*"(-?\d+)"/g)].map((m) => ({ gid: m[2], title: decodeJsString(m[1]) }));
  } catch {
    tabs = [];
  }
  if (tabs.length === 0) tabs = [{ gid: linkGid, title: null }];
  return Promise.all(
    tabs.slice(0, 5).map(async (tab) => ({ ...tab, csv: await fetchSheetCsv(`https://docs.google.com/spreadsheets/d/${id}/edit?gid=${tab.gid}`) }))
  );
}

// The names are JS string literals ("Details \x26 budget", "\"quoted\"").
const decodeJsString = (s) => {
  try {
    return JSON.parse(`"${s.replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => `\\u00${h}`)}"`);
  } catch {
    return s;
  }
};
