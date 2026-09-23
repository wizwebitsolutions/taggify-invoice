import { Router } from "express";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireAccess } from "../../middleware/requireAccess.js";
import { validateBody } from "../../middleware/validate.js";
import { createBillingProfileSchema, updateBillingProfileSchema, approvalSchema } from "./schemas.js";
import { loadEffectivePermissions } from "../../lib/effectivePermissions.js";
import * as billingService from "./service.js";

const router = Router();
router.use(requireAuth);

// finance.view sees every profile (bank/PAN details included — to review +
// approve); everyone else sees only their own. Read fresh from the DB, not
// the JWT (23 Sep, Step 3) — this used to be a bare ADMIN/FINANCE role
// check, so restricting a Finance account's finance.view never actually
// hid anyone else's bank details from them.
router.get("/", async (req, res, next) => {
  try {
    const effective = await loadEffectivePermissions(req.user.id);
    res.json(effective["finance.view"] ? await billingService.listAll() : await billingService.listOwn(req.user.id));
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

// Edit details — owner, or Admin / finance.manage for anyone (22 Sep). Who
// may is decided in the service, where the profile's owner is known.
router.put("/:id", validateBody(updateBillingProfileSchema), async (req, res, next) => {
  try {
    res.json(await billingService.update(req.params.id, req.user, req.body));
  } catch (err) {
    next(err);
  }
});

router.put("/:id/approval", requireAccess("finance.pay"), validateBody(approvalSchema), async (req, res, next) => {
  try {
    res.json(await billingService.setApproval(req.params.id, req.body.approvalStatus));
  } catch (err) {
    next(err);
  }
});

export default router;
