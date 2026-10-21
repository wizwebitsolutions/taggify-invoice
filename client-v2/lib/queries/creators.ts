"use client";

import { useQuery, type QueryClient } from "@tanstack/react-query";

import { useAuth } from "@/lib/auth-context";
import { assets as assetsApi } from "@/lib/api-client";
import { canAddForOwner, canViewCreators, isFetching } from "@/lib/creators";

/** Every page this user may see (same key as Finance's useAssets so both share one fetch). */
export function useAllPages() {
  const { accessToken, user } = useAuth();
  return useQuery({
    queryKey: ["assets", "all"],
    queryFn: () => assetsApi.list(accessToken!),
    enabled: !!accessToken && canViewCreators(user),
    // Followers and averages arrive from Instagram in the background; poll while any page is still being fetched.
    refetchInterval: (query) => ((query.state.data ?? []).some(isFetching) ? 5_000 : false),
  });
}

/** Creator accounts a page can be registered under. */
export function usePageOwners(enabled = true) {
  const { accessToken, user } = useAuth();
  return useQuery({ queryKey: ["assets", "owners"], queryFn: () => assetsApi.owners(accessToken!), enabled: enabled && !!accessToken && canAddForOwner(user) });
}

/** A page change can move a vendor's payout identity, the approvals queue and plan pickers. */
export function invalidatePages(qc: QueryClient) {
  return qc.invalidateQueries({ queryKey: ["assets"] });
}
