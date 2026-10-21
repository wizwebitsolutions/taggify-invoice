"use client";

import { useQuery, type QueryClient } from "@tanstack/react-query";

import { useAuth } from "@/lib/auth-context";
import { assets as assetsApi, billing as billingApi, hasAccess, hasOwnAccess, payments as paymentsApi, type PaymentsFilters } from "@/lib/api-client";

/**
 * React Query hooks for Finance. Every key starts with "payments", "assets"
 * or "billing" so a payout can invalidate exactly what it changed
 * (invalidateAfterPayout) and the screens never show stale dues.
 */
export const financeKeys = {
  summary: (f: PaymentsFilters) => ["payments", "summary", f] as const,
  pending: (f: PaymentsFilters) => ["payments", "pending", f] as const,
  paid: (f: PaymentsFilters & { creatorId?: string }) => ["payments", "paid", f] as const,
  drafts: (creatorId?: string) => ["payments", "drafts", creatorId ?? "all"] as const,
  assets: ["assets", "all"] as const,
  billing: ["billing", "all"] as const,
};

/** The /payments admin routes are gated on finance.pay server-side; don't even ask without it. */
function usePayToken() {
  const { accessToken, user } = useAuth();
  return hasAccess(user, "finance.pay") ? accessToken : null;
}

export function usePaymentSummary(filters: PaymentsFilters) {
  const token = usePayToken();
  return useQuery({ queryKey: financeKeys.summary(filters), queryFn: () => paymentsApi.summary(token!, filters), enabled: !!token });
}

export function usePendingDues(filters: PaymentsFilters = {}) {
  const token = usePayToken();
  return useQuery({ queryKey: financeKeys.pending(filters), queryFn: () => paymentsApi.listPending(token!, filters), enabled: !!token });
}

export function usePaidLedger(filters: Omit<PaymentsFilters, "ownerId"> & { creatorId?: string }) {
  const token = usePayToken();
  return useQuery({ queryKey: financeKeys.paid(filters), queryFn: () => paymentsApi.listPaid(token!, filters), enabled: !!token });
}

/** Payouts created but never given a receipt — their links are locked until finished or cancelled. */
export function useDraftPayouts(creatorId?: string) {
  const token = usePayToken();
  return useQuery({
    queryKey: financeKeys.drafts(creatorId),
    queryFn: () => paymentsApi.listPayouts(token!, { status: "DRAFT", creatorId }),
    enabled: !!token,
  });
}

/** All pages (Finance can read Inventory) — for page photos, followers, platform and category. */
export function useAssets() {
  const { accessToken, user } = useAuth();
  const token = hasAccess(user, "inventory.view") || hasOwnAccess(user, "inventory.view") ? accessToken : null;
  return useQuery({ queryKey: financeKeys.assets, queryFn: () => assetsApi.list(token!), enabled: !!token, staleTime: 60_000 });
}

export function useBillingProfiles() {
  const { accessToken, user } = useAuth();
  const token = hasAccess(user, "finance.view") ? accessToken : null;
  return useQuery({ queryKey: financeKeys.billing, queryFn: () => billingApi.list(token!), enabled: !!token, staleTime: 60_000 });
}

/** A payout moves links from Pending to Paid and changes every money tile. */
export function invalidateAfterPayout(qc: QueryClient) {
  return Promise.all([qc.invalidateQueries({ queryKey: ["payments"] }), qc.invalidateQueries({ queryKey: ["links"] }), qc.invalidateQueries({ queryKey: ["invoices"] })]);
}
