import { Router } from "express";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireAccess } from "../../middleware/requireAccess.js";
import { validateBody } from "../../middleware/validate.js";
import { createPlanSchema, updatePlanSchema, createVariantSchema, importSheetUrlSchema, importSheetPagesSchema, clientInvoiceSchema, confirmPlanInvoiceAttachmentSchema, planFromSheetSchema, planSheetSyncSchema, addPendingPageSchema, generateSheetSchema, checkPagesSchema } from "./schemas.js";
import * as plansService from "./service.js";
import { checkProfiles } from "../assets/service.js";
import { fetchSheetCsv, fetchSheetTabs } from "../campaigns/service.js";
import { buildPlanPdf, buildPlanGroupPdf } from "../../lib/planPdf.js";
import { buildClientInvoicePdf } from "../../lib/clientInvoicePdf.js";
import { getNumbering } from "../../lib/clientInvoiceNumbering.js";
import { COMPANY } from "../../lib/companyDetails.js";

const router = Router();
// PLAN_MAKER (newTask.md, 8 Sep) is a bare role here — every handler below
// scopes to "own plans only" for that role via plansService's
// assertCanAccessPlan, unaffected by the overlay. ADMIN (or, since 15 Sep,
// any other role granted plans.manage) goes through the permission check.
router.use(requireAuth, requireAccess("plans.view", "PLAN_MAKER"));
// Per-action keys (23 Sep): reading needs plans.view (the router gate above),
// every mutation plans.edit, approve/reject plans.approve. PLAN_MAKER is bare
// on all three — plansService scopes them to their own plans.
const canEdit = requireAccess("plans.edit", "PLAN_MAKER");
const canApprove = requireAccess("plans.approve", "PLAN_MAKER");

router.get("/", async (req, res, next) => {
  try {
    res.json(await plansService.listPlans(req.user));
  } catch (err) {
    next(err);
  }
});

// Saved clients for the wizard's Client name field and the "Generate
// invoice" popup's company dropdown. Before /:id so it isn't read as one.
router.get("/clients", async (req, res, next) => {
  try {
    res.json(await plansService.listSavedClients(req.user));
  } catch (err) {
    next(err);
  }
});

// What the "Generate invoice" popup prefills: the counter's next number and
// the company's default HSN/SAC. Registered before /:id so it isn't read as one.
router.get("/client-invoice-numbering", async (req, res, next) => {
  try {
    res.json({ ...(await getNumbering()), defaultHsnSac: COMPANY.sac, companyStateCode: COMPANY.gstin.trim().slice(0, 2) });
  } catch (err) {
    next(err);
  }
});

router.post("/", canEdit, validateBody(createPlanSchema), async (req, res, next) => {
  try {
    res.status(201).json(await plansService.createPlan(req.user, req.body));
  } catch (err) {
    next(err);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    res.json(await plansService.getPlan(req.params.id, req.user));
  } catch (err) {
    next(err);
  }
});

/**
 * After a successful edit, rewrite whatever Google Sheet was already generated
 * for this plan's group (user report, 29 Sep — the shared link kept showing the
 * plan as it was when first generated). Fired after the response and never
 * awaited: refreshGeneratedSheets queues it and swallows (logs) its own errors,
 * so a slow or disconnected Google account can't slow down or fail a save.
 */
function refreshSheetsAfterEdit(req) {
  void plansService.refreshGeneratedSheets(req.params.id, req.user);
}

