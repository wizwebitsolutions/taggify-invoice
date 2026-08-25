import { Router } from "express";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireRole } from "../../middleware/requireRole.js";
import { validateBody, validateQuery } from "../../middleware/validate.js";
import { createLinkSchema, bulkCreateLinkSchema, listLinksQuerySchema, reviewScreenshotSchema } from "./schemas.js";
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

router.post("/:id/review-screenshot", requireRole("ADMIN"), validateBody(reviewScreenshotSchema), async (req, res, next) => {
  try {
    res.json(await linksService.reviewScreenshot(req.params.id, req.user, req.body));
  } catch (err) {
    next(err);
  }
});

router.post("/:id/refresh-metrics", requireRole("ADMIN"), async (req, res, next) => {
  try {
    res.json(await linksService.refreshMetricsNow(req.params.id));
  } catch (err) {
    next(err);
  }
});

router.post("/:id/approve-insights", requireRole("ADMIN"), async (req, res, next) => {
  try {
    res.json(await linksService.approveInsights(req.params.id, req.user));
  } catch (err) {
    next(err);
  }
});

export default router;
