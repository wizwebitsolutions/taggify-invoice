import "dotenv/config";
import { clearStaleScrapeQueue } from "./modules/assets/service.js";
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
import postTrackerRoutes from "./modules/postTracker/routes.js";
import { startBulkTrackWorker } from "./modules/bulkTrack/worker.js";
import { startPostTrackerWorker } from "./modules/postTracker/worker.js";
import { startCronJobs } from "./modules/jobs/index.js";
import { startKeepAlive } from "./modules/jobs/keepAlive.js";
import { notFoundHandler, errorHandler } from "./middleware/errorHandler.js";
import { createFrontendHandler } from "./frontend.js";

const app = express();

// credentials: true + a reflected (non-"*") origin is required for the
// browser to send/accept the trusted-device cookie (23 Sep — "skip OTP for
// 7 days"). Production is same-origin already (client-v2 is served by
// this same service — see src/frontend.js), so this only changes local dev,
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
apiRouter.use("/post-tracker", postTrackerRoutes);
apiRouter.use(notFoundHandler);
apiRouter.use(errorHandler);
app.use("/api", apiRouter);

// Frontend: client-v2's built Next app, run in this process (src/frontend.js).
// CSP off here only: Next ships inline hydration/theme-init scripts that
// helmet's default CSP would silently block.
app.use(helmet({ contentSecurityPolicy: false }));
app.use(createFrontendHandler());

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`invoice-taggify server listening on :${PORT}`);
  startCronJobs();
  startKeepAlive();
  startBulkTrackWorker();
  startPostTrackerWorker();
  clearStaleScrapeQueue().catch((err) => console.error("clearStaleScrapeQueue failed", err));
});

export default app;
