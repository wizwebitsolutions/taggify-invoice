import { Router } from "express";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireRole } from "../../middleware/requireRole.js";
import { requireAccess } from "../../middleware/requireAccess.js";
import { validateBody } from "../../middleware/validate.js";
import { prisma } from "../../lib/prisma.js";
import { getEffectivePermissions } from "../../lib/permissions.js";
import { updatePermissionsSchema } from "./schemas.js";
import { invoiceNumberingSchema } from "../plans/schemas.js";
import { getNumbering, setNumbering } from "../../lib/clientInvoiceNumbering.js";
import { repairInvoicedLinks } from "../../lib/repairInvoicedLinks.js";
import * as adminService from "./service.js";
import { financeExportJob } from "../jobs/financeExport.js";
import { financeGoogleSheetExportJob } from "../jobs/financeGoogleSheetExport.js";

const router = Router();
// No blanket requireRole("ADMIN") here any more (15 Sep) — each route below
// is gated individually via requireAccess() so a non-admin role granted one
// of these six sections can reach it, while /job-runs (the one route with
// no permission key at all) keeps its own explicit requireRole("ADMIN").
router.use(requireAuth);

// Proforma Invoice numbering (user request, 17 Sep — "admin, finance will
// have power to change invoice no. prefix"). Role-gated, not permission-
// gated: it's those two roles specifically, not a grantable section.
router.get("/invoice-numbering", requireAccess("finance.edit"), async (req, res, next) => {
  try {
    res.json(await getNumbering());
  } catch (err) {
    next(err);
  }
});

router.put("/invoice-numbering", requireAccess("finance.edit"), validateBody(invoiceNumberingSchema), async (req, res, next) => {
  try {
    res.json(await setNumbering(req.body));
  } catch (err) {
    next(err);
  }
});

router.get("/users", requireAccess("users.view"), async (req, res, next) => {
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

// Self-change, promotion to ADMIN and changes to an ADMIN account are
// refused/guarded in the service (23 Sep audit) — see updateUserRole.
router.put("/users/:id/role", requireAccess("users.edit"), async (req, res, next) => {
  try {
    res.json(await adminService.updateUserRole(req.user.id, req.params.id, req.body?.role));
  } catch (err) {
    next(err);
  }
});

router.put(
  "/users/:id/permissions",
  requireAccess("users.edit"),
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

router.post("/users/:id/reset-password", requireAccess("users.edit"), async (req, res, next) => {
  try {
    res.json(await adminService.resetUserPassword(req.user.id, req.params.id));
  } catch (err) {
    next(err);
  }
});

// Manual trigger (newTask.md #2) — runs the same export the daily cron
// does, but reports the real outcome back synchronously so it can actually
// be tested (runTrackedJob, used by the cron schedule, deliberately
// swallows errors into JobRun so a bad job can't crash the scheduler —
// not useful for "did it actually work?" feedback here).
// Re-align link statuses with the invoices they're on (22 Sep) — see
// lib/repairInvoicedLinks.js. Admin-only, idempotent.
router.post("/repair/invoiced-links", requireRole("ADMIN"), requireAccess("finance.edit"), async (req, res, next) => {
  try {
    res.json(await repairInvoicedLinks({ actedById: req.user.id }));
  } catch (err) {
    next(err);
  }
});

router.post("/finance-export/run-now", requireAccess("finance.edit"), async (req, res, next) => {
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
router.post("/finance-google-sheet-export/run-now", requireAccess("finance.edit"), async (req, res, next) => {
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
// lib/permissions.js's key list, which mirrors actual nav sections). Kept on
// an explicit requireRole("ADMIN") rather than requireAccess(), since this
// route was never part of the grantable set and shouldn't become one by
// accident just because the router's old blanket ADMIN gate was removed.
router.get("/job-runs", requireAccess("finance.edit"), async (req, res, next) => {
  try {
    const runs = await prisma.jobRun.findMany({ orderBy: { startedAt: "desc" }, take: 50 });
    res.json(runs);
  } catch (err) {
    next(err);
  }
});

export default router;
