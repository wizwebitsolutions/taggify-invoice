/**
 * Typed client for server/ (system design.md §2.3). One function per
 * backend route — every screen calls through here, never a raw fetch()
 * inline in a component. Single source for the API base URL and the
 * auth-header/error-shape conventions.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api";

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// Shared with lib/auth-context.tsx (one source of truth for the key) so a
// background refresh triggered here and the React state living there never
// disagree about where the session is stored.
export const AUTH_STORAGE_KEY = "taggify_auth";

interface StoredAuthShape {
  user: unknown;
  accessToken: string;
  refreshToken: string;
}

function readStoredAuth(): StoredAuthShape | null {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeStoredAuth(next: StoredAuthShape | null) {
  try {
    if (next) localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(next));
    else localStorage.removeItem(AUTH_STORAGE_KEY);
  } catch {
    // best-effort — a request still gets its retried/failed outcome either way
  }
  // AuthProvider only reads localStorage once on mount; this tells it (and
  // any other listener in this tab — localStorage's own "storage" event
  // only fires in *other* tabs) that the session changed under it.
  if (typeof window !== "undefined") window.dispatchEvent(new Event("taggify:auth-sync"));
}

// The access token is short-lived (15m) and nothing was ever calling
// POST /auth/refresh — every request just started 401ing after 15 minutes,
// silently rendering empty lists everywhere with no error and no way back
// short of manually logging out and in. This makes a 401 self-heal instead.
//
// One shared in-flight promise: the server *rotates* refresh tokens
// (single-use, revoked once redeemed — see server/src/modules/auth/service.js),
// so two requests 401ing at once and each redeeming the refresh token would
// race — the second would redeem an already-revoked token and fail. Every
// concurrent 401 awaits the same refresh instead of starting its own.
let refreshPromise: Promise<string | null> | null = null;

function refreshAccessToken(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const stored = readStoredAuth();
      if (!stored?.refreshToken) return null;
      try {
        const result = await request<AuthResponse>("/auth/refresh", {
          method: "POST",
          body: { refreshToken: stored.refreshToken },
        });
        writeStoredAuth({ user: result.user, accessToken: result.accessToken, refreshToken: result.refreshToken });
        return result.accessToken;
      } catch {
        // The refresh token is single-use and rotated server-side (see
        // authService.refresh) — with two tabs/devices open on the same
        // session, both can have the same access token and race to refresh
        // it within moments of each other. Whichever loses the race gets
        // rejected here even though the session is fine: the *other* caller
        // already redeemed it and localStorage now holds a newer pair. Only
        // wipe the session if storage still points at the token we just
        // tried — a genuinely dead refresh token — not when someone else
        // already won the race.
        const latest = readStoredAuth();
        if (latest?.refreshToken && latest.refreshToken !== stored.refreshToken) {
          return latest.accessToken;
        }
        writeStoredAuth(null);
        return null;
      } finally {
        refreshPromise = null;
      }
    })();
  }
  return refreshPromise;
}

async function request<T>(
  path: string,
  {
    method = "GET",
    body,
    token,
    credentials,
    _isRetry = false,
  }: { method?: string; body?: unknown; token?: string | null; credentials?: RequestCredentials; _isRetry?: boolean } = {}
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    // Opt-in only (login/verify-otp) — the trusted-device cookie ("skip OTP
    // for 7 days", 23 Sep) needs the browser to send/accept it, which
    // requires this explicitly on a cross-origin fetch (client :3000 vs
    // API :4000 in dev; same-origin in production). Every other call is
    // unaffected — this app is otherwise entirely bearer-token based.
    ...(credentials ? { credentials } : {}),
  });

  if (res.status === 204) return undefined as T;

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Never intercept /auth/* itself — login failing with 401 is a wrong
    // password, not an expired session, and refresh's own 401 is handled
    // by refreshAccessToken's catch, not by recursing back into refreshing.
    // Exception: /auth/email/* called *with a session* (in-app email
    // verification, 21 Sep) — a 401 there can only mean an expired access
    // token, and without the retry /verify-email dead-ends after 15 minutes
    // with the only way out being a re-login the account may not have left.
    const isAuthPath = path.startsWith("/auth/") && !path.startsWith("/auth/email/");
    if (res.status === 401 && token && !_isRetry && !isAuthPath) {
      const freshToken = await refreshAccessToken();
      if (freshToken) return request<T>(path, { method, body, token: freshToken, _isRetry: true });
    }
    throw new ApiError(res.status, data?.error?.code ?? "UNKNOWN", data?.error?.message ?? res.statusText);
  }
  return data as T;
}

// ── Types (fields the UI actually reads) ──────────────────────────────
export type Role = "CREATOR" | "TEAM_MEMBER" | "ADMIN" | "FINANCE" | "PLAN_MAKER";

// Per-account permissions (newTask.md, 8 Sep for the ADMIN sub-admin case;
// 15 Sep any role can be granted; 23 Sep split into per-action keys —
// "user selects Invoices, then checkboxes for edit, approve … appear
// below"). Mirrors the server's lib/permissions.js SECTIONS: every key is
// `<section>.<action>`, and edit/approve/pay each imply that section's
// view. The server always sends the *effective* map (role baseline merged
// with the account's overlay), never the raw overlay.
export const PERMISSION_SECTIONS = {
  users: ["view", "edit"],
  campaigns: ["view", "edit"],
  inventory: ["view", "edit", "approve"],
  links: ["view", "edit", "approve"],
  finance: ["view", "edit", "approve", "pay"],
  plans: ["view", "edit", "approve"],
  // 12 Oct — Bulk Tracker (server lib/permissions.js OPT_IN_KEYS).
  bulkTrack: ["view"],
} as const;
/**
 * Opt-in keys (12 Oct): grantable to any role — own-scope roles included —
 * and off for everyone but ADMIN until an admin turns them on. The server's
 * effective `permissions` map carries them for every role, so hasAccess()
 * is the gate for all accounts.
 */
export const OPT_IN_KEYS = ["bulkTrack.view"] as const;
export const isOptInKey = (key: string) => (OPT_IN_KEYS as readonly string[]).includes(key);
export type PermissionSection = keyof typeof PERMISSION_SECTIONS;
export type PermissionAction = "view" | "edit" | "approve" | "pay";
export type PermissionKey = {
  [S in PermissionSection]: `${S}.${(typeof PERMISSION_SECTIONS)[S][number]}`;
}[PermissionSection];
export type Permissions = Record<PermissionKey, boolean>;
export const PERMISSION_KEYS = (Object.keys(PERMISSION_SECTIONS) as PermissionSection[]).flatMap((s) =>
  PERMISSION_SECTIONS[s].map((a) => `${s}.${a}` as PermissionKey)
);

// A session stored before the split still carries the six old keys until
// its next token refresh — read them as the sections they covered.
const LEGACY_KEY_MAP: Record<string, PermissionKey[]> = {
  "users.manage": ["users.view", "users.edit"],
  "campaigns.manage": ["campaigns.view", "campaigns.edit"],
  "inventory.manage": ["inventory.view", "inventory.edit", "inventory.approve"],
  "links.review": ["links.view", "links.edit", "links.approve"],
  "finance.manage": ["finance.view", "finance.edit", "finance.approve", "finance.pay"],
  "plans.manage": ["plans.view", "plans.edit", "plans.approve"],
};

type AccessUser = { role?: Role; permissions?: Partial<Record<string, boolean>>; ownAccess?: Partial<Record<string, boolean>> } | null | undefined;

/**
 * Own-scope roles (24 Sep, mirrors server lib/permissions.js): Creators,
 * Team members and Plan makers never hold global keys — their access is a
 * set of switches over their *own* content (OWN_CAPABILITIES), all ON by
 * default; an admin can switch any off on People → Edit access.
 */
export const OWN_SCOPE_ROLES: Role[] = ["CREATOR", "TEAM_MEMBER", "PLAN_MAKER"];
export const isOwnScopeRole = (role: Role | undefined | null) => !!role && OWN_SCOPE_ROLES.includes(role);
export const OWN_CAPABILITIES: Partial<Record<Role, PermissionKey[]>> = {
  CREATOR: ["campaigns.view", "inventory.view", "inventory.edit", "links.view", "links.edit", "finance.view", "finance.edit", "users.view", "users.edit"],
  TEAM_MEMBER: ["campaigns.view", "inventory.view", "links.view", "links.edit", "finance.view"],
  PLAN_MAKER: ["plans.view", "plans.edit", "plans.approve", "campaigns.view", "campaigns.edit", "links.view", "finance.view", "finance.edit", "inventory.view", "inventory.edit"],
};

/** An own-scope role's switches with nothing turned off. */
export function defaultOwnAccess(role: Role): Permissions {
  const allowed = OWN_CAPABILITIES[role] ?? [];
  return Object.fromEntries(PERMISSION_KEYS.map((k) => [k, allowed.includes(k)])) as Permissions;
}

/**
 * Is an own-content feature switched on for this (own-scope) account? Same
 * answer as the server's hasOwnCapability. A session from before 24 Sep has
 * no map yet — treat the role's own features as on (the server default)
 * until its next refresh. Staff roles: false (use hasAccess).
 */
export function hasOwnAccess(user: AccessUser, key: PermissionKey): boolean {
  if (!isOwnScopeRole(user?.role)) return false;
  const allowed = OWN_CAPABILITIES[user!.role!] ?? [];
  if (!allowed.includes(key)) return false;
  const map = user?.ownAccess;
  if (!map) return true;
  const section = key.split(".")[0];
  if (key !== `${section}.view` && map[`${section}.view`] === false) return false;
  return map[key] !== false;
}

/** The one gate for UI that both kinds of account can use: own-content switch for own-scope roles, global key for staff. */
export function canUse(user: AccessUser, key: PermissionKey): boolean {
  return isOwnScopeRole(user?.role) ? hasOwnAccess(user, key) : hasAccess(user, key);
}

/**
 * Same answer the server's hasPermission() gives. The server's effective
 * map is authoritative when present; a session with no map at all (older
 * login) falls back to "ADMIN has everything, nobody else has anything".
 * Use this (not a bare `role === "ADMIN"` check) for any UI gate on a
 * permission key, so a granted Finance/Planner sees the same controls a
 * sub-admin restricted to just that action would.
 */
export function hasAccess(user: AccessUser, key: PermissionKey): boolean {
  const map = user?.permissions;
  if (!map) return user?.role === "ADMIN";
  if (typeof map[key] === "boolean") return map[key] === true;
  for (const [legacy, keys] of Object.entries(LEGACY_KEY_MAP)) {
    if (keys.includes(key) && typeof map[legacy] === "boolean") return map[legacy] === true;
  }
  // Implied view: an action grant on the section shows the section.
  if (key.endsWith(".view")) {
    const section = key.split(".")[0] as PermissionSection;
    if (PERMISSION_SECTIONS[section].some((a) => a !== "view" && map[`${section}.${a}`] === true)) return true;
  }
  return user?.role === "ADMIN" && map[key] === undefined;
}

