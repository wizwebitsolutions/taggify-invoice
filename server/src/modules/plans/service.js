import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../middleware/errorHandler.js";
import { getAvgEngagement, createAsset } from "../assets/service.js";
import {
  createSpreadsheet,
  deleteSheetTab,
  ensureSheetTabsExist,
  writeSheetTab,
  getSheetTabIds,
  getExistingSheetTabs,
  batchUpdateSpreadsheet,
} from "../../lib/googleSheetsClient.js";
import { makeFilePublicViewable, shareFileWithEditor } from "../../lib/googleDriveClient.js";
import { getUserAccessToken, isGoogleOAuthConfigured } from "../../lib/googleOAuthClient.js";
import { buildPlanSheetTabs, buildFormatRequests, buildExecutionSheetTemplate, previewExecutionSheetTemplate, reconcilePlanTabRequests, tabStatusRequests } from "../../lib/planSheet.js";
import { getNumbering, advancePast } from "../../lib/clientInvoiceNumbering.js";
import { loadEffectivePermissions } from "../../lib/effectivePermissions.js";
import { buildPlanInvoiceAttachmentKey, getUploadParams, objectExists, publicUrlFor } from "../../lib/cloudinaryClient.js";
import { fetchSheetCsv } from "../campaigns/service.js";
import { autoAttachLink } from "../links/service.js";
import { parseExecutionSheet } from "../../lib/executionSheetParser.js";

const PLAN_INCLUDE = { items: { include: { asset: true } }, createdBy: { select: { id: true, name: true } }, approvedBy: { select: { id: true, name: true } } };

/**
 * "Inventory" (newTask.md #13) — pitch documents built from a set of pages,
 * exportable as a PDF for a brand client. See schema.prisma's Plan/PlanItem
 * comment for how this differs from Campaign.
 */

// Rounded to paise so float drift can't leave total !== subtotal + gstAmount
// by a fraction (same rounding invoices/service.js uses) — one local helper
// since annotatePlan now needs this twice (real subtotal, display subtotal).
// gstPercent is a plain number (e.g. 18), not a fraction.
const gstOn = (subtotal, gstPercent) => (gstPercent ? Math.round(subtotal * (Number(gstPercent) / 100) * 100) / 100 : 0);

// An inactive page (8 Oct) can't be added to a plan. `alreadyOn` = the plan's
// current pages, which stay allowed so editing an existing plan works as before.
const inactiveError = (asset) => new ApiError(400, "PAGE_INACTIVE", `@${asset.handle} is inactive and can't be added to a plan`);

async function resolveItemCosts(items, alreadyOn = new Set()) {
  if (!items || items.length === 0) return [];
  const assetIds = [...new Set(items.map((i) => i.assetId))];
  const assets = await prisma.asset.findMany({ where: { id: { in: assetIds } }, include: { rateCards: true } });
  const assetById = new Map(assets.map((a) => [a.id, a]));

  return items.map((item) => {
    const asset = assetById.get(item.assetId);
    if (!asset) throw new ApiError(404, "ASSET_NOT_FOUND", `Page ${item.assetId} not found`);
    if (asset.isActive === false && !alreadyOn.has(asset.id)) throw inactiveError(asset);
    let cost = item.cost;
    if (cost == null) {
      const rateCard = asset.rateCards.find((rc) => rc.format === item.format);
      if (!rateCard) throw new ApiError(400, "NO_RATE_CARD", `No rate card set for format "${item.format}" on @${asset.handle}`);
      cost = Number(rateCard.amount);
    }
    return {
      assetId: item.assetId,
      format: item.format,
      cost,
      clientCost: item.clientCost ?? null,
      postsPerProfile: item.postsPerProfile ?? 1,
    };
  });
}

// Hard budget cap (user request, 14 Sep — "cost accordingly will be
// visible according to budget and can upto budget only", decided as a hard
// cap this session): the client-facing subtotal (clientCost ?? cost, × posts)
// may never exceed the plan's budget. Checked whenever items or the budget
// change, so neither a page added on the pages step nor a price raised on
// the pricing step nor a budget lowered later can leave the plan over.
export function clientSubtotalOf(items) {
  return items.reduce((sum, i) => sum + Number(i.clientCost ?? i.cost) * (i.postsPerProfile ?? 1), 0);
}

// The cap is on the *pages* only. The overall quoted total typed on the
// pricing step (overrideCost) is deliberately NOT capped — it's the markup
// the client is quoted and may be larger than the budget (user request,
// 14 Sep — "quoted to client will be larger ... that is okay").
function assertWithinBudget(budget, items) {
  if (budget == null) return;
  const subtotal = clientSubtotalOf(items);
  if (subtotal > Number(budget)) {
    throw new ApiError(400, "PLAN_OVER_BUDGET", `These pages come to ₹${subtotal.toLocaleString("en-IN")}, over the ₹${Number(budget).toLocaleString("en-IN")} budget`);
  }
}

export async function createPlan(requester, { items, ...fields }) {
  const resolvedItems = await resolveItemCosts(items);
  assertWithinBudget(fields.budget, resolvedItems);
  const plan = await prisma.plan.create({
    data: {
      ...fields,
      createdById: requester.id,
      items: { create: resolvedItems },
    },
    include: PLAN_INCLUDE,
  });
  return annotatePlan(plan);
}

// Plan Maker can only ever touch their own plans (newTask.md, 8 Sep — "Plan
// Maker... approves plans he created as well"); anyone holding plans.edit
// or plans.approve can touch any (23 Sep — read fresh from the DB, not
// bare role, so a role explicitly granted one of those keys — not just a
// plain ADMIN or the bare PLAN_MAKER role — gets the same full access;
// before this, a granted role could only ever act on plans it created
// itself, same as an ungranted Creator would). Not scoped as a WHERE
// clause because 404 (not 403) is what a not-found *or* not-yours plan
// should look like — same not-leaking-existence shape the rest of this
// file's ApiError(404, "PLAN_NOT_FOUND", ...) already uses.
async function canManageAnyPlan(requester) {
  const effective = await loadEffectivePermissions(requester.id);
  return effective["plans.edit"] || effective["plans.approve"];
}

async function assertCanAccessPlan(requester, plan) {
  if (await canManageAnyPlan(requester)) return;
  if (plan.createdById !== requester.id) {
    throw new ApiError(404, "PLAN_NOT_FOUND", "Plan not found");
  }
}

// ── Keeping generated Google Sheets current (user report, 29 Sep) ──────
// "on modifying plan after generation, in google sheet it's not updating":
// a plan's sheet was only ever written by an explicit Generate/Regenerate,
// but its link is shared publicly with the client, who opens it directly —
// never through the app. So any edit that changes what the sheet shows now
// rewrites every sheet already generated for the plan's group (client and/or
// internal). It runs after the save, not inside it: a rewrite is several
// seconds of Google API calls and the wizard saves on every step, and a
// Google outage must never fail a plan save. Rewrites of the same
// spreadsheet are serialised and coalesced, so two quick edits can't
// interleave their clear/write calls, and a burst of edits costs at most one
// extra rewrite — each rewrite reads the plan fresh, so the last one is current.
const sheetRefreshes = new Map(); // group key → { again: boolean, done: Promise }

function queueSheetRefresh(key, run) {
  const current = sheetRefreshes.get(key);
  if (current) {
    current.again = true;
    return current.done;
  }
  const state = { again: false };
  state.done = (async () => {
    try {
      do {
        state.again = false;
        await run();
      } while (state.again);
    } finally {
      sheetRefreshes.delete(key);
    }
  })();
  sheetRefreshes.set(key, state);
  return state.done;
}

/**
 * Rewrites the plan group's already-generated sheets. A sheet nobody has
 * generated yet is left alone — generating one is still an explicit action.
 * Returns the queued promise (tests await it; routes don't).
 */
export async function refreshGeneratedSheets(planId, requester) {
  try {
    const plan = await prisma.plan.findUnique({ where: { id: planId }, select: { id: true, pitchGroupId: true } });
    if (!plan) return;
    // Keyed by the pitch group, not the plan: Plan A and Plan B share one
    // spreadsheet, so edits to both must queue behind each other too.
    await queueSheetRefresh(plan.pitchGroupId ?? plan.id, async () => {
      try {
        const group = await prisma.plan.findMany({
          where: plan.pitchGroupId ? { pitchGroupId: plan.pitchGroupId } : { id: plan.id },
          select: { clientSheetUrl: true, internalSheetUrl: true },
        });
        if (group.some((p) => p.clientSheetUrl)) await generatePlanSheet(planId, requester, { internal: false });
        if (group.some((p) => p.internalSheetUrl)) await generatePlanSheet(planId, requester, { internal: true });
      } catch (err) {
        console.error(`[plans] couldn't refresh the Google Sheet for plan ${planId}:`, err?.message ?? err);
      }
    });
  } catch (err) {
    console.error(`[plans] couldn't queue a Google Sheet refresh for plan ${planId}:`, err?.message ?? err);
  }
}

