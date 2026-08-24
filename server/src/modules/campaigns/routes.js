import { Router } from "express";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireRole } from "../../middleware/requireRole.js";
import { validateBody } from "../../middleware/validate.js";
import { createCampaignSchema } from "./schemas.js";
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

export default router;
