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
  { method = "GET", body, token, _isRetry = false }: { method?: string; body?: unknown; token?: string | null; _isRetry?: boolean } = {}
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return undefined as T;

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Never intercept /auth/* itself — login failing with 401 is a wrong
    // password, not an expired session, and refresh's own 401 is handled
    // by refreshAccessToken's catch, not by recursing back into refreshing.
    if (res.status === 401 && token && !_isRetry && !path.startsWith("/auth/")) {
      const freshToken = await refreshAccessToken();
      if (freshToken) return request<T>(path, { method, body, token: freshToken, _isRetry: true });
    }
    throw new ApiError(res.status, data?.error?.code ?? "UNKNOWN", data?.error?.message ?? res.statusText);
  }
  return data as T;
}

// ── Types (fields the UI actually reads) ──────────────────────────────
export type Role = "CREATOR" | "TEAM_MEMBER" | "ADMIN" | "FINANCE";

export interface User {
  id: string;
  phoneNumber: string;
  name: string | null;
  role: Role;
  whatsappVerified: boolean;
  email?: string | null;
  secondaryPhone?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  state?: string | null;
  pincode?: string | null;
  createdAt?: string;
}

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
  user?: { id: string; name: string | null; phoneNumber: string };
}

export interface AuthResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
}

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
export const LINK_FORMATS = ["reel", "story", "carousel", "collaboration", "video"] as const;

export interface Asset {
  id: string;
  ownerId: string;
  platform: string;
  handle: string;
  followers: number;
  /** Free-form, e.g. "Meme page", "News page" — set at creation. */
  category?: string | null;
  approvalStatus: string;
  createdAt: string;
  rateCards: RateCard[];
  engagement: { avgLikes: number | null; avgComments: number | null; avgViews: number | null; sampleSize: number };
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
  /** costCap - spent, or null if no cap was set. */
  remainingBudget?: number | null;
  /** Rows from an attached sheet still waiting on a page/creator to be created for them. */
  pendingAssignmentCount?: number;
}

export interface CampaignAssignment {
  id: string;
  campaignId: string;
  assetId: string | null;
  pageHandle: string;
  creatorPhone: string | null;
  status: "pending" | "matched";
  createdAt: string;
  asset?: { id: string; handle: string; category: string | null; approvalStatus: string } | null;
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
export const INVOICEABLE_LINK_STATUSES: Link["status"][] = ["SCREENSHOT_APPROVED", "INSIGHTS_PENDING", "INSIGHTS_APPROVED"];
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
    | "INVOICED";
  postedAt: string | null;
  createdAt: string;
  campaign?: Campaign;
  asset?: Asset;
  screenshot?: { id: string; publicId: string; approved: boolean | null; url: string | null } | null;
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
  creator?: { id: string; name: string | null; phoneNumber: string };
  items?: { id: string; amount: string; link: Link }[];
  billingProfile?: BillingProfile | null;
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
  asset?: { id: string; handle: string; category: string | null; followers: number };
}

export interface Plan {
  id: string;
  name: string;
  clientName: string;
  clientContact: string | null;
  budget: string | null;
  createdAt: string;
  updatedAt: string;
  items: PlanItem[];
  /** Sum of every item's cost. */
  totalCost: number;
  /** budget - totalCost. Positive = under budget, negative = over. Null if no budget was set. */
  budgetVariance: number | null;
  /** Summed avg. likes/views across the plan's distinct pages. */
  expectedEngagement: { likes: number; views: number };
  createdBy?: { id: string; name: string | null };
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
  login: (phoneNumber: string, password: string) =>
    request<AuthResponse>("/auth/login", { method: "POST", body: { phoneNumber, password } }),
  refresh: (refreshToken: string) =>
    request<AuthResponse>("/auth/refresh", { method: "POST", body: { refreshToken } }),
  logout: (refreshToken: string) =>
    request<void>("/auth/logout", { method: "POST", body: { refreshToken } }),
  changePassword: (token: string, currentPassword: string, newPassword: string) =>
    request<void>("/auth/change-password", { method: "POST", token, body: { currentPassword, newPassword } }),
  // Admin-only — creates the account and returns a system-generated password, shown once.
  signup: (token: string, body: { phoneNumber: string; name?: string; role: Role }) =>
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
};