export async function updatePlan(planId, requester, { items, ...fields }) {
  const existing = await prisma.plan.findUnique({ where: { id: planId } });
  if (!existing) throw new ApiError(404, "PLAN_NOT_FOUND", "Plan not found");
  await assertCanAccessPlan(requester, existing);

  const data = { ...fields };
  const budget = fields.budget !== undefined ? fields.budget : existing.budget;
  if (items) {
    const onPlan = await prisma.planItem.findMany({ where: { planId }, select: { assetId: true } });
    const resolvedItems = await resolveItemCosts(items, new Set(onPlan.map((i) => i.assetId)));
    assertWithinBudget(budget, resolvedItems);
    await prisma.planItem.deleteMany({ where: { planId } });
    data.items = { create: resolvedItems };
  } else if (fields.budget !== undefined) {
    assertWithinBudget(budget, await prisma.planItem.findMany({ where: { planId } }));
  }
  // A budget saved here answers the uploaded sheet's pending "budget" entry (22 Sep).
  if (fields.budget !== undefined && Array.isArray(existing.sourceSheetPending) && existing.sourceSheetPending.some((p) => p.kind === "budget")) {
    data.sourceSheetPending = existing.sourceSheetPending.filter((p) => p.kind !== "budget");
  }

  // A new/changed execution sheet starts from a clean slate — the pending
  // list and fetch time belong to the sheet that produced them.
  if (fields.executionSheetUrl !== undefined && fields.executionSheetUrl !== existing.executionSheetUrl) {
    data.executionSheetPending = null;
    data.executionSheetFetchedAt = null;
  }

  const plan = await prisma.plan.update({
    where: { id: planId },
    data,
    include: PLAN_INCLUDE,
  });
  // Attaching a sheet to an approved plan reads it immediately (23 Sep) so
  // the links show up without a second click. The link is already saved
  // above, so a sheet that can't be read (not shared, wrong columns) is
  // reported on the response rather than failing the save — the card shows
  // the message next to its Refresh button.
  if (fields.executionSheetUrl && fields.executionSheetUrl !== existing.executionSheetUrl && plan.status === "APPROVED" && plan.campaignId) {
    try {
      const { plan: synced } = await syncExecutionSheet(planId, requester);
      return synced;
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      return { ...(await annotatePlan(plan)), executionSheetSyncError: err.message };
    }
  }
  return annotatePlan(plan);
}

// ── Execution sheet → links (user decision, 23 Sep) ───────────────────
// "Parse → auto-create links": every sheet row that names a Posted Link
// becomes a SUBMITTED Link for that page's owner, on the campaign the plan's
// approval created — the same links/service.js autoAttachLink path the
// campaign assignment-sheet import already uses, so a link created here is
// indistinguishable downstream (screenshots, insights, invoicing). Each
// link fills one of the plan's CampaignAssignment slots for that page (root
// row = 1st post, postNumber rows = 2nd, 3rd…), carrying that slot's
// format/cost from the plan item, so the creator's invoice bills what the
// plan priced. Idempotent: a URL already linked for the page is skipped, a
// slot already filled is skipped, so Refresh never doubles anything. Rows
// that can't become a link are recorded, not dropped.

const MAX_EXECUTION_ROWS = 500;

export async function syncExecutionSheet(planId, requester) {
  const plan = await prisma.plan.findUnique({ where: { id: planId }, include: PLAN_INCLUDE });
  if (!plan) throw new ApiError(404, "PLAN_NOT_FOUND", "Plan not found");
  await assertCanAccessPlan(requester, plan);
  if (!plan.executionSheetUrl) throw new ApiError(409, "NO_EXECUTION_SHEET", "Attach an execution sheet first");
  if (plan.status !== "APPROVED" || !plan.campaignId) {
    throw new ApiError(409, "PLAN_NOT_APPROVED", "Approve the plan first — posted links are attached to the campaign its approval creates");
  }

  const csv = await fetchSheetCsv(plan.executionSheetUrl);
  const { headerRow, rows } = parseExecutionSheet(csv);
  if (headerRow === -1) {
    throw new ApiError(400, "SHEET_FORMAT", 'Couldn\'t find the header row — the sheet needs a "Posted Link" column and a "Page Name" or "Page Link" column (see the template)');
  }

  // Every assignment slot on the plan's campaign rows (root + extra-post rows),
  // with the page's rate cards for autoAttachLink's fallback pricing.
  const campaignRows = await prisma.campaign.findMany({
    where: { OR: [{ id: plan.campaignId }, { parentCampaignId: plan.campaignId }] },
    select: { id: true, postNumber: true },
  });
  const rowOrder = new Map(campaignRows.map((c) => [c.id, c.postNumber ?? 1]));
  const slots = await prisma.campaignAssignment.findMany({
    where: { campaignId: { in: campaignRows.map((c) => c.id) }, assetId: { not: null } },
    include: { asset: { include: { rateCards: true } } },
  });
  slots.sort((a, b) => (rowOrder.get(a.campaignId) ?? 1) - (rowOrder.get(b.campaignId) ?? 1));
  const slotsByHandle = new Map();
  for (const s of slots) {
    const key = s.asset.handle.toLowerCase();
    if (!slotsByHandle.has(key)) slotsByHandle.set(key, []);
    slotsByHandle.get(key).push(s);
  }

  const pending = [];
  let attached = 0;
  let alreadyLinked = 0;
  const seenUrls = new Set();
  for (const row of rows.slice(0, MAX_EXECUTION_ROWS)) {
    const record = { rowNumber: row.rowNumber, pageHandle: row.pageHandle, pageName: row.pageName, postUrl: row.postUrl };
    if (!row.postUrl) {
      pending.push({ ...record, reason: "No posted link yet" });
      continue;
    }
    if (seenUrls.has(row.postUrl)) continue; // the same post listed twice in the sheet
    seenUrls.add(row.postUrl);
    if (!row.pageHandle) {
      pending.push({ ...record, reason: "Couldn't tell which page this is — add the page's Instagram link" });
      continue;
    }
    const pageSlots = slotsByHandle.get(row.pageHandle.toLowerCase());
    if (!pageSlots) {
      pending.push({ ...record, reason: `@${row.pageHandle} isn't a page on this plan` });
      continue;
    }
    const asset = pageSlots[0].asset;
    const existing = await prisma.link.findFirst({ where: { url: row.postUrl, assetId: asset.id }, select: { id: true } });
    if (existing) {
      alreadyLinked += 1;
      continue;
    }
    const slot = pageSlots.find((s) => !s.linkId);
    if (!slot) {
      pending.push({ ...record, reason: `More posts than the plan booked for @${row.pageHandle} (${pageSlots.length})` });
      continue;
    }
    try {
      const link = await autoAttachLink(asset, {
        campaignId: slot.campaignId,
        url: row.postUrl,
        format: slot.format ?? plan.items.find((i) => i.assetId === asset.id)?.format ?? "reel",
        cost: slot.cost != null ? Number(slot.cost) : undefined,
      });
      if (!link) {
        alreadyLinked += 1;
        continue;
      }
      await prisma.campaignAssignment.update({ where: { id: slot.id }, data: { linkId: link.id, postUrl: row.postUrl } });
      slot.linkId = link.id;
      attached += 1;
    } catch (err) {
      pending.push({ ...record, reason: err instanceof ApiError ? err.message : "Couldn't attach this post" });
    }
  }

  const updated = await prisma.plan.update({
    where: { id: planId },
    data: { executionSheetPending: pending, executionSheetFetchedAt: new Date() },
    include: PLAN_INCLUDE,
  });
  return { plan: await annotatePlan(updated), summary: { attached, alreadyLinked, pending: pending.length, rows: rows.length } };
}

// ADMIN sees every plan; Plan Maker sees only the ones they created — their
// dashboard's "which plan worked, their analysis" (newTask.md, 8 Sep) is
// scoped to their own pitches, not the whole agency's.
export async function listPlans(requester) {
  const where = requester && (await canManageAnyPlan(requester)) ? {} : { createdById: requester.id };
  const plans = await prisma.plan.findMany({
    where,
    include: PLAN_INCLUDE,
    orderBy: { createdAt: "desc" },
  });
  return Promise.all(plans.map(annotatePlan));
}

