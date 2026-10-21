/**
 * Campaign + post helpers (pure). Campaigns have no stored status: live until
 * the deadline passes (no deadline = live). Post statuses are the server's
 * LinkStatus; the labels below are what people see.
 */
import type { Campaign, CampaignAssignment, Link } from "@/lib/api-client";

export type PostFilter = "all" | "review" | "fix" | "broken" | "verified";

export const POST_STATUS: Record<Link["status"], { label: string; tone: "success" | "warning" | "danger" | "info" | "neutral"; filter: Exclude<PostFilter, "all"> | null }> = {
  SUBMITTED: { label: "Needs proof", tone: "warning", filter: "fix" },
  PENDING_SCREENSHOT_REVIEW: { label: "Proof in review", tone: "warning", filter: "review" },
  SCREENSHOT_REJECTED: { label: "Proof rejected", tone: "danger", filter: "fix" },
  SCREENSHOT_APPROVED: { label: "Proof approved", tone: "info", filter: null },
  INSIGHTS_PENDING: { label: "Insights in review", tone: "warning", filter: "review" },
  INSIGHTS_APPROVED: { label: "Verified", tone: "success", filter: "verified" },
  INVOICED: { label: "Invoiced", tone: "info", filter: "verified" },
  INVALID: { label: "Broken link", tone: "danger", filter: "broken" },
};

export function isEnded(c: Pick<Campaign, "deadline">, now = new Date()) {
  if (!c.deadline) return false;
  const end = new Date(c.deadline);
  end.setHours(23, 59, 59, 999);
  return end < now;
}

export function deadlineLabel(c: Pick<Campaign, "deadline">) {
  if (!c.deadline) return "No deadline";
  const d = new Date(c.deadline);
  const days = Math.ceil((d.getTime() - Date.now()) / 86_400_000);
  const date = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
  if (days < 0) return `Ended ${date}`;
  if (days === 0) return `Due today`;
  if (days <= 7) return `Due ${date} · ${days} day${days === 1 ? "" : "s"} left`;
  return `Due ${date}`;
}

export type PageProgress = {
  assetId: string;
  handle: string;
  category: string | null;
  booked: number;
  posted: number;
  broken: number;
  late: boolean;
};

/**
 * Booked vs posted per page: a booking is one assignment row (the plan's
 * posts-per-page are spread into one row per post); a post is any link on
 * that page except a broken one. Late = the deadline has passed and posts are
 * still missing.
 */
export function pageProgress(campaign: Pick<Campaign, "deadline">, assignments: CampaignAssignment[], links: Link[]): PageProgress[] {
  const m = new Map<string, PageProgress>();
  for (const a of assignments) {
    if (!a.assetId) continue;
    const p = m.get(a.assetId) ?? { assetId: a.assetId, handle: a.asset?.handle ?? a.pageHandle, category: a.asset?.category ?? null, booked: 0, posted: 0, broken: 0, late: false };
    p.booked++;
    m.set(a.assetId, p);
  }
  for (const l of links) {
    const p = m.get(l.assetId) ?? { assetId: l.assetId, handle: l.asset?.handle ?? "page", category: l.asset?.category ?? null, booked: 0, posted: 0, broken: 0, late: false };
    // Same rule as the server's postCount: broken, rejected-proof and over-booking posts don't fill a booking.
    if (l.status === "INVALID") p.broken++;
    else if (l.status !== "SCREENSHOT_REJECTED" && !l.overQuota) p.posted++;
    m.set(l.assetId, p);
  }
  const ended = isEnded(campaign);
  return [...m.values()].map((p) => ({ ...p, late: ended && p.posted < p.booked })).sort((a, b) => b.booked - b.posted - (a.booked - a.posted));
}
