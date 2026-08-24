import { Router } from "express";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireRole } from "../../middleware/requireRole.js";
import { prisma } from "../../lib/prisma.js";

const router = Router();
router.use(requireAuth, requireRole("ADMIN"));

router.get("/users", async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, phoneNumber: true, name: true, role: true, whatsappVerified: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
    res.json(users);
  } catch (err) {
    next(err);
  }
});

router.put("/users/:id/role", async (req, res, next) => {
  try {
    const { role } = req.body;
    if (!["CREATOR", "TEAM_MEMBER", "ADMIN", "FINANCE"].includes(role)) {
      return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid role" } });
    }
    const user = await prisma.user.update({ where: { id: req.params.id }, data: { role } });
    res.json(user);
  } catch (err) {
    next(err);
  }
});

router.get("/job-runs", async (req, res, next) => {
  try {
    const runs = await prisma.jobRun.findMany({ orderBy: { startedAt: "desc" }, take: 50 });
    res.json(runs);
  } catch (err) {
    next(err);
  }
});

export default router;