export interface User {
  id: string;
  /** Optional since 24 Sep — accounts are created with an email (the login); phone is extra contact info. */
  phoneNumber: string | null;
  name: string | null;
  role: Role;
  whatsappVerified: boolean;
  email?: string | null;
  /** Login/refresh payloads only (email 2FA, 21 Sep). `false` = still signing
   *  in by phone number and must verify an email; undefined on a session
   *  stored before this existed, until its next token refresh. */
  emailVerified?: boolean;
  /** /users/me only — same fact as emailVerified, as the profile endpoint reports it. */
  emailVerifiedAt?: string | null;
  secondaryPhone?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  state?: string | null;
  pincode?: string | null;
  createdAt?: string;
  /** Only populated on login/refresh and the admin Users list — see Permissions. */
  permissions?: Permissions;
  /** Which admin created this account, if it was created via the sub-admin flow (admin Users list only). */
  createdByAdminId?: string | null;
  /** Own-content switches for CREATOR / TEAM_MEMBER / PLAN_MAKER (24 Sep); all-false for staff. */
  ownAccess?: Partial<Record<string, boolean>>;
}

/** The contact + address fields People → Edit details can change (server admin/service.js DETAIL_FIELDS). */
export type UserDetailField = "name" | "phoneNumber" | "secondaryPhone" | "addressLine1" | "addressLine2" | "state" | "pincode";

export interface BillingProfile {
  id: string;
  userId: string;
  pan: string;
  name: string;
  gstin: string | null;
  msme: string | null;
  bankAccountNumber: string;
  ifscCode: string;
  approvalStatus: "pending" | "approved" | "rejected";
  createdAt: string;
  user?: { id: string; name: string | null; phoneNumber: string | null; email?: string | null };
}

export interface AuthResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
}

// Email 2FA (21 Sep) — POST /auth/login answers with a step, and only
// AUTHENTICATED carries a session (see server auth/service.js's login).
// The challengeToken is the proof-of-password to hand to the next step's
// endpoint; it is not a session and must never be stored as one.
// Since 24 Sep there are only two answers: a code was emailed, or (a
// remembered device) straight in.
export type LoginResult = ({ step: "AUTHENTICATED" } & AuthResponse) | { step: "OTP_REQUIRED"; challengeToken: string; emailHint: string };

/** How email setup proves who's asking: a locked-out login's challenge token, or a normal session's access token. */
export type EmailSetupIdentity = { challengeToken: string } | { token: string };

export interface RateCard {
  id: string;
  assetId: string;
  format: string;
  amount: string;
  effectiveFrom: string;
}

// Suggested starting points, not a fixed enum — Asset.category is free-form
// server-side (same convention as RateCard.format's custom formats), so a
// page can be tagged with anything typed into the "custom category" input
// alongside these. Shared between assets/page.tsx's "Add page" and
// users/page.tsx's "Add user" (which can create a creator's first page(s)
// inline) so the two pickers don't drift apart.
export const PAGE_CATEGORIES = ["Meme page", "News page", "Entertainment", "Lifestyle", "Fashion", "Fitness", "Food"];

// Standard rate-card/link formats — not a fixed enum server-side (a rate
// card can carry a free-form custom format too), just the starting set
// shown in pickers. Shared between assets/page.tsx and users/page.tsx's
// multi-page "Add user" flow.
/** reel/story only, app-wide (user request, 14 Sep — "no other format from entire app"). Mirrors server/src/lib/formats.js. */
export const LINK_FORMATS = ["reel", "story"] as const;

export interface Asset {
  id: string;
  ownerId: string;
  platform: string;
  handle: string;
  followers: number;
  /** Instagram CDN URL, synced from Apify — re-synced every 24h. Null until the first scrape completes. */
  profilePicUrl?: string | null;
  /** Free-form, e.g. "Meme page", "News page" — set at creation, editable from Inventory's Edit panel (28 Sep). */
  category?: string | null;
  approvalStatus: string;
  /** Admin's Active / Inactive switch (8 Oct). An inactive page can't be added to new plans. */
  isActive?: boolean;
  createdAt: string;
  rateCards: RateCard[];
  /**
   * `source: "profile"` = averaged from the profile's latest posts by the Apify scrape (no links through the app yet); absent = from this app's own link snapshots.
   * `manual` marks figures typed in Inventory's Edit panel (28 Sep), which override whichever automatic source produced the rest and survive re-scrapes.
   */
  engagement: {
    avgLikes: number | null;
    avgComments: number | null;
    avgViews: number | null;
    sampleSize: number;
    source?: "profile";
    manual?: { avgViews?: true; avgLikes?: true; avgComments?: true };
  };
  /** When the last Instagram profile scrape succeeded — null until the first one lands (Inventory shows "Fetching from Instagram…" meanwhile). */
  lastScrapedAt?: string | null;
  /** Why the last profile scrape failed (private account, bad handle, Apify outage) — null once one succeeds. */
  lastScrapeError?: string | null;
  /** Set while a profile scrape is queued/running for this page (create, import, bulk refresh); null once it finishes. */
  scrapeQueuedAt?: string | null;
  /** The creator this page belongs to — Inventory's owner filter (newTask.md, 9 Sep). */
  owner?: { id: string; name: string | null; phoneNumber: string | null; email?: string | null } | null;
  /** Every campaign this page has been assigned to, deduped — Inventory card's "campaigns they've made" (user request, 11 Sep). */
  campaigns: { id: string; title: string; brandName: string }[];
}

export interface Campaign {
  id: string;
  brandName: string;
  title: string;
  deadline: string | null;
  createdAt: string;
  costCap?: string | null;
  sheetLink?: string | null;
  /** How many links (posts) have been submitted under this campaign so far. */
  postCount?: number;
  /** One post's preview, picked server-side, to represent the whole campaign on its card. Null until at least one submitted post has been scraped. */
  representativePost?: { thumbnailUrl: string | null; caption: string | null } | null;
  /** Sum of likeCount across every submitted post's latest snapshot (unknown/-1 counts excluded). */
  totalLikes?: number;
  /** Sum of every non-screenshot-rejected link's cost. */
  spent?: number;
  /** costCap - spent, or null if no cap was set. Not sent to creators. */
  remainingBudget?: number | null;
  /** Creators only: cost of links on their own pages — the only money they see. */
  yourEarnings?: number;
  /** Rows from an attached sheet still waiting on a page/creator to be created for them. */
  pendingAssignmentCount?: number;
  /** Set when this campaign is a phase (2+) of another — points at phase 1's id. Null/undefined for a standalone campaign or phase 1 itself. */
  parentCampaignId?: string | null;
  /** 1 for a standalone campaign or the first phase; 2+ for later phases. For a creator this is their running count (see creatorPhaseNumber). */
  phaseNumber?: number;
  /** 22 Sep — 1 for a phase itself, 2+ for an extra post of that phase (a page booked for 2 reels). Admins see an extra post as a 2nd post of its phase. */
  postNumber?: number;
  /** Creator / team member responses only — this row's number in one running count over the campaign's phases and extra posts ("X — Phase 3"). */
  creatorPhaseNumber?: number;
  /** Creator / team member list only (24 Sep): their pages booked on this
   *  exact row — the only pages it takes links for (server:
   *  lib/pageOwnership.js assertPageBooked). */
  bookedAssetIds?: string[];
  /** Creator / team member list only (29 Sep): per page of theirs, how many posts this campaign phase booked and how many are already up.
   *  `booked` is the number of assignment slots — the plan's postsPerProfile isn't stored on the campaign, only spread into one row per post. */
  pageQuota?: { assetId: string; booked: number; submitted: number }[];
  /** The whole phase group (including this campaign), phase-1-first. Only present on getCampaignById's response, not the list. */
  phases?: { id: string; phaseNumber: number; title: string; createdAt: string }[];
  /** Only present on listCampaigns' response — how many phases (including this root) exist. 1 for a campaign with no phases. */
  phaseCount?: number;
}

export interface CampaignAssignment {
  id: string;
  campaignId: string;
  assetId: string | null;
  pageHandle: string;
  creatorPhone: string | null;
  /** Set when this row's sheet entry already named a posted link (newTask.md, 8 Sep) — kept even after auto-attaching, same as pageHandle/creatorPhone. */
  postUrl: string | null;
  format: string | null;
  cost: string | null;
  /** Set once postUrl has been auto-attached to a real Link — never unset, so a row is only ever auto-attached once. */
  linkId: string | null;
  status: "pending" | "matched";
  createdAt: string;
  /** 2+ when this page's row belongs to an extra post of the phase (listAssignments, 22 Sep). */
  postNumber?: number;
  asset?: { id: string; handle: string; category: string | null; approvalStatus: string } | null;
  link?: { id: string; status: Link["status"] } | null;
}

export interface LinkCostRevision {
  id: string;
  linkId: string;
  previousCost: string;
  newCost: string;
  note: string | null;
  createdAt: string;
  revisedBy?: { id: string; name: string | null };
}

export interface PostSnapshot {
  likeCount: number;
  commentsCount: number;
  videoViews: number;
  capturedAt: string;
}

// Mirrors server/src/modules/invoices/service.js's INVOICEABLE_STATUSES —
// kept here, not redefined per-component, so the two can't drift apart.
// Screenshot approval is the real "was the work done" gate; insights
// (Apify metrics) are not required before a link can be invoiced.
// Mirrors server/src/modules/invoices/service.js's INVOICEABLE_STATUSES: a
// screenshot/insights are optional proof, not a gate (user request, 12 Sep)
// — only a rejected screenshot, a broken (INVALID) link, or an already
// INVOICED one is excluded.
export const INVOICEABLE_LINK_STATUSES: Link["status"][] = [
  "SUBMITTED",
  "PENDING_SCREENSHOT_REVIEW",
  "SCREENSHOT_APPROVED",
  "INSIGHTS_PENDING",
  "INSIGHTS_APPROVED",
];
export const INVOICEABLE_LINK_STATUSES_CSV = INVOICEABLE_LINK_STATUSES.join(",");

