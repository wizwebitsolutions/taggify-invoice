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
  email?: string | null;
  secondaryPhone?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  state?: string | null;
  pincode?: string | null;
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

export interface Asset {
  id: string;
  ownerId: string;
  platform: string;
  handle: string;
  followers: number;
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
  screenshot?: { id: string; publicId: string; approved: boolean | null } | null;
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
  status: "DRAFT" | "RAISED" | "APPROVED" | "REJECTED" | "PAID";
  paymentStatus: "PENDING" | "COMPLETED" | "CANCELLED";
  gstStatus: "PENDING" | "SCHEDULED" | "COMPLETED";
  remarks: string | null;
  dueDate: string | null;
  paidAt: string | null;
  createdAt: string;
  overdueDays: number;
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
  create: (token: string, handle: string, platform = "instagram") =>
    request<Asset>("/assets", { method: "POST", token, body: { handle, platform } }),
  updateRateCard: (token: string, assetId: string, rateCards: { format: string; amount: number }[]) =>
    request<RateCard[]>(`/assets/${assetId}/rate-card`, { method: "PUT", token, body: { rateCards } }),
};

// ── Campaigns ───────────────────────────────────────────────────────
export const campaigns = {
  list: (token: string) => request<Campaign[]>("/campaigns", { token }),
  create: (token: string, brandName: string, title: string, deadline?: string) =>
    request<Campaign>("/campaigns", { method: "POST", token, body: { brandName, title, deadline } }),
  update: (token: string, id: string, body: { brandName?: string; title?: string; deadline?: string | null }) =>
    request<Campaign>(`/campaigns/${id}`, { method: "PUT", token, body }),
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
  bulkCreate: (token: string, linkIds: string[], dueInDays = 15) =>
    request<Invoice>("/invoices/bulk", { method: "POST", token, body: { linkIds, dueInDays } }),
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
  jobRuns: (token: string) => request<JobRun[]>("/admin/job-runs", { token }),
};
