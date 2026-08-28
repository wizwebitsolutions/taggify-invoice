import { Router } from "express";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireRole } from "../../middleware/requireRole.js";
import { validateBody } from "../../middleware/validate.js";
import { createPlanSchema, updatePlanSchema } from "./schemas.js";
import * as plansService from "./service.js";
import { buildPlanPdf } from "../../lib/planPdf.js";

const router = Router();
router.use(requireAuth, requireRole("ADMIN"));

router.get("/", async (req, res, next) => {
  try {
    res.json(await plansService.listPlans());
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
    res.json(await plansService.getPlan(req.params.id));
  } catch (err) {
    next(err);
  }
});

router.put("/:id", validateBody(updatePlanSchema), async (req, res, next) => {
  try {
    res.json(await plansService.updatePlan(req.params.id, req.body));
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    await plansService.deletePlan(req.params.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.get("/:id/pdf", async (req, res, next) => {
  try {
    const plan = await plansService.getPlan(req.params.id);
    const pdf = await buildPlanPdf(plan);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${plan.name.replace(/[^a-z0-9]+/gi, "-")}.pdf"`);
    res.setHeader("Content-Length", pdf.length);
    res.send(pdf);
  } catch (err) {
    next(err);
  }
});

export default router;
