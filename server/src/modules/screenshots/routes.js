import { Router } from "express";
import { requireAuth } from "../../middleware/requireAuth.js";
import { validateBody } from "../../middleware/validate.js";
import { uploadUrlRequestSchema, confirmUploadSchema } from "./schemas.js";
import * as screenshotsService from "./service.js";

const router = Router({ mergeParams: true });
router.use(requireAuth);

router.post("/upload-url", validateBody(uploadUrlRequestSchema), async (req, res, next) => {
  try {
    res.json(await screenshotsService.requestUploadUrl(req.params.linkId, req.body.contentType));
  } catch (err) {
    next(err);
  }
});

router.post("/", validateBody(confirmUploadSchema), async (req, res, next) => {
  try {
    res.status(201).json(await screenshotsService.confirmUpload(req.params.linkId, req.body.r2Key));
  } catch (err) {
    next(err);
  }
});

export default router;
