import { prisma } from "../../lib/prisma.js";

/**
 * Wraps a job's work in a JobRun row so cron runs are observable without a
 * queue system's built-in dashboard (no BullMQ/Redis by design).
 */
export async function runTrackedJob(jobName, work) {
  const run = await prisma.jobRun.create({ data: { jobName, status: "running" } });
  try {
    await work();
    await prisma.jobRun.update({ where: { id: run.id }, data: { status: "success", finishedAt: new Date() } });
  } catch (err) {
    await prisma.jobRun.update({
      where: { id: run.id },
      data: { status: "failed", finishedAt: new Date(), error: String(err?.message ?? err) },
    });
    console.error(`[job:${jobName}] failed:`, err);
  }
}
