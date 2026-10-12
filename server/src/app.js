import "dotenv/config";
import { clearStaleScrapeQueue } from "./modules/assets/service.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import morgan from "morgan";

import authRoutes from "./modules/auth/routes.js";
import usersRoutes from "./modules/users/routes.js";
import assetsRoutes from "./modules/assets/routes.js";
import campaignsRoutes from "./modules/campaigns/routes.js";
import linksRoutes from "./modules/links/routes.js";
import screenshotsRoutes from "./modules/screenshots/routes.js";
import invoicesRoutes from "./modules/invoices/routes.js";
import paymentsRoutes from "./modules/payments/routes.js";
import billingRoutes from "./modules/billing/routes.js";
import notificationsRoutes from "./modules/notifications/routes.js";
import adminRoutes from "./modules/admin/routes.js";
import plansRoutes from "./modules/plans/routes.js";
import googleAuthRoutes from "./modules/integrations/googleAuthRoutes.js";
import bulkTrackRoutes from "./modules/bulkTrack/routes.js";
import { startBulkTrackWorker } from "./modules/bulkTrack/worker.js";
import { startCronJobs } from "./modules/jobs/index.js";
import { startKeepAlive } from "./modules/jobs/keepAlive.js";
import { notFoundHandler, errorHandler } from "./middleware/errorHandler.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// client/ builds to a static export (next.config.js: output: "export") that
// this server hosts directly, so one Render service owns the whole app —
// no separate Vercel deploy. See CLAUDE.md.
const CLIENT_DIST = path.join(__dirname, "../../client/out");

const app = express();

// credentials: true + a reflected (non-"*") origin is required for the
// browser to send/accept the trusted-device cookie (23 Sep — "skip OTP for
// 7 days"). Production is same-origin already (client/out is served by
// this same service — see render.yaml), so this only changes local dev,
// where the client (:3000) and API (:4000) are same-site but cross-origin.
app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
app.use(express.json());
app.use(morgan(process.env.NODE_ENV === "development" ? "dev" : "combined"));

// helmet() (full defaults, CSP included) is scoped per-section below rather
// than applied globally, so the CSP relaxation the static frontend needs
// doesn't also weaken /api/* JSON responses.
app.get("/health", helmet(), (req, res) => res.json({ ok: true }));

// All backend routes live under /api — client/app has its own top-level
// routes with the same names (campaigns, assets, invoices, users), so API
// and frontend paths must not collide on a shared origin.
const apiRouter = express.Router();
apiRouter.use(helmet());
apiRouter.use("/auth", authRoutes);
apiRouter.use("/users", usersRoutes);
apiRouter.use("/assets", assetsRoutes);
apiRouter.use("/campaigns", campaignsRoutes);
apiRouter.use("/links", linksRoutes);
// nested under /links/:linkId/screenshot — issuing upload URLs and confirming uploads
apiRouter.use("/links/:linkId/screenshot", screenshotsRoutes);
apiRouter.use("/invoices", invoicesRoutes);
apiRouter.use("/payments", paymentsRoutes);
apiRouter.use("/billing-profiles", billingRoutes);
apiRouter.use("/notifications", notificationsRoutes);
apiRouter.use("/admin", adminRoutes);
apiRouter.use("/plans", plansRoutes);
apiRouter.use("/integrations/google", googleAuthRoutes);
apiRouter.use("/bulk-track", bulkTrackRoutes);
apiRouter.use(notFoundHandler);
apiRouter.use(errorHandler);
app.use("/api", apiRouter);

// Static frontend + SPA fallback. CSP off here only: Next's static export
// ships inline hydration/theme-init scripts it can't hash/nonce per-request,
// and helmet's default CSP would silently block them. `extensions: ["html"]`
// lets a request for e.g. /campaigns/view resolve to the exported
// campaigns/view.html.
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.static(CLIENT_DIST, { extensions: ["html"] }));
app.get("*", (req, res) => {
  res.sendFile(path.join(CLIENT_DIST, "index.html"), (err) => {
    if (err) res.status(500).send("Frontend build not found — run `npm run build` in client/ first.");
  });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`invoice-taggify server listening on :${PORT}`);
  startCronJobs();
  startKeepAlive();
  startBulkTrackWorker();
  clearStaleScrapeQueue().catch((err) => console.error("clearStaleScrapeQueue failed", err));
});

export default app;
