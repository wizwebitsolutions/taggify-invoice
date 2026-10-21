"use client";

import { useQuery, type QueryClient } from "@tanstack/react-query";

import { useAuth } from "@/lib/auth-context";
import { assets as assetsApi, canUse, invoices as invoicesApi, links as linksApi, payments as paymentsApi, screenshots as screenshotsApi, type Link } from "@/lib/api-client";

/**
 * Creator / team-member data. Every endpoint is own-scope server-side (the
 * server forces the owner to the caller), and each hook only asks when the
 * caller's own-content switch for it is on.
 */
export const creatorKeys = {
  posts: ["links", "mine"] as const,
  pending: ["payments", "me", "pending"] as const,
  summary: (from?: string, to?: string) => ["payments", "me", "summary", from ?? "", to ?? ""] as const,
  paid: ["payments", "me", "paid"] as const,
  invoices: ["invoices", "mine"] as const,
  pages: ["assets", "mine"] as const,
};

function useOwnToken(key: Parameters<typeof canUse>[1]) {
  const { accessToken, user } = useAuth();
  return canUse(user, key) ? accessToken : null;
}

/** Creator money (payments /me/*, own invoices): team members never see billing, so don't ask. */
function useMoneyToken() {
  const { user } = useAuth();
  const token = useOwnToken("finance.view");
  return user?.role === "CREATOR" ? token : null;
}

/** Every post of the caller's (or their creator's) pages — up to 500, newest first. */
export function useMyPosts() {
  const token = useOwnToken("links.view");
  return useQuery({
    queryKey: creatorKeys.posts,
    queryFn: async () => {
      const items: Link[] = [];
      for (let page = 1; page <= 5; page++) {
        const r = await linksApi.list(token!, { page, pageSize: 100 });
        items.push(...r.items);
        if (items.length >= r.total || r.items.length === 0) break;
      }
      return items;
    },
    enabled: !!token,
  });
}

export function useMyPending() {
  const token = useMoneyToken();
  return useQuery({ queryKey: creatorKeys.pending, queryFn: () => paymentsApi.listMyPending(token!), enabled: !!token });
}

export function useMySummary(range: { from?: string; to?: string } = {}) {
  const token = useMoneyToken();
  return useQuery({ queryKey: creatorKeys.summary(range.from, range.to), queryFn: () => paymentsApi.mySummary(token!, range), enabled: !!token });
}

export function useMyPaid() {
  const token = useMoneyToken();
  return useQuery({ queryKey: creatorKeys.paid, queryFn: () => paymentsApi.listMyPaid(token!), enabled: !!token });
}

export function useMyInvoices() {
  const token = useMoneyToken();
  return useQuery({ queryKey: creatorKeys.invoices, queryFn: () => invoicesApi.list(token!, { pageSize: 100 }), enabled: !!token });
}

export function useMyPages() {
  const token = useOwnToken("inventory.view");
  return useQuery({ queryKey: creatorKeys.pages, queryFn: () => assetsApi.list(token!), enabled: !!token });
}

export function invalidateCreator(qc: QueryClient) {
  return Promise.all(["links", "payments", "invoices", "assets", "campaigns"].map((k) => qc.invalidateQueries({ queryKey: [k] })));
}

/** Signed direct-to-Cloudinary upload of a proof screenshot, then confirm (moves the post to "proof in review"). */
export async function uploadProof(token: string, linkId: string, file: File) {
  const params = await screenshotsApi.requestUploadUrl(token, linkId);
  const form = new FormData();
  form.append("file", file);
  form.append("api_key", params.apiKey);
  form.append("timestamp", String(params.timestamp));
  form.append("signature", params.signature);
  form.append("public_id", params.publicId);
  const res = await fetch(params.uploadUrl, { method: "POST", body: form });
  if (!res.ok) throw new Error("The screenshot upload didn't go through. Check your connection and try again.");
  return screenshotsApi.confirm(token, linkId, params.publicId);
}

export const PROOF_MAX_BYTES = 8 * 1024 * 1024;
export function proofProblem(file: File): string | null {
  if (!file.type.startsWith("image/")) return `${file.name} isn't an image. Upload a screenshot (PNG or JPG).`;
  if (file.size > PROOF_MAX_BYTES) return `${file.name} is over 8 MB. Upload a smaller screenshot.`;
  return null;
}
