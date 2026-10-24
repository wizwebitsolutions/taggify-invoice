import { Router } from "express";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireRole } from "../../middleware/requireRole.js";
import { requireAccess } from "../../middleware/requireAccess.js";
import { validateBody, validateQuery } from "../../middleware/validate.js";
import { requireOwnAccess } from "../../middleware/requireOwnAccess.js";
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
import { getPostThumbnailSource } from "./thumbnail.js";

const router = Router();

// Public (registered before requireAuth, so it's exempt) — an <img> tag can't
// send our Authorization header, and a post's cover is already public on
// Instagram; the link id alone is enough to serve it. Mirrors
// GET /assets/:id/profile-pic, including the Cross-Origin-Resource-Policy
// override (helmet's same-origin default silently blocks cross-origin <img>).
router.get("/:id/thumbnail", async (req, res, next) => {
  try {
    const source = await getPostThumbnailSource(req.params.id);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    if (source.redirect) return res.redirect(302, source.redirect);
    res.setHeader("Content-Type", source.contentType);
    res.send(source.buffer);
  } catch (err) {
    if (err?.statusCode === 404) res.setHeader("Cache-Control", "public, max-age=600");
    next(err);
  }
});

router.use(requireAuth);

router.post("/", requireOwnAccess("links.edit"), requireRole("CREATOR", "TEAM_MEMBER"), validateBody(createLinkSchema), async (req, res, next) => {
  try {
    res.status(201).json(await linksService.createLink(req.user, req.body));
  } catch (err) {
    next(err);
  }
});

router.post("/bulk", requireOwnAccess("links.edit"), requireRole("CREATOR", "TEAM_MEMBER"), validateBody(bulkCreateLinkSchema), async (req, res, next) => {
  try {
    res.status(201).json(await linksService.bulkCreateLink(req.user, req.body));
  } catch (err) {
    next(err);
  }
});

router.post("/bulk-import", requireAccess("links.edit"), validateBody(bulkImportLinksSchema), async (req, res, next) => {
  try {
    res.status(201).json(await linksService.bulkImportLinks(req.user, req.body));
  } catch (err) {
    next(err);
  }
});

router.get("/", requireOwnAccess("links.view"), validateQuery(listLinksQuerySchema), async (req, res, next) => {
  try {
    res.json(await linksService.listLinks(req.user, req.query));
  } catch (err) {
    next(err);
  }
});

router.get("/:id/timeline", requireOwnAccess("links.view"), async (req, res, next) => {
  try {
    res.json(await linksService.getLinkTimeline(req.params.id, req.user));
  } catch (err) {
    next(err);
  }
});

router.post("/:id/review-screenshot", requireAccess("links.approve"), validateBody(reviewScreenshotSchema), async (req, res, next) => {
  try {
    res.json(await linksService.reviewScreenshot(req.params.id, req.user, req.body));
  } catch (err) {
    next(err);
  }
});

router.post("/:id/refresh-metrics", requireAccess("links.edit"), async (req, res, next) => {
  try {
    res.json(await linksService.refreshMetricsNow(req.params.id, req.user));
  } catch (err) {
    next(err);
  }
});

router.post("/:id/approve-insights", requireAccess("links.approve"), async (req, res, next) => {
  try {
    res.json(await linksService.approveInsights(req.params.id, req.user));
  } catch (err) {
    next(err);
  }
});

router.put("/:id/cost", requireAccess("links.edit"), validateBody(reviseCostSchema), async (req, res, next) => {
  try {
    res.json(await linksService.reviseLinkCost(req.params.id, req.user, req.body));
  } catch (err) {
    next(err);
  }
});

// Delete a post (12 Oct): staff with links.edit only — never a creator, who
// has no way to undo it. Refused once it's on an invoice or payout (service).
router.delete("/:id", requireAccess("links.edit"), async (req, res, next) => {
  try {
    res.json(await linksService.deleteLink(req.params.id));
  } catch (err) {
    next(err);
  }
});

router.post("/:id/mark-invalid", requireAccess("links.edit"), validateBody(markInvalidSchema), async (req, res, next) => {
  try {
    res.json(await linksService.markLinkInvalid(req.params.id, req.user, req.body));
  } catch (err) {
    next(err);
  }
});

router.get("/:id/cost-revisions", requireAccess("links.view"), async (req, res, next) => {
  try {
    res.json(await linksService.getLinkCostRevisions(req.params.id));
  } catch (err) {
    next(err);
  }
});

export default router;
