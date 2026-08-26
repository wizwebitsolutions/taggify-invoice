import { Router } from "express";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireRole } from "../../middleware/requireRole.js";
import { validateBody } from "../../middleware/validate.js";
import { uploadUrlRequestSchema, confirmUploadSchema } from "./schemas.js";
import * as screenshotsService from "./service.js";

const router = Router({ mergeParams: true });
router.use(requireAuth);

// Mirrors the role gate on link creation (CREATOR/TEAM_MEMBER) — previously
// missing here, so any authenticated user of any role could mint an upload
// URL or confirm an upload against an arbitrary linkId, regardless of who
// submitted it. This still doesn't check the link actually belongs to the
// caller (no per-asset ownership check) — flagged separately, not fixed
// here, since that needs a TeamMembership-aware ownership lookup.
router.post(
  "/upload-url",
  requireRole("CREATOR", "TEAM_MEMBER"),
  validateBody(uploadUrlRequestSchema),
  async (req, res, next) => {
    try {
      res.json(await screenshotsService.requestUploadUrl(req.params.linkId));
    } catch (err) {
      next(err);
    }
  }
);

router.post("/", requireRole("CREATOR", "TEAM_MEMBER"), validateBody(confirmUploadSchema), async (req, res, next) => {
  try {
    res.status(201).json(await screenshotsService.confirmUpload(req.params.linkId, req.body.publicId));
  } catch (err) {
    next(err);
  }
});

export default router;
