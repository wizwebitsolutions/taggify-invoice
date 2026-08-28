import { Router } from "express";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireRole } from "../../middleware/requireRole.js";
import { prisma } from "../../lib/prisma.js";
import * as adminService from "./service.js";
import { financeExportJob } from "../jobs/financeExport.js";

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

router.post("/users/:id/reset-password", async (req, res, next) => {
  try {
    res.json(await adminService.resetUserPassword(req.params.id));
  } catch (err) {
    next(err);
  }
});

// Manual trigger (newTask.md #2) — runs the same export the daily cron
// does, but reports the real outcome back synchronously so it can actually
// be tested (runTrackedJob, used by the cron schedule, deliberately
// swallows errors into JobRun so a bad job can't crash the scheduler —
// not useful for "did it actually work?" feedback here).
router.post("/finance-export/run-now", async (req, res, next) => {
  const run = await prisma.jobRun.create({ data: { jobName: "finance_export", status: "running" } });
  try {
    const result = await financeExportJob();
    await prisma.jobRun.update({ where: { id: run.id }, data: { status: "success", finishedAt: new Date() } });
    res.json({ ok: true, ...result });
  } catch (err) {
    const message = String(err?.message ?? err);
    await prisma.jobRun.update({ where: { id: run.id }, data: { status: "failed", finishedAt: new Date(), error: message } });
    res.status(500).json({ error: { code: "FINANCE_EXPORT_FAILED", message } });
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
