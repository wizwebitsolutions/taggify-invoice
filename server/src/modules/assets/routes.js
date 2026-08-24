import { Router } from "express";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireRole } from "../../middleware/requireRole.js";
import { validateBody } from "../../middleware/validate.js";
import { createAssetSchema, updateRateCardSchema } from "./schemas.js";
import * as assetsService from "./service.js";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res, next) => {
  try {
    res.json(await assetsService.listAssets(req.user));
  } catch (err) {
    next(err);
  }
});

router.post("/", requireRole("CREATOR"), validateBody(createAssetSchema), async (req, res, next) => {
  try {
    res.status(201).json(await assetsService.createAsset(req.user, req.body));
  } catch (err) {
    next(err);
  }
});

router.put("/:id/approval", requireRole("ADMIN"), async (req, res, next) => {
  try {
    res.json(await assetsService.setApprovalStatus(req.params.id, req.body.approvalStatus));
  } catch (err) {
    next(err);
  }
});

router.put(
  "/:id/rate-card",
  requireRole("ADMIN"),
  validateBody(updateRateCardSchema),
  async (req, res, next) => {
    try {
      res.json(await assetsService.updateRateCard(req.params.id, req.body.rateCards));
    } catch (err) {
      next(err);
    }
  }
);

export default router;