export interface Link {
  id: string;
  campaignId: string;
  assetId: string;
  submittedById: string;
  url: string;
  format: string;
  cost: string;
  customRate: boolean;
  status:
    | "SUBMITTED"
    | "PENDING_SCREENSHOT_REVIEW"
    | "SCREENSHOT_REJECTED"
    | "SCREENSHOT_APPROVED"
    | "INSIGHTS_PENDING"
    | "INSIGHTS_APPROVED"
    | "INVOICED"
    | "INVALID";
  postedAt: string | null;
  /** Beyond the posts the campaign booked for this page (29 Sep) — the creator's own extra: never invoiced, paid, or counted toward spend. */
  overQuota?: boolean;
  createdAt: string;
  campaign?: Campaign;
  asset?: Asset;
  screenshot?: { id: string; publicId: string; approved: boolean | null; url: string | null } | null;
  /** Present (on GET /links) when the link already sits on an invoice — even if its status hasn't caught up. */
  invoiceItem?: { invoiceId: string; invoice?: { invoiceNumber: string; status: Invoice["status"] } } | null;
  /** Present when the link already sits on an admin-initiated Payout (tasks.md #5, 23 Sep) — the mirror of invoiceItem for that mechanism. */
  payoutItem?: { payoutId: string } | null;
  postSnapshots?: PostSnapshot[];
}

