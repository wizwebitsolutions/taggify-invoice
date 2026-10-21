import { canUse, hasAccess, hasOwnAccess, isOwnScopeRole, type Asset, type Role } from "@/lib/api-client";

/**
 * Creators (v1 "Inventory") permissions, mirroring server/src/modules/assets/routes.js:
 * - list: inventory.view (own-scope roles see their own pages; PLAN_MAKER sees every page)
 * - edit details / rate card / refresh: requireAccess("inventory.edit") — a global key
 * - approve: inventory.approve
 * - add a page for someone else: ADMIN, or PLAN_MAKER with their own inventory.edit switch
 * - rate cards on a new page: ADMIN role only (assets service createAsset)
 * - new creator login: users.edit, or PLAN_MAKER with own inventory.edit (auth requireSignupAccess)
 */
type U = { role?: Role; permissions?: Partial<Record<string, boolean>>; ownAccess?: Partial<Record<string, boolean>> } | null | undefined;

export const canViewCreators = (u: U) => !!u && u.role !== "CREATOR" && u.role !== "TEAM_MEMBER" && canUse(u, "inventory.view");
export const canEditPages = (u: U) => hasAccess(u, "inventory.edit");
export const canApprovePages = (u: U) => hasAccess(u, "inventory.approve");
// ADMIN is not a bare role on POST /assets or GET /assets/owners — a sub-admin without inventory.edit is refused.
export const canAddForOwner = (u: U) => (u?.role === "ADMIN" && hasAccess(u, "inventory.edit")) || (u?.role === "PLAN_MAKER" && hasOwnAccess(u, "inventory.edit"));
export const canSetRatesOnCreate = (u: U) => u?.role === "ADMIN";
export const canCreateLogin = (u: U) => hasAccess(u, "users.edit") || (u?.role === "PLAN_MAKER" && hasOwnAccess(u, "inventory.edit"));
/** Creators → Import pages: staff with inventory.edit, or a planner granted it (server: requireAccess("inventory.edit", "CREATOR", "PLAN_MAKER")). */
export const canImportPages = (u: U) => (!!u && !isOwnScopeRole(u.role) && hasAccess(u, "inventory.edit")) || (u?.role === "PLAN_MAKER" && hasOwnAccess(u, "inventory.edit"));

export const PAGE_APPROVAL: Record<string, { label: string; tone: "success" | "warning" | "danger" }> = {
  approved: { label: "Approved", tone: "success" },
  pending: { label: "Waiting for approval", tone: "warning" },
  rejected: { label: "Rejected", tone: "danger" },
};

export const rateOf = (a: Pick<Asset, "rateCards">, format: string) => {
  const r = a.rateCards.find((x) => x.format === format);
  return r ? Number(r.amount) : null;
};

/** A queued scrape older than this is treated as stuck (the server clears it on its own clean-up), so rows stop spinning. */
const SCRAPE_QUEUE_MAX_AGE_MS = 15 * 60 * 1000;
export const isFetching = (a: Pick<Asset, "scrapeQueuedAt">) => !!a.scrapeQueuedAt && Date.now() - new Date(a.scrapeQueuedAt).getTime() < SCRAPE_QUEUE_MAX_AGE_MS;

/** Profile scrape state, in words. */
export function scrapeState(a: Pick<Asset, "scrapeQueuedAt" | "lastScrapedAt" | "lastScrapeError">): "fetching" | "failed" | "ok" | "never" {
  if (isFetching(a)) return "fetching";
  if (a.lastScrapeError) return "failed";
  return a.lastScrapedAt ? "ok" : "never";
}

const NON_PROFILE_PATHS = ["p", "reel", "reels", "tv", "explore", "accounts", "direct"];

/**
 * Instagram handle from "@riya.eats", "riya.eats" or a profile link; null if it isn't one.
 * Mirrors server/src/modules/assets/importParser.js normalizeHandle + HANDLE_PATTERN — POST /assets
 * itself doesn't check the format, so a post/reel link must be refused here.
 */
export function normalizeHandle(raw: string): string | null {
  let value = raw.trim();
  if (!value) return null;
  const url = value.match(/^(?:https?:\/\/)?(?:www\.|m\.)?instagram\.com\/([^/?#\s]+)(?:\/([^/?#\s]+))?/i);
  if (url) {
    const [, first, second] = url;
    const lower = first.toLowerCase();
    if (lower === "stories" || lower === "_u") value = second ?? "";
    else if (NON_PROFILE_PATHS.includes(lower)) return null;
    else value = first;
  } else if (/^(?:https?:\/\/|www\.)/i.test(value)) return null;
  value = value.replace(/^@+/, "").trim();
  return /^[a-z0-9._]{1,30}$/i.test(value) ? value.toLowerCase() : null;
}

export type Vendor = { id: string; owner: NonNullable<Asset["owner"]> | null; pages: Asset[]; followers: number; campaigns: number; pending: number; rejected: number };

/** Pages grouped by the vendor (owner) who gets paid for them. */
export function groupVendors(pages: Asset[]): Vendor[] {
  const map = new Map<string, Vendor>();
  for (const p of pages) {
    const v = map.get(p.ownerId) ?? { id: p.ownerId, owner: p.owner ?? null, pages: [], followers: 0, campaigns: 0, pending: 0, rejected: 0 };
    v.pages.push(p);
    v.followers += p.followers ?? 0;
    if (p.approvalStatus === "pending") v.pending++;
    if (p.approvalStatus === "rejected") v.rejected++;
    map.set(p.ownerId, v);
  }
  for (const v of map.values()) v.campaigns = new Set(v.pages.flatMap((p) => (p.campaigns ?? []).map((c) => c.id))).size;
  return [...map.values()];
}

/** Active / Inactive switch: PUT /assets/:id/active is ADMIN role + inventory.edit. */
export const canSetPageActive = (u: U) => !!u && u.role === "ADMIN" && hasAccess(u, "inventory.edit");
/** Remove a page (16 Oct): DELETE /assets/:id is ADMIN role + inventory.edit. */
export const canDeletePage = canSetPageActive;
/**
 * Suggest an edit (16 Oct): a plan maker with the inventory.edit switch on can't change a page
 * directly; PUT /assets/:id/propose-edit parks the change until an admin applies it.
 */
export const canProposeEdits = (u: U) => !!u && u.role === "PLAN_MAKER" && hasOwnAccess(u, "inventory.edit") && !canEditPages(u);

/** Page grade A / B / C (16 Oct) — set by hand, optional. */
export const GRADES = ["A", "B", "C"] as const;
export type Grade = (typeof GRADES)[number];
export const isGrade = (g: unknown): g is Grade => typeof g === "string" && (GRADES as readonly string[]).includes(g);
