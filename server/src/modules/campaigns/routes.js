import { Router } from "express";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireAccess } from "../../middleware/requireAccess.js";
import { requirePermission } from "../../middleware/requirePermission.js";
import { validateBody } from "../../middleware/validate.js";
import { createCampaignSchema, updateCampaignSchema, resolveAssignmentSchema, importSheetUrlSchema, createPhaseSchema } from "./schemas.js";
import * as campaignsService from "./service.js";

const router = Router();
router.use(requireAuth);

// req.user scopes what comes back for a Plan Maker (own plans' campaigns
// only — see lib/campaignAccess.js); every other role is unaffected.
router.get("/", async (req, res, next) => {
  try {
    res.json(await campaignsService.listCampaigns({ search: req.query.search }, req.user));
  } catch (err) {
    next(err);
  }
});

// Full campaign detail — bugs.md #7's edit/view page.
router.get("/:id", async (req, res, next) => {
  try {
    res.json(await campaignsService.getCampaignById(req.params.id, req.user));
  } catch (err) {
    next(err);
  }
});

router.post("/", requireAccess("campaigns.edit"), validateBody(createCampaignSchema), async (req, res, next) => {
  try {
    res.status(201).json(await campaignsService.createCampaign(req.body));
  } catch (err) {
    next(err);
  }
});

router.put("/:id", requireAccess("campaigns.edit"), validateBody(updateCampaignSchema), async (req, res, next) => {
  try {
    res.json(await campaignsService.updateCampaign(req.params.id, req.body));
  } catch (err) {
    next(err);
  }
});

// newTask.md, 8 Sep — more posts under the same brand deal become a new
// phase, not a brand-new campaign; :id can be any phase's id, not just the
// root's (see createPhase).
// Plan Maker too (22 Sep — "admin/plan maker can add phase 2"), on their
// own plans' campaigns only (createPhase checks).
router.post("/:id/phases", requireAccess("campaigns.edit", "PLAN_MAKER"), validateBody(createPhaseSchema), async (req, res, next) => {
  try {
    res.status(201).json(await campaignsService.createPhase(req.params.id, req.body, req.user));
  } catch (err) {
    next(err);
  }
});

// Deleting a phase is an admin action (22 Sep); :id is the phase itself.
// Refused for Phase 1 and while posts/invoices exist (see deletePhase).
router.delete("/:id/phase", requireAccess("campaigns.edit"), async (req, res, next) => {
  try {
    res.json(await campaignsService.deletePhase(req.params.id));
  } catch (err) {
    next(err);
  }
});

// Rows from an attached sheet (newTask.md #8) — matched + still-pending
// page/creator assignments. Open to every role, not just ADMIN/FINANCE
// (newTask.md, 8 Sep — "visible to all creators listed in that sheet"):
// listAssignments itself scopes what comes back — full sheet for
// Admin/Finance, only a CREATOR/TEAM_MEMBER's own matched row(s) for
// everyone else, so this never hands a creator another creator's phone
// number. requirePermission("campaigns.view") only ever matters for the
// ADMIN branch (a sub-admin with that key off) — a no-op for every other role.
router.get("/:id/assignments", requirePermission("campaigns.view"), async (req, res, next) => {
  try {
    res.json(await campaignsService.listAssignments(req.params.id, req.user));
  } catch (err) {
    next(err);
  }
});

// Admin points a pending row at a page (one they just created, or an existing one) — newTask.md #11.
router.put(
  "/:id/assignments/:assignmentId",
  requireAccess("campaigns.edit"),
  validateBody(resolveAssignmentSchema),
  async (req, res, next) => {
    try {
      res.json(await campaignsService.resolveAssignment(req.params.id, req.params.assignmentId, req.body.assetId));
    } catch (err) {
      next(err);
    }
  }
);

// bugs.md #6 — admin pastes a Google Sheet link instead of downloading +
// re-uploading a CSV; used by both the New campaign assignment sheet and
// the Import work sheet on the client, which parse the returned CSV text
// exactly as they would a file upload.
router.post("/import-sheet-url", requireAccess("campaigns.edit"), validateBody(importSheetUrlSchema), async (req, res, next) => {
  try {
    const csv = await campaignsService.fetchSheetCsv(req.body.url);
    res.json({ csv });
  } catch (err) {
    next(err);
  }
});

export default router;