/**
 * Saved clients (user request, 21 Sep — "if client name already exists ...
 * it should fetch all details like gst, address ... dropdown of client
 * name"). There's no Client table: a client is whatever earlier plans were
 * billed to, so this folds the requester's visible plans (same scope as
 * listPlans — a Plan Maker never sees another maker's client's GSTIN or
 * address) down to one entry per billing identity, newest plan winning.
 *
 * Keyed on client name + GSTIN (falling back to company, then address)
 * rather than name alone: one brand routinely bills through different GST
 * registrations in different states, and those must stay separate choices.
 * A name that only ever appeared on plans with no billing details still
 * comes back (details null) so the wizard's Client name field can suggest
 * it — but not once the same name has an entry that does carry details.
 */
export async function listSavedClients(requester) {
  const where = requester && (await canManageAnyPlan(requester)) ? {} : { createdById: requester.id };
  const plans = await prisma.plan.findMany({
    where,
    select: { clientName: true, clientCompany: true, clientGstNumber: true, clientAddress: true, clientPhone: true },
    orderBy: { updatedAt: "desc" },
  });

  const norm = (v) => (v ?? "").trim().toLowerCase();
  const detailed = new Map();
  const bare = new Map();
  for (const plan of plans) {
    const name = norm(plan.clientName);
    if (!name) continue;
    const identity = norm(plan.clientGstNumber) || norm(plan.clientCompany) || norm(plan.clientAddress);
    const bucket = identity ? detailed : bare;
    const key = `${name}|${identity}`;
    if (bucket.has(key)) continue;
    bucket.set(key, {
      clientName: plan.clientName.trim(),
      clientCompany: plan.clientCompany?.trim() || null,
      clientGstNumber: plan.clientGstNumber?.trim() || null,
      clientAddress: plan.clientAddress?.trim() || null,
      clientPhone: plan.clientPhone?.trim() || null,
    });
  }

  const namesWithDetails = new Set([...detailed.values()].map((c) => norm(c.clientName)));
  return [...detailed.values(), ...[...bare.values()].filter((c) => !namesWithDetails.has(norm(c.clientName)))].sort((a, b) =>
    a.clientName.localeCompare(b.clientName, "en", { sensitivity: "base" })
  );
}

export async function getPlan(planId, requester) {
  const plan = await prisma.plan.findUnique({
    where: { id: planId },
    include: PLAN_INCLUDE,
  });
  if (!plan) throw new ApiError(404, "PLAN_NOT_FOUND", "Plan not found");
  if (requester) await assertCanAccessPlan(requester, plan);
  return annotatePlan(plan);
}

export async function deletePlan(planId, requester) {
  const plan = await prisma.plan.findUnique({ where: { id: planId } });
  if (!plan) throw new ApiError(404, "PLAN_NOT_FOUND", "Plan not found");
  await assertCanAccessPlan(requester, plan);
  await prisma.plan.delete({ where: { id: planId } });
}

/**
 * DRAFT → APPROVED/REJECTED, decided directly by whoever built it (or
 * Admin) — no separate "submit for someone else to sign off on" step
 * (user request, 11 Sep — "remove option of submit for approval, plan
 * maker or admin can approve plan by themselves only"). This used to be a
 * two-step DRAFT → PENDING_APPROVAL → APPROVED/REJECTED flow (see git
 * history); PENDING_APPROVAL stays in the PlanStatus enum only so any
 * plan already in that state (pre-existing prod data) still renders
 * correctly — nothing can transition into it anymore. Admin can decide on
 * any plan; a Plan Maker can only decide on their own ("approves plans he
 * created as well") — they can't approve a colleague's pitch.
 */
async function decidePlan(planId, requester, decision) {
  const plan = await prisma.plan.findUnique({ where: { id: planId }, include: PLAN_INCLUDE });
  if (!plan) throw new ApiError(404, "PLAN_NOT_FOUND", "Plan not found");
  await assertCanAccessPlan(requester, plan);
  // A rejected plan can still be approved later (8 Oct — "if a plan is
  // rejected it can be approved again"); only a draft can be rejected.
  const decidable = decision === "APPROVED" ? plan.status === "DRAFT" || plan.status === "REJECTED" : plan.status === "DRAFT";
  if (!decidable) {
    throw new ApiError(400, "INVALID_PLAN_STATUS", decision === "APPROVED" ? `Only a draft or rejected plan can be approved (this one is ${plan.status})` : `Only a draft plan can be rejected (this one is ${plan.status})`);
  }

  // Approving creates the real Campaign the pages actually run under (user
  // request, 10 Sep — "on his marking all pages mentioned in the plan will
  // get the campaign visible") — decided via AskUserQuestion this session:
  // a real Campaign + one already-"matched" CampaignAssignment per distinct
  // page, the same visibility path every other campaign already uses
  // (campaigns/service.js's own listAssignments scopes a matched row to
  // its page's owner), not a parallel one. Only this plan's own approval
  // converts — a sibling in the same pitch group (Plan B) stays whatever
  // status it's already in; approving it separately later creates its own,
  // second campaign. Skipped for an empty plan (nothing to make visible).
  // Root + phases + the plan's own status flip commit together — a failed
  // phase create must not leave a campaign behind with the plan still DRAFT
  // (re-approving would then mint a second root).
  const updated = await prisma.$transaction(async (tx) => {
    const campaignId = decision === "APPROVED" && plan.items.length > 0 ? (await createCampaignFromPlan(plan, tx)).id : undefined;
    return tx.plan.update({
      where: { id: planId },
      data:
        decision === "APPROVED"
          ? { status: "APPROVED", approvedById: requester.id, approvedAt: new Date(), ...(campaignId ? { campaignId } : {}) }
          : { status: "REJECTED", approvedById: requester.id, approvedAt: new Date() },
      include: PLAN_INCLUDE,
    });
  });
  return annotatePlan(updated);
}

// One CampaignAssignment per distinct page — "matched" immediately since
// these are already real Asset records (not raw sheet rows waiting on an
// admin to resolve them, the way campaigns/service.js's own sheet-import
// assignments start out). format/cost carry the plan item's own values
// through as a reference starting point; the creator's actual submission
// still goes through the normal link pipeline from here.
async function createCampaignFromPlan(plan, tx = prisma) {
  const distinctAssetIds = [...new Set(plan.items.map((i) => i.assetId))];
  // One assignment per distinct page per phase, carrying the line that
  // actually still has an Nth post (a page listed as reel x1 + story x3 is a
  // story job in phases 2-3, not a reel one).
  const assignmentsForPhase = (phase) =>
    distinctAssetIds
      .map((assetId) => plan.items.find((i) => i.assetId === assetId && (i.postsPerProfile ?? 1) >= phase))
      .filter(Boolean)
      .map((item) => ({ assetId: item.assetId, pageHandle: item.asset?.handle ?? "", format: item.format, cost: item.cost, status: "matched" }));
  const root = await tx.campaign.create({
    data: {
      brandName: plan.clientCompany || plan.clientName,
      title: plan.name,
      costCap: plan.budget ?? plan.items.reduce((sum, item) => sum + Number(item.cost) * item.postsPerProfile, 0),
      assignments: { create: assignmentsForPhase(1) },
    },
  });
  // Posts per page > 1 become phases (user request, 14 Sep — "if post per
  // page will be more than 1, to the creator side it'll show phase 2, 3
  // like this different campaigns"): phase N carries every page that still
  // has an Nth post to do, under the same parent so budget/spend roll up
  // (same shape campaigns/service.js's createPhase makes by hand). The
  // creator sees each phase as its own campaign in their dashboard.
  // 22 Sep — these are a page's extra posts, not real phases: the creator
  // still sees each as its own numbered phase (lib/campaignPhases.js), but
  // an admin sees one phase where that page has 2+ posts. So they're rows of
  // phase 1 (postNumber 2, 3, …) titled like the campaign itself; a real
  // phase is only ever added from the campaign page (createPhase).
  const postCount = Math.max(1, ...plan.items.map((i) => i.postsPerProfile ?? 1));
  for (let post = 2; post <= postCount; post++) {
    await tx.campaign.create({
      data: {
        brandName: root.brandName,
        title: plan.name,
        parentCampaignId: root.id,
        phaseNumber: 1,
        postNumber: post,
        assignments: { create: assignmentsForPhase(post) },
      },
    });
  }
  return root;
}

export const approvePlan = (planId, requester) => decidePlan(planId, requester, "APPROVED");
export const rejectPlan = (planId, requester) => decidePlan(planId, requester, "REJECTED");

