import { Router } from "express";
import { requireAuth } from "../../middleware/requireAuth.js";
import * as notificationsService from "./service.js";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res, next) => {
  try {
    res.json(await notificationsService.listForUser(req.user.id, { unreadOnly: req.query.unread === "true" }));
  } catch (err) {
    next(err);
  }
});

router.post("/:id/read", async (req, res, next) => {
  try {
    await notificationsService.markRead(req.user.id, req.params.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
