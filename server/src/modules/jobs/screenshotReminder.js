import { prisma } from "../../lib/prisma.js";
import { notify } from "../notifications/service.js";

const STALE_AFTER_HOURS = 24;

/**
 * creator.wldd.in proactively nudges creators — "Reminder: Upload Insight
 * Screenshot for [link]" — when a submitted post is sitting without its
 * proof screenshot. We don't have a manual insight-screenshot step (that's
 * replaced by the automated Apify scrape, per recommend.md), but the same
 * gap exists for the *first* screenshot: a link can sit in SUBMITTED with
 * no proof uploaded and nothing else pushes on it. This job closes that
 * gap — the equivalent nudge for our workflow, not a literal port.
 */
export async function screenshotReminderJob() {
  const staleBefore = new Date(Date.now() - STALE_AFTER_HOURS * 60 * 60 * 1000);

  const stale = await prisma.link.findMany({
    where: { status: "SUBMITTED", createdAt: { lt: staleBefore }, screenshot: null },
    select: { id: true, url: true, submittedById: true },
  });

  for (const link of stale) {
    await notify(link.submittedById, "screenshot_reminder", { linkId: link.id, url: link.url });
  }
}