/**
 * Adds the computed numbers newTask.md #13 (and its 8 Sep follow-up) ask
 * for. Two cost totals, kept deliberately distinct:
 *  - totalCost/budgetVariance: internal — every item's real cost × how many
 *    posts it covers, compared against the admin's own budget target.
 *  - overview.{subtotal,gstAmount,total}: client-facing — each item's
 *    clientCost when set (falling back to its real cost otherwise), the
 *    number that actually belongs in anything sent to the brand. See
 *    forClientPdf() below for why the PDF never touches totalCost directly.
 * expectedEngagement/overview.expectedImpressions come from the *distinct*
 * selected pages' own scrape history (getAvgEngagement) — an asset picked
 * for two formats only counts once. There's no impressions metric anywhere
 * in the data model (PostSnapshot tracks likes/comments/views/saves/
 * shares/reposts, not impressions), so it's approximated from avg. views
 * per post × posts per profile — an estimate, same spirit as the source
 * sheet's own rounded "5M+" rather than an exact figure.
 */
async function annotatePlan(plan) {
  const budget = plan.budget != null ? Number(plan.budget) : null;

  const distinctAssetIds = [...new Set(plan.items.map((i) => i.assetId))];
  const engagements = await Promise.all(distinctAssetIds.map((assetId) => getAvgEngagement(assetId)));
  const engagementByAsset = new Map(distinctAssetIds.map((id, i) => [id, engagements[i]]));
  const expectedLikes = engagements.reduce((sum, e) => sum + (e.avgLikes ?? 0), 0);
  const expectedViews = engagements.reduce((sum, e) => sum + (e.avgViews ?? 0), 0);

  const totalCost = plan.items.reduce((sum, item) => sum + Number(item.cost) * item.postsPerProfile, 0);
  const clientSubtotal = plan.items.reduce((sum, item) => sum + Number(item.clientCost ?? item.cost) * item.postsPerProfile, 0);
  const gstPercent = plan.gstPercent != null ? Number(plan.gstPercent) : null;
  const gstAmount = gstOn(clientSubtotal, gstPercent);

  const totalPosts = plan.items.reduce((sum, item) => sum + item.postsPerProfile, 0);
  const expectedImpressions = plan.items.reduce(
    (sum, item) => sum + (engagementByAsset.get(item.assetId)?.avgViews ?? 0) * item.postsPerProfile,
    0
  );
  const totalFollowers = distinctAssetIds.reduce((sum, id) => {
    const item = plan.items.find((i) => i.assetId === id);
    return sum + (item?.asset?.followers ?? 0);
  }, 0);

  // Step 3's editable client-facing overview (user request, 10 Sep) —
  // each override field independently replaces its computed counterpart in
  // `overview` when set; null/unset keeps the computed value, same as
  // every plan before these columns existed. gstAmount/total always derive
  // from whichever subtotal ends up in `overview`, never from the raw
  // computed one, so a GST-inclusive total on the client PDF always
  // matches the number actually shown above it.
  const displayFollowers = plan.overrideFollowers ?? totalFollowers;
  const displayPosts = plan.overridePosts ?? totalPosts;
  const displayImpressions = plan.overrideImpressions ?? expectedImpressions;
  const displaySubtotal = plan.overrideCost != null ? Number(plan.overrideCost) : clientSubtotal;
  const displayGstAmount = gstOn(displaySubtotal, gstPercent);

  return {
    ...plan,
    // Each line's expected views (page avg views × posts) — the sheet's
    // per-category reach in the "breakdown" format (8 Oct).
    items: plan.items.map((item) => ({ ...item, expectedViews: (engagementByAsset.get(item.assetId)?.avgViews ?? 0) * item.postsPerProfile })),
    gstPercent,
    isGstPlan: Boolean(gstPercent),
    invoiceAttachment: invoiceAttachmentFor(plan),
    // Always an array for the client, whether the column is null or unset.
    sourceSheetPending: Array.isArray(plan.sourceSheetPending) ? plan.sourceSheetPending : [],
    executionSheetPending: Array.isArray(plan.executionSheetPending) ? plan.executionSheetPending : [],
    totalCost,
    // Positive = under budget ("less cost" than budgeted), negative = over ("extra cost").
    budgetVariance: budget != null ? budget - totalCost : null,
    expectedEngagement: { likes: expectedLikes, views: expectedViews },
    overview: {
      totalFollowers: displayFollowers,
      totalPosts: displayPosts,
      expectedImpressions: displayImpressions,
      subtotal: displaySubtotal,
      gstAmount: displayGstAmount,
      total: displaySubtotal + displayGstAmount,
    },
    // The real, always-computed numbers, regardless of any override above —
    // Step 3's "Internal" panel reads this so an overridden client-facing
    // number never hides what's actually true from the person setting it.
    internal: {
      computedFollowers: totalFollowers,
      computedPosts: totalPosts,
      computedImpressions: expectedImpressions,
      computedSubtotal: clientSubtotal,
      computedGstAmount: gstAmount,
      computedTotal: clientSubtotal + gstAmount,
    },
  };
}

/**
 * Reshapes a plan for the client-facing PDF (newTask.md, 8 Sep) — the
 * whole point of a separate clientCost is that the real internal number
 * must never reach anything sent to a brand. Rather than trust every call
 * site to remember `clientCost ?? cost` themselves, this resolves it once
 * here and doesn't even carry `cost`/`clientCost` through to the output —
 * planPdf.js physically has no field to reach for but the resolved
 * `displayCost`, so there's no way to wire it up wrong later.
 */
export function forClientPdf(plan) {
  return {
    name: plan.name,
    variantLabel: plan.variantLabel,
    // Approval state — the client sheet shows whether this plan is the one
    // that went ahead (Active) or not (29 Sep). Not a cost, safe to pass.
    status: plan.status,
    clientName: plan.clientName,
    clientContact: plan.clientContact,
    clientCompany: plan.clientCompany,
    clientGstNumber: plan.clientGstNumber,
    clientAddress: plan.clientAddress,
    notes: plan.notes,
    createdAt: plan.createdAt,
    isGstPlan: plan.isGstPlan,
    gstPercent: plan.gstPercent,
    overview: plan.overview,
    // Which sheet layout the plan uses (8 Oct). Not a cost, safe to pass.
    sheetFormat: plan.sheetFormat,
    items: plan.items.map((item) => ({
      format: item.format,
      postsPerProfile: item.postsPerProfile,
      expectedViews: item.expectedViews ?? 0,
      displayCost: Number(item.clientCost ?? item.cost),
      asset: item.asset ? { handle: item.asset.handle, category: item.asset.category, followers: item.asset.followers } : null,
    })),
  };
}

// ── Client invoice (user request, 13 Sep) ─────────────────────────────
// "on clicking generate invoice, it'll ask for client details like gst,
// company address, phone number" — the Taggify → client invoice for the
// plan's client-facing total (overview.*), distinct from the creators'
// own payout invoices (invoices/service.js). The popup's details are
// saved onto the plan, the number is minted once and kept on every
// regeneration, and the PDF is rendered on demand from the plan row —
// there's no separate Invoice record for it (it isn't a creator payout,
// so none of the RAISED/APPROVED/PAID machinery applies).

const orNull = (v) => (v && v.trim() ? v.trim() : null);
// Who may type their own invoice number instead of taking the counter's
// next one (user request, 17 Sep — "invoice no. will be set by admin").
const canSetInvoiceNumber = (requester) => requester.role === "ADMIN" || requester.role === "FINANCE";

