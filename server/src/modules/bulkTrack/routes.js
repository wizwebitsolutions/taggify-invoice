import { Router } from "express";

import { requireAuth } from "../../middleware/requireAuth.js";
import { requireAccess } from "../../middleware/requireAccess.js";
import { prisma } from "../../lib/prisma.js";
import { isFullAdmin } from "../../lib/permissions.js";
import { validateBody, validateQuery } from "../../middleware/validate.js";
import { manualBatchSchema, sheetPreviewSchema, sheetSourceSchema, listPostsQuerySchema, listSheetSourcesQuerySchema } from "./schemas.js";
import * as bulkTrackService from "./service.js";

/**
 * Bulk Tracker (12 Oct) — every route needs the opt-in `bulkTrack.view` key
 * (ADMIN by default; any other account an admin grants it to). No bare
 * roles: an own-scope account passes only with an explicit grant. Rows are
 * then scoped to the caller's own unless they're a full admin (service.js).
 */
const router = Router();
router.use(requireAuth, requireAccess("bulkTrack.view"), async (req, _res, next) => {
  try {
    // Fresh from the DB (like requireAccess) — a restricted sub-admin is not a full admin.
    const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { role: true, permissions: true } });
    req.bulkUser = { id: req.user.id, seesAll: isFullAdmin(user) };
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

router.post("/batches", validateBody(manualBatchSchema), handle((req) => bulkTrackService.createManualBatch(req.bulkUser, req.body), 201));
router.get("/batches", handle((req) => bulkTrackService.listBatches(req.bulkUser)));
router.get("/batches/:id", handle((req) => bulkTrackService.getBatch(req.bulkUser, req.params.id)));
router.get("/batches/:id/export", async (req, res, next) => {
  try {
    const { filename, workbook } = await bulkTrackService.buildBatchExport(req.bulkUser, req.params.id);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    // Once the file has started streaming a JSON error can't follow it.
    if (res.headersSent) return res.destroy(err);
    next(err);
  }
});
router.post("/batches/:id/refresh", handle((req) => bulkTrackService.refreshBatchPosts(req.bulkUser, req.params.id)));
router.delete("/batches/:id", handle((req) => bulkTrackService.deleteBatch(req.bulkUser, req.params.id)));

router.get("/posts", validateQuery(listPostsQuerySchema), handle((req) => bulkTrackService.listAllPosts(req.bulkUser, req.query)));
router.post("/posts/refresh", validateQuery(listPostsQuerySchema), handle((req) => bulkTrackService.refreshAllPosts(req.bulkUser, req.query)));

router.post("/sheet-sources/preview", validateBody(sheetPreviewSchema), handle((req) => bulkTrackService.previewSheet(req.body)));
router.post("/sheet-sources", validateBody(sheetSourceSchema), handle((req) => bulkTrackService.createSheetSource(req.bulkUser, req.body), 201));
router.get("/sheet-sources", validateQuery(listSheetSourcesQuerySchema), handle((req) => bulkTrackService.listSheetSources(req.bulkUser, req.query)));
router.post("/sheet-sources/:id/check", handle((req) => bulkTrackService.checkSheetSourceNow(req.bulkUser, req.params.id)));
router.delete("/sheet-sources/:id", handle((req) => bulkTrackService.deleteSheetSource(req.bulkUser, req.params.id)));

export default router;
