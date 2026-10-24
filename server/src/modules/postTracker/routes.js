import { Router } from "express";

import { requireAuth } from "../../middleware/requireAuth.js";
import { requireAccess } from "../../middleware/requireAccess.js";
import { loadUserAccess } from "../../lib/requestUser.js";
import { isFullAdmin } from "../../lib/permissions.js";
import { validateBody, validateQuery } from "../../middleware/validate.js";
import { addPostsSchema, listPostsQuerySchema, updatePostSchema } from "./schemas.js";
import * as postTrackerService from "./service.js";

/**
 * Post Tracker (24 Oct) — every route needs the opt-in `postTracker.view`
 * key (ADMIN by default; any other account an admin grants it to), same as
 * the Bulk Tracker. Cards are scoped to the caller's own unless they're a
 * full admin (service.js).
 */
const router = Router();
router.use(requireAuth, requireAccess("postTracker.view"), async (req, _res, next) => {
  try {
    // The row requireAccess just loaded (memoised per request) — a restricted sub-admin is not a full admin.
    const user = await loadUserAccess(req.user.id);
    req.trackerUser = { id: req.user.id, seesAll: isFullAdmin(user) };
    next();
  } catch (err) {
    next(err);
  }
});

const handle = (fn, status = 200) => async (req, res, next) => {
  try {
    res.status(status).json(await fn(req));
  } catch (err) {
    next(err);
  }
};

router.post("/", validateBody(addPostsSchema), handle((req) => postTrackerService.addPosts(req.trackerUser, req.body), 201));
router.get("/", validateQuery(listPostsQuerySchema), handle((req) => postTrackerService.listPosts(req.trackerUser, req.query)));
router.patch("/:id", validateBody(updatePostSchema), handle((req) => postTrackerService.updatePost(req.trackerUser, req.params.id, req.body)));
router.delete("/:id", handle((req) => postTrackerService.deletePost(req.trackerUser, req.params.id)));

export default router;