export async function generateClientInvoice(planId, requester, details) {
  const plan = await prisma.plan.findUnique({ where: { id: planId }, include: PLAN_INCLUDE });
  if (!plan) throw new ApiError(404, "PLAN_NOT_FOUND", "Plan not found");
  await assertCanAccessPlan(requester, plan);
  if (plan.status !== "APPROVED") {
    throw new ApiError(409, "PLAN_NOT_APPROVED", "Approve the plan before invoicing the client");
  }
  const clientGstNumber = orNull(details.clientGstNumber);
  // Mandatory on every client invoice, GST plan or not (21 Sep).
  if (!clientGstNumber) {
    throw new ApiError(400, "CLIENT_GST_REQUIRED", "The client's GST number is needed on the invoice");
  }
  const annotated = await annotatePlan(plan);
  if (!(annotated.overview.subtotal > 0)) {
    throw new ApiError(409, "PLAN_NOTHING_TO_INVOICE", "This plan has no client-facing cost to invoice");
  }

  // A typed number wins; otherwise a plan keeps the number it already has
  // (the client never sees two numbers for one plan), and a first-time
  // invoice takes the counter's next one.
  const typed = orNull(details.clientInvoiceNumber);
  if (typed && typed !== plan.clientInvoiceNumber && !canSetInvoiceNumber(requester)) {
    throw new ApiError(403, "INVOICE_NUMBER_FORBIDDEN", "Only an Admin or Finance can set the invoice number");
  }
  const fixedNumber = typed ?? plan.clientInvoiceNumber;
  let clientInvoiceNumber = fixedNumber ?? (await getNumbering()).suggestion;

  // A number the *counter* proposed can already be taken (two generates at
  // once, a counter an admin lowered, a number typed under an older
  // prefix). Nobody chose it, so step past it and take the next free one —
  // otherwise a Plan Maker, who can't type a number, would 409 forever. A
  // number someone typed is theirs to fix, so that one is reported instead.
  let updated;
  for (let attempt = 0; ; attempt += 1) {
    try {
      updated = await prisma.plan.update({
        where: { id: planId },
        data: {
          clientCompany: details.clientCompany.trim(),
          clientGstNumber,
          clientAddress: details.clientAddress.trim(),
          clientPhone: orNull(details.clientPhone),
          invoiceDescription: details.invoiceDescription.trim(),
          hsnSac: orNull(details.hsnSac),
          clientInvoiceNumber,
          clientInvoiceAt: new Date(),
        },
        include: PLAN_INCLUDE,
      });
      break;
    } catch (err) {
      if (err?.code !== "P2002") throw err;
      if (fixedNumber || attempt >= 20) {
        throw new ApiError(409, "INVOICE_NUMBER_TAKEN", `Invoice number ${clientInvoiceNumber} is already used on another plan`);
      }
      await advancePast(clientInvoiceNumber);
      clientInvoiceNumber = (await getNumbering()).suggestion;
    }
  }
  // Only after the number is really taken, so a failed generate never burns one.
  await advancePast(clientInvoiceNumber);
  const result = await annotatePlan(updated);
  await upsertClientInvoiceLedger(result, requester);
  return result;
}

/**
 * Receivables ledger row (user decision, 23 Sep — client invoices are
 * tracked and listed in /invoices). Written after the plan row has the
 * number, so the two can't disagree. A regenerate refreshes the number
 * (an Admin may have retyped it) and the totals; status / paidAt / issuedAt
 * are the ledger's own and are left alone. Best-effort *would* be wrong
 * here — Finance settles from this row, so a failure surfaces as a failed
 * generate rather than a silently missing receivable.
 */
async function upsertClientInvoiceLedger(plan, requester) {
  const money = {
    subtotal: plan.overview.subtotal,
    gstPercent: plan.gstPercent,
    gstAmount: plan.overview.gstAmount,
    total: plan.overview.total,
    invoiceNumber: plan.clientInvoiceNumber,
    campaignId: plan.campaignId ?? null,
  };
  return prisma.clientInvoice.upsert({
    where: { planId: plan.id },
    create: { planId: plan.id, issuedById: requester.id, issuedAt: plan.clientInvoiceAt ?? new Date(), ...money },
    update: money,
  });
}

/**
 * The client-invoice document for a plan, for a caller that has already
 * been authorised some other way (the Receivables view in /invoices —
 * Finance has no plan access). No requester check here on purpose; the
 * plan-scoped route uses getClientInvoice above.
 */
export async function clientInvoiceDocumentForPlan(planId) {
  const plan = await prisma.plan.findUnique({ where: { id: planId }, include: PLAN_INCLUDE });
  if (!plan) throw new ApiError(404, "PLAN_NOT_FOUND", "Plan not found");
  if (!plan.clientInvoiceNumber) {
    throw new ApiError(409, "CLIENT_INVOICE_NOT_GENERATED", "Generate the client invoice first");
  }
  return forClientInvoice(await annotatePlan(plan));
}

// Attached invoice PDF (user request, 14 Sep — "in plans for admin, plan
// maker side, there'll be option of attaching invoice document in pdf
// format as well"). Same direct-to-Cloudinary two-step as the creator's
// invoice attachment (invoices/service.js): the client asks for a signed
// key, uploads the bytes itself, then confirms; the server only ever holds
// the reference. Anyone who can act on the plan (Admin any, Plan Maker own)
// can attach — same gate as every other write here, no approval required,
// since an invoice raised outside the system may exist before approval.
export function invoiceAttachmentFor(plan) {
  if (!plan.invoiceAttachmentPublicId) return null;
  return {
    name: plan.invoiceAttachmentName,
    url: publicUrlFor(plan.invoiceAttachmentPublicId),
    uploadedAt: plan.invoiceAttachmentUploadedAt,
    uploadedById: plan.invoiceAttachmentUploadedById,
  };
}

async function getWritablePlan(planId, requester) {
  const plan = await prisma.plan.findUnique({ where: { id: planId } });
  if (!plan) throw new ApiError(404, "PLAN_NOT_FOUND", "Plan not found");
  await assertCanAccessPlan(requester, plan);
  return plan;
}

export async function requestInvoiceAttachmentUpload(planId, requester) {
  await getWritablePlan(planId, requester);
  return getUploadParams(buildPlanInvoiceAttachmentKey(planId));
}

export async function confirmInvoiceAttachment(planId, requester, { publicId, fileName }) {
  await getWritablePlan(planId, requester);
  if (!publicId.startsWith(`plan-invoice-attachments/${planId}/`)) {
    throw new ApiError(400, "KEY_MISMATCH", "Object key does not belong to this plan");
  }
  if (!(await objectExists(publicId))) {
    throw new ApiError(422, "UPLOAD_NOT_FOUND", "No file found at that key — upload may not have completed");
  }
  const updated = await prisma.plan.update({
    where: { id: planId },
    data: {
      invoiceAttachmentPublicId: publicId,
      invoiceAttachmentName: fileName,
      invoiceAttachmentUploadedById: requester.id,
      invoiceAttachmentUploadedAt: new Date(),
    },
  });
  return invoiceAttachmentFor(updated);
}

/** Clears the reference only — the object stays in Cloudinary, same as invoices/service.js's removeAttachment. */
export async function removeInvoiceAttachment(planId, requester) {
  const plan = await getWritablePlan(planId, requester);
  if (!plan.invoiceAttachmentPublicId) return null;
  await prisma.plan.update({
    where: { id: planId },
    data: { invoiceAttachmentPublicId: null, invoiceAttachmentName: null, invoiceAttachmentUploadedById: null, invoiceAttachmentUploadedAt: null },
  });
  return null;
}

export async function getClientInvoice(planId, requester) {
  const plan = await getPlan(planId, requester);
  if (!plan.clientInvoiceNumber) {
    throw new ApiError(409, "CLIENT_INVOICE_NOT_GENERATED", "Generate the client invoice first");
  }
  return forClientInvoice(plan);
}

/**
 * Same discipline as forClientPdf: only resolved client-facing numbers
 * reach clientInvoicePdf.js — no `cost`, no `totalCost`, no `internal`.
 * `itemised` says whether the per-page lines add up to the subtotal
 * (false once Step 3 overrode the client-facing cost, in which case the
 * PDF shows one consolidated line instead).
 */
export function forClientInvoice(plan) {
  return {
    ...forClientPdf(plan),
    clientPhone: plan.clientPhone,
    invoiceDescription: plan.invoiceDescription,
    hsnSac: plan.hsnSac,
    clientInvoiceNumber: plan.clientInvoiceNumber,
    clientInvoiceAt: plan.clientInvoiceAt,
    itemised: plan.overrideCost == null,
  };
}

// "Plan B or other plan" (user request, 10 Sep) — a linked sibling Plan
// that starts from the source plan's client details, then is edited fully
// independently from there (no live sync between siblings — see
// schema.prisma's Plan.pitchGroupId comment for why). Since 23 Sep ("on
// adding new plan, only budget and page selection will be filled again,
// everything else like client details etc will be same") the budget, pages
// and the page-derived Step 3 overrides start empty; client details, brief
// and GST % carry over. Both rows end up sharing pitchGroupId, which is all
// that ties them together (and what makes them share one client / one
// internal sheet — see generatePlanSheet); the source plan gets one
// backfilled here if it doesn't already have one.
const VARIANT_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"];

