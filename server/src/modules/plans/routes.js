import { Router } from "express";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireRole } from "../../middleware/requireRole.js";
import { requirePermission } from "../../middleware/requirePermission.js";
import { validateBody } from "../../middleware/validate.js";
import { createPlanSchema, updatePlanSchema } from "./schemas.js";
import * as plansService from "./service.js";
import { buildPlanPdf } from "../../lib/planPdf.js";

const router = Router();
// PLAN_MAKER (newTask.md, 8 Sep) joins ADMIN here — every handler below
// scopes to "own plans only" for that role via plansService's
// assertCanAccessPlan; requirePermission("plans.manage") only ever matters
// for the ADMIN branch (a sub-admin with that key off), see requirePermission.js.
router.use(requireAuth, requireRole("ADMIN", "PLAN_MAKER"), requirePermission("plans.manage"));

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

// DRAFT → PENDING_APPROVAL (newTask.md, 8 Sep — Plan → Approve step).
router.post("/:id/submit", async (req, res, next) => {
  try {
    res.json(await plansService.submitPlan(req.params.id, req.user));
  } catch (err) {
    next(err);
  }
});

// PENDING_APPROVAL → APPROVED. Admin: any plan. Plan Maker: only their own.
router.post("/:id/approve", async (req, res, next) => {
  try {
    res.json(await plansService.approvePlan(req.params.id, req.user));
  } catch (err) {
    next(err);
  }
});

// PENDING_APPROVAL → REJECTED. Same access rule as approve.
router.post("/:id/reject", async (req, res, next) => {
  try {
    res.json(await plansService.rejectPlan(req.params.id, req.user));
  } catch (err) {
    next(err);
  }
});

router.get("/:id/pdf", async (req, res, next) => {
  try {
    const plan = await plansService.getPlan(req.params.id, req.user);
    // forClientPdf strips the internal cost before this ever reaches
    // PDFKit — see plans/service.js for why that's not just a style choice.
    const pdf = await buildPlanPdf(plansService.forClientPdf(plan));
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${plan.name.replace(/[^a-z0-9]+/gi, "-")}.pdf"`);
    res.setHeader("Content-Length", pdf.length);
    res.send(pdf);
  } catch (err) {
    next(err);
  }
});

export default router;
