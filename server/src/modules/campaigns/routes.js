import { Router } from "express";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireRole } from "../../middleware/requireRole.js";
import { validateBody } from "../../middleware/validate.js";
import { createCampaignSchema, updateCampaignSchema, resolveAssignmentSchema } from "./schemas.js";
import * as campaignsService from "./service.js";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res, next) => {
  try {
    res.json(await campaignsService.listCampaigns({ search: req.query.search }));
  } catch (err) {
    next(err);
  }
});

router.post("/", requireRole("ADMIN"), validateBody(createCampaignSchema), async (req, res, next) => {
  try {
    res.status(201).json(await campaignsService.createCampaign(req.body));
  } catch (err) {
    next(err);
  }
});

router.put("/:id", requireRole("ADMIN"), validateBody(updateCampaignSchema), async (req, res, next) => {
  try {
    res.json(await campaignsService.updateCampaign(req.params.id, req.body));
  } catch (err) {
    next(err);
  }
});

// Rows from an attached sheet (newTask.md #8) — matched + still-pending page/creator assignments.
router.get("/:id/assignments", requireRole("ADMIN"), async (req, res, next) => {
  try {
    res.json(await campaignsService.listAssignments(req.params.id));
  } catch (err) {
    next(err);
  }
});

// Admin points a pending row at a page (one they just created, or an existing one) — newTask.md #11.
router.put(
  "/:id/assignments/:assignmentId",
  requireRole("ADMIN"),
  validateBody(resolveAssignmentSchema),
  async (req, res, next) => {
    try {
      res.json(await campaignsService.resolveAssignment(req.params.id, req.params.assignmentId, req.body.assetId));
    } catch (err) {
      next(err);
    }
  }
);

export default router;
