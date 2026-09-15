import { Router } from "express";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireAccess } from "../../middleware/requireAccess.js";
import { validateBody } from "../../middleware/validate.js";
import { createBillingProfileSchema, approvalSchema } from "./schemas.js";
import * as billingService from "./service.js";

const router = Router();
router.use(requireAuth);

// Admin/Finance see every profile (to review + approve); everyone else sees only their own.
router.get("/", async (req, res, next) => {
  try {
    const isReviewer = ["ADMIN", "FINANCE"].includes(req.user.role);
    res.json(isReviewer ? await billingService.listAll() : await billingService.listOwn(req.user.id));
  } catch (err) {
    next(err);
  }
});

router.post("/", validateBody(createBillingProfileSchema), async (req, res, next) => {
  try {
    res.status(201).json(await billingService.create(req.user.id, req.body));
  } catch (err) {
    next(err);
  }
});

router.put("/:id/approval", requireAccess("finance.manage", "FINANCE"), validateBody(approvalSchema), async (req, res, next) => {
  try {
    res.json(await billingService.setApproval(req.params.id, req.body.approvalStatus));
  } catch (err) {
    next(err);
  }
});

export default router;
