import express, { Router } from "express";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireAccess } from "../../middleware/requireAccess.js";
import { validateBody } from "../../middleware/validate.js";
import { createAssetSchema, updateRateCardSchema, importAssetsSchema, setApprovalSchema, importSheetUrlSchema, importFollowersSchema, refreshProfilesSchema } from "./schemas.js";
import { ApiError } from "../../middleware/errorHandler.js";
import * as assetsService from "./service.js";
import { buildImportPagesTemplate } from "../../lib/importPagesTemplate.js";

const router = Router();

// Inventory sheet import (user request, 14 Sep) — a pages list is tiny; 5 MB
// matches campaigns/service.js's MAX_SHEET_BYTES for Google Sheet fetches.
const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024;

// Public (registered before requireAuth below, so it's exempt) — an <img>
// tag can't send our Authorization header, and a profile picture isn't
// sensitive (it's already public on Instagram itself); the asset id alone
// is enough to serve it. Proxies the fetch server-to-server instead of the
// client hotlinking cdninstagram.com directly — see fetchProfilePic's doc
// comment for why (user report, 11 Sep: the direct hotlink came back broken).
router.get("/:id/profile-pic", async (req, res, next) => {
  try {
    const { buffer, contentType } = await assetsService.fetchProfilePic(req.params.id);
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=3600");
    // THE actual bug (found 11 Sep, after "Instagram flakiness" turned out to
    // be a red herring): apiRouter's helmet() sets Cross-Origin-Resource-
    // Policy: same-origin on every response by default, which silently
    // blocks an <img> tag — a "no-cors" cross-origin embed — from loading
    // this in dev (client on :3000, API on :4000, so genuinely
    // cross-origin), even though a fetch() to the exact same URL succeeds
    // fine (CORP and CORS are checked differently; app.use(cors()) covers
    // fetch/XHR, not embeds like <img>). Overridden here, not globally: this
    // one route is deliberately meant to be hotlinked from any origin that
    // can reach the app; every other API response stays same-origin-only.
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.send(buffer);
  } catch (err) {
    next(err);
  }
});

router.use(requireAuth);

router.get("/", async (req, res, next) => {
  try {
    res.json(await assetsService.listAssets(req.user));
  } catch (err) {
    next(err);
  }
});

// CREATOR is a bare role here — adding their own page is unaffected by
// the overlay either way; ADMIN (or any other role granted inventory.manage)
// goes through the permission check.
router.post("/", requireAccess("inventory.edit", "CREATOR"), validateBody(createAssetSchema), async (req, res, next) => {
  try {
    res.status(201).json(await assetsService.createAsset(req.user, req.body));
  } catch (err) {
    next(err);
  }
});

router.put("/:id/approval", requireAccess("inventory.approve"), validateBody(setApprovalSchema), async (req, res, next) => {
  try {
    res.json(await assetsService.setApprovalStatus(req.params.id, req.body.approvalStatus));
  } catch (err) {
    next(err);
  }
});

// Bulk refresh for a selection (user request, 14 Sep) — queues background
// scrapes and returns at once; rows poll while scrapeQueuedAt is set.
router.post("/refresh-profiles", requireAccess("inventory.edit"), validateBody(refreshProfilesSchema), async (req, res, next) => {
  try {
    res.json(await assetsService.queueProfileRefresh(req.body.assetIds));
  } catch (err) {
    next(err);
  }
});

router.post("/:id/refresh-profile", requireAccess("inventory.edit"), async (req, res, next) => {
  try {
    res.json(await assetsService.refreshProfile(req.params.id));
  } catch (err) {
    next(err);
  }
});

router.put(
  "/:id/rate-card",
  requireAccess("inventory.edit"),
  validateBody(updateRateCardSchema),
  async (req, res, next) => {
    try {
      res.json(await assetsService.updateRateCard(req.params.id, req.body.rateCards));
    } catch (err) {
      next(err);
    }
  }
);

/* ── Inventory "Create page" / "Import pages" (user request, 14 Sep) ───── */

// Creator accounts the admin can register a page under (the "Create page"
// modal's account picker and the import preview's fallback picker). Gated
// on inventory.manage rather than users.manage, since a sub-admin allowed
// to manage Inventory needs it even without access to the Users page.
router.get("/owners", requireAccess("inventory.edit"), async (req, res, next) => {
  try {
    res.json(await assetsService.listPageOwners());
  } catch (err) {
    next(err);
  }
});

// "Download template" in the Import pages popup (22 Sep) — the exact
// columns the importer reads, with two example rows.
router.get("/import/template.xlsx", requireAccess("inventory.edit"), async (req, res, next) => {
  try {
    const buffer = await buildImportPagesTemplate();
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="import-pages-template.xlsx"');
    res.setHeader("Content-Length", buffer.length);
    res.send(buffer);
  } catch (err) {
    next(err);
  }
});

// Step 1 of the sheet import: the raw .xlsx/.csv bytes come in as the
// body (Content-Type application/octet-stream, original name in
// X-File-Name), get parsed and resolved against real accounts/pages, and
// the resulting per-row preview goes back. Nothing is written here.
const rawFileBody = express.raw({ type: () => true, limit: MAX_IMPORT_FILE_BYTES });
router.post("/import/preview", requireAccess("inventory.edit"), (req, res, next) => {
  rawFileBody(req, res, (err) => {
    if (!err) return next();
    if (err.type === "entity.too.large") return next(new ApiError(413, "FILE_TOO_LARGE", "That file is over 5 MB — export just the pages sheet and try again."));
    // Any other body-parser complaint (unsupported Content-Encoding, aborted
    // upload, …) is the caller's problem, not a server fault.
    if (err.status && err.status < 500) return next(new ApiError(err.status, "UPLOAD_REJECTED", "Couldn't read that upload — try the file again."));
    next(err);
  });
}, async (req, res, next) => {
  try {
    let fileName = "";
    try {
      fileName = decodeURIComponent(String(req.get("x-file-name") ?? ""));
    } catch {
      fileName = "";
    }
    const parsed = await assetsService.parseImportSheetOrThrow(Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), fileName);
    res.json(await assetsService.previewImport(parsed));
  } catch (err) {
    next(err);
  }
});

// Step 1, Google Sheet flavour (user request, 14 Sep): a pasted share link
// instead of a file — fetched server-side as CSV, then the same preview.
router.post("/import/preview-url", requireAccess("inventory.edit"), validateBody(importSheetUrlSchema), async (req, res, next) => {
  try {
    res.json(await assetsService.previewImportFromSheetUrl(req.body.url));
  } catch (err) {
    next(err);
  }
});

// Step 1½: live follower counts / avg views for the previewed handles, one
// Apify run for the batch (user request, 14 Sep). Slow-ish (a minute or
// so) and optional — the modal shows the rows first and fills these in.
router.post("/import/followers", requireAccess("inventory.edit"), validateBody(importFollowersSchema), async (req, res, next) => {
  try {
    res.json(await assetsService.fetchImportFollowers(req.body.handles));
  } catch (err) {
    next(err);
  }
});

// Step 2: create the rows the admin confirmed (each with the account it
// should sit under). Re-validated server-side — see importAssets.
router.post("/import", requireAccess("inventory.edit"), validateBody(importAssetsSchema), async (req, res, next) => {
  try {
    res.status(201).json(await assetsService.importAssets(req.user, req.body.rows));
  } catch (err) {
    next(err);
  }
});

export default router;
