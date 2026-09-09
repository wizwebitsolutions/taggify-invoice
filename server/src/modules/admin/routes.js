import { Router } from "express";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireRole } from "../../middleware/requireRole.js";
import { requirePermission } from "../../middleware/requirePermission.js";
import { validateBody } from "../../middleware/validate.js";
import { prisma } from "../../lib/prisma.js";
import { getEffectivePermissions } from "../../lib/permissions.js";
import { updatePermissionsSchema } from "./schemas.js";
import * as adminService from "./service.js";
import { financeExportJob } from "../jobs/financeExport.js";
import { financeGoogleSheetExportJob } from "../jobs/financeGoogleSheetExport.js";

const router = Router();
router.use(requireAuth, requireRole("ADMIN"));

router.get("/users", requirePermission("users.manage"), async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, phoneNumber: true, name: true, role: true, whatsappVerified: true, permissions: true, createdByAdminId: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
    // Every row carries its *effective* permissions (role defaults merged
    // with any override), not the raw overlay — the Users page shouldn't
    // have to re-derive ADMIN's defaults itself to know what a plain admin
    // can do vs. a restricted sub-admin.
    res.json(users.map((u) => ({ ...u, permissions: getEffectivePermissions(u) })));
  } catch (err) {
    next(err);
  }
});

router.put("/users/:id/role", requirePermission("users.manage"), async (req, res, next) => {
  try {
    const { role } = req.body;
    if (!["CREATOR", "TEAM_MEMBER", "ADMIN", "FINANCE", "PLAN_MAKER"].includes(role)) {
      return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid role" } });
    }
    // Moving an account off ADMIN drops any sub-admin overlay it carried —
    // if it's ever promoted back to ADMIN later, it should start as a plain
    // full admin, not silently reappear restricted by a stale permission set.
    const data = role === "ADMIN" ? { role } : { role, permissions: null };
    const user = await prisma.user.update({ where: { id: req.params.id }, data });
    res.json(user);
  } catch (err) {
    next(err);
  }
});

router.put(
  "/users/:id/permissions",
  requirePermission("users.manage"),
  validateBody(updatePermissionsSchema),
  async (req, res, next) => {
    try {
      if (req.params.id === req.user.id) {
        return res.status(400).json({ error: { code: "CANNOT_EDIT_SELF", message: "You can't edit your own access — ask another admin." } });
      }
      res.json(await adminService.updateUserPermissions(req.user.id, req.params.id, req.body.permissions));
    } catch (err) {
      next(err);
    }
  }
);

router.post("/users/:id/reset-password", requirePermission("users.manage"), async (req, res, next) => {
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
router.post("/finance-export/run-now", requirePermission("finance.manage"), async (req, res, next) => {
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

// Same manual-trigger pattern as finance-export/run-now, for the Google
// Sheet export (newTask.md, 8 Sep) — runs alongside it, not in place of it.
router.post("/finance-google-sheet-export/run-now", requirePermission("finance.manage"), async (req, res, next) => {
  const run = await prisma.jobRun.create({ data: { jobName: "finance_google_sheet_export", status: "running" } });
  try {
    const result = await financeGoogleSheetExportJob();
    await prisma.jobRun.update({ where: { id: run.id }, data: { status: "success", finishedAt: new Date() } });
    res.json({ ok: true, ...result });
  } catch (err) {
    const message = String(err?.message ?? err);
    await prisma.jobRun.update({ where: { id: run.id }, data: { status: "failed", finishedAt: new Date(), error: message } });
    res.status(500).json({ error: { code: "FINANCE_GOOGLE_SHEET_EXPORT_FAILED", message } });
  }
});

// Not permission-gated beyond plain ADMIN — diagnostic cron history, not a
// distinct "section" a sub-admin's access would be scoped away from (see
// lib/permissions.js's key list, which mirrors actual nav sections).
router.get("/job-runs", async (req, res, next) => {
  try {
    const runs = await prisma.jobRun.findMany({ orderBy: { startedAt: "desc" }, take: 50 });
    res.json(runs);
  } catch (err) {
    next(err);
  }
});

export default router;
