import { Router } from "express";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireAccess } from "../../middleware/requireAccess.js";
import { validateBody } from "../../middleware/validate.js";
import { createPlanSchema, updatePlanSchema, createVariantSchema, importSheetUrlSchema, importSheetPagesSchema, clientInvoiceSchema, confirmPlanInvoiceAttachmentSchema } from "./schemas.js";
import * as plansService from "./service.js";
import { fetchSheetCsv } from "../campaigns/service.js";
import { buildPlanPdf, buildPlanGroupPdf } from "../../lib/planPdf.js";
import { buildClientInvoicePdf } from "../../lib/clientInvoicePdf.js";

const router = Router();
// PLAN_MAKER (newTask.md, 8 Sep) is a bare role here — every handler below
// scopes to "own plans only" for that role via plansService's
// assertCanAccessPlan, unaffected by the overlay. ADMIN (or, since 15 Sep,
// any other role granted plans.manage) goes through the permission check.
router.use(requireAuth, requireAccess("plans.manage", "PLAN_MAKER"));

router.get("/", async (req, res, next) => {
  try {
    res.json(await plansService.listPlans(req.user));
  } catch (err) {
    next(err);
  }
});

router.post("/", validateBody(createPlanSchema), async (req, res, next) => {
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

router.put("/:id", validateBody(updatePlanSchema), async (req, res, next) => {
  try {
    res.json(await plansService.updatePlan(req.params.id, req.user, req.body));
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    await plansService.deletePlan(req.params.id, req.user);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// DRAFT → APPROVED, decided directly by the owner (or Admin) — no
// intermediate submit-for-someone-else step (user request, 11 Sep).
router.post("/:id/approve", async (req, res, next) => {
  try {
    res.json(await plansService.approvePlan(req.params.id, req.user));
  } catch (err) {
    next(err);
  }
});

// DRAFT → REJECTED. Same access rule as approve.
router.post("/:id/reject", async (req, res, next) => {
  try {
    res.json(await plansService.rejectPlan(req.params.id, req.user));
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

// Client invoice (user request, 13 Sep): the popup posts the client
// details here; the plan comes back with clientInvoiceNumber set, then the
// PDF is fetched from the GET below (same auth-header download pattern as
// /invoices/:id/pdf — see client/lib/api-client.ts).
router.post("/:id/client-invoice", validateBody(clientInvoiceSchema), async (req, res, next) => {
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
    res.setHeader("Content-Disposition", `attachment; filename="${invoice.clientInvoiceNumber}.pdf"`);
    res.setHeader("Content-Length", pdf.length);
    res.send(pdf);
  } catch (err) {
    next(err);
  }
});

// Attached invoice PDF (user request, 14 Sep): signed upload key → the
// client uploads to Cloudinary directly → confirm with key + file name.
// Mirrors /invoices/:id/attachment/*.
router.post("/:id/invoice-attachment/upload-url", async (req, res, next) => {
  try {
    res.json(await plansService.requestInvoiceAttachmentUpload(req.params.id, req.user));
  } catch (err) {
    next(err);
  }
});

router.post("/:id/invoice-attachment", validateBody(confirmPlanInvoiceAttachmentSchema), async (req, res, next) => {
  try {
    res.status(201).json(await plansService.confirmInvoiceAttachment(req.params.id, req.user, req.body));
  } catch (err) {
    next(err);
  }
});

router.delete("/:id/invoice-attachment", async (req, res, next) => {
  try {
    await plansService.removeInvoiceAttachment(req.params.id, req.user);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// "Plan B or other plan" (user request, 10 Sep) — a linked sibling that
// starts from this plan's client-details/budget shell + current pages.
router.post("/:id/variant", validateBody(createVariantSchema), async (req, res, next) => {
  try {
    res.status(201).json(await plansService.createPlanVariant(req.params.id, req.user, req.body));
  } catch (err) {
    next(err);
  }
});

// Same pattern as campaigns/routes.js's own /import-sheet-url — paste a
// Google Sheet link, get its CSV text back, parse client-side. Plan Maker
// gets this too (campaigns' equivalent route is ADMIN-only; plans aren't).
router.post("/import-sheet-url", validateBody(importSheetUrlSchema), async (req, res, next) => {
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
router.post("/:id/import-sheet-pages", validateBody(importSheetPagesSchema), async (req, res, next) => {
  try {
    res.json(await plansService.importPlanSheetPages(req.params.id, req.user, req.body.rows));
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
router.post("/:id/sheet", async (req, res, next) => {
  try {
    res.json(await plansService.generatePlanSheet(req.params.id, req.user, { internal: req.query.variant === "internal" }));
  } catch (err) {
    next(err);
  }
});

// The downloadable sample execution sheet (user request, 10 Sep — "give
// downloadable sample template for google sheet so they'll know how their
// execution should look like"). Not scoped to any one plan.
router.post("/execution-sheet-template", async (req, res, next) => {
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
