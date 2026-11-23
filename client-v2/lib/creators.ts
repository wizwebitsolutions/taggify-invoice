import { canUse, hasAccess, hasOwnAccess, isOwnScopeRole, type Asset, type Role } from "@/lib/api-client";
import { FORMATS } from "@/lib/formats";

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

/**
 * The page's headline price: its first priced format in the app's order (Reel
 * first). The same rate the plan builder shows and adds a page at.
 */
export function headlineRate(a: Pick<Asset, "rateCards">): number | null {
  for (const f of FORMATS) {
    const r = a.rateCards?.find((x) => x.format === f);
    if (r && Number(r.amount) > 0) return Number(r.amount);
  }
  return null;
}

/** Cost filter bands (23 Nov — "filter according to cost of page"), on headlineRate. */
export const COST_BANDS = [
  { value: "all", label: "All", min: null, max: null },
  { value: "lt5k", label: "Under ₹5,000", min: 0, max: 5000 },
  { value: "5-10k", label: "₹5,000 – ₹10,000", min: 5000, max: 10000 },
  { value: "10-25k", label: "₹10,000 – ₹25,000", min: 10000, max: 25000 },
  { value: "25-50k", label: "₹25,000 – ₹50,000", min: 25000, max: 50000 },
  { value: "50k-1l", label: "₹50,000 – ₹1,00,000", min: 50000, max: 100000 },
  { value: "gt1l", label: "Over ₹1,00,000", min: 100000, max: null },
  { value: "none", label: "No rate set", min: null, max: null },
] as const;
export type CostBand = (typeof COST_BANDS)[number]["value"];

/** Whether a page's headline rate falls in `band` (lower bound inclusive, upper exclusive). */
export function inCostBand(a: Pick<Asset, "rateCards">, band: string): boolean {
  if (band === "all") return true;
  const rate = headlineRate(a);
  if (band === "none") return rate == null;
  const b = COST_BANDS.find((x) => x.value === band);
  if (!b || rate == null) return false;
  return (b.min == null || rate >= b.min) && (b.max == null || rate < b.max);
}

/** Vendor filter options: every page owner, by name. */
export function vendorOptions(pages: Pick<Asset, "owner">[]): { value: string; label: string }[] {
  const byId = new Map<string, string>();
  for (const p of pages) if (p.owner?.id && !byId.has(p.owner.id)) byId.set(p.owner.id, p.owner.name?.trim() || p.owner.email || p.owner.phoneNumber || "Unnamed vendor");
  return [{ value: "all", label: "All" }, ...[...byId.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label }))];
}

/** Platforms a page can be on (23 Nov). Only Instagram pages are fetched automatically. */
export type PagePlatform = "instagram" | "youtube" | "facebook";
export const PLATFORM_LABEL: Record<PagePlatform, string> = { instagram: "Instagram", youtube: "YouTube", facebook: "Facebook" };

/** A page's public profile link on its platform. */
export function pageProfileUrl(handle: string, platform?: string | null): string {
  const h = handle.replace(/^@+/, "");
  const p = platform?.toLowerCase();
  if (p === "youtube") return /^UC[\w-]{20,}$/.test(h) ? `https://www.youtube.com/channel/${h}` : `https://www.youtube.com/@${h}`;
  if (p === "facebook") return /^\d+$/.test(h) ? `https://www.facebook.com/profile.php?id=${h}` : `https://www.facebook.com/${h}`;
  return `https://www.instagram.com/${h}/`;
}

/**
 * A page link or handle → { platform, handle } (23 Nov — "YouTube and Facebook
 * inventory add nahi ho rahi"). youtube.com/@name, /c/, /user/, /channel/ and
 * facebook.com/name or profile.php?id= are read as those platforms; anything
 * else goes through the Instagram rules. A bare handle uses `fallback`.
 * Mirrors server/src/modules/assets/importParser.js otherPlatformRef.
 */
export function pageRefFromInput(raw: string, fallback: PagePlatform = "instagram"): { platform: PagePlatform; handle: string } | null {
  const value = raw.trim();
  if (!value) return null;
  const yt = value.match(/^(?:https?:\/\/)?(?:www\.|m\.)?youtube\.com\/(@[^/?#\s]+|c\/[^/?#\s]+|user\/[^/?#\s]+|channel\/[^/?#\s]+)/i);
  if (yt) {
    const handle = yt[1].replace(/^@/, "").replace(/^(c|user|channel)\//i, "");
    return /^[a-z0-9._-]{1,100}$/i.test(handle) ? { platform: "youtube", handle } : null;
  }
  const fb = value.match(/^(?:https?:\/\/)?(?:www\.|m\.|web\.)?(?:facebook\.com|fb\.com)\/([^?#\s]+)(\?[^#\s]*)?/i);
  if (fb) {
    const path = fb[1].replace(/\/+$/, "");
    if (/^profile\.php$/i.test(path)) {
      const id = /[?&]id=(\d+)/.exec(fb[2] ?? "")?.[1];
      return id ? { platform: "facebook", handle: id } : null;
    }
    const first = path.split("/")[0];
    if (!first || ["watch", "reel", "reels", "share", "groups", "events", "photo", "photos", "story.php", "permalink.php", "login", "pages"].includes(first.toLowerCase())) return null;
    return /^[a-z0-9._-]{1,100}$/i.test(first) ? { platform: "facebook", handle: first } : null;
  }
  if (/^(?:https?:\/\/|www\.)/i.test(value) && !/instagram\.com/i.test(value)) return null;
  if (fallback !== "instagram" && !/instagram\.com/i.test(value)) {
    const handle = value.replace(/^@+/, "").trim();
    return /^[a-z0-9._-]{1,100}$/i.test(handle) ? { platform: fallback, handle } : null;
  }
  const ig = normalizeHandle(value);
  return ig ? { platform: "instagram", handle: ig } : null;
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

/**
 * Vendor contact details from Inventory (13 Nov). PUT /assets/vendors/:id is the ADMIN role +
 * inventory.edit (applies at once); a plan maker with their Inventory switch on suggests instead
 * (PUT …/propose-edit) and someone with inventory.approve applies or discards it.
 */
export const canEditVendors = canSetPageActive;
export const canSuggestVendorEdits = (u: U) => !!u && u.role === "PLAN_MAKER" && hasOwnAccess(u, "inventory.edit");

/** Vendors with a suggested change waiting, once each (the pages list repeats a vendor per page). */
export function vendorsWithPendingEdit(pages: Pick<Asset, "owner">[]): NonNullable<Asset["owner"]>[] {
  const byId = new Map<string, NonNullable<Asset["owner"]>>();
  for (const p of pages) {
    const o = p.owner;
    if (o?.pendingVendorEdit && typeof o.pendingVendorEdit === "object" && Object.keys(o.pendingVendorEdit).length > 0 && !byId.has(o.id)) byId.set(o.id, o);
  }
  return [...byId.values()];
}

/** Page grade A / B / C (16 Oct) — set by hand, optional. */
export const GRADES = ["A", "B", "C"] as const;
export type Grade = (typeof GRADES)[number];
export const isGrade = (g: unknown): g is Grade => typeof g === "string" && (GRADES as readonly string[]).includes(g);