export async function createPlanVariant(planId, requester, { variantLabel, budget, items } = {}) {
  const source = await prisma.plan.findUnique({ where: { id: planId }, include: PLAN_INCLUDE });
  if (!source) throw new ApiError(404, "PLAN_NOT_FOUND", "Plan not found");
  await assertCanAccessPlan(requester, source);
  // Budget and pages may come with the request (7 Oct: the variant is filled in
  // the plan form, then saved in one go) — same cost resolution and budget
  // check as createPlan, done before the transaction so a refusal writes nothing.
  const resolvedItems = items?.length ? await resolveItemCosts(items) : [];
  assertWithinBudget(budget, resolvedItems);

  const pitchGroupId = source.pitchGroupId ?? source.id;

  // Count-then-create, made atomic via a serializable transaction (code
  // review, 10 Sep) — a plain read+write here would let two concurrent
  // "Add Plan B" calls both see the same sibling count and create two
  // variants with an identical label. Serializable makes Postgres abort
  // the loser with a retryable error instead of letting it through with
  // stale data; the client already disables the button while its own
  // request is pending (see plan-wizard.tsx's PreviewStep), which covers
  // the realistic single-user double-click — this closes the rarer
  // cross-tab/cross-request race too, without a full retry loop.
  const variant = await prisma.$transaction(
    async (tx) => {
      if (!source.pitchGroupId) {
        await tx.plan.update({ where: { id: source.id }, data: { pitchGroupId } });
      }
      const siblingCount = await tx.plan.count({ where: { pitchGroupId } });
      const label = variantLabel ?? `Plan ${VARIANT_LETTERS[siblingCount] ?? siblingCount + 1}`;

      return tx.plan.create({
        data: {
          name: source.name,
          clientName: source.clientName,
          clientContact: source.clientContact,
          clientCompany: source.clientCompany,
          clientGstNumber: source.clientGstNumber,
          clientAddress: source.clientAddress,
          notes: source.notes,
          gstPercent: source.gstPercent,
          sheetFormat: source.sheetFormat,
          ...(budget !== undefined ? { budget } : {}),
          pitchGroupId,
          variantLabel: label,
          createdById: requester.id,
          ...(resolvedItems.length ? { items: { create: resolvedItems } } : {}),
        },
        include: PLAN_INCLUDE,
      });
    },
    { isolationLevel: "Serializable" }
  );
  return annotatePlan(variant);
}

// Every plan sharing a pitchGroupId — the "combined PDF" download's source
// list, and the wizard's tab strip once a Plan B exists. Ordered by
// creation so Plan A always renders/lists before Plan B.
export async function listPlanGroup(pitchGroupId, requester) {
  const plans = await prisma.plan.findMany({ where: { pitchGroupId }, include: PLAN_INCLUDE, orderBy: { createdAt: "asc" } });
  if (plans.length === 0) throw new ApiError(404, "PLAN_NOT_FOUND", "Plan group not found");
  for (const plan of plans) await assertCanAccessPlan(requester, plan);
  return Promise.all(plans.map(annotatePlan));
}

/**
 * "Attach a Google Sheet of pages" (user request, 10 Sep) at the
 * page-selection step. Reuses campaigns/service.js's own sheet-fetch
 * helper for the URL→CSV leg rather than duplicating it — plans and
 * campaigns both just need "turn a pasted Google Sheet link into CSV text",
 * nothing module-specific about that part.
 *
 * Unlike campaigns' assignment sheet (which only ever matches existing
 * pages, leaving the rest "pending" for an admin to resolve later), a row
 * here whose handle isn't already in Inventory gets a brand-new Asset
 * created for it directly (approvalStatus "pending", owned by whoever's
 * building this plan) — decided via AskUserQuestion this session. A new
 * page has no rate card yet, so `cost` is required for such a row; one
 * without it is reported back as a failure rather than silently dropped or
 * guessed at (same partial-success shape createCampaign's own row loop
 * uses — one bad row doesn't fail the rest).
 */
export async function importPlanSheetPages(planId, requester, rows) {
  const plan = await prisma.plan.findUnique({ where: { id: planId } });
  if (!plan) throw new ApiError(404, "PLAN_NOT_FOUND", "Plan not found");
  await assertCanAccessPlan(requester, plan);

  const handles = [...new Set(rows.map((r) => r.handle.trim().replace(/^@+/, "").toLowerCase()))];
  const existingAssets = await prisma.asset.findMany({ where: { handle: { in: handles, mode: "insensitive" } }, include: { rateCards: true } });
  const assetByHandle = new Map(existingAssets.map((a) => [a.handle.toLowerCase(), a]));
  const onPlan = new Set((await prisma.planItem.findMany({ where: { planId }, select: { assetId: true } })).map((i) => i.assetId));

  let matchedCount = 0;
  let createdCount = 0;
  const failures = [];
  const newItems = [];

  for (const row of rows) {
    const cleanHandle = row.handle.trim().replace(/^@+/, "");
    let asset = assetByHandle.get(cleanHandle.toLowerCase());

    if (asset && asset.isActive === false && !onPlan.has(asset.id)) {
      failures.push({ handle: cleanHandle, reason: "This page is inactive and can't be added to a plan." });
      continue;
    }
    if (asset) {
      matchedCount += 1;
    } else {
      if (row.cost == null) {
        failures.push({ handle: cleanHandle, reason: "New page — a cost is required since it has no rate card yet." });
        continue;
      }
      asset = await prisma.asset.create({
        data: { ownerId: requester.id, platform: "instagram", handle: cleanHandle, followers: row.followers ?? 0, category: row.category, approvalStatus: "pending" },
        include: { rateCards: true },
      });
      assetByHandle.set(cleanHandle.toLowerCase(), asset);
      createdCount += 1;
    }

    const format = row.format ?? asset.rateCards[0]?.format ?? "reel";
    const rateCard = asset.rateCards.find((rc) => rc.format === format);
    const cost = row.cost ?? (rateCard ? Number(rateCard.amount) : null);
    if (cost == null) {
      failures.push({ handle: cleanHandle, reason: `No rate card set for format "${format}" and no cost given in the sheet.` });
      continue;
    }
    newItems.push({ assetId: asset.id, format, cost, postsPerProfile: row.postsPerProfile ?? 1 });
  }

  if (newItems.length > 0) {
    await prisma.planItem.createMany({ data: newItems.map((i) => ({ ...i, planId })) });
  }

  return { matchedCount, createdCount, addedCount: newItems.length, failures, plan: await getPlan(planId, requester) };
}

// ── "Upload plan" from a Google Sheet (user request, 22 Sep) ──────────────
// "plan maker can upload their own made excel sheet plan, it'll be showed in
// their plans, anything missing in excel sheet according to our plan
// (database) will be shown as missing ... and refresh button of fetching
// updated sheet". The client fetches + parses the sheet (same
// /import-sheet-url leg the wizard uses) and posts the plan-level fields it
// found plus the page rows; this side turns them into a real Plan.
//
// Two rules, both decided with the user:
//  - The sheet wins on Refresh — but only for cells that HAVE a value. A
//    blank cell keeps whatever was typed in the app, so the missing fields
//    someone filled in here survive a refresh of a sheet that still lacks
//    them (the edge case named in the request).
//  - Nothing is created behind the user's back: a handle not in Inventory,
//    or a page with no cost, doesn't become an item — it's kept as a
//    "pending" row on the plan and shown as missing, with a one-click
//    Add to inventory (addPendingPage) that resolves it.

const cleanHandle = (h) => String(h ?? "").trim().replace(/^@+/, "");

/**
 * Matches sheet rows to Inventory. Matched rows with a resolvable cost
 * become items; the rest come back as pending entries with a reason. Same
 * handle-matching / cost-resolution rules as importPlanSheetPages above,
 * minus the create-a-page branch.
 */
async function resolveSheetRows(rows, alreadyOn = new Set()) {
  const handles = [...new Set(rows.map((r) => cleanHandle(r.handle).toLowerCase()))].filter(Boolean);
  const assets = handles.length ? await prisma.asset.findMany({ where: { handle: { in: handles, mode: "insensitive" } }, include: { rateCards: true } }) : [];
  const assetByHandle = new Map(assets.map((a) => [a.handle.toLowerCase(), a]));
  const items = [];
  const pending = [];
  for (const row of rows) {
    const handle = cleanHandle(row.handle);
    if (!handle) continue;
    const base = { kind: "page", handle, pageUrl: row.pageUrl ?? null, category: row.category ?? null, followers: row.followers ?? null, format: row.format ?? null, cost: row.cost ?? null, clientCost: row.clientCost ?? null, postsPerProfile: row.postsPerProfile ?? 1 };
    const asset = assetByHandle.get(handle.toLowerCase());
    if (!asset) {
      pending.push({ ...base, reason: "Not in Inventory yet." });
      continue;
    }
    if (asset.isActive === false && !alreadyOn.has(asset.id)) {
      pending.push({ ...base, reason: "This page is inactive and can't be added to a plan." });
      continue;
    }
    const format = row.format ?? asset.rateCards[0]?.format ?? "reel";
    const rateCard = asset.rateCards.find((rc) => rc.format === format);
    const cost = row.cost ?? (rateCard ? Number(rateCard.amount) : null);
    if (cost == null) {
      pending.push({ ...base, format, reason: `No cost in the sheet and no ${format} rate card on this page.` });
      continue;
    }
    items.push({ assetId: asset.id, format, cost, clientCost: row.clientCost ?? null, postsPerProfile: row.postsPerProfile ?? 1 });
  }
  return { items, pending };
}

