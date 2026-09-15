import { Router } from "express";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireRole } from "../../middleware/requireRole.js";
import { requireAccess } from "../../middleware/requireAccess.js";
import { validateBody, validateQuery } from "../../middleware/validate.js";
import {
  createLinkSchema,
  bulkCreateLinkSchema,
  bulkImportLinksSchema,
  listLinksQuerySchema,
  reviewScreenshotSchema,
  reviseCostSchema,
  markInvalidSchema,
} from "./schemas.js";
import * as linksService from "./service.js";

const router = Router();
router.use(requireAuth);

router.post("/", requireRole("CREATOR", "TEAM_MEMBER"), validateBody(createLinkSchema), async (req, res, next) => {
  try {
    res.status(201).json(await linksService.createLink(req.user, req.body));
  } catch (err) {
    next(err);
  }
});

router.post("/bulk", requireRole("CREATOR", "TEAM_MEMBER"), validateBody(bulkCreateLinkSchema), async (req, res, next) => {
  try {
    res.status(201).json(await linksService.bulkCreateLink(req.user, req.body));
  } catch (err) {
    next(err);
  }
});

router.post("/bulk-import", requireAccess("links.review"), validateBody(bulkImportLinksSchema), async (req, res, next) => {
  try {
    res.status(201).json(await linksService.bulkImportLinks(req.user, req.body));
  } catch (err) {
    next(err);
  }
});

router.get("/", validateQuery(listLinksQuerySchema), async (req, res, next) => {
  try {
    res.json(await linksService.listLinks(req.user, req.query));
  } catch (err) {
    next(err);
  }
});

router.get("/:id/timeline", async (req, res, next) => {
  try {
    res.json(await linksService.getLinkTimeline(req.params.id));
  } catch (err) {
    next(err);
  }
});

router.post("/:id/review-screenshot", requireAccess("links.review"), validateBody(reviewScreenshotSchema), async (req, res, next) => {
  try {
    res.json(await linksService.reviewScreenshot(req.params.id, req.user, req.body));
  } catch (err) {
    next(err);
  }
});

router.post("/:id/refresh-metrics", requireAccess("links.review"), async (req, res, next) => {
  try {
    res.json(await linksService.refreshMetricsNow(req.params.id, req.user));
  } catch (err) {
    next(err);
  }
});

router.post("/:id/approve-insights", requireAccess("links.review"), async (req, res, next) => {
  try {
    res.json(await linksService.approveInsights(req.params.id, req.user));
  } catch (err) {
    next(err);
  }
});

router.put("/:id/cost", requireAccess("links.review"), validateBody(reviseCostSchema), async (req, res, next) => {
  try {
    res.json(await linksService.reviseLinkCost(req.params.id, req.user, req.body));
  } catch (err) {
    next(err);
  }
});

router.post("/:id/mark-invalid", requireAccess("links.review"), validateBody(markInvalidSchema), async (req, res, next) => {
  try {
    res.json(await linksService.markLinkInvalid(req.params.id, req.user, req.body));
  } catch (err) {
    next(err);
  }
});

router.get("/:id/cost-revisions", requireAccess("links.review"), async (req, res, next) => {
  try {
    res.json(await linksService.getLinkCostRevisions(req.params.id));
  } catch (err) {
    next(err);
  }
});

export default router;
