import { Router } from "express";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireRole } from "../../middleware/requireRole.js";
import { validateBody } from "../../middleware/validate.js";
import { addTeamMemberSchema, updateProfileSchema } from "./schemas.js";
import * as usersService from "./service.js";

const router = Router();
router.use(requireAuth);

router.get("/me", async (req, res, next) => {
  try {
    res.json(await usersService.getProfile(req.user.id));
  } catch (err) {
    next(err);
  }
});

router.put("/me", validateBody(updateProfileSchema), async (req, res, next) => {
  try {
    res.json(await usersService.updateProfile(req.user.id, req.body));
  } catch (err) {
    next(err);
  }
});

router.get("/me/team", requireRole("CREATOR"), async (req, res, next) => {
  try {
    res.json(await usersService.listTeamMembers(req.user.id));
  } catch (err) {
    next(err);
  }
});

router.post("/me/team", requireRole("CREATOR"), validateBody(addTeamMemberSchema), async (req, res, next) => {
  try {
    res.status(201).json(await usersService.addTeamMember(req.user.id, req.body));
  } catch (err) {
    next(err);
  }
});

export default router;