/**
 * Writes a parsed sheet onto a plan: non-blank fields overwrite, items are
 * rebuilt from the rows, pending rows + fetchedAt are stored. A budget the
 * pages exceed isn't stored (every later save with items would then fail
 * assertWithinBudget) — it's reported as a pending "budget" entry instead,
 * and the step that asks for the budget knows the floor.
 */
async function applySheetToPlan(existing, { fields, rows }) {
  const planId = existing.id;
  const data = {};
  for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== null && v !== "") data[k] = v;

  // A sheet with no page table at all is a blank cell writ large — the
  // plan's pages stay as they are. A sheet WITH pages replaces them (the
  // sheet wins), including any added in the wizard since the upload.
  const hasPageTable = rows.length > 0;
  const onPlan = hasPageTable ? new Set((await prisma.planItem.findMany({ where: { planId }, select: { assetId: true } })).map((i) => i.assetId)) : new Set();
  const { items, pending } = hasPageTable ? await resolveSheetRows(rows, onPlan) : { items: null, pending: [] };
  const effectiveItems = items ?? (await prisma.planItem.findMany({ where: { planId } }));
  const subtotal = clientSubtotalOf(effectiveItems);

  // The budget the plan would end up with — the sheet's, else the one typed
  // in the app. If the pages exceed it, it's cleared and asked for again
  // (pending "budget", with the floor) rather than stored: assertWithinBudget
  // would otherwise fail every later save with items.
  const budget = data.budget ?? (existing.budget != null ? Number(existing.budget) : null);
  if (budget != null && subtotal > budget) {
    pending.push({ kind: "budget", sheetBudget: budget, reason: `${data.budget != null ? "The sheet's budget" : "The budget"} ₹${budget.toLocaleString("en-IN")} is below what the pages come to (₹${subtotal.toLocaleString("en-IN")}).` });
    data.budget = null;
  }

  if (items) await prisma.planItem.deleteMany({ where: { planId } });
  const plan = await prisma.plan.update({
    where: { id: planId },
    data: { ...data, ...(items ? { items: { create: items } } : {}), sourceSheetPending: pending, sourceSheetFetchedAt: new Date() },
    include: PLAN_INCLUDE,
  });
  return annotatePlan(plan);
}

export async function createPlanFromSheet(requester, { sourceSheetUrl, fields, rows }) {
  const created = await prisma.plan.create({
    data: { name: fields.name, clientName: fields.clientName, createdById: requester.id, sourceSheetUrl },
  });
  return applySheetToPlan(created, { fields, rows });
}

export async function syncPlanFromSheet(planId, requester, body) {
  const plan = await prisma.plan.findUnique({ where: { id: planId } });
  if (!plan) throw new ApiError(404, "PLAN_NOT_FOUND", "Plan not found");
  await assertCanAccessPlan(requester, plan);
  if (!plan.sourceSheetUrl) throw new ApiError(409, "PLAN_NOT_FROM_SHEET", "This plan wasn't uploaded from a sheet — there's nothing to refresh");
  if (plan.status !== "DRAFT") throw new ApiError(409, "PLAN_NOT_DRAFT", "Only a draft plan can be refreshed from its sheet");
  return applySheetToPlan(plan, body);
}

/**
 * One-click "Add to inventory" for a pending sheet row: registers the page
 * (assets/service.js createAsset — its owner/clash/approval rules apply; an
 * Admin may pick the owner, anyone else gets it under their own account)
 * and turns the row into a plan item. A pending row with no cost can't
 * become an item even once the page exists — it stays pending with that
 * reason until the sheet gives it a cost.
 */
export async function addPendingPage(planId, requester, { handle, ownerId }) {
  const plan = await prisma.plan.findUnique({ where: { id: planId } });
  if (!plan) throw new ApiError(404, "PLAN_NOT_FOUND", "Plan not found");
  await assertCanAccessPlan(requester, plan);
  const pending = Array.isArray(plan.sourceSheetPending) ? plan.sourceSheetPending : [];
  const key = cleanHandle(handle).toLowerCase();
  const row = pending.find((p) => p.kind === "page" && cleanHandle(p.handle).toLowerCase() === key);
  if (!row) throw new ApiError(404, "PENDING_PAGE_NOT_FOUND", `@${cleanHandle(handle)} isn't waiting to be added on this plan`);
  if (row.cost == null) throw new ApiError(400, "PENDING_PAGE_NO_COST", `@${row.handle} has no cost in the sheet — add one there and refresh first`);
  // Same cap every other way of adding a page respects (PLAN_OVER_BUDGET).
  const currentItems = await prisma.planItem.findMany({ where: { planId } });
  assertWithinBudget(plan.budget, [...currentItems, { cost: row.cost, clientCost: row.clientCost ?? null, postsPerProfile: row.postsPerProfile ?? 1 }]);

  const format = row.format ?? "reel";
  let asset;
  try {
    asset = await createAsset(requester, {
      platform: "instagram",
      handle: cleanHandle(row.handle),
      category: row.category ?? undefined,
      ownerId,
      followers: row.followers ?? undefined,
      rateCards: requester.role === "ADMIN" ? [{ format, amount: row.cost }] : undefined,
    });
  } catch (err) {
    // Registered under someone else since the sheet was read — still a real
    // page, so the item can be added against it.
    if (!(err instanceof ApiError && err.code === "ASSET_ALREADY_EXISTS")) throw err;
    asset = await prisma.asset.findFirst({ where: { platform: "instagram", handle: { equals: cleanHandle(row.handle), mode: "insensitive" } } });
    if (!asset) throw err;
  }
  if (asset.isActive === false) throw inactiveError(asset);

  await prisma.planItem.create({ data: { planId, assetId: asset.id, format, cost: row.cost, clientCost: row.clientCost ?? null, postsPerProfile: row.postsPerProfile ?? 1 } });
  const updated = await prisma.plan.update({
    where: { id: planId },
    data: { sourceSheetPending: pending.filter((p) => p !== row) },
    include: PLAN_INCLUDE,
  });
  return annotatePlan(updated);
}

/** Pulls the spreadsheetId back out of a previously generated sheet URL,
 *  so regenerating a plan's sheet reuses the same file (idempotent, like
 *  the old shared-spreadsheet version) instead of creating a fresh one
 *  every time "Regenerate" is clicked. */
function spreadsheetIdFromUrl(url) {
  const match = /\/spreadsheets\/d\/([^/]+)/.exec(url ?? "");
  return match?.[1] ?? null;
}

/** Shared by generatePlanSheet/getExecutionSheetTemplate — the OAuth
 *  access token for the connected Google account, or a friendly error
 *  pointing at the one-time connect flow if no admin has completed it. */
async function requireGoogleAccessToken() {
  if (!isGoogleOAuthConfigured()) {
    throw new ApiError(
      503,
      "SHEETS_NOT_CONFIGURED",
      "Google Sheets export isn't configured yet: set GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, and GOOGLE_OAUTH_REDIRECT_URI (see server/.env.example)."
    );
  }
  const accessToken = await getUserAccessToken();
  if (!accessToken) {
    throw new ApiError(
      503,
      "GOOGLE_NOT_CONNECTED",
      "No Google account is connected yet — an admin needs to visit /api/integrations/google/authorize once to connect one."
    );
  }
  return accessToken;
}

/**
 * The plan's deliverable (user request, 10 Sep — "plan will be of google
 * sheet, not in pdf, it'll generate google sheet and will provide link";
 * later, 10 Sep — "1 spreadsheet generation per plan, not just write
 * access, and also public view access of sheet to anyone"). Creates (or
 * reuses, on regenerate) ONE spreadsheet owned by the connected Google
 * account, writes a pair of tabs into it ("Overview of ..." + the page
 * list), and shares it "Anyone with the link → Viewer" so the link is
 * actually usable by a client with no separate access grant. The returned
 * link deep-links straight to the Overview tab
 * (`.../edit?gid=<id>#gid=<id>`, the same shape as the reference sheet's
 * own links) rather than just the spreadsheet root.
 *
 * Built from forClientPdf()'s output, same as the (now-secondary) PDF path
 * — the real internal cost never has a field to leak through here either.
 */
