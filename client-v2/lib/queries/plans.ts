"use client";

import { useQuery, type QueryClient } from "@tanstack/react-query";

import { useAuth } from "@/lib/auth-context";
import { plans as plansApi } from "@/lib/api-client";
import { canViewPlans } from "@/lib/plans";

/**
 * Plans hooks. Keys start with "plans"; approving a plan also creates a
 * campaign, so invalidateAfterPlanChange refreshes campaigns too.
 */
export const planKeys = {
  all: ["plans", "list"] as const,
  one: (id: string) => ["plans", "one", id] as const,
  clients: ["plans", "clients"] as const,
};

function usePlanToken() {
  const { accessToken, user } = useAuth();
  return canViewPlans(user) ? accessToken : null;
}

export function usePlans() {
  const token = usePlanToken();
  return useQuery({ queryKey: planKeys.all, queryFn: () => plansApi.list(token!), enabled: !!token });
}

export function usePlan(id: string) {
  const token = usePlanToken();
  return useQuery({ queryKey: planKeys.one(id), queryFn: () => plansApi.get(token!, id), enabled: !!token && !!id });
}

export function useSavedClients() {
  const token = usePlanToken();
  return useQuery({ queryKey: planKeys.clients, queryFn: () => plansApi.clients(token!), enabled: !!token, staleTime: 60_000 });
}

export function invalidateAfterPlanChange(qc: QueryClient) {
  // A plan can mint its client invoice, so Receivables and the Finance overview refresh too.
  return Promise.all([qc.invalidateQueries({ queryKey: ["plans"] }), qc.invalidateQueries({ queryKey: ["campaigns"] }), qc.invalidateQueries({ queryKey: ["clientInvoices"] })]);
}
