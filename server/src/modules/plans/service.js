import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../middleware/errorHandler.js";
import { getAvgEngagement } from "../assets/service.js";
import {
  createSpreadsheet,
  deleteSheetTab,
  ensureSheetTabsExist,
  writeSheetTab,
  getSheetTabIds,
  batchUpdateSpreadsheet,
} from "../../lib/googleSheetsClient.js";
import { makeFilePublicViewable } from "../../lib/googleDriveClient.js";
import { getUserAccessToken, isGoogleOAuthConfigured } from "../../lib/googleOAuthClient.js";
import { buildPlanSheetTabs, buildFormatRequests, buildExecutionSheetTemplate, previewExecutionSheetTemplate } from "../../lib/planSheet.js";
import { customAlphabet } from "nanoid";
import { buildPlanInvoiceAttachmentKey, getUploadParams, objectExists, publicUrlFor } from "../../lib/cloudinaryClient.js";

const PLAN_INCLUDE = { items: { include: { asset: true } }, createdBy: { select: { id: true, name: true } }, approvedBy: { select: { id: true, name: true } } };

/**
 * "Inventory" (newTask.md #13) — pitch documents built from a set of pages,
 * exportable as a PDF for a brand client. See schema.prisma's Plan/PlanItem
 * comment for how this differs from Campaign.
 */

// Flat rate, matching invoices/service.js's own GST_RATE exactly (kept as
// a separate constant here rather than imported — plans and invoices are
// independent documents that happen to share a number, not one config
// that should couple the two modules together).
const GST_RATE = 0.18;
// Rounded to paise so float drift can't leave total !== subtotal + gstAmount
// by a fraction (same rounding invoices/service.js uses) — one local helper
// since annotatePlan now needs this twice (real subtotal, display subtotal).
const gstOn = (subtotal, isGstPlan) => (isGstPlan ? Math.round(subtotal * GST_RATE * 100) / 100 : 0);