// { internal: true } (user request, 10 Sep — "list of plans ... option of
// viewing googlesheet of plan for client or internal") writes the OTHER
// tab pair instead into a SEPARATE spreadsheet from the client one: the
// full annotated plan (real cost, real computed numbers, ignoring any
// Step 3 override), cached onto `internalSheetUrl` instead of
// `clientSheetUrl` — never made public (see routes.js: only the client
// variant is ever offered for public sharing).
/**
 * Plans in a pitch group (Plan A, B, C… — user request, 23 Sep: "in client
 * sheet and internal sheet, there will be tabs of plan A, Plan B ... 2-2
 * tabs will increase") share one client and one internal spreadsheet, with
 * an Overview + Pages tab pair per plan. Generating from any plan rewrites
 * every sibling's tabs (so the sheet never shows a stale Plan A next to a
 * fresh Plan B) and points every sibling's cached link at its own Overview
 * tab. A plan with no siblings is a group of one. Siblings the requester
 * can't open are left out rather than leaked into their sheet.
 */
async function sheetGroup(plan, requester) {
  if (!plan.pitchGroupId) return [plan];
  const siblings = await prisma.plan.findMany({ where: { pitchGroupId: plan.pitchGroupId }, include: PLAN_INCLUDE, orderBy: { createdAt: "asc" } });
  const visible = [];
  for (const sibling of siblings) {
    if (sibling.id === plan.id) {
      visible.push(plan);
      continue;
    }
    try {
      await assertCanAccessPlan(requester, sibling);
      visible.push(await annotatePlan(sibling));
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
    }
  }
  return visible;
}

export async function generatePlanSheet(planId, requester, { internal = false } = {}) {
  const accessToken = await requireGoogleAccessToken();

  const plan = await getPlan(planId, requester);
  const group = await sheetGroup(plan, requester);
  const urlKey = internal ? "internalSheetUrl" : "clientSheetUrl";
  const sheets = group.map((p) => ({ plan: p, ...buildPlanSheetTabs(internal ? p : forClientPdf(p), { internal }) }));
  const titles = sheets.flatMap((t) => [t.overviewTitle, ...t.pageTabs.map((tab) => tab.title)]);

  let spreadsheetId = spreadsheetIdFromUrl(plan[urlKey]) ?? group.map((p) => spreadsheetIdFromUrl(p[urlKey])).find(Boolean) ?? null;
  if (!spreadsheetId) {
    // No variant label in the file name — the file may hold Plan A, B, C….
    const created = await createSpreadsheet({ accessToken, title: `${plan.name} — ${internal ? "Internal" : "Client"} (Taggify)` });
    spreadsheetId = created.spreadsheetId;
    await ensureSheetTabsExist({ accessToken, spreadsheetId, titles });
    // Drop the blank default "Sheet1" tab now that the real tabs exist.
    await deleteSheetTab({ accessToken, spreadsheetId, sheetId: created.defaultSheetId });
    // Public view access (user request, 10 Sep — "public view access of
    // sheet to anyone") only needs setting once, at creation — it's a
    // property of the file, not something a rewrite could ever revoke.
    if (!internal) await makeFilePublicViewable({ accessToken, fileId: spreadsheetId });
  } else {
    // Rename this group's existing tabs to their current titles first (plan
    // renamed, or its status flipped Active ↔ Not active, 29 Sep) — otherwise
    // the new titles would be created alongside the old tabs, and the client's
    // sheet would keep the stale pair forever.
    const existingTabs = await getExistingSheetTabs({ accessToken, spreadsheetId });
    await batchUpdateSpreadsheet({ accessToken, spreadsheetId, requests: reconcilePlanTabRequests(existingTabs, sheets, { internal }) });
    await ensureSheetTabsExist({ accessToken, spreadsheetId, titles });
  }

  // sheetId (gid) per tab, fetched once — the formatting requests address a
  // tab by numeric sheetId, not title, and the deep-links need it too.
  const gids = await getSheetTabIds({ accessToken, spreadsheetId, titles });

  // RAW (the default): links are plain URL text (22 Sep), so a handle or
  // URL can never be re-read by Sheets as a formula or number.
  for (const t of sheets) {
    await writeSheetTab({ accessToken, spreadsheetId, title: t.overviewTitle, rows: t.overviewRows });
    for (const tab of t.pageTabs) await writeSheetTab({ accessToken, spreadsheetId, title: tab.title, rows: tab.rows });
  }

  // Styling (user request, 10 Sep — "google sheet format should be like
  // this, same styling") — header bands, merged title cells, bordered table.
  await batchUpdateSpreadsheet({
    accessToken,
    spreadsheetId,
    requests: sheets.flatMap((t) => [
      ...(gids[t.overviewTitle] != null ? [...buildFormatRequests(gids[t.overviewTitle], t.overviewRowSpecs, t.overviewNumCols), ...tabStatusRequests(gids[t.overviewTitle], t.plan)] : []),
      ...t.pageTabs.flatMap((tab) => (gids[tab.title] != null ? [...buildFormatRequests(gids[tab.title], tab.rowSpecs, tab.numCols), ...tabStatusRequests(gids[tab.title], t.plan)] : [])),
    ]),
  });

  // Edit access for whoever generated it (8 Oct). Never fails the generation:
  // the sheet is already written, so a sharing problem is reported back instead.
  const shared = await shareWithGenerator(accessToken, spreadsheetId, requester);

  const base = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
  let spreadsheetUrl = base;
  for (const t of sheets) {
    const gid = gids[t.overviewTitle];
    const url = gid != null ? `${base}?gid=${gid}#gid=${gid}` : base;
    if (t.plan.id === plan.id) spreadsheetUrl = url;
    await prisma.plan.update({ where: { id: t.plan.id }, data: { [urlKey]: url } });
  }
  return { spreadsheetUrl, ...shared };
}

/** Shares a generated sheet with the requester's email as an editor: `{ sharedWith }` or `{ shareError }`. */
async function shareWithGenerator(accessToken, spreadsheetId, requester) {
  const user = await prisma.user.findUnique({ where: { id: requester.id }, select: { email: true } });
  if (!user?.email) return { shareError: "Your account has no email, so the sheet couldn't be shared with you for editing." };
  try {
    await shareFileWithEditor({ accessToken, fileId: spreadsheetId, email: user.email });
    return { sharedWith: user.email };
  } catch (err) {
    console.error(`generatePlanSheet: couldn't give ${user.email} edit access to ${spreadsheetId}`, err);
    return { shareError: `The sheet was made, but ${user.email} couldn't be given edit access (it may not be a Google account).` };
  }
}

const EXECUTION_TEMPLATE_SETTING_KEY = "executionTemplateSpreadsheetId";

/**
 * The downloadable sample execution sheet (user request, 10 Sep — "give
 * downloadable sample template for google sheet so they'll know how their
 * execution should look like"). One static reference document, not
 * per-plan — created once under the connected Google account (cached in
 * `AppSetting` so a second request reuses the same file instead of
 * spawning a new one) and made publicly viewable, same as a plan's client
 * sheet. Idempotent beyond creation too: re-calling just overwrites the
 * one tab in place.
 */
export async function getExecutionSheetTemplate() {
  const accessToken = await requireGoogleAccessToken();

  const { title, rows, rowSpecs, numCols } = buildExecutionSheetTemplate();
  const setting = await prisma.appSetting.findUnique({ where: { key: EXECUTION_TEMPLATE_SETTING_KEY } });
  let spreadsheetId = setting?.value ?? null;
  if (!spreadsheetId) {
    const created = await createSpreadsheet({ accessToken, title: "Taggify — Sample Execution Sheet Template" });
    spreadsheetId = created.spreadsheetId;
    await ensureSheetTabsExist({ accessToken, spreadsheetId, titles: [title] });
    await deleteSheetTab({ accessToken, spreadsheetId, sheetId: created.defaultSheetId });
    await makeFilePublicViewable({ accessToken, fileId: spreadsheetId });
    await prisma.appSetting.upsert({
      where: { key: EXECUTION_TEMPLATE_SETTING_KEY },
      create: { key: EXECUTION_TEMPLATE_SETTING_KEY, value: spreadsheetId },
      update: { value: spreadsheetId },
    });
  } else {
    await ensureSheetTabsExist({ accessToken, spreadsheetId, titles: [title] });
  }
  const gids = await getSheetTabIds({ accessToken, spreadsheetId, titles: [title] });

  await writeSheetTab({ accessToken, spreadsheetId, title, rows });
  await batchUpdateSpreadsheet({ accessToken, spreadsheetId, requests: gids[title] != null ? buildFormatRequests(gids[title], rowSpecs, numCols) : [] });

  const gid = gids[title];
  return { spreadsheetUrl: gid != null ? `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit?gid=${gid}#gid=${gid}` : `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit` };
}

// The in-app "Preview template" table (user request, 11 Sep — show what
// the execution sheet should look like, in preview, before pasting one
// in) — no Google account/OAuth needed, unlike getExecutionSheetTemplate
// above, so this is always available even when Google isn't connected.
export const getExecutionSheetTemplatePreview = previewExecutionSheetTemplate;
