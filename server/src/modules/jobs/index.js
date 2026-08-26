import cron from "node-cron";
import { runTrackedJob } from "./jobRunner.js";
import { instagramRescrapeJob } from "./instagramRescrape.js";
import { assetProfileRescrapeJob } from "./assetProfileRescrape.js";
import { invoiceAgingSweepJob } from "./invoiceAgingSweep.js";
import { screenshotReminderJob } from "./screenshotReminder.js";

/**
 * Registers all scheduled jobs in-process via node-cron (no Redis/BullMQ).
 * NOTE (per system design.md §2.11): if this API is ever horizontally
 * scaled, add a pg_advisory_lock (or a "leader" flag) around each job's
 * work to prevent duplicate execution across instances — not needed at
 * single-instance scale, so intentionally left out for now.
 */
export function startCronJobs() {
  if (process.env.ENABLE_CRON !== "true") {
    console.log("Cron jobs disabled (ENABLE_CRON != true)");
    return;
  }

  const igSchedule = process.env.INSTAGRAM_RESCRAPE_CRON || "0 */6 * * *";
  const assetProfileSchedule = process.env.ASSET_PROFILE_RESCRAPE_CRON || "0 3 * * *"; // 24h interval
  const invoiceSchedule = process.env.INVOICE_AGING_SWEEP_CRON || "0 9 * * *";
  const reminderSchedule = process.env.SCREENSHOT_REMINDER_CRON || "0 10 * * *";

  cron.schedule(igSchedule, () => runTrackedJob("instagram_rescrape", instagramRescrapeJob));
  cron.schedule(assetProfileSchedule, () => runTrackedJob("asset_profile_rescrape", assetProfileRescrapeJob));
  cron.schedule(invoiceSchedule, () => runTrackedJob("invoice_aging_sweep", invoiceAgingSweepJob));
  cron.schedule(reminderSchedule, () => runTrackedJob("screenshot_reminder", screenshotReminderJob));

  console.log(
    `Cron jobs scheduled — instagram_rescrape: "${igSchedule}", asset_profile_rescrape: "${assetProfileSchedule}", invoice_aging_sweep: "${invoiceSchedule}", screenshot_reminder: "${reminderSchedule}"`
  );
}