export interface LinkStatusEvent {
  id: string;
  linkId: string;
  status: Link["status"];
  note: string | null;
  createdAt: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Invoice {
  id: string;
  creatorId: string;
  invoiceNumber: string;
  amount: string; // final total = subtotal + gstAmount
  subtotal: string;
  isGstInvoice: boolean;
  gstAmount: string;
  status: "DRAFT" | "RAISED" | "APPROVED" | "REJECTED" | "PAID";
  paymentStatus: "PENDING" | "COMPLETED" | "CANCELLED";
  gstStatus: "PENDING" | "SCHEDULED" | "COMPLETED";
  remarks: string | null;
  dueDate: string | null;
  paidAt: string | null;
  createdAt: string;
  overdueDays: number;
  creator?: { id: string; name: string | null; phoneNumber: string | null; email?: string | null };
  /** Set when the invoice is tied to one campaign — always for one generated from a campaign page (12 Sep), and for a creator-raised one whose links all share a campaign. */
  campaignId?: string | null;
  campaign?: { id: string; title: string; brandName: string } | null;
  /** Who generated it (Admin/Plan Maker for a campaign-generated invoice; the raiser for a bulk one). Null on older rows. */
  raisedById?: string | null;
  raisedBy?: { id: string; name: string | null; role: string } | null;
  /** The creator's own invoice document (PDF/image) attached to this record, if any (12 Sep). */
  attachment?: { name: string; url: string | null; uploadedAt: string | null; uploadedById: string | null } | null;
  /** Proof of payment Finance backfilled directly onto this invoice (28 Sep) — only ever set for a standalone-paid invoice with no Payout behind it; one paid through a Payout has its receipt there instead. */
  receipt?: { name: string; url: string | null; uploadedAt: string | null; uploadedById: string | null } | null;
  /** Posts on it beyond their campaign booking (29 Sep). Non-zero means it can't be approved or paid — reject it so the creator re-raises with only the booked posts. */
  overQuotaCount?: number;
  items?: { id: string; amount: string; link: Link }[];
  billingProfile?: BillingProfile | null;
}

/**
 * Receivables (user decision, 23 Sep): the ledger row for a plan's
 * Taggify → client invoice. Minted by plans.generateClientInvoice, listed
 * and settled via `clientInvoices` below. The document is still the plan's
 * (`GET /plans/:id/client-invoice.pdf`); `clientInvoices.downloadPdf` is the
 * same PDF reached without plan access.
 */
export interface ClientInvoice {
  id: string;
  planId: string;
  campaignId: string | null;
  invoiceNumber: string;
  subtotal: string;
  gstPercent: string | null;
  gstAmount: string;
  total: string;
  status: "ISSUED" | "PAID" | "CANCELLED";
  issuedAt: string;
  paidAt: string | null;
  paidAmount: string | null;
  remarks: string | null;
  plan?: {
    id: string;
    name: string;
    clientName: string;
    clientCompany: string | null;
    clientGstNumber: string | null;
    createdById: string;
    createdBy?: { id: string; name: string | null } | null;
    campaign?: { id: string; title: string; brandName: string } | null;
    /** The real (non-Proforma) invoice document, attached from the Plan page or the Payments tab (tasks.md #5, 23 Sep). */
    invoiceAttachment?: { name: string; url: string | null; uploadedAt: string | null; uploadedById: string | null } | null;
  } | null;
  issuedBy?: { id: string; name: string | null; role: Role } | null;
}

export interface TeamMembership {
  id: string;
  userId: string;
  creatorId: string;
  canSeeMoney: boolean;
  createdAt: string;
}

export interface JobRun {
  id: string;
  jobName: string;
  status: "running" | "success" | "failed";
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
}

// "Inventory" (newTask.md #13) — a pitch document built from a set of pages.
export interface PlanItem {
  id: string;
  planId: string;
  assetId: string;
  format: string;
  cost: string;
  /** Client-facing price for this line when it differs from `cost` — null shows `cost` as-is. Never rendered in the PDF directly; the server resolves the fallback once. */
  clientCost: string | null;
  /** How many posts on this page this line covers — cost/clientCost above are per-post. */
  postsPerProfile: number;
  asset?: { id: string; handle: string; category: string | null; followers: number };
}

export interface Plan {
  id: string;
  name: string;
  clientName: string;
  clientContact: string | null;
  /** Client-details block (user request, 10 Sep — company/GST/address). */
  clientCompany: string | null;
  clientGstNumber: string | null;
  clientAddress: string | null;
  /** Client invoice (user request, 13 Sep) — phone collected by the "Generate invoice" popup. */
  clientPhone: string | null;
  /** The Taggify → client invoice number, minted on first generation and kept across regenerations. Null until generated. */
  clientInvoiceNumber: string | null;
  clientInvoiceAt: string | null;
  /** Saved from the "Generate invoice" popup (17 Sep). */
  invoiceDescription: string | null;
  hsnSac: string | null;
  /** Free-form brief/note, rendered as an extra bullet on the PDF's NOTES block. */
  notes: string | null;
  budget: string | null;
  /** Whether the PDF/overview adds a GST line on top of the client subtotal — derived from gstPercent. */
  isGstPlan: boolean;
  /** The GST % applied to this plan's overview/invoice, editable at plan creation. Null = no GST line. */
  gstPercent: number | null;
  /** Approval workflow (newTask.md, 8 Sep — Plan → Approve step). New plans start DRAFT. */
  status: "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "REJECTED";
  approvedBy?: { id: string; name: string | null } | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  items: PlanItem[];
  /** Internal — sum of every item's real cost × postsPerProfile. Admin-eyes-only; never shown to the client. */
  totalCost: number;
  /** budget - totalCost. Positive = under budget, negative = over. Null if no budget was set. */
  budgetVariance: number | null;
  /** Summed avg. likes/views across the plan's distinct pages. */
  expectedEngagement: { likes: number; views: number };
  /** Client-facing totals — matches the "CAMPAIGN OVERVIEW" block on the PDF.
   *  Each number reflects Step 3's override when one is set (see `internal`
   *  below for the real computed number regardless of any override). */
  overview: {
    totalFollowers: number;
    totalPosts: number;
    /** Estimated from avg. views per post — there's no real impressions metric captured anywhere. */
    expectedImpressions: number;
    subtotal: number;
    gstAmount: number;
    total: number;
  };
  /** The real numbers, ignoring any Step 3 override — what the internal PDF renders. */
  internal: {
    computedFollowers: number;
    computedPosts: number;
    computedImpressions: number;
    computedSubtotal: number;
    computedGstAmount: number;
    computedTotal: number;
  };
  /** Step 3's editable client-facing overrides — null means "use the computed value" (see `overview` above). */
  overrideFollowers: number | null;
  overridePosts: number | null;
  overrideImpressions: number | null;
  overrideCost: string | null;
  /** "Plan B or other plan" (user request, 10 Sep) — plans sharing this id started from one client-details/budget shell; null until "Add Plan B" is used. */
  pitchGroupId: string | null;
  /** "Plan A" / "Plan B" / etc — which sibling this is within its pitch group. */
  variantLabel: string;
  /** The Google Sheet's layout (8 Oct): "breakdown" = a row per page category, "summary" = one campaign-overview block. */
  sheetFormat?: SheetFormat;
  /** The generated client-facing Google Sheet link (user request, 10 Sep — "plan will be of google sheet ... generate google sheet and will provide link"). Null until generated. */
  clientSheetUrl: string | null;
  /** The generated internal (real-numbers) Google Sheet link — "list of plans ... option of viewing googlesheet of plan for client or internal". Null until generated. */
  internalSheetUrl: string | null;
  /** The execution tracking sheet (user request, 10 Sep). Since 23 Sep it is read on attach / Refresh links: rows with a Posted Link become SUBMITTED links for the page's owner on the plan's campaign. */
  executionSheetUrl: string | null;
  /** When the execution sheet was last read into links. Null until the plan is approved and the sheet has been read once. */
  executionSheetFetchedAt?: string | null;
  /** Sheet rows that didn't become links, with why (page not on the plan, no post link yet, more posts than booked…). */
  executionSheetPending?: ExecutionSheetPendingEntry[];
  /** Only on the PUT /plans/:id response: the link saved but the sheet couldn't be read right now (not shared, wrong columns). */
  executionSheetSyncError?: string;
  /** "Upload plan" (user request, 22 Sep): the Google Sheet this plan was built from — Refresh re-fetches it. Null for wizard-built plans. */
  sourceSheetUrl?: string | null;
  sourceSheetFetchedAt?: string | null;
  /** Sheet rows that couldn't become items yet (page not in Inventory / no cost) or a budget the pages exceed — what the card lists as missing. */
  sourceSheetPending?: SheetPendingEntry[];
  /** Set once, on approval — the real Campaign created from this plan's pages (user request, 10 Sep — "on his marking all pages mentioned in the plan will get the campaign visible"). Null until approved. */
  campaignId: string | null;
  /** Attached invoice PDF (user request, 14 Sep — "option of attaching invoice document in pdf format as well"). Null until one is uploaded. */
  invoiceAttachment?: { name: string; url: string | null; uploadedAt: string | null; uploadedById: string | null } | null;
  createdBy?: { id: string; name: string | null };
}

export interface ExecutionSheetPendingEntry {
  rowNumber: number;
  pageHandle: string | null;
  pageName: string | null;
  postUrl: string | null;
  reason: string;
}

export type SheetPendingEntry =
  | { kind: "page"; handle: string; pageUrl?: string | null; category: string | null; followers: number | null; format: string | null; cost: number | null; clientCost: number | null; postsPerProfile: number; reason: string }
  | { kind: "budget"; sheetBudget: number; reason: string };

export interface ParsedPlanSheetPayload {
  fields: { name?: string; clientName?: string; clientContact?: string; clientCompany?: string; clientGstNumber?: string; clientAddress?: string; notes?: string; budget?: number; gstPercent?: number };
  rows: { handle: string; pageUrl?: string; category?: string; followers?: number; format?: string; cost?: number; clientCost?: number; postsPerProfile?: number }[];
}

export interface Notification {
  id: string;
  userId: string;
  type: string;
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

// ── Auth ────────────────────────────────────────────────────────────
export const auth = {
  // credentials: "include" — sends/accepts the trusted-device cookie
  // ("skip OTP for 7 days", 23 Sep). Login must send whatever cookie this
  // browser already has; verify-otp is what sets a fresh one.
  // Email + password only (24 Sep) — phone-number login is gone.
  login: (email: string, password: string) =>
    request<LoginResult>("/auth/login", { method: "POST", body: { email, password }, credentials: "include" }),
  // remember defaults true (the checkbox next to the code entry starts
  // checked) — unchecking it still signs in, just without a trusted-device
  // cookie, so the next login asks for OTP again.
  verifyLoginOtp: (challengeToken: string, code: string, remember = true) =>
    request<AuthResponse>("/auth/login/verify-otp", { method: "POST", body: { challengeToken, code, remember }, credentials: "include" }),
  resendLoginOtp: (challengeToken: string) =>
    request<void>("/auth/login/resend-otp", { method: "POST", body: { challengeToken } }),
  // Also the "resend" for email setup — the server rate-limits repeats.
  startEmailVerification: (identity: EmailSetupIdentity, email: string) =>
    request<{ emailHint: string }>("/auth/email/start", {
      method: "POST",
      ...("token" in identity ? { token: identity.token, body: { email } } : { body: { email, challengeToken: identity.challengeToken } }),
    }),
  confirmEmailVerification: (identity: EmailSetupIdentity, code: string) =>
    request<AuthResponse>("/auth/email/confirm", {
      method: "POST",
      ...("token" in identity ? { token: identity.token, body: { code } } : { body: { code, challengeToken: identity.challengeToken } }),
    }),
  refresh: (refreshToken: string) =>
    request<AuthResponse>("/auth/refresh", { method: "POST", body: { refreshToken } }),
  logout: (refreshToken: string) =>
    request<void>("/auth/logout", { method: "POST", body: { refreshToken } }),
  changePassword: (token: string, currentPassword: string, newPassword: string) =>
    request<void>("/auth/change-password", { method: "POST", token, body: { currentPassword, newPassword } }),
  // Admin-only — creates the account and returns a system-generated password, shown once.
  // `permissions` (only meaningful when role is "ADMIN") is the sub-admin
  // creation path (newTask.md, 8 Sep) — omit it, or leave every key true, for a plain admin.
  // Email required (the new account's login), phone optional; the password is generated server-side and returned once.
  signup: (token: string, body: { email: string; phoneNumber?: string; name?: string; role: Role; permissions?: Partial<Permissions> }) =>
    request<{ user: User; generatedPassword: string }>("/auth/signup", { method: "POST", token, body }),
};

// ── Users ───────────────────────────────────────────────────────────
export const users = {
  me: (token: string) => request<User>("/users/me", { token }),
  updateProfile: (token: string, body: Partial<Pick<User, "name" | "email" | "secondaryPhone" | "addressLine1" | "addressLine2" | "state" | "pincode">>) =>
    request<User>("/users/me", { method: "PUT", token, body }),
  team: (token: string) => request<TeamMembership[]>("/users/me/team", { token }),
  addTeamMember: (token: string, userId: string, canSeeMoney: boolean) =>
    request<TeamMembership>("/users/me/team", { method: "POST", token, body: { userId, canSeeMoney } }),
};

// ── Billing profiles ───────────────────────────────────────────────
export const billing = {
  list: (token: string) => request<BillingProfile[]>("/billing-profiles", { token }),
  create: (token: string, body: { pan: string; name: string; gstin?: string; msme?: string; bankAccountNumber: string; ifscCode: string }) =>
    request<BillingProfile>("/billing-profiles", { method: "POST", token, body }),
  setApproval: (token: string, id: string, approvalStatus: BillingProfile["approvalStatus"]) =>
    request<BillingProfile>(`/billing-profiles/${id}/approval`, { method: "PUT", token, body: { approvalStatus } }),
  // Edit details (22 Sep) — owner, or Admin / finance.manage for anyone; an
  // owner's edit sends the profile back to "pending" server-side.
  update: (token: string, id: string, body: Partial<Pick<BillingProfile, "pan" | "name" | "gstin" | "msme" | "bankAccountNumber" | "ifscCode">>) =>
    request<BillingProfile>(`/billing-profiles/${id}`, { method: "PUT", token, body }),
};

// ── Assets ──────────────────────────────────────────────────────────
export const assets = {
  list: (token: string) => request<Asset[]>("/assets", { token }),
  create: (token: string, handle: string, platform = "instagram", opts: { category?: string; ownerId?: string; rateCards?: { format: string; amount: number }[] } = {}) =>
    request<Asset>("/assets", { method: "POST", token, body: { handle, platform, ...opts } }),
  updateRateCard: (token: string, assetId: string, rateCards: { format: string; amount: number }[]) =>
    request<RateCard[]>(`/assets/${assetId}/rate-card`, { method: "PUT", token, body: { rateCards } }),
  // Category + manual engagement from Inventory's Edit panel (28 Sep). Only the
  // keys sent are touched; null clears one (no category, or that figure back to
  // whatever the scrape says).
  updateDetails: (token: string, assetId: string, body: { category?: string | null; avgViews?: number | null; avgLikes?: number | null; avgComments?: number | null }) =>
    request<Asset>(`/assets/${assetId}/details`, { method: "PUT", token, body }),
  setApproval: (token: string, assetId: string, approvalStatus: "approved" | "rejected" | "pending") =>
    request<Asset>(`/assets/${assetId}/approval`, { method: "PUT", token, body: { approvalStatus } }),
  // Active / Inactive (8 Oct) — admins only (ADMIN role + inventory.edit, server-side).
  setActive: (token: string, assetId: string, isActive: boolean) => request<Asset>(`/assets/${assetId}/active`, { method: "PUT", token, body: { isActive } }),
  // Inventory's manual "refresh" button — re-pulls followers/name/bio/avatar
  // from Apify right now instead of waiting for the 24h cron. Returns the
  // bare updated row (no rateCards/engagement/owner joins, unlike list()) —
  // callers should invalidate ["assets"] and refetch rather than read this
  // directly.
  // Bulk version for a selection — queues background scrapes, returns at once.
  refreshProfiles: (token: string, assetIds: string[]) => request<{ queued: number }>("/assets/refresh-profiles", { method: "POST", token, body: { assetIds } }),
  refreshProfile: (token: string, assetId: string) =>
    request<{ id: string; handle: string; followers: number }>(`/assets/${assetId}/refresh-profile`, { method: "POST", token }),
  // Inventory card's cover photo — routed through our own server instead of
  // an <img> hotlinking cdninstagram.com directly (user report, 11 Sep: the
  // direct link intermittently came back broken; server/src/modules/assets/
  // service.js's fetchProfilePic explains why). No token needed: this route
  // is deliberately public (an <img> tag can't send an Authorization header
  // anyway, and the picture is already public on Instagram itself).
  profilePicUrl: (assetId: string) => `${API_URL}/assets/${assetId}/profile-pic`,
  // Inventory "Create page" / "Import pages" (user request, 14 Sep). Admin
  // only — creator accounts a page can be registered under.
  owners: (token: string) => request<PageOwner[]>("/assets/owners", { token }),
  // Step 1: upload the raw .xlsx/.csv bytes, get back a per-row preview
  // (resolved account, status, reason) without anything being created.
  previewImport: (token: string, file: File) =>
    requestWithFile<ImportPreview>("/assets/import/preview", token, file),
  // Step 1, from a pasted Google Sheet share link (fetched server-side as CSV).
  previewImportUrl: (token: string, url: string) => request<ImportPreview>("/assets/import/preview-url", { method: "POST", token, body: { url } }),
  // Live follower counts / avg views for previewed handles (≤100 per call; one Apify run). A null entry = private/missing profile.
  importFollowers: (token: string, handles: string[]) =>
    request<{ profiles: Record<string, ImportScrapedProfile | null> }>("/assets/import/followers", { method: "POST", token, body: { handles } }),
  // Step 2: create exactly the rows the admin confirmed.
  import: (token: string, rows: ImportAssetRow[]) =>
    request<ImportResult>("/assets/import", { method: "POST", token, body: { rows } }),
  // The sheet the importer reads (14 Oct): Page Name, Page Link, Vendor Name, Vendor Contact, Followers, Reel Rate, Story Rate.
  downloadImportTemplate: (token: string) => downloadBinary(`${API_URL}/assets/import/template.xlsx`, token, "import-pages-template.xlsx"),
};

export interface PageOwner {
  id: string;
  name: string | null;
  phoneNumber: string | null;
  email?: string | null;
}

export type ImportRowStatus = "ready" | "invalid" | "duplicate" | "exists" | "conflict" | "owner-missing" | "owner-unknown";

export interface ImportPreviewRow {
  rowNumber: number;
  rawHandle: string;
  handle: string | null;
  /** The sheet's "Page Name" column — saved as the page's display name. */
  pageName?: string | null;
  category: string | null;
  followers: number | null;
  rateCards: { format: string; amount: number }[];
  /** What the sheet's owner cell said, verbatim. */
  ownerRef: string | null;
  /** The account this row resolved to (or already lives under, for "exists"). */
  owner: { id: string; name: string | null; phoneNumber: string | null; email?: string | null } | null;
  ownerId: string | null;
  status: ImportRowStatus;
  reason: string | null;
  /** What the sheet's Vendor Name / Vendor Contact columns said (14 Oct). */
  vendor?: ImportVendorContact | null;
}

export interface ImportVendorContact {
  name: string | null;
  phone: string | null;
  email: string | null;
}

/** A vendor the sheet named that isn't in Taggify yet, with the rows that belong to it (14 Oct). */
export interface ImportNewVendor extends ImportVendorContact {
  key: string;
  rowNumbers: number[];
}

export interface ImportPreview {
  rows: ImportPreviewRow[];
  summary: Partial<Record<ImportRowStatus, number>>;
  totalRows: number;
  hasOwnerColumn: boolean;
  owners: PageOwner[];
  /** Always empty for a CREATOR caller. Absent on older servers. */
  newVendors?: ImportNewVendor[];
}

export interface ImportScrapedProfile {
  followers: number;
  avgViews: number | null;
  avgLikes: number | null;
  avgComments: number | null;
  fullName: string | null;
}

export interface ImportAssetRow {
  handle: string;
  ownerId: string;
  category?: string | null;
  pageName?: string | null;
  followers?: number | null;
  rateCards?: { format: string; amount: number }[];
}

export interface ImportResult {
  created: { id: string; handle: string; ownerId: string; approvalStatus: string; owner: { id: string; name: string | null; phoneNumber: string | null; email?: string | null } }[];
  skipped: { handle: string; reason: string }[];
}

/** POSTs a file's raw bytes (not JSON) — same auth/error conventions as request(), including the one-shot refresh on 401. */
async function requestWithFile<T>(path: string, token: string, file: File, _isRetry = false): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "X-File-Name": encodeURIComponent(file.name),
      Authorization: `Bearer ${token}`,
    },
    body: file,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !_isRetry) {
      const freshToken = await refreshAccessToken();
      if (freshToken) return requestWithFile<T>(path, freshToken, file, true);
    }
    throw new ApiError(res.status, data?.error?.code ?? "UNKNOWN", data?.error?.message ?? res.statusText);
  }
  return data as T;
}