async function resolveItemCosts(items) {
  if (!items || items.length === 0) return [];
  const assetIds = [...new Set(items.map((i) => i.assetId))];
  const assets = await prisma.asset.findMany({ where: { id: { in: assetIds } }, include: { rateCards: true } });
  const assetById = new Map(assets.map((a) => [a.id, a]));

  return items.map((item) => {
    const asset = assetById.get(item.assetId);
    if (!asset) throw new ApiError(404, "ASSET_NOT_FOUND", `Page ${item.assetId} not found`);
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
// Maker... approves plans he created as well"); Admin can touch any. Not
// scoped as a WHERE clause because 404 (not 403) is what a not-found *or*
// not-yours plan should look like — same not-leaking-existence shape the
// rest of this file's ApiError(404, "PLAN_NOT_FOUND", ...) already uses.
function assertCanAccessPlan(requester, plan) {
  if (requester.role === "ADMIN") return;
  if (plan.createdById !== requester.id) {
    throw new ApiError(404, "PLAN_NOT_FOUND", "Plan not found");
  }
}

export async function updatePlan(planId, requester, { items, ...fields }) {
  const existing = await prisma.plan.findUnique({ where: { id: planId } });
  if (!existing) throw new ApiError(404, "PLAN_NOT_FOUND", "Plan not found");
  assertCanAccessPlan(requester, existing);

  const data = { ...fields };
  const budget = fields.budget !== undefined ? fields.budget : existing.budget;
  if (items) {
    const resolvedItems = await resolveItemCosts(items);
    assertWithinBudget(budget, resolvedItems);
    await prisma.planItem.deleteMany({ where: { planId } });
    data.items = { create: resolvedItems };
  } else if (fields.budget !== undefined) {
    assertWithinBudget(budget, await prisma.planItem.findMany({ where: { planId } }));
  }

  const plan = await prisma.plan.update({
    where: { id: planId },
    data,
    include: PLAN_INCLUDE,
  });
  return annotatePlan(plan);
}

// ADMIN sees every plan; Plan Maker sees only the ones they created — their
// dashboard's "which plan worked, their analysis" (newTask.md, 8 Sep) is
// scoped to their own pitches, not the whole agency's.
export async function listPlans(requester) {
  const where = requester?.role === "ADMIN" ? {} : { createdById: requester.id };
  const plans = await prisma.plan.findMany({
    where,
    include: PLAN_INCLUDE,
    orderBy: { createdAt: "desc" },
  });
  return Promise.all(plans.map(annotatePlan));
}

export async function getPlan(planId, requester) {
  const plan = await prisma.plan.findUnique({
    where: { id: planId },
    include: PLAN_INCLUDE,
  });
  if (!plan) throw new ApiError(404, "PLAN_NOT_FOUND", "Plan not found");
  if (requester) assertCanAccessPlan(requester, plan);
  return annotatePlan(plan);
}

export async function deletePlan(planId, requester) {
  const plan = await prisma.plan.findUnique({ where: { id: planId } });
  if (!plan) throw new ApiError(404, "PLAN_NOT_FOUND", "Plan not found");
  assertCanAccessPlan(requester, plan);
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
  assertCanAccessPlan(requester, plan);
  if (plan.status !== "DRAFT") {
    throw new ApiError(400, "INVALID_PLAN_STATUS", `Only a draft plan can be ${decision === "APPROVED" ? "approved" : "rejected"} (this one is ${plan.status})`);
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
  const phaseCount = Math.max(1, ...plan.items.map((i) => i.postsPerProfile ?? 1));
  for (let phase = 2; phase <= phaseCount; phase++) {
    await tx.campaign.create({
      data: {
        brandName: root.brandName,
        title: `${plan.name} — Phase ${phase}`,
        parentCampaignId: root.id,
        phaseNumber: phase,
        assignments: { create: assignmentsForPhase(phase) },
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
  const gstAmount = gstOn(clientSubtotal, plan.isGstPlan);

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
  const displayGstAmount = gstOn(displaySubtotal, plan.isGstPlan);

  return {
    ...plan,
    invoiceAttachment: invoiceAttachmentFor(plan),
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
    clientName: plan.clientName,
    clientContact: plan.clientContact,
    clientCompany: plan.clientCompany,
    clientGstNumber: plan.clientGstNumber,
    clientAddress: plan.clientAddress,
    notes: plan.notes,
    createdAt: plan.createdAt,
    isGstPlan: plan.isGstPlan,
    overview: plan.overview,
    items: plan.items.map((item) => ({
      format: item.format,
      postsPerProfile: item.postsPerProfile,
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

// Letters + digits only — this number is printed on a client-facing document.
const clientInvoiceSuffix = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 6);
const newClientInvoiceNumber = () => `CINV-${Date.now()}-${clientInvoiceSuffix()}`;
const orNull = (v) => (v && v.trim() ? v.trim() : null);

export async function generateClientInvoice(planId, requester, details) {
  const plan = await prisma.plan.findUnique({ where: { id: planId }, include: PLAN_INCLUDE });
  if (!plan) throw new ApiError(404, "PLAN_NOT_FOUND", "Plan not found");
  assertCanAccessPlan(requester, plan);
  if (plan.status !== "APPROVED") {
    throw new ApiError(409, "PLAN_NOT_APPROVED", "Approve the plan before invoicing the client");
  }
  const clientGstNumber = orNull(details.clientGstNumber);
  if (plan.isGstPlan && !clientGstNumber) {
    throw new ApiError(400, "CLIENT_GST_REQUIRED", "This is a GST plan — the client's GST number is needed on the invoice");
  }
  const annotated = await annotatePlan(plan);
  if (!(annotated.overview.subtotal > 0)) {
    throw new ApiError(409, "PLAN_NOTHING_TO_INVOICE", "This plan has no client-facing cost to invoice");
  }

  const updated = await prisma.plan.update({
    where: { id: planId },
    data: {
      clientCompany: details.clientCompany.trim(),
      clientGstNumber,
      clientAddress: details.clientAddress.trim(),
      clientPhone: orNull(details.clientPhone),
      clientInvoiceNumber: plan.clientInvoiceNumber ?? newClientInvoiceNumber(),
      clientInvoiceAt: new Date(),
    },
    include: PLAN_INCLUDE,
  });
  return annotatePlan(updated);
}

// Attached invoice PDF (user request, 14 Sep — "in plans for admin, plan
// maker side, there'll be option of attaching invoice document in pdf
// format as well"). Same direct-to-Cloudinary two-step as the creator's
// invoice attachment (invoices/service.js): the client asks for a signed
// key, uploads the bytes itself, then confirms; the server only ever holds
// the reference. Anyone who can act on the plan (Admin any, Plan Maker own)
// can attach — same gate as every other write here, no approval required,
// since an invoice raised outside the system may exist before approval.
function invoiceAttachmentFor(plan) {
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
  assertCanAccessPlan(requester, plan);
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
    clientInvoiceNumber: plan.clientInvoiceNumber,
    clientInvoiceAt: plan.clientInvoiceAt,
    itemised: plan.overrideCost == null,
  };
}

// "Plan B or other plan" (user request, 10 Sep) — a linked sibling Plan
// that starts from the source plan's client-details/budget "shell" and its
// current page selection, then is edited fully independently from there
// (no live sync between siblings — see schema.prisma's Plan.pitchGroupId
// comment for why). Both rows end up sharing pitchGroupId, which is all
// that ties them together; the source plan gets one backfilled here if it
// doesn't already have one (the very first "Add Plan B" on a plan).
const VARIANT_LETTERS = ["A", "B", "C", "D", "E", "F"];

export async function createPlanVariant(planId, requester, { variantLabel } = {}) {
  const source = await prisma.plan.findUnique({ where: { id: planId }, include: PLAN_INCLUDE });
  if (!source) throw new ApiError(404, "PLAN_NOT_FOUND", "Plan not found");
  assertCanAccessPlan(requester, source);

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
          budget: source.budget,
          isGstPlan: source.isGstPlan,
          overrideFollowers: source.overrideFollowers,
          overridePosts: source.overridePosts,
          overrideImpressions: source.overrideImpressions,
          overrideCost: source.overrideCost,
          pitchGroupId,
          variantLabel: label,
          createdById: requester.id,
          items: {
            create: source.items.map((item) => ({
              assetId: item.assetId,
              format: item.format,
              cost: item.cost,
              clientCost: item.clientCost,
              postsPerProfile: item.postsPerProfile,
            })),
          },
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
  for (const plan of plans) assertCanAccessPlan(requester, plan);
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
  assertCanAccessPlan(requester, plan);

  const handles = [...new Set(rows.map((r) => r.handle.trim().replace(/^@+/, "").toLowerCase()))];
  const existingAssets = await prisma.asset.findMany({ where: { handle: { in: handles, mode: "insensitive" } }, include: { rateCards: true } });
  const assetByHandle = new Map(existingAssets.map((a) => [a.handle.toLowerCase(), a]));

  let matchedCount = 0;
  let createdCount = 0;
  const failures = [];
  const newItems = [];

  for (const row of rows) {
    const cleanHandle = row.handle.trim().replace(/^@+/, "");
    let asset = assetByHandle.get(cleanHandle.toLowerCase());

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
export async function generatePlanSheet(planId, requester, { internal = false } = {}) {
  const accessToken = await requireGoogleAccessToken();

  const plan = await getPlan(planId, requester);
  const { overviewTitle, overviewRows, overviewRowSpecs, overviewNumCols, pagesTitle, pagesRows, pagesRowSpecs, pagesNumCols } = buildPlanSheetTabs(
    internal ? plan : forClientPdf(plan),
    { internal }
  );

  let spreadsheetId = spreadsheetIdFromUrl(internal ? plan.internalSheetUrl : plan.clientSheetUrl);
  if (!spreadsheetId) {
    const variantLabel = plan.variantLabel ?? "Plan A";
    const title = `${plan.name} — ${variantLabel} — ${internal ? "Internal" : "Client"} (Taggify)`;
    const created = await createSpreadsheet({ accessToken, title });
    spreadsheetId = created.spreadsheetId;
    await ensureSheetTabsExist({ accessToken, spreadsheetId, titles: [overviewTitle, pagesTitle] });
    // Drop the blank default "Sheet1" tab now that the real tabs exist.
    await deleteSheetTab({ accessToken, spreadsheetId, sheetId: created.defaultSheetId });
    // Public view access (user request, 10 Sep — "public view access of
    // sheet to anyone") only needs setting once, at creation — it's a
    // property of the file, not something a rewrite could ever revoke.
    if (!internal) {
      await makeFilePublicViewable({ accessToken, fileId: spreadsheetId });
    }
  } else {
    await ensureSheetTabsExist({ accessToken, spreadsheetId, titles: [overviewTitle, pagesTitle] });
  }

  // sheetId (gid) for each tab, fetched once — needed both for the
  // formatting requests below (which address a tab by numeric sheetId, not
  // title) and for the final deep-link.
  const gids = await getSheetTabIds({ accessToken, spreadsheetId, titles: [overviewTitle, pagesTitle] });

  await writeSheetTab({ accessToken, spreadsheetId, title: overviewTitle, rows: overviewRows });
  // USER_ENTERED so the Page Link column's =HYPERLINK(...) formula
  // actually evaluates into a clickable link (see planSheet.js).
  await writeSheetTab({ accessToken, spreadsheetId, title: pagesTitle, rows: pagesRows, valueInputOption: "USER_ENTERED" });

  // Styling (user request, 10 Sep — "google sheet format should be like
  // this, same styling") — colored header bands, merged title cells, a
  // bordered table, matching the reference sheets' own look, not the
  // plain unstyled values written above.
  await batchUpdateSpreadsheet({
    accessToken,
    spreadsheetId,
    requests: [
      ...(gids[overviewTitle] != null ? buildFormatRequests(gids[overviewTitle], overviewRowSpecs, overviewNumCols) : []),
      ...(gids[pagesTitle] != null ? buildFormatRequests(gids[pagesTitle], pagesRowSpecs, pagesNumCols) : []),
    ],
  });

  const gid = gids[overviewTitle];
  const spreadsheetUrl = gid != null ? `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit?gid=${gid}#gid=${gid}` : `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;

  await prisma.plan.update({ where: { id: planId }, data: internal ? { internalSheetUrl: spreadsheetUrl } : { clientSheetUrl: spreadsheetUrl } });
  return { spreadsheetUrl };
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

  await writeSheetTab({ accessToken, spreadsheetId, title, rows, valueInputOption: "USER_ENTERED" });
  await batchUpdateSpreadsheet({ accessToken, spreadsheetId, requests: gids[title] != null ? buildFormatRequests(gids[title], rowSpecs, numCols) : [] });

  const gid = gids[title];
  return { spreadsheetUrl: gid != null ? `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit?gid=${gid}#gid=${gid}` : `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit` };
}

// The in-app "Preview template" table (user request, 11 Sep — show what
// the execution sheet should look like, in preview, before pasting one
// in) — no Google account/OAuth needed, unlike getExecutionSheetTemplate
// above, so this is always available even when Google isn't connected.
export const getExecutionSheetTemplatePreview = previewExecutionSheetTemplate;
