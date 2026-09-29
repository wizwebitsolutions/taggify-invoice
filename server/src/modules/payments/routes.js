import { Router } from "express";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireAccess } from "../../middleware/requireAccess.js";
import { validateBody, validateQuery } from "../../middleware/validate.js";
import { requireOwnAccess } from "../../middleware/requireOwnAccess.js";
import {
  createPayoutSchema,
  confirmPayoutReceiptSchema,
  listPayoutsQuerySchema,
  listPendingLinksQuerySchema,
  listMyPendingQuerySchema,
  listMyPayoutsQuerySchema,
  listPaidQuerySchema,
  listMyPaidQuerySchema,
} from "./schemas.js";
import * as paymentsService from "./service.js";

const router = Router();
router.use(requireAuth);

// Creator's own Payments view (24 Sep redesign) — any signed-in user, but
// the service forces ownerId/creatorId to the caller, so this only ever
// returns links on pages they own and payouts made to them. Registered
// before the finance.pay gate below so it isn't caught by it.
router.get("/me/summary", requireOwnAccess("finance.view"), async (req, res, next) => {
  try {
    res.json(await paymentsService.getMyPaymentSummary(req.user));
  } catch (err) {
    next(err);
  }
});

router.get("/me/pending", requireOwnAccess("finance.view"), validateQuery(listMyPendingQuerySchema), async (req, res, next) => {
  try {
    res.json(await paymentsService.listMyPendingLinks(req.user, req.query));
  } catch (err) {
    next(err);
  }
});

router.get("/me/payouts", requireOwnAccess("finance.view"), validateQuery(listMyPayoutsQuerySchema), async (req, res, next) => {
  try {
    res.json(await paymentsService.listMyPayouts(req.user, req.query));
  } catch (err) {
    next(err);
  }
});

router.get("/me/paid", requireOwnAccess("finance.view"), validateQuery(listMyPaidQuerySchema), async (req, res, next) => {
  try {
    res.json(await paymentsService.listMyPaidLedger(req.user, req.query));
  } catch (err) {
    next(err);
  }
});

// Everything else — the "Payments" tab's admin side (tasks.md #5, 23 Sep) —
// is admin/finance only.
router.use(requireAccess("finance.pay"));

router.get("/summary", async (req, res, next) => {
  try {
    res.json(await paymentsService.getPaymentSummary(req.user));
  } catch (err) {
    next(err);
  }
});

router.get("/pending", validateQuery(listPendingLinksQuerySchema), async (req, res, next) => {
  try {
    res.json(await paymentsService.listPendingLinks(req.user, req.query));
  } catch (err) {
    next(err);
  }
});

router.get("/payouts", validateQuery(listPayoutsQuerySchema), async (req, res, next) => {
  try {
    res.json(await paymentsService.listPayouts(req.user, req.query));
  } catch (err) {
    next(err);
  }
});

router.get("/paid", validateQuery(listPaidQuerySchema), async (req, res, next) => {
  try {
    res.json(await paymentsService.listPaidLedger(req.user, req.query));
  } catch (err) {
    next(err);
  }
});

router.post("/payouts", validateBody(createPayoutSchema), async (req, res, next) => {
  try {
    res.status(201).json(await paymentsService.createPayout(req.user, req.body));
  } catch (err) {
    next(err);
  }
});

router.delete("/payouts/:id", async (req, res, next) => {
  try {
    await paymentsService.cancelPayout(req.params.id, req.user);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.get("/payouts/:id/receipt-upload", async (req, res, next) => {
  try {
    res.json(await paymentsService.requestPayoutReceiptUpload(req.params.id, req.user));
  } catch (err) {
    next(err);
  }
});

router.post("/payouts/:id/receipt", validateBody(confirmPayoutReceiptSchema), async (req, res, next) => {
  try {
    res.status(201).json(await paymentsService.confirmPayoutReceipt(req.params.id, req.user, req.body));
  } catch (err) {
    next(err);
  }
});

export default router;