// ── Campaigns ───────────────────────────────────────────────────────
export const campaigns = {
  list: (token: string) => request<Campaign[]>("/campaigns", { token }),
  get: (token: string, id: string) => request<Campaign>(`/campaigns/${id}`, { token }),
  create: (
    token: string,
    body: {
      brandName: string;
      title: string;
      deadline?: string;
      costCap?: number;
      sheetLink?: string;
      // postUrl/format/cost (newTask.md, 8 Sep) — a row naming an already-
      // posted link gets it auto-attached to the matched creator's posts
      // straight away; see server's autoAttachLinkIfPossible.
      assignments?: { handle: string; phone?: string; postUrl?: string; format?: string; cost?: number }[];
    }
  ) =>
    request<{ campaign: Campaign; matchedCount: number; pendingCount: number; autoAttachedCount: number }>("/campaigns", {
      method: "POST",
      token,
      body,
    }),
  update: (token: string, id: string, body: { brandName?: string; title?: string; deadline?: string | null; costCap?: number | null }) =>
    request<Campaign>(`/campaigns/${id}`, { method: "PUT", token, body }),
  listAssignments: (token: string, campaignId: string) =>
    request<CampaignAssignment[]>(`/campaigns/${campaignId}/assignments`, { token }),
  resolveAssignment: (token: string, campaignId: string, assignmentId: string, assetId: string) =>
    request<CampaignAssignment>(`/campaigns/${campaignId}/assignments/${assignmentId}`, {
      method: "PUT",
      token,
      body: { assetId },
    }),
  // bugs.md #6 — fetches a public Google Sheet's CSV export server-side
  // (avoids the browser CORS restriction a direct client-side fetch to
  // docs.google.com would hit) so it can be parsed exactly like an
  // uploaded CSV file.
  importSheetUrl: (token: string, url: string) => request<{ csv: string }>("/campaigns/import-sheet-url", { method: "POST", token, body: { url } }),
  // newTask.md, 8 Sep — more posts under the same brand deal become a new
  // phase, not a brand-new campaign; campaignId can be any phase's id.
  createPhase: (token: string, campaignId: string, title?: string) =>
    request<Campaign>(`/campaigns/${campaignId}/phases`, { method: "POST", token, body: { title } }),
  // Admin only (22 Sep): deletes a phase (not Phase 1) and its extra posts; 409 PHASE_HAS_POSTS while anything was submitted/invoiced on it.
  deletePhase: (token: string, phaseId: string) => request<{ deleted: number; rootId: string }>(`/campaigns/${phaseId}/phase`, { method: "DELETE", token }),
};

// ── Links ───────────────────────────────────────────────────────────
export const links = {
  list: (
    token: string,
    params: {
      status?: string;
      assetId?: string;
      // "Vendor" filter (tasks.md #5, 23 Sep — Payments tab): the page's owner.
      ownerId?: string;
      campaignId?: string;
      from?: string;
      to?: string;
      page?: number;
      pageSize?: number;
      unbilled?: boolean;
      // Payout-eligible list (tasks.md #5, 23 Sep): not already on a payout or an invoice.
      unpaid?: boolean;
    } = {}
  ) => {
    const qs = new URLSearchParams();
    if (params.status) qs.set("status", params.status);
    if (params.unbilled) qs.set("unbilled", "true");
    if (params.unpaid) qs.set("unpaid", "true");
    if (params.assetId) qs.set("assetId", params.assetId);
    if (params.ownerId) qs.set("ownerId", params.ownerId);
    if (params.campaignId) qs.set("campaignId", params.campaignId);
    if (params.from) qs.set("from", params.from);
    if (params.to) qs.set("to", params.to);
    qs.set("page", String(params.page ?? 1));
    qs.set("pageSize", String(params.pageSize ?? 100));
    return request<Paginated<Link>>(`/links?${qs}`, { token });
  },
  create: (token: string, body: { campaignId: string; assetId: string; url: string; format: string }) =>
    request<Link>("/links", { method: "POST", token, body }),
  // creator.wldd.in's "Upload Links" — one campaign/asset/format, many URLs at once.
  bulkCreate: (token: string, body: { campaignId: string; assetId: string; format: string; urls: string[] }) =>
    request<{ created: Link[]; skipped: { url: string; reason: string }[]; totalSubmitted: number }>("/links/bulk", {
      method: "POST",
      token,
      body,
    }),
  // Admin sheet import of already-done work (newTask.md #8) — resolves each
  // row's campaign/page by name, skipping (not failing the batch) any row
  // that doesn't match or was already submitted.
  bulkImport: (token: string, rows: { campaignTitle: string; pageHandle: string; url: string; format: string; cost?: number }[]) =>
    request<{ created: Link[]; skipped: { row: unknown; reason: string }[]; totalSubmitted: number }>("/links/bulk-import", {
      method: "POST",
      token,
      body: { rows },
    }),
  timeline: (token: string, linkId: string) =>
    request<LinkStatusEvent[]>(`/links/${linkId}/timeline`, { token }),
  reviewScreenshot: (token: string, linkId: string, approved: boolean, note?: string) =>
    request<Link>(`/links/${linkId}/review-screenshot`, { method: "POST", token, body: { approved, note } }),
  approveInsights: (token: string, linkId: string) =>
    request<Link>(`/links/${linkId}/approve-insights`, { method: "POST", token }),
  refreshMetrics: (token: string, linkId: string) =>
    request<{ ok: boolean; reason?: string }>(`/links/${linkId}/refresh-metrics`, { method: "POST", token }),
  reviseCost: (token: string, linkId: string, cost: number, note?: string) =>
    request<Link>(`/links/${linkId}/cost`, { method: "PUT", token, body: { cost, note } }),
  costRevisions: (token: string, linkId: string) =>
    request<LinkCostRevision[]>(`/links/${linkId}/cost-revisions`, { token }),
  markInvalid: (token: string, linkId: string, note: string) =>
    request<Link>(`/links/${linkId}/mark-invalid`, { method: "POST", token, body: { note } }),
};

// ── Screenshots ─────────────────────────────────────────────────────
// Cloudinary signed direct upload: get signed params, PUT the file straight
// to Cloudinary from the browser, then confirm with the API.
export const screenshots = {
  requestUploadUrl: (token: string, linkId: string) =>
    request<{ uploadUrl: string; apiKey: string; timestamp: number; signature: string; publicId: string }>(
      `/links/${linkId}/screenshot/upload-url`,
      { method: "POST", token }
    ),
  confirm: (token: string, linkId: string, publicId: string) =>
    request<{ id: string; publicId: string; url: string | null }>(`/links/${linkId}/screenshot`, {
      method: "POST",
      token,
      body: { publicId },
    }),
};

// ── Receivables: client invoices (23 Sep) ────────────────────────────
export const clientInvoices = {
  list: (token: string, params: { status?: ClientInvoice["status"]; campaignId?: string; search?: string; hasAttachment?: boolean } = {}) => {
    const qs = new URLSearchParams();
    if (params.status) qs.set("status", params.status);
    if (params.campaignId) qs.set("campaignId", params.campaignId);
    if (params.search) qs.set("search", params.search);
    if (params.hasAttachment) qs.set("hasAttachment", "true");
    const q = qs.toString();
    return request<{ items: ClientInvoice[]; total: number }>(`/invoices/client${q ? `?${q}` : ""}`, { token });
  },
  markPaid: (token: string, id: string, body: { paidAmount?: number; remarks?: string } = {}) =>
    request<ClientInvoice>(`/invoices/client/${id}/mark-paid`, { method: "POST", token, body }),
  cancel: (token: string, id: string, remarks: string) => request<ClientInvoice>(`/invoices/client/${id}/cancel`, { method: "POST", token, body: { remarks } }),
  downloadPdf: (token: string, id: string, invoiceNumber?: string | null) =>
    downloadBinary(`${API_URL}/invoices/client/${id}/pdf`, token, `${(invoiceNumber ?? id).replace(/[^A-Za-z0-9._-]+/g, "-")}.pdf`),
};

