import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";

import authRoutes from "./modules/auth/routes.js";
import usersRoutes from "./modules/users/routes.js";
import assetsRoutes from "./modules/assets/routes.js";
import campaignsRoutes from "./modules/campaigns/routes.js";
import linksRoutes from "./modules/links/routes.js";
import screenshotsRoutes from "./modules/screenshots/routes.js";
import invoicesRoutes from "./modules/invoices/routes.js";
import billingRoutes from "./modules/billing/routes.js";
import notificationsRoutes from "./modules/notifications/routes.js";
import adminRoutes from "./modules/admin/routes.js";
import plansRoutes from "./modules/plans/routes.js";
import { startCronJobs } from "./modules/jobs/index.js";
import { notFoundHandler, errorHandler } from "./middleware/errorHandler.js";

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(morgan(process.env.NODE_ENV === "development" ? "dev" : "combined"));

app.get("/health", (req, res) => res.json({ ok: true }));

app.use("/auth", authRoutes);
app.use("/users", usersRoutes);
app.use("/assets", assetsRoutes);
app.use("/campaigns", campaignsRoutes);
app.use("/links", linksRoutes);
// nested under /links/:linkId/screenshot — issuing upload URLs and confirming uploads
app.use("/links/:linkId/screenshot", screenshotsRoutes);
app.use("/invoices", invoicesRoutes);
app.use("/billing-profiles", billingRoutes);
app.use("/notifications", notificationsRoutes);
app.use("/admin", adminRoutes);
app.use("/plans", plansRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`invoice-taggify server listening on :${PORT}`);
  startCronJobs();
});

export default app;
