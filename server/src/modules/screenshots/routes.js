import { Router } from "express";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireRole } from "../../middleware/requireRole.js";
import { validateBody } from "../../middleware/validate.js";
import { requireOwnAccess } from "../../middleware/requireOwnAccess.js";
import { uploadUrlRequestSchema, confirmUploadSchema } from "./schemas.js";
import * as screenshotsService from "./service.js";

const router = Router({ mergeParams: true });
router.use(requireAuth);

// Mirrors the role gate on link creation (CREATOR/TEAM_MEMBER), plus (24 Sep)
// the own-content switch for links and a per-page ownership check in the
// service — only the page's own creator or their team member can upload.
router.post(
  "/upload-url",
  requireOwnAccess("links.edit"), requireRole("CREATOR", "TEAM_MEMBER"),
  validateBody(uploadUrlRequestSchema),
  async (req, res, next) => {
    try {
      res.json(await screenshotsService.requestUploadUrl(req.params.linkId, req.user));
    } catch (err) {
      next(err);
    }
  }
);

router.post("/", requireOwnAccess("links.edit"), requireRole("CREATOR", "TEAM_MEMBER"), validateBody(confirmUploadSchema), async (req, res, next) => {
  try {
    res.status(201).json(await screenshotsService.confirmUpload(req.params.linkId, req.body.publicId, req.user));
  } catch (err) {
    next(err);
  }
});

export default router;
