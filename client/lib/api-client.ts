/**
 * Typed client for server/ (system design.md §2.3). One function per
 * backend route — every screen calls through here, never a raw fetch()
 * inline in a component. Single source for the API base URL and the
 * auth-header/error-shape conventions.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(
  path: string,
  { method = "GET", body, token }: { method?: string; body?: unknown; token?: string | null } = {}
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

export interface Asset {
  id: string;
  ownerId: string;
  platform: string;
  handle: string;
  followers: number;
  approvalStatus: string;
  createdAt: string;
  rateCards: RateCard[];
}

export interface Campaign {
  id: string;
  brandName: string;
  title: string;
  createdAt: string;
}

export interface PostSnapshot {
  likeCount: number;
  commentsCount: number;
  videoViews: number;
  capturedAt: string;
}

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
  screenshot?: { id: string; r2Key: string; approved: boolean | null } | null;
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
  amount: string;
  status: "DRAFT" | "RAISED" | "APPROVED" | "PAID";
  gstStatus: "PENDING" | "SCHEDULED" | "COMPLETED";
  dueDate: string | null;
  paidAt: string | null;
  createdAt: string;
  overdueDays: number;
  items?: { id: string; amount: string; link: Link }[];
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
};

// ── Users ───────────────────────────────────────────────────────────
export const users = {
  me: (token: string) => request<User>("/users/me", { token }),
  team: (token: string) => request<TeamMembership[]>("/users/me/team", { token }),
  addTeamMember: (token: string, userId: string, canSeeMoney: boolean) =>
    request<TeamMembership>("/users/me/team", { method: "POST", token, body: { userId, canSeeMoney } }),
};

// ── Assets ──────────────────────────────────────────────────────────
export const assets = {
  list: (token: string) => request<Asset[]>("/assets", { token }),
  create: (token: string, handle: string, platform = "instagram") =>
    request<Asset>("/assets", { method: "POST", token, body: { handle, platform } }),
  updateRateCard: (token: string, assetId: string, rateCards: { format: string; amount: number }[]) =>
    request<RateCard[]>(`/assets/${assetId}/rate-card`, { method: "PUT", token, body: { rateCards } }),
};

// ── Campaigns ───────────────────────────────────────────────────────
export const campaigns = {
  list: (token: string) => request<Campaign[]>("/campaigns", { token }),
  create: (token: string, brandName: string, title: string) =>
    request<Campaign>("/campaigns", { method: "POST", token, body: { brandName, title } }),
};

// ── Links ───────────────────────────────────────────────────────────
export const links = {
  list: (token: string, params: { status?: string; page?: number; pageSize?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.status) qs.set("status", params.status);
    qs.set("page", String(params.page ?? 1));
    qs.set("pageSize", String(params.pageSize ?? 100));
    return request<Paginated<Link>>(`/links?${qs}`, { token });
  },
  create: (token: string, body: { campaignId: string; assetId: string; url: string; format: string }) =>
    request<Link>("/links", { method: "POST", token, body }),
  timeline: (token: string, linkId: string) =>
    request<LinkStatusEvent[]>(`/links/${linkId}/timeline`, { token }),
  reviewScreenshot: (token: string, linkId: string, approved: boolean, note?: string) =>
    request<Link>(`/links/${linkId}/review-screenshot`, { method: "POST", token, body: { approved, note } }),
  approveInsights: (token: string, linkId: string) =>
    request<Link>(`/links/${linkId}/approve-insights`, { method: "POST", token }),
  refreshMetrics: (token: string, linkId: string) =>
    request<{ ok: boolean; reason?: string }>(`/links/${linkId}/refresh-metrics`, { method: "POST", token }),
};

// ── Screenshots ─────────────────────────────────────────────────────
export const screenshots = {
  requestUploadUrl: (token: string, linkId: string, contentType = "image/jpeg") =>
    request<{ uploadUrl: string; r2Key: string }>(`/links/${linkId}/screenshot/upload-url`, {
      method: "POST",
      token,
      body: { contentType },
    }),
  confirm: (token: string, linkId: string, r2Key: string) =>
    request<{ id: string; r2Key: string; url: string | null }>(`/links/${linkId}/screenshot`, {
      method: "POST",
      token,
      body: { r2Key },
    }),
};

// ── Invoices ────────────────────────────────────────────────────────
export const invoices = {
  list: (token: string, params: { status?: string; page?: number; pageSize?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.status) qs.set("status", params.status);
    qs.set("page", String(params.page ?? 1));
    qs.set("pageSize", String(params.pageSize ?? 100));
    return request<Paginated<Invoice>>(`/invoices?${qs}`, { token });
  },
  bulkCreate: (token: string, linkIds: string[], dueInDays = 15) =>
    request<Invoice>("/invoices/bulk", { method: "POST", token, body: { linkIds, dueInDays } }),
  markPaid: (token: string, invoiceId: string) =>
    request<Invoice>(`/invoices/${invoiceId}/mark-paid`, { method: "POST", token }),
  updateGstStatus: (token: string, invoiceId: string, gstStatus: Invoice["gstStatus"]) =>
    request<Invoice>(`/invoices/${invoiceId}/gst-status`, { method: "PUT", token, body: { gstStatus } }),
};

// ── Notifications ───────────────────────────────────────────────────
export const notifications = {
  list: (token: string, unreadOnly = false) =>
    request<Notification[]>(`/notifications${unreadOnly ? "?unread=true" : ""}`, { token }),
  markRead: (token: string, id: string) =>
    request<void>(`/notifications/${id}/read`, { method: "POST", token }),
};

// ── Admin ───────────────────────────────────────────────────────────
export const admin = {
  users: (token: string) => request<User[]>("/admin/users", { token }),
  jobRuns: (token: string) => request<JobRun[]>("/admin/job-runs", { token }),
};
