import cron from "node-cron";
import { runTrackedJob } from "./jobRunner.js";
import { instagramRescrapeJob } from "./instagramRescrape.js";
import { assetProfileRescrapeJob } from "./assetProfileRescrape.js";
import { invoiceAgingSweepJob } from "./invoiceAgingSweep.js";
import { screenshotReminderJob } from "./screenshotReminder.js";
import { financeExportJob } from "./financeExport.js";
import { financeGoogleSheetExportJob } from "./financeGoogleSheetExport.js";

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
  const financeExportSchedule = process.env.FINANCE_EXPORT_CRON || "0 2 * * *"; // before the day's other sweeps
  // newTask.md, 8 Sep — same daily finance data, also written live to a
  // Google Sheet; alongside financeExportJob, not replacing it (see
  // financeGoogleSheetExport.js for why). Own schedule env var so the two
  // can be retimed independently even though they default to the same slot.
  const financeGoogleSheetExportSchedule = process.env.FINANCE_GOOGLE_SHEET_EXPORT_CRON || "0 2 * * *";

  cron.schedule(igSchedule, () => runTrackedJob("instagram_rescrape", instagramRescrapeJob));
  cron.schedule(assetProfileSchedule, () => runTrackedJob("asset_profile_rescrape", assetProfileRescrapeJob));
  cron.schedule(invoiceSchedule, () => runTrackedJob("invoice_aging_sweep", invoiceAgingSweepJob));
  cron.schedule(reminderSchedule, () => runTrackedJob("screenshot_reminder", screenshotReminderJob));
  // Runs unconditionally like every other job — if GITHUB_TOKEN isn't
  // configured yet, financeExportJob throws a specific, readable error that
  // runTrackedJob records to JobRun (admin dashboard "Recent job runs", client-v2 Settings → Background jobs) instead of this
  // silently never running with no trace of why.
  cron.schedule(financeExportSchedule, () => runTrackedJob("finance_export", financeExportJob));
  // Same unconditional-registration + specific-error-into-JobRun pattern as
  // finance_export above — until the three GOOGLE_* vars are set, this runs
  // on schedule and fails with a readable reason in JobRun rather than
  // silently never firing.
  cron.schedule(financeGoogleSheetExportSchedule, () => runTrackedJob("finance_google_sheet_export", financeGoogleSheetExportJob));

  console.log(
    `Cron jobs scheduled — instagram_rescrape: "${igSchedule}", asset_profile_rescrape: "${assetProfileSchedule}", invoice_aging_sweep: "${invoiceSchedule}", screenshot_reminder: "${reminderSchedule}", finance_export: "${financeExportSchedule}", finance_google_sheet_export: "${financeGoogleSheetExportSchedule}"`
  );
}