// ── Assets ──────────────────────────────────────────────────────────
export const assets = {
  list: (token: string) => request<Asset[]>("/assets", { token }),
  create: (token: string, handle: string, platform = "instagram", opts: { category?: string; ownerId?: string } = {}) =>
    request<Asset>("/assets", { method: "POST", token, body: { handle, platform, ...opts } }),
  updateRateCard: (token: string, assetId: string, rateCards: { format: string; amount: number }[]) =>
    request<RateCard[]>(`/assets/${assetId}/rate-card`, { method: "PUT", token, body: { rateCards } }),
  setApproval: (token: string, assetId: string, approvalStatus: "approved" | "rejected" | "pending") =>
    request<Asset>(`/assets/${assetId}/approval`, { method: "PUT", token, body: { approvalStatus } }),
};

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
      assignments?: { handle: string; phone?: string }[];
    }
  ) =>
    request<{ campaign: Campaign; matchedCount: number; pendingCount: number }>("/campaigns", {
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
};

// ── Links ───────────────────────────────────────────────────────────
export const links = {
  list: (
    token: string,
    params: { status?: string; assetId?: string; campaignId?: string; from?: string; to?: string; page?: number; pageSize?: number } = {}
  ) => {
    const qs = new URLSearchParams();
    if (params.status) qs.set("status", params.status);
    if (params.assetId) qs.set("assetId", params.assetId);
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

// ── Invoices ────────────────────────────────────────────────────────
export const invoices = {
  list: (token: string, params: { status?: string; paymentStatus?: string; search?: string; page?: number; pageSize?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.status) qs.set("status", params.status);
    if (params.paymentStatus) qs.set("paymentStatus", params.paymentStatus);
    if (params.search) qs.set("search", params.search);
    qs.set("page", String(params.page ?? 1));
    qs.set("pageSize", String(params.pageSize ?? 100));
    return request<Paginated<Invoice>>(`/invoices?${qs}`, { token });
  },
  bulkCreate: (token: string, linkIds: string[], dueInDays = 15, isGstInvoice = false) =>
    request<Invoice>("/invoices/bulk", { method: "POST", token, body: { linkIds, dueInDays, isGstInvoice } }),
  markPaid: (token: string, invoiceId: string) =>
    request<Invoice>(`/invoices/${invoiceId}/mark-paid`, { method: "POST", token }),
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
  // Manual trigger for the daily finance export (newTask.md #2) — same job
  // the cron runs, reported back synchronously so it's actually testable.
  runFinanceExportNow: (token: string) =>
    request<{ ok: true; commitSha?: string; htmlUrl?: string }>("/admin/finance-export/run-now", { method: "POST", token }),
  // Reset-and-reveal, not a stored/recoverable password — see admin/service.js.
  resetPassword: (token: string, userId: string) =>
    request<{ generatedPassword: string }>(`/admin/users/${userId}/reset-password`, { method: "POST", token }),
};

// ── Plans ("Inventory") ────────────────────────────────────────────
export interface PlanItemInput {
  assetId: string;
  format: string;
  /** Omit to fall back to the page's rate card for that format. */
  cost?: number;
}

export const plans = {
  list: (token: string) => request<Plan[]>("/plans", { token }),
  get: (token: string, id: string) => request<Plan>(`/plans/${id}`, { token }),
  create: (
    token: string,
    body: { name: string; clientName: string; clientContact?: string; budget?: number; items?: PlanItemInput[] }
  ) => request<Plan>("/plans", { method: "POST", token, body }),
  update: (
    token: string,
    id: string,
    body: Partial<{ name: string; clientName: string; clientContact: string | null; budget: number | null; items: PlanItemInput[] }>
  ) => request<Plan>(`/plans/${id}`, { method: "PUT", token, body }),
  remove: (token: string, id: string) => request<void>(`/plans/${id}`, { method: "DELETE", token }),
  // Binary response, same pattern as invoices.downloadPdf.
  downloadPdf: async (token: string, id: string, name?: string) => {
    const res = await fetch(`${API_URL}/plans/${id}/pdf`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new ApiError(res.status, data?.error?.code ?? "UNKNOWN", data?.error?.message ?? res.statusText);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name ?? id}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
};