// ── Invoices ────────────────────────────────────────────────────────
export const invoices = {
  list: (
    token: string,
    params: { campaignId?: string; status?: string; paymentStatus?: string; search?: string; page?: number; pageSize?: number } = {}
  ) => {
    const qs = new URLSearchParams();
    if (params.campaignId) qs.set("campaignId", params.campaignId);
    if (params.status) qs.set("status", params.status);
    if (params.paymentStatus) qs.set("paymentStatus", params.paymentStatus);
    if (params.search) qs.set("search", params.search);
    qs.set("page", String(params.page ?? 1));
    qs.set("pageSize", String(params.pageSize ?? 100));
    return request<Paginated<Invoice>>(`/invoices?${qs}`, { token });
  },
  bulkCreate: (token: string, linkIds: string[], dueInDays = 15, isGstInvoice = false) =>
    request<Invoice>("/invoices/bulk", { method: "POST", token, body: { linkIds, dueInDays, isGstInvoice } }),
  // Attached invoice document (12 Sep) — same two-step direct-to-Cloudinary
  // upload as screenshots: mint a signed upload, PUT the bytes there, confirm.
  requestAttachmentUpload: (token: string, invoiceId: string) =>
    request<{ uploadUrl: string; apiKey: string; timestamp: number; signature: string; publicId: string }>(`/invoices/${invoiceId}/attachment/upload-url`, {
      method: "POST",
      token,
    }),
  confirmAttachment: (token: string, invoiceId: string, publicId: string, fileName: string) =>
    request<NonNullable<Invoice["attachment"]>>(`/invoices/${invoiceId}/attachment`, { method: "POST", token, body: { publicId, fileName } }),
  removeAttachment: (token: string, invoiceId: string) => request<void>(`/invoices/${invoiceId}/attachment`, { method: "DELETE", token }),
  // Admin sign-off, RAISED → APPROVED (Finance then marks paid).
  approve: (token: string, invoiceId: string) =>
    request<Invoice>(`/invoices/${invoiceId}/approve`, { method: "POST", token }),
  // Finance backfilling proof of payment onto a legacy standalone-paid invoice
  // (28 Sep) — an invoice is otherwise paid off exclusively via a Payout now (see PaySheet).
  requestReceiptUpload: (token: string, invoiceId: string) =>
    request<{ uploadUrl: string; apiKey: string; timestamp: number; signature: string; publicId: string }>(`/invoices/${invoiceId}/receipt-upload`, {
      method: "POST",
      token,
    }),
  confirmReceipt: (token: string, invoiceId: string, publicId: string, fileName: string) =>
    request<NonNullable<Invoice["receipt"]>>(`/invoices/${invoiceId}/receipt`, { method: "POST", token, body: { publicId, fileName } }),
  reject: (token: string, invoiceId: string, remarks: string) =>
    request<Invoice>(`/invoices/${invoiceId}/reject`, { method: "POST", token, body: { remarks } }),
  updateGstStatus: (token: string, invoiceId: string, gstStatus: Invoice["gstStatus"]) =>
    request<Invoice>(`/invoices/${invoiceId}/gst-status`, { method: "PUT", token, body: { gstStatus } }),
  updatePaymentStatus: (token: string, invoiceId: string, paymentStatus: Invoice["paymentStatus"]) =>
    request<Invoice>(`/invoices/${invoiceId}/payment-status`, { method: "PUT", token, body: { paymentStatus } }),
  // Plain-text list of the invoice's post URLs — creator.wldd.in's "Download Links", separate from the PDF.
  downloadLinks: async (token: string, invoiceId: string, invoiceNumber?: string) => {
    const res = await fetch(`${API_URL}/invoices/${invoiceId}/links.txt`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new ApiError(res.status, data?.error?.code ?? "UNKNOWN", data?.error?.message ?? res.statusText);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${invoiceNumber ?? invoiceId}-links.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
  // Binary response (not JSON) — fetched with the auth header, then handed
  // to the browser as a download via an object URL (a plain <a href> can't
  // carry the Authorization header the API requires).
  downloadPdf: async (token: string, invoiceId: string, invoiceNumber?: string) => {
    const res = await fetch(`${API_URL}/invoices/${invoiceId}/pdf`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new ApiError(res.status, data?.error?.code ?? "UNKNOWN", data?.error?.message ?? res.statusText);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${invoiceNumber ?? invoiceId}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
};

/**
 * Admin/Finance-initiated payout to a creator/vendor (tasks.md #5, 23 Sep —
 * the Payments tab's internal-costing side). Distinct from Invoice, which is
 * the creator's own self-raised bill: here Finance picks the links and pays.
 * DRAFT means the links are locked but no receipt has been attached yet;
 * confirming the receipt upload is what flips it to PAID.
 */
export interface Payout {
  id: string;
  creatorId: string;
  subtotal: string;
  isGstInvoice: boolean;
  gstAmount: string;
  tdsPercent: string | null;
  tdsAmount: string;
  netAmount: string; // subtotal + gstAmount - tdsAmount, what actually gets paid
  status: "DRAFT" | "PAID" | "CANCELLED";
  paidAt: string | null;
  /** Bank reference typed when marking paid (24 Sep redesign) — optional. */
  utr?: string | null;
  createdAt: string;
  creator?: { id: string; name: string | null; phoneNumber: string | null; email?: string | null } | null;
  createdBy?: { id: string; name: string | null } | null;
  markedPaidBy?: { id: string; name: string | null } | null;
  receipt?: { name: string; url: string | null; uploadedAt: string | null } | null;
  items?: { id: string; amount: string; link: PayoutItemLink }[];
}

/** One link as a payout carries it — enough for the Paid tab's expanded row. */
export type PayoutItemLink = Pick<Link, "id" | "url" | "format" | "assetId"> &
  Partial<Pick<Link, "cost" | "status" | "postedAt" | "createdAt" | "campaignId" | "postSnapshots">> & {
    asset?: { id: string; handle: string };
    campaign?: { id: string; title: string; brandName: string };
  };

/** A payable link on the Payments tab's Pending list (24 Sep redesign) — carries its page owner so the list can group by vendor. */
export type PendingLink = Link & {
  asset: { id: string; handle: string; ownerId: string; owner?: PageOwner | null };
  campaign?: Campaign;
};

/**
 * A creator-raised invoice on the Payments list (25 Sep) — an owed invoice is
 * paid as a whole from Payments; `selectable` is false once it's paid (or one of
 * its links is already on a payout), so the checkbox is disabled.
 */
export interface PaymentInvoice {
  id: string;
  invoiceNumber: string;
  creatorId: string;
  amount: string;
  subtotal: string;
  isGstInvoice: boolean;
  gstAmount: string;
  status: "RAISED" | "APPROVED" | "PAID";
  dueDate: string | null;
  paidAt: string | null;
  createdAt: string;
  creator?: PageOwner | null;
  links: PayoutItemLink[];
  selectable: boolean;
  /** Posts on it beyond their campaign booking (29 Sep) — when non-zero it's not selectable: it has to be rejected and re-raised. */
  overQuotaCount?: number;
  /** Set only on a legacy standalone-paid row (28 Sep fix) — never present on an owed invoice. */
  receipt?: { name: string; url: string | null; uploadedAt: string | null; uploadedById: string | null } | null;
}

/**
 * One row on the Paid tab's merged ledger (28 Sep fix): a real Payout (TDS +
 * receipt always present — the only way an invoice can be paid off going
 * forward) or, for legacy data from before the direct-mark-paid path was
 * removed, a standalone invoice paid with no TDS applied and — until Finance
 * backfills one — no receipt on file.
 */
export type PaidLedgerRow = { kind: "payout"; paidAt: string | null; payout: Payout } | { kind: "invoice"; paidAt: string | null; invoice: PaymentInvoice };
export type PaidLedgerResult = { items: PaidLedgerRow[]; total: number };

/** The Payments tiles (2 Oct): Pending and Paid for the same filters as the lists — follows the month picked. */
export interface PaymentSummary {
  /** Unpaid links + owed invoices. `links` counts the links inside those invoices too. */
  pending: { amount: number; links: number; invoices: number };
  /** Net paid out (payouts + legacy directly-paid invoices). */
  paid: { amount: number; links: number; payments: number };
}

/** Pending/Paid tab filters (24 Sep redesign). from/to are ISO instants. */
export interface PaymentsFilters {
  ownerId?: string;
  assetId?: string;
  q?: string;
  from?: string;
  to?: string;
}

export type PendingResult = { items: PendingLink[]; total: number; invoices: PaymentInvoice[] };

function paymentsQuery(params: PaymentsFilters & { status?: string; page?: number; pageSize?: number }) {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") qs.set(key, String(value));
  }
  return qs.toString();
}

// ── Payments tab (tasks.md #5, 23 Sep; redesigned 24 Sep) ───────────
// Everything but the two `my*` reads is admin/finance (finance.pay) only.
export const payments = {
  listPayouts: (
    token: string,
    params: { creatorId?: string; assetId?: string; q?: string; status?: Payout["status"]; from?: string; to?: string; page?: number; pageSize?: number } = {}
  ) => request<Paginated<Payout>>(`/payments/payouts?${paymentsQuery({ page: 1, pageSize: 100, ...params })}`, { token }),
  /** Every vendor's payable links — the Pending tab. */
  listPending: (token: string, filters: PaymentsFilters = {}) =>
    request<PendingResult>(`/payments/pending?${paymentsQuery({ pageSize: 500, ...filters })}`, { token }),
  /** Pending/Paid tile totals for the same filters as the lists. */
  summary: (token: string, filters: PaymentsFilters = {}) => {
    const qs = paymentsQuery(filters);
    return request<PaymentSummary>(`/payments/summary${qs ? `?${qs}` : ""}`, { token });
  },
  mySummary: (token: string, filters: Omit<PaymentsFilters, "ownerId"> = {}) => {
    const qs = paymentsQuery(filters);
    return request<PaymentSummary>(`/payments/me/summary${qs ? `?${qs}` : ""}`, { token });
  },
  /** Creator's own payable links (server forces the owner to the caller). */
  listMyPending: (token: string, filters: Omit<PaymentsFilters, "ownerId"> = {}) =>
    request<PendingResult>(`/payments/me/pending?${paymentsQuery({ pageSize: 500, ...filters })}`, { token }),
  /** Creator's own PAID payouts. */
  listMyPayouts: (token: string, filters: Omit<PaymentsFilters, "ownerId"> = {}) =>
    request<Paginated<Payout>>(`/payments/me/payouts?${paymentsQuery({ page: 1, pageSize: 100, ...filters })}`, { token }),
  /** The Paid tab's actual list (28 Sep fix): real Payouts plus any legacy standalone-paid invoice — matches what the "Paid this month" tile counts. */
  listPaid: (token: string, filters: Omit<PaymentsFilters, "ownerId"> & { creatorId?: string } = {}) =>
    request<PaidLedgerResult>(`/payments/paid?${paymentsQuery({ pageSize: 100, ...filters })}`, { token }),
  /** Creator's own paid ledger. */
  listMyPaid: (token: string, filters: Omit<PaymentsFilters, "ownerId"> = {}) =>
    request<PaidLedgerResult>(`/payments/me/paid?${paymentsQuery({ pageSize: 100, ...filters })}`, { token }),
  createPayout: (token: string, body: { creatorId: string; linkIds: string[]; invoiceIds?: string[]; isGstInvoice: boolean; tdsPercent: 1 | 2 | 10 | null }) =>
    request<Payout>("/payments/payouts", { method: "POST", token, body }),
  cancelPayout: (token: string, payoutId: string) => request<void>(`/payments/payouts/${payoutId}`, { method: "DELETE", token }),
  // Same two-step direct-to-Cloudinary upload as every other attachment here.
  requestReceiptUpload: (token: string, payoutId: string) =>
    request<{ uploadUrl: string; apiKey: string; timestamp: number; signature: string; publicId: string }>(`/payments/payouts/${payoutId}/receipt-upload`, {
      method: "GET",
      token,
    }),
  confirmReceipt: (token: string, payoutId: string, publicId: string, fileName: string, extra: { paidOn?: string; utr?: string } = {}) =>
    request<Payout>(`/payments/payouts/${payoutId}/receipt`, {
      method: "POST",
      token,
      body: { publicId, fileName, ...(extra.paidOn ? { paidOn: extra.paidOn } : {}), ...(extra.utr?.trim() ? { utr: extra.utr.trim() } : {}) },
    }),
};

// ── Notifications ───────────────────────────────────────────────────
export const notifications = {
  list: (token: string, unreadOnly = false) =>
    request<Notification[]>(`/notifications${unreadOnly ? "?unread=true" : ""}`, { token }),
  markRead: (token: string, id: string) =>
    request<void>(`/notifications/${id}/read`, { method: "POST", token }),
  markAllRead: (token: string) => request<void>("/notifications/read-all", { method: "POST", token }),
};

// ── Admin ───────────────────────────────────────────────────────────
export const admin = {
  users: (token: string) => request<User[]>("/admin/users", { token }),
  updateUserRole: (token: string, userId: string, role: Role) =>
    request<User>(`/admin/users/${userId}/role`, { method: "PUT", token, body: { role } }),
  jobRuns: (token: string) => request<JobRun[]>("/admin/job-runs", { token }),
  invoiceNumbering: (token: string) => request<InvoiceNumbering>("/admin/invoice-numbering", { token }),
  updateInvoiceNumbering: (token: string, body: { prefix?: string; nextNumber?: number }) =>
    request<InvoiceNumbering>("/admin/invoice-numbering", { method: "PUT", token, body }),
  // Manual trigger for the daily finance export (newTask.md #2) — same job
  // the cron runs, reported back synchronously so it's actually testable.
  runFinanceExportNow: (token: string) =>
    request<{ ok: true; commitSha?: string; htmlUrl?: string }>("/admin/finance-export/run-now", { method: "POST", token }),
  // Same, for the Google Sheet export (newTask.md, 8 Sep) — runs alongside
  // the GitHub export above, not instead of it.
  runFinanceGoogleSheetExportNow: (token: string) =>
    request<{ ok: true; spreadsheetUrl?: string }>("/admin/finance-google-sheet-export/run-now", { method: "POST", token }),
  // Reset-and-reveal, not a stored/recoverable password — see admin/service.js.
  resetPassword: (token: string, userId: string) =>
    request<{ generatedPassword: string }>(`/admin/users/${userId}/reset-password`, { method: "POST", token }),
  // Change a user's email — their login (24 Sep). The new address starts unverified; they're signed out everywhere.
  // People → Edit details (12 Oct) — full admins only, server-enforced. Send
  // only what changed; "" clears a field. Email stays on updateUserEmail.
  updateUserDetails: (token: string, userId: string, body: Partial<Record<UserDetailField, string>>) =>
    request<Pick<User, "id" | UserDetailField>>(`/admin/users/${userId}/details`, { method: "PUT", token, body }),
  createBillingProfileFor: (token: string, userId: string, body: { pan: string; name: string; gstin?: string; msme?: string; bankAccountNumber: string; ifscCode: string }) =>
    request<BillingProfile>(`/admin/users/${userId}/billing-profiles`, { method: "POST", token, body }),
  updateUserEmail: (token: string, userId: string, email: string) =>
    request<{ id: string; email: string; emailVerified: boolean }>(`/admin/users/${userId}/email`, { method: "PUT", token, body: { email } }),
  // Sub-admin permission edits (newTask.md, 8 Sep) — only the keys being
  // changed need to be sent; the server merges onto the existing overlay.
  updatePermissions: (token: string, userId: string, permissions: Partial<Permissions>) =>
    request<User>(`/admin/users/${userId}/permissions`, { method: "PUT", token, body: { permissions } }),
};

// ── Plans ("Inventory") ────────────────────────────────────────────
export interface PlanItemInput {
  assetId: string;
  format: string;
  /** Omit to fall back to the page's rate card for that format. */
  cost?: number;
  /** Client-facing price for this line, when it differs from cost — omit to show cost as-is. */
  clientCost?: number;
  /** How many posts on this page this line covers. Defaults to 1 server-side. */
  postsPerProfile?: number;
}

// One field set shared by create/update — every field beyond name/clientName
// is optional, matching the wizard's "fill what you have, come back later"
// shape (see the Plans list's completeness indicator).
export type SheetFormat = "breakdown" | "summary";

export interface PlanFields {
  sheetFormat?: SheetFormat;
  name: string;
  clientName: string;
  clientContact?: string;
  clientCompany?: string;
  clientGstNumber?: string;
  clientAddress?: string;
  notes?: string;
  budget?: number;
  gstPercent?: number | null;
  items?: PlanItemInput[];
  overrideFollowers?: number | null;
  overridePosts?: number | null;
  overrideImpressions?: number | null;
  overrideCost?: number | null;
}

export interface SheetImportResult {
  matchedCount: number;
  createdCount: number;
  addedCount: number;
  failures: { handle: string; reason: string }[];
  plan: Plan;
}

async function downloadBinary(url: string, token: string, filename: string) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(res.status, data?.error?.code ?? "UNKNOWN", data?.error?.message ?? res.statusText);
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}

/** One billing identity from earlier plans (server: plans/service.js's
 *  listSavedClients). Detail fields are all null for a name that has never
 *  been invoiced; one clientName can appear more than once (one brand,
 *  several GST registrations). */
export interface SavedClient {
  clientName: string;
  clientCompany: string | null;
  clientGstNumber: string | null;
  clientAddress: string | null;
  clientPhone: string | null;
}

export interface ClientInvoiceDetails {
  clientCompany: string;
  clientGstNumber: string;
  clientAddress: string;
  clientPhone?: string;
  /** The Proforma Invoice's one "Description of goods/service" line. */
  invoiceDescription: string;
  /** Blank = the company's default HSN/SAC. */
  hsnSac?: string;
  /** Admin/Finance only — a typed number instead of the counter's next one. */
  clientInvoiceNumber?: string;
}

/** Proforma Invoice numbering: `suggestion` is prefix + the zero-padded next number. */
export interface InvoiceNumbering {
  prefix: string;
  nextNumber: number;
  suggestion: string;
}

// The connected Google account behind per-plan sheets (22 Sep — its refresh
// token can expire/be revoked, which every sheet action then reports as
// GOOGLE_RECONNECT_REQUIRED). /authorize is a browser GET carrying the access
// token as a query param (an OAuth redirect can't take a header), opened in a
// new tab — never fetched.
export const integrations = {
  googleStatus: (token: string) => request<{ configured: boolean; connected: boolean; healthy: boolean }>("/integrations/google/status", { token }),
  googleAuthorizeUrl: (token: string) => `${API_URL}/integrations/google/authorize?token=${encodeURIComponent(token)}`,
};
/** The error codes a "Reconnect Google" action fixes. */
export const GOOGLE_RECONNECT_CODES = new Set(["GOOGLE_RECONNECT_REQUIRED", "GOOGLE_NOT_CONNECTED"]);
export const needsGoogleReconnect = (err: unknown) => err instanceof ApiError && GOOGLE_RECONNECT_CODES.has(err.code);

export const plans = {
  list: (token: string) => request<Plan[]>("/plans", { token }),
  get: (token: string, id: string) => request<Plan>(`/plans/${id}`, { token }),
  create: (token: string, body: PlanFields) => request<Plan>("/plans", { method: "POST", token, body }),
  // Every clearable text/number field accepts null here (server's
  // updatePlanSchema is the nullable one) — Omit+override rather than a
  // plain `&` intersection with PlanFields, since intersecting two
  // property types narrows to their overlap (`string` only, dropping both
  // `null` and `undefined`) instead of replacing the type outright.
  update: (
    token: string,
    id: string,
    body: Partial<
      Omit<PlanFields, "clientContact" | "clientCompany" | "clientGstNumber" | "clientAddress" | "budget" | "notes"> & {
        clientContact: string | null;
        clientCompany: string | null;
        clientGstNumber: string | null;
        clientAddress: string | null;
        budget: number | null;
        notes: string | null;
        executionSheetUrl: string | null;
      }
    >
  ) => request<Plan>(`/plans/${id}`, { method: "PUT", token, body }),
  remove: (token: string, id: string) => request<void>(`/plans/${id}`, { method: "DELETE", token }),
  // Approval workflow (user request, 11 Sep — "remove option of submit for
  // approval, plan maker or admin can approve plan by themselves only"):
  // approve/reject act directly on a DRAFT plan, no submit step first.
  // Server enforces who can call which: Admin on any plan, Plan Maker only
  // on their own.
  approve: (token: string, id: string) => request<Plan>(`/plans/${id}/approve`, { method: "POST", token }),
  // Plan B, C… (23 Sep) — a sibling with the same client details and an
  // empty budget/page selection; the server picks the next letter.
  createVariant: (token: string, id: string) => request<Plan>(`/plans/${id}/variant`, { method: "POST", token, body: {} }),
  reject: (token: string, id: string) => request<Plan>(`/plans/${id}/reject`, { method: "POST", token }),
  // Execution sheet → links (23 Sep): re-read the attached sheet and attach
  // every posted link it names to the plan's campaign. Also happens on its
  // own when the link is first saved on an approved plan.
  syncExecutionSheet: (token: string, id: string) =>
    request<{ plan: Plan; summary: { attached: number; alreadyLinked: number; pending: number; rows: number } }>(`/plans/${id}/execution-sheet/sync`, { method: "POST", token }),
  // Same pattern as campaigns.importSheetUrl — fetches a pasted Google
  // Sheet link server-side, returns its CSV text to parse client-side.
  // Client invoice (user request, 13 Sep — "on clicking generate invoice,
  // it'll ask for client details like gst, company address, phone number"):
  // the popup posts the details, the plan comes back with a
  // clientInvoiceNumber, then the PDF is fetched with the auth header and
  // handed to the browser as a download (same pattern as invoices.downloadPdf).
  invoiceNumbering: (token: string) => request<InvoiceNumbering & { defaultHsnSac: string; companyStateCode: string }>("/plans/client-invoice-numbering", { token }),
  // Saved clients (21 Sep) — billing identities from the caller's earlier
  // plans, for the wizard's Client name and the invoice popup's Company dropdowns.
  clients: (token: string) => request<SavedClient[]>("/plans/clients", { token }),
  generateClientInvoice: (token: string, id: string, body: ClientInvoiceDetails) =>
    request<Plan>(`/plans/${id}/client-invoice`, { method: "POST", token, body }),
  downloadClientInvoicePdf: (token: string, id: string, invoiceNumber?: string | null) =>
    downloadBinary(`${API_URL}/plans/${id}/client-invoice.pdf`, token, `${(invoiceNumber ?? id).replace(/[^A-Za-z0-9._-]+/g, "-")}.pdf`),
  // Attached invoice PDF (user request, 14 Sep) — same signed direct-to-
  // Cloudinary two-step as invoices.requestAttachmentUpload/confirmAttachment.
  requestInvoiceAttachmentUpload: (token: string, id: string) =>
    request<{ uploadUrl: string; apiKey: string; timestamp: number; signature: string; publicId: string }>(`/plans/${id}/invoice-attachment/upload-url`, {
      method: "POST",
      token,
    }),
  confirmInvoiceAttachment: (token: string, id: string, publicId: string, fileName: string) =>
    request<NonNullable<Plan["invoiceAttachment"]>>(`/plans/${id}/invoice-attachment`, { method: "POST", token, body: { publicId, fileName } }),
  removeInvoiceAttachment: (token: string, id: string) => request<void>(`/plans/${id}/invoice-attachment`, { method: "DELETE", token }),
  importSheetUrl: (token: string, url: string) => request<{ csv: string }>("/plans/import-sheet-url", { method: "POST", token, body: { url } }),
  importSheetPages: (token: string, id: string, rows: { handle: string; category?: string; followers?: number; format?: string; cost?: number; postsPerProfile?: number }[]) =>
    request<SheetImportResult>(`/plans/${id}/import-sheet-pages`, { method: "POST", token, body: { rows } }),
  // "Upload plan" from a whole-plan sheet (user request, 22 Sep). The CSV
  // comes from importSheetUrl above and is parsed client-side
  // (lib/parseAssignmentSheet.ts parsePlanSheet); createFromSheet makes the
  // plan, syncFromSheet is the card's Refresh (same stored link), and
  // addPendingPage is the one-click Add to inventory for a pending row.
  importSheetTabs: (token: string, url: string) =>
    request<{ tabs: { gid: string; title: string | null; csv: string }[] }>("/plans/import-sheet-tabs", { method: "POST", token, body: { url } }),
  createFromSheet: (token: string, body: ParsedPlanSheetPayload & { sourceSheetUrl: string; fields: ParsedPlanSheetPayload["fields"] & { name: string; clientName: string } }) =>
    request<Plan>("/plans/from-sheet", { method: "POST", token, body }),
  syncFromSheet: (token: string, id: string, body: ParsedPlanSheetPayload) => request<Plan>(`/plans/${id}/sheet-sync`, { method: "POST", token, body }),
  addPendingPage: (token: string, id: string, body: { handle: string; ownerId?: string }) =>
    request<Plan>(`/plans/${id}/sheet-pending/add`, { method: "POST", token, body }),
  // The plan's deliverable (user request, 10 Sep — "plan will be of google
  // sheet, not in pdf, it'll generate google sheet and will provide link"),
  // superseding the PDF downloads below as the primary Build-step action.
  generateSheet: (token: string, id: string, variant?: "client" | "internal") =>
    request<{ spreadsheetUrl: string; sharedWith?: string; shareError?: string }>(`/plans/${id}/sheet${variant === "internal" ? "?variant=internal" : ""}`, { method: "POST", token }),
  // The downloadable sample (user request, 10 Sep — "give downloadable
  // sample template for google sheet so they'll know how their execution
  // should look like") — one fixed document, not scoped to any plan.
  getExecutionSheetTemplate: (token: string) => request<{ spreadsheetUrl: string }>("/plans/execution-sheet-template", { method: "POST", token }),
  // The same sample as plain data, for an in-app preview table (user
  // request, 11 Sep — "show in preview" before pasting an execution sheet
  // link) — no Google account needed, unlike the live download above.
  previewExecutionSheetTemplate: (token: string) =>
    request<{ title: string; headers: string[]; rows: (string | number)[][]; totalsRow: (string | number)[]; linkColumns: number[] }>(
      "/plans/execution-sheet-template/preview",
      { token }
    ),
  // PDF export — kept as a secondary option (server-side unchanged and
  // still fully working) now that the Google Sheet above is primary.
  // variant: "internal" gets the real-numbers PDF instead of the
  // client-facing one — same endpoint, a query param apart.
  downloadPdf: (token: string, id: string, name?: string, variant?: "client" | "internal") =>
    downloadBinary(`${API_URL}/plans/${id}/pdf${variant === "internal" ? "?variant=internal" : ""}`, token, `${name ?? id}${variant === "internal" ? "-internal" : ""}.pdf`),
  downloadGroupPdf: (token: string, pitchGroupId: string, name?: string, variant?: "client" | "internal") =>
    downloadBinary(
      `${API_URL}/plans/group/${pitchGroupId}/pdf${variant === "internal" ? "?variant=internal" : ""}`,
      token,
      `${name ?? "plan-group"}${variant === "internal" ? "-internal" : ""}.pdf`
    ),
};

// Mirrors server's lib/permissions.js ROLE_DEFAULTS — used by the Add user
// form to pre-check a Finance/Planner account's own baseline sections in the
// access editor, and to decide whether a create request actually deviates
// from that baseline (only then is `permissions` sent at all).
export const ROLE_DEFAULT_PERMISSIONS: Record<Role, Permissions> = {
  ADMIN: Object.fromEntries(PERMISSION_KEYS.map((k) => [k, true])) as Permissions,
  FINANCE: Object.fromEntries(
    PERMISSION_KEYS.map((k) => [k, (["finance.view", "finance.edit", "finance.approve", "finance.pay", "campaigns.view", "inventory.view", "links.view"] as PermissionKey[]).includes(k)])
  ) as Permissions,
  // Own-scope roles hold no global key (24 Sep) — their switches are defaultOwnAccess().
  PLAN_MAKER: Object.fromEntries(PERMISSION_KEYS.map((k) => [k, false])) as Permissions,
  CREATOR: Object.fromEntries(PERMISSION_KEYS.map((k) => [k, false])) as Permissions,
  TEAM_MEMBER: Object.fromEntries(PERMISSION_KEYS.map((k) => [k, false])) as Permissions,
};

// ── Bulk Tracker (12 Oct) — server modules/bulkTrack ───────────────────
export type BulkRowStatus = "queued" | "done" | "failed" | "broken" | "not_fetched";

export interface BulkBatch {
  id: string;
  sourceType: "manual" | "sheet";
  sheetSourceId: string | null;
  status: "running" | "done";
  totalCount: number;
  successCount: number;
  failedCount: number;
  createdAt: string;
  sheetSource?: { sheetUrl: string } | null;
}

export interface BulkBatchProfile {
  id: string;
  username: string;
  profileUrl: string;
  category: string | null;
  status: BulkRowStatus;
  failureReason: string | null;
  followers: number | null;
}

export interface BulkPostMetrics {
  id: string;
  permalink: string;
  status: BulkRowStatus;
  postType: "reel" | "post" | null;
  failureReason: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  reposts: number | null;
  saves: number | null;
}

export interface BulkPostRow extends BulkPostMetrics {
  createdAt: string;
}

export interface BulkBatchDetail {
  batch: BulkBatch;
  profiles: BulkBatchProfile[];
  posts: BulkPostMetrics[];
}

export interface BulkSheetSource {
  id: string;
  name: string | null;
  sheetUrl: string;
  gid: string;
  profileLinkCol: string | null;
  postLinkCol: string | null;
  categoryCol: string | null;
  followersCol: string | null;
  dateCol: string | null;
  pageNameCol: string | null;
  fetchFollowers: boolean;
  fetchEngagement: boolean;
  lastCheckedAt: string | null;
  createdAt: string;
}

export interface BulkSheetPreview {
  headers: string[];
  sampleRow: Record<string, string> | null;
  rowCount: number;
  rows: Record<string, string>[];
}

export interface BulkSheetSourceInput {
  sheetUrl: string;
  gid?: string;
  name?: string;
  profileLinkCol?: string;
  postLinkCol?: string;
  categoryCol?: string;
  followersCol?: string;
  dateCol?: string;
  pageNameCol?: string;
  fetchFollowers: boolean;
  fetchEngagement: boolean;
}

/** `null` = manual entries (source=internal); an id = that sheet's posts. */
const bulkPostsQuery = (sheetSourceId: string | null) =>
  sheetSourceId ? `?source=sheet&sheetSourceId=${encodeURIComponent(sheetSourceId)}` : "?source=internal";

export const bulkTrack = {
  createBatch: (token: string, body: { profileLinks: string[]; postLinks: string[] }) =>
    request<{ batchId: string; queued: { profiles: number; posts: number }; skipped: { profiles: number; posts: number } }>("/bulk-track/batches", { method: "POST", token, body }),
  batches: (token: string) => request<BulkBatch[]>("/bulk-track/batches", { token }),
  batch: (token: string, id: string) => request<BulkBatchDetail>(`/bulk-track/batches/${id}`, { token }),
  exportBatch: (token: string, id: string) => downloadBinary(`${API_URL}/bulk-track/batches/${id}/export`, token, `bulk-track-${id}.xlsx`),
  refreshBatch: (token: string, id: string) => request<{ queued: number }>(`/bulk-track/batches/${id}/refresh`, { method: "POST", token }),
  deleteBatch: (token: string, id: string) =>
    request<{ success: true; deleted: { posts: number; profiles: number } }>(`/bulk-track/batches/${id}`, { method: "DELETE", token }),
  posts: (token: string, sheetSourceId: string | null) => request<BulkPostRow[]>(`/bulk-track/posts${bulkPostsQuery(sheetSourceId)}`, { token }),
  refreshPosts: (token: string, sheetSourceId: string | null) =>
    request<{ queued: number }>(`/bulk-track/posts/refresh${bulkPostsQuery(sheetSourceId)}`, { method: "POST", token }),
  previewSheet: (token: string, body: { sheetUrl: string; gid?: string }) =>
    request<BulkSheetPreview>("/bulk-track/sheet-sources/preview", { method: "POST", token, body }),
  connectSheet: (token: string, body: BulkSheetSourceInput) =>
    request<{ sheetSourceId: string; batchId: string; imported: { rows: number; profiles: number; posts: number } }>("/bulk-track/sheet-sources", { method: "POST", token, body }),
  sheetSources: (token: string, page: number, pageSize: number) =>
    request<{ sources: BulkSheetSource[]; total: number }>(`/bulk-track/sheet-sources?page=${page}&pageSize=${pageSize}`, { token }),
  checkSheet: (token: string, id: string) =>
    request<{ newRowsFound: number; batchId: string | null; imported: { rows: number; profiles: number; posts: number } }>(`/bulk-track/sheet-sources/${id}/check`, { method: "POST", token }),
  deleteSheet: (token: string, id: string) =>
    request<{ success: true; deleted: { posts: number; profiles: number; batches: number } }>(`/bulk-track/sheet-sources/${id}`, { method: "DELETE", token }),
};