router.put("/:id", canEdit, validateBody(updatePlanSchema), async (req, res, next) => {
  try {
    res.json(await plansService.updatePlan(req.params.id, req.user, req.body));
    // Swapping the execution-sheet link alone changes nothing the plan sheet shows.
    const onlyExecutionSheet = Object.keys(req.body).every((key) => key === "executionSheetUrl");
    if (!onlyExecutionSheet) refreshSheetsAfterEdit(req);
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", canEdit, async (req, res, next) => {
  try {
    await plansService.deletePlan(req.params.id, req.user);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// DRAFT → APPROVED, decided directly by the owner (or Admin) — no
// intermediate submit-for-someone-else step (user request, 11 Sep).
router.post("/:id/approve", canApprove, async (req, res, next) => {
  try {
    res.json(await plansService.approvePlan(req.params.id, req.user));
    // The sheet shows Active / Not active per plan (29 Sep), so a decision changes it.
    refreshSheetsAfterEdit(req);
  } catch (err) {
    next(err);
  }
});

// DRAFT → REJECTED. Same access rule as approve.
router.post("/:id/reject", canApprove, async (req, res, next) => {
  try {
    res.json(await plansService.rejectPlan(req.params.id, req.user));
    refreshSheetsAfterEdit(req);
  } catch (err) {
    next(err);
  }
});

// ?variant=internal (user request, 10 Sep — "internal plan in which actual
// things will be there") swaps which shape reaches buildPlanPdf: the
// stripped forClientPdf() output by default, or the full annotated plan
// (real cost, real computed numbers, ignoring any Step 3 override) when
// internal is asked for. Same access rule as every other plan route —
// nothing extra to gate since assertCanAccessPlan already ran in getPlan.
router.get("/:id/pdf", async (req, res, next) => {
  try {
    const plan = await plansService.getPlan(req.params.id, req.user);
    const internal = req.query.variant === "internal";
    const pdf = await buildPlanPdf(internal ? plan : plansService.forClientPdf(plan), { internal });
    const suffix = internal ? "-internal" : "";
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${plan.name.replace(/[^a-z0-9]+/gi, "-")}${suffix}.pdf"`);
    res.setHeader("Content-Length", pdf.length);
    res.send(pdf);
  } catch (err) {
    next(err);
  }
});

// Execution sheet → links (user decision, 23 Sep): re-reads the attached
// sheet and attaches every posted link it names. Also runs automatically
// when the link is first saved on an approved plan (see updatePlan).
router.post("/:id/execution-sheet/sync", canEdit, async (req, res, next) => {
  try {
    res.json(await plansService.syncExecutionSheet(req.params.id, req.user));
  } catch (err) {
    next(err);
  }
});

// Client invoice (user request, 13 Sep): the popup posts the client
// details here; the plan comes back with clientInvoiceNumber set, then the
// PDF is fetched from the GET below (same auth-header download pattern as
// /invoices/:id/pdf — see client/lib/api-client.ts).
router.post("/:id/client-invoice", canEdit, validateBody(clientInvoiceSchema), async (req, res, next) => {
  try {
    res.json(await plansService.generateClientInvoice(req.params.id, req.user, req.body));
  } catch (err) {
    next(err);
  }
});

router.get("/:id/client-invoice.pdf", async (req, res, next) => {
  try {
    const invoice = await plansService.getClientInvoice(req.params.id, req.user);
    const pdf = await buildClientInvoicePdf(invoice);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${invoice.clientInvoiceNumber.replace(/[^A-Za-z0-9._-]+/g, "-")}.pdf"`);
    res.setHeader("Content-Length", pdf.length);
    res.send(pdf);
  } catch (err) {
    next(err);
  }
});

// Attached invoice PDF (user request, 14 Sep): signed upload key → the
// client uploads to Cloudinary directly → confirm with key + file name.
// Mirrors /invoices/:id/attachment/*.
router.post("/:id/invoice-attachment/upload-url", canEdit, async (req, res, next) => {
  try {
    res.json(await plansService.requestInvoiceAttachmentUpload(req.params.id, req.user));
  } catch (err) {
    next(err);
  }
});

router.post("/:id/invoice-attachment", canEdit, validateBody(confirmPlanInvoiceAttachmentSchema), async (req, res, next) => {
  try {
    res.status(201).json(await plansService.confirmInvoiceAttachment(req.params.id, req.user, req.body));
  } catch (err) {
    next(err);
  }
});

router.delete("/:id/invoice-attachment", canEdit, async (req, res, next) => {
  try {
    await plansService.removeInvoiceAttachment(req.params.id, req.user);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// "Plan B or other plan" (user request, 10 Sep) — a linked sibling that
// starts from this plan's client-details/budget shell + current pages.
router.post("/:id/variant", canEdit, validateBody(createVariantSchema), async (req, res, next) => {
  try {
    res.status(201).json(await plansService.createPlanVariant(req.params.id, req.user, req.body));
  } catch (err) {
    next(err);
  }
});

// Same pattern as campaigns/routes.js's own /import-sheet-url — paste a
// Google Sheet link, get its CSV text back, parse client-side. Plan Maker
// gets this too (campaigns' equivalent route is ADMIN-only; plans aren't).
// "Upload plan" from a whole-plan sheet (user request, 22 Sep): the client
// fetches the CSV via /import-sheet-url above, parses it, and posts the
// result here to create the plan; /:id/sheet-sync is the card's Refresh
// (same stored link, re-fetched); /:id/sheet-pending/add is the one-click
// Add to inventory for a row the sheet had that Inventory didn't.
router.post("/from-sheet", canEdit, validateBody(planFromSheetSchema), async (req, res, next) => {
  try {
    res.status(201).json(await plansService.createPlanFromSheet(req.user, req.body));
  } catch (err) {
    next(err);
  }
});

router.post("/:id/sheet-sync", canEdit, validateBody(planSheetSyncSchema), async (req, res, next) => {
  try {
    res.json(await plansService.syncPlanFromSheet(req.params.id, req.user, req.body));
    refreshSheetsAfterEdit(req);
  } catch (err) {
    next(err);
  }
});

router.post("/:id/sheet-pending/add", canEdit, validateBody(addPendingPageSchema), async (req, res, next) => {
  try {
    res.json(await plansService.addPendingPage(req.params.id, req.user, req.body));
    refreshSheetsAfterEdit(req);
  } catch (err) {
    next(err);
  }
});

// Every tab of the sheet (the uploaded plan sheet has a Details tab and a
// Pages tab — 22 Sep); the client parses them.
// "Are these pages still up?" (17 Oct) — the plan wizard confirms its picked
// pages on Instagram. Only pages not checked in the last 24h cost an Apify
// call (assets/service.js checkProfiles); a broken page is flagged so the
// wizard can offer a replacement. Anyone who may edit plans may run it.
router.post("/check-pages", canEdit, validateBody(checkPagesSchema), async (req, res, next) => {
  try {
    res.json(await checkProfiles(req.body.assetIds, { force: req.body.force === true }));
  } catch (err) {
    next(err);
  }
});

router.post("/import-sheet-tabs", canEdit, validateBody(importSheetUrlSchema), async (req, res, next) => {
  try {
    res.json({ tabs: await fetchSheetTabs(req.body.url) });
  } catch (err) {
    next(err);
  }
});

router.post("/import-sheet-url", canEdit, validateBody(importSheetUrlSchema), async (req, res, next) => {
  try {
    res.json({ csv: await fetchSheetCsv(req.body.url) });
  } catch (err) {
    next(err);
  }
});

// Attach a sheet of pages to this plan's selection (user request, 10 Sep) —
// takes already-parsed rows (client parses the CSV from the route above,
// same as every other sheet-import flow in this app), matches/creates
// Inventory pages, and appends a PlanItem per resulting page.
router.post("/:id/import-sheet-pages", canEdit, validateBody(importSheetPagesSchema), async (req, res, next) => {
  try {
    res.json(await plansService.importPlanSheetPages(req.params.id, req.user, req.body.rows));
    refreshSheetsAfterEdit(req);
  } catch (err) {
    next(err);
  }
});

// The plan's deliverable (user request, 10 Sep — "plan will be of google
// sheet ... generate google sheet and will provide link"; later, "1
// spreadsheet generation per plan, not just write access, and also public
// view access of sheet to anyone"). ?variant=internal writes the
// real-numbers version into its own separate (never public) spreadsheet
// instead. Returns the link to a brand-new spreadsheet owned by whichever
// Google account completed /integrations/google/authorize.
// Body may carry `sheetFormat` (16 Oct) — picked in the popup that opens on
// "Client sheet"; it's saved on the plan and used for this and later generates.
router.post("/:id/sheet", canEdit, validateBody(generateSheetSchema), async (req, res, next) => {
  try {
    res.json(await plansService.generatePlanSheet(req.params.id, req.user, { internal: req.query.variant === "internal", sheetFormat: req.body?.sheetFormat }));
  } catch (err) {
    next(err);
  }
});

// The downloadable sample execution sheet (user request, 10 Sep — "give
// downloadable sample template for google sheet so they'll know how their
// execution should look like"). Not scoped to any one plan.
router.post("/execution-sheet-template", canEdit, async (req, res, next) => {
  try {
    res.json(await plansService.getExecutionSheetTemplate());
  } catch (err) {
    next(err);
  }
});

// The same sample, as plain data for an in-app preview table (user
// request, 11 Sep — "show in preview" before pasting an execution sheet
// link) — GET + no Google OAuth dependency, unlike the POST above.
router.get("/execution-sheet-template/preview", async (req, res, next) => {
  try {
    res.json(plansService.getExecutionSheetTemplatePreview());
  } catch (err) {
    next(err);
  }
});

// Combined "Plan A + Plan B" download — every plan sharing this group id,
// one PDF, a page break between each. Kept as a secondary export option
// now that the primary deliverable is the Google Sheet above.
router.get("/group/:pitchGroupId/pdf", async (req, res, next) => {
  try {
    const plans = await plansService.listPlanGroup(req.params.pitchGroupId, req.user);
    const internal = req.query.variant === "internal";
    const pdf = await buildPlanGroupPdf(internal ? plans : plans.map(plansService.forClientPdf), { internal });
    const suffix = internal ? "-internal" : "";
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="plan-group${suffix}.pdf"`);
    res.setHeader("Content-Length", pdf.length);
    res.send(pdf);
  } catch (err) {
    next(err);
  }
});

export default router;
